"use strict";

(function () {
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
  const USER_ERRORS = {
    timeout: "Conexiunea a expirat. Te rugăm să încerci din nou.",
    network: "Nu am putut contacta serverul. Verifică conexiunea și încearcă din nou.",
    http: "Trimiterea nu a reușit. Te rugăm să încerci din nou.",
    invalid_response: "Trimiterea nu a reușit. Te rugăm să încerci din nou.",
    unconfirmed: "Trimiterea nu a reușit. Te rugăm să încerci din nou.",
    unknown: "Trimiterea nu a reușit. Verifică datele și încearcă din nou.",
  };
  const IP_RETRY_DELAYS_MS = [0, 250, 750];
  let cachedIP = "";

  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const logEvent = (level, details) => {
    try {
      const logger = globalThis?.SolonLog;
      if (typeof logger?.[level] === "function") {
        logger[level](details);
        return;
      }
      const method = level === "error" || level === "critical" ? "error" : level === "warn" ? "warn" : "info";
      if (typeof console?.[method] === "function") {
        console[method](`[solon ${level}]`, details);
      }
    } catch {
      return;
    }
  };

  const classifySubmitError = (error) => {
    if (!error) return "unknown";
    if (error.solonCode) return error.solonCode;
    const name = error.name || "";
    const message = String(error.message || "");
    if (name === "AbortError" || /aborted|timeout/i.test(message)) return "timeout";
    if (name === "TypeError" || /failed to fetch|network/i.test(message)) return "network";
    if (name === "SyntaxError") return "invalid_response";
    if (message === "Request failed") return "http";
    if (message === "The API did not confirm the save") return "unconfirmed";
    return "unknown";
  };

  const taggedError = (solonCode, error) => {
    if (error && typeof error === "object") error.solonCode = solonCode;
    return error;
  };

  const getIP = async () => {
    if (cachedIP) return cachedIP;
    for (let attempt = 0; attempt < IP_RETRY_DELAYS_MS.length; attempt++) {
      if (IP_RETRY_DELAYS_MS[attempt]) await wait(IP_RETRY_DELAYS_MS[attempt]);
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
      } catch (error) {
        if (attempt === IP_RETRY_DELAYS_MS.length - 1) {
          logEvent("warn", {
            type: "ip_lookup_failed",
            reason: classifySubmitError(error),
            name: error?.name,
          });
          return "";
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return "";
  };

  const showStatus = (form, message, isError, retry) => {
    const status = form.parentElement.querySelector("[data-form-status]");
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
    status.classList.toggle("is-success", Boolean(message) && !isError);
    if (!retry) return;

    const retryFn = typeof retry === "function" ? retry : retry.run;
    const retryLabel =
      retry?.label || (typeof retry === "function" ? "Reîncearcă abonarea" : "Încearcă din nou");
    const managed = Boolean(retry?.managed);
    const button = document.createElement("button");
    button.type = "button";
    button.className = managed ? "solon-form-retry" : "solon-newsletter-retry";
    button.textContent = retryLabel;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await retryFn();
        if (!managed) {
          form.reset();
          showStatus(form, "Mesajul a fost trimis, iar adresa a fost înregistrată.", false);
        }
      } catch {
        if (!managed) {
          showStatus(
            form,
            "Mesajul a fost trimis. Abonarea la newsletter nu a putut fi confirmată.",
            true,
            retry
          );
        }
      }
    });
    status.append(" ", button);
  };

  const postForm = async (type, values) => {
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
      if (!response.ok) throw taggedError("http", new Error("Request failed"));
      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        throw taggedError("invalid_response", parseError);
      }
      if (!result || result.ok !== true) {
        throw taggedError("unconfirmed", new Error("The API did not confirm the save"));
      }
    } catch (error) {
      if (error?.solonCode) throw error;
      throw taggedError(classifySubmitError(error), error);
    } finally {
      clearTimeout(timer);
    }
  };

  const valuesFor = (form, type, ip, date) => {
    const values = { Data: date, IP: ip };
    SCHEMAS[type].fields.forEach((name) => {
      const field = form.elements.namedItem(name);
      values[name] = (field ? field.value : "").trim();
    });
    return values;
  };

  const setupFormButtons = (form) => {
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
  };

  const lock = (form, locked) => {
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
        if (button.classList?.add) {
          button.classList.add("is-loading");
        }
        if (button.tagName === "INPUT") {
          button.value = "Se trimite...";
        } else if (button.innerHTML !== undefined) {
          const label = button.dataset.originalHtml || button.textContent || "Trimite";
          button.innerHTML = `<span class="solon-btn-spinner" aria-hidden="true"></span><span class="solon-btn-label">${label}</span>`;
        }
      } else {
        if (button.classList?.remove) {
          button.classList.remove("is-loading");
        }
        if (button.tagName === "INPUT" && button.dataset.originalValue !== undefined) {
          button.value = button.dataset.originalValue;
        } else if (button.dataset.originalHtml !== undefined && button.innerHTML !== undefined) {
          button.innerHTML = button.dataset.originalHtml;
        }
      }
    });
  };

  const handleSubmit = async (form, type) => {
    if (form.dataset.submitting === "true") return;
    if (!form.reportValidity()) return;

    form.dataset.submitting = "true";
    lock(form, true);
    showStatus(form, "", false);

    try {
      const date = today();
      const ip = await getIP();
      const values = valuesFor(form, type, ip, date);
      await postForm(type, values);

      if (type === "Contact" && form.elements.namedItem("NewsletterOptIn")?.checked) {
        try {
          await postForm("Newsletter", { Data: date, Email: values.Email, IP: ip });
        } catch (newsletterError) {
          logEvent("error", {
            type: "form_submit_error",
            form: "Newsletter",
            reason: classifySubmitError(newsletterError),
            name: newsletterError?.name,
            partial: "contact_ok",
          });
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
      logEvent("info", { type: "form_submit_ok", form: type });
    } catch (error) {
      const reason = classifySubmitError(error);
      logEvent("error", {
        type: "form_submit_error",
        form: type,
        reason,
        name: error?.name,
      });
      showStatus(form, USER_ERRORS[reason] || USER_ERRORS.unknown, true, {
        run: () => handleSubmit(form, type),
        label: "Încearcă din nou",
        managed: true,
      });
    } finally {
      form.dataset.submitting = "false";
      lock(form, false);
    }
  };

  document.querySelectorAll("form[data-solon-form]").forEach((form) => {
    const type = form.dataset.solonForm;
    if (!SCHEMAS[type]) return;

    setupFormButtons(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const pending = handleSubmit(form, type);
      if (typeof pending?.catch === "function") {
        pending.catch((error) => {
          logEvent("error", {
            type: "form_submit_error",
            form: type,
            reason: "unknown",
            name: error?.name,
          });
        });
      }
      return pending;
    });
  });
})();
