(function () {
  "use strict";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbzE0XZ-FU4FRdJXoFWUhgSsCrRPZKHRCaOpwZ16Ww9M7Ffgy0O6Xi2QvgxQNhplZxsd/exec";
  const IP_URL = "https://api64.ipify.org?format=json";
  const SCHEMAS = {
    Contact: { sheet: "Contact", fields: ["Email", "Nume", "Mesaj"] },
    Telefon: { sheet: "Telefon", fields: ["Telefon"] },
    Newsletter: { sheet: "Newsletter", fields: ["Email"] },
  };
  const MESSAGES = {
    Contact: "Mesajul a fost trimis. Îți mulțumim!",
    Telefon: "Cererea ta a fost înregistrată. Te vom contacta telefonic.",
    Newsletter: "Adresa ta a fost înregistrată pentru newsletter.",
  };
  let cachedIP = "";

  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  async function getIP() {
    if (cachedIP) return cachedIP;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(IP_URL, {
        signal: controller.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new Error("IP lookup failed");
      const result = await response.json();
      if (typeof result.ip !== "string") throw new Error("IP lookup returned no address");
      cachedIP = result.ip;
      return cachedIP;
    } catch (_) {
      return "";
    } finally {
      clearTimeout(timer);
    }
  }

  function showStatus(form, message, isError, retryNewsletter) {
    const status = form.parentElement.querySelector("[data-form-status]");
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
    status.classList.toggle("is-success", Boolean(message) && !isError);
    if (retryNewsletter) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "solon-newsletter-retry";
      button.textContent = "Reîncearcă abonarea";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await retryNewsletter();
          form.reset();
          showStatus(form, "Mesajul a fost trimis, iar adresa a fost înregistrată.", false);
        } catch (_) {
          showStatus(
            form,
            "Mesajul a fost trimis. Abonarea la newsletter nu a putut fi confirmată.",
            true,
            retryNewsletter
          );
        }
      });
      status.append(" ", button);
    }
  }

  async function postForm(type, values) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${API_URL}?sheet=${encodeURIComponent(SCHEMAS[type].sheet)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({ action: "append", data: values }),
      });
      if (!response.ok) throw new Error("Request failed");
      const result = await response.json();
      if (!result || result.ok !== true) throw new Error("The API did not confirm the save");
    } finally {
      clearTimeout(timer);
    }
  }

  function valuesFor(form, type, ip, date) {
    const values = { Data: date, IP: ip };
    SCHEMAS[type].fields.forEach((name) => {
      const field = form.elements.namedItem(name);
      values[name] = (field ? field.value : "").trim();
    });
    return values;
  }

  function setupFormButtons(form) {
    form.querySelectorAll('input[type="submit"]').forEach((input) => {
      if (typeof document !== "undefined" && document.createElement) {
        const button = document.createElement("button");
        button.type = "submit";
        if (input.id) button.id = input.id;
        if (input.className) button.className = input.className;
        button.textContent = input.value;
        if (input.replaceWith) {
          input.replaceWith(button);
        }
      }
    });
  }

  function lock(form, locked) {
    form.querySelectorAll('[type="submit"]').forEach((button) => {
      button.disabled = locked;
      if (!button.dataset) button.dataset = {};

      if (locked) {
        if (button.dataset.originalHtml === undefined && button.innerHTML !== undefined) {
          button.dataset.originalHtml = button.innerHTML;
        }
        if (button.dataset.originalValue === undefined && button.value !== undefined) {
          button.dataset.originalValue = button.value;
        }
        if (button.classList && button.classList.add) {
          button.classList.add("is-loading");
        }
        if (button.tagName === "INPUT") {
          button.value = "Se trimite...";
        } else if (button.innerHTML !== undefined) {
          const label = button.dataset.originalHtml || button.textContent || "Trimite";
          button.innerHTML = `<span class="solon-btn-spinner" aria-hidden="true"></span><span class="solon-btn-label">${label}</span>`;
        }
      } else {
        if (button.classList && button.classList.remove) {
          button.classList.remove("is-loading");
        }
        if (button.tagName === "INPUT" && button.dataset.originalValue !== undefined) {
          button.value = button.dataset.originalValue;
        } else if (button.dataset.originalHtml !== undefined && button.innerHTML !== undefined) {
          button.innerHTML = button.dataset.originalHtml;
        }
      }
    });
  }

  document.querySelectorAll("form[data-solon-form]").forEach((form) => {
    const type = form.dataset.solonForm;
    if (!SCHEMAS[type]) return;

    setupFormButtons(form);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "true") return;
      if (!form.reportValidity()) return;

      form.dataset.submitting = "true";
      lock(form, true);
      showStatus(form, "", false);

      const date = today();
      const ip = await getIP();
      const values = valuesFor(form, type, ip, date);
      try {
        await postForm(type, values);

        if (type === "Contact" && form.elements.namedItem("NewsletterOptIn")?.checked) {
          try {
            await postForm("Newsletter", { Data: date, Email: values.Email, IP: ip });
          } catch (_) {
            form.reset();
            form.elements.namedItem("Email").value = values.Email;
            showStatus(
              form,
              "Mesajul a fost trimis. Abonarea la newsletter nu a putut fi confirmată.",
              true,
              () => postForm("Newsletter", { Data: date, Email: values.Email, IP: ip })
            );
            return;
          }
        }

        form.reset();
        showStatus(form, MESSAGES[type], false);
      } catch (_) {
        showStatus(form, "Trimiterea nu a reușit. Verifică datele și încearcă din nou.", true);
      } finally {
        form.dataset.submitting = "false";
        lock(form, false);
      }
    });
  });
})();
