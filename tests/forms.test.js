"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/forms.js"), "utf8");

const harness = (types, options = {}) => {
  const requests = [];
  const forms = types.map((type, index) => {
    const values = {
      Email: options.email || "  ada@example.com ",
      Nume: " Ada Lovelace ",
      Mesaj: "  Hello\nworld  ",
      Telefon: "  +40 777 123 456  ",
      NewsletterOptIn: { checked: type === "Contact" && options.optIn === true },
    };
    const status = {
      hidden: true,
      textContent: "",
      children: [],
      classList: { toggle: () => undefined },
      append(...children) { this.children.push(...children); },
    };
    const submitClassList = new Set();
    const submit = {
      disabled: false,
      innerHTML: "Trimite",
      textContent: "Trimite",
      classList: {
        add(cls) { submitClassList.add(cls); },
        remove(cls) { submitClassList.delete(cls); },
        contains(cls) { return submitClassList.has(cls); },
      },
    };
    const form = {
      dataset: { solonForm: type },
      parentElement: { querySelector(selector) { return selector === "[data-form-status]" ? status : null; } },
      elements: {
        namedItem(name) {
          if (values[name] === undefined) return null;
          if (name === "NewsletterOptIn") return values[name];
          return {
            get value() { return values[name]; },
            set value(value) { values[name] = value; },
          };
        },
      },
      listeners: {},
      reportValidity() { return options.valid !== false; },
      reset() {
        for (const [key, value] of Object.entries(values)) {
          if (key === "NewsletterOptIn") value.checked = false;
          else if (typeof value === "string") values[key] = "";
        }
      },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      querySelectorAll() { return [submit]; },
      async dispatch() {
        let prevented = false;
        const result = this.listeners.submit({ preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
        return result;
      },
      values,
      status,
      submit,
      index,
    };
    return form;
  });

  const logs = [];
  const context = {
    document: {
      querySelectorAll() { return forms; },
      createElement() {
        return {
          type: "",
          className: "",
          textContent: "",
          disabled: false,
          addEventListener(name, fn) { this.listeners = this.listeners || {}; this.listeners[name] = fn; },
          async click() { return this.listeners.click(); },
        };
      },
    },
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (options.fetch) return options.fetch(String(url), init, requests.length);
      if (String(url).includes("ipify")) return { ok: true, json: async () => ({ ip: "203.0.113.7" }) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
    AbortController,
    Intl,
    Date: options.Date || Date,
    URLSearchParams,
    JSON,
    Promise,
    SyntaxError,
    TypeError,
    console: options.console || {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      log: () => undefined,
    },
    SolonLog: options.SolonLog || {
      info: (event) => { logs.push({ level: "info", event }); },
      warn: (event) => { logs.push({ level: "warn", event }); },
      error: (event) => { logs.push({ level: "error", event }); },
    },
    setTimeout: options.setTimeout || ((fn, ms) => {
      if (ms > 0 && ms <= 1000) return setTimeout(fn, 0);
      return setTimeout(fn, ms);
    }),
    clearTimeout: options.clearTimeout || clearTimeout,
    encodeURIComponent,
    Error,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "forms.js" });
  return { forms, requests, logs };
};

const dataRequests = (requests) => requests.filter(({ url }) => !url.includes("ipify"));

test("maps Contact, Telefon, and Newsletter to their sheet payloads", async () => {
  const { forms, requests } = harness(["Contact", "Telefon", "Newsletter"]);
  for (const form of forms) await form.dispatch();

  const sent = dataRequests(requests);
  assert.equal(sent.length, 3);
  const parsed = sent.map(({ url, init }) => ({
    sheet: new URL(url).searchParams.get("sheet"),
    headers: init.headers,
    body: JSON.parse(init.body),
  }));
  assert.deepEqual(parsed.map((item) => item.sheet), ["Contact", "Telefon", "Newsletter"]);
  assert.deepEqual(parsed.map((item) => Object.keys(item.body.data)), [
    ["Data", "IP", "Email", "Nume", "Mesaj"],
    ["Data", "IP", "Telefon"],
    ["Data", "IP", "Email"],
  ]);
  assert.equal(parsed[0].body.data.Nume, "Ada Lovelace");
  assert.equal(parsed[0].body.data.Mesaj, "Hello\nworld");
  assert.equal(parsed[1].body.data.Telefon, "+40 777 123 456");
  assert.equal(parsed[0].body.action, "append");
  assert.equal(parsed[0].headers["Content-Type"], "text/plain;charset=UTF-8");
  assert.equal(sent[0].init.credentials, "omit");
  assert.equal(sent[0].init.redirect, "follow");
  assert.equal(parsed[0].body.data.IP, "203.0.113.7");
  assert.ok(parsed.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.body.data.Data)));
  assert.equal(new Set(requests.filter(({ url }) => url.includes("ipify")).map(({ url }) => url)).size, 1);
});

test("uses the Bucharest calendar date at the UTC date boundary", async () => {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-09-25T21:30:00.000Z"])); }
  }
  const { forms, requests } = harness(["Telefon"], { Date: FixedDate });
  await forms[0].dispatch();
  assert.equal(JSON.parse(dataRequests(requests)[0].init.body).data.Data, "2026-09-26");
});

test("sends a blank name when the optional contact name is omitted", async () => {
  const { forms, requests } = harness(["Contact"]);
  delete forms[0].values.Nume;
  await forms[0].dispatch();
  assert.equal(JSON.parse(dataRequests(requests)[0].init.body).data.Nume, "");
});

test("sends an empty IP when public IP lookup fails", async () => {
  const { forms, requests } = harness(["Newsletter"], {
    fetch: async (url) => {
      if (url.includes("ipify")) throw new Error("offline");
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await forms[0].dispatch();
  assert.equal(JSON.parse(dataRequests(requests)[0].init.body).data.IP, "");
});

test("shows success only for an explicit API confirmation with ok: true", async () => {
  const { forms } = harness(["Newsletter"], {
    fetch: async (url) => {
      if (url.includes("ipify")) return { ok: true, json: async () => ({ ip: "203.0.113.7" }) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await forms[0].dispatch();
  assert.match(forms[0].status.textContent, /înregistrată/);
  assert.equal(forms[0].status.hidden, false);
  assert.equal(forms[0].values.Email, "");
});

test("retains fields and shows an error for ok: false, missing ok, or malformed responses", async (t) => {
  for (const response of [
    { ok: false, json: async () => ({ ok: true }) },
    { ok: true, json: async () => ({ ok: false, error: "Failed" }) },
    { ok: true, json: async () => ({ error: "No ok property" }) },
    { ok: true, json: async () => { throw new SyntaxError("bad JSON"); } },
  ]) {
    await t.test("response fails", async () => {
      const { forms } = harness(["Newsletter"], {
        fetch: async (url) => url.includes("ipify")
          ? { ok: true, json: async () => ({ ip: "203.0.113.7" }) }
          : response,
      });
      await forms[0].dispatch();
      assert.match(forms[0].status.textContent, /nu a reușit/);
      assert.equal(forms[0].values.Email, "  ada@example.com ");
      assert.equal(forms[0].submit.disabled, false);
    });
  }
});

test("adds modern loading state with spinner to button during submit and restores afterwards", async () => {
  let inFlightCheck = false;
  const { forms } = harness(["Newsletter"], {
    fetch: async (url) => {
      if (url.includes("ipify")) return { ok: true, json: async () => ({ ip: "203.0.113.7" }) };
      assert.equal(forms[0].submit.disabled, true);
      assert.equal(forms[0].submit.classList.contains("is-loading"), true);
      assert.match(forms[0].submit.innerHTML, /solon-btn-spinner/);
      inFlightCheck = true;
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await forms[0].dispatch();
  assert.equal(inFlightCheck, true);
  assert.equal(forms[0].submit.disabled, false);
  assert.equal(forms[0].submit.classList.contains("is-loading"), false);
  assert.equal(forms[0].submit.innerHTML, "Trimite");
});

test("does not submit invalid forms", async () => {
  const { forms, requests } = harness(["Newsletter"], { valid: false });
  await forms[0].dispatch();
  assert.equal(requests.length, 0);
});

test("applies the 20-second timeout signal to submission requests", async () => {
  let submissionSignal;
  let timeout = 0;
  const { forms } = harness(["Newsletter"], {
    setTimeout(fn, ms) {
      if (ms === 20000) {
        timeout = ms;
        fn();
        return 0;
      }
      const id = setTimeout(fn, ms);
      return id;
    },
    fetch: async (url, init) => {
      if (url.includes("ipify")) return { ok: true, json: async () => ({ ip: "203.0.113.7" }) };
      submissionSignal = init.signal;
      if (init.signal.aborted) throw new Error("aborted");
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await forms[0].dispatch();
  assert.equal(timeout, 20000);
  assert.equal(submissionSignal.aborted, true);
  assert.match(forms[0].status.textContent, /expirat/);
  assert.equal(forms[0].status.children.length, 2);
});

test("prevents concurrent submissions and retries only Newsletter after partial success", async () => {
  let releaseContact;
  let newsletterCalls = 0;
  const { forms, requests } = harness(["Contact"], {
    optIn: true,
    fetch: async (url) => {
      if (url.includes("ipify")) return { ok: true, json: async () => ({ ip: "203.0.113.7" }) };
      if (url.includes("sheet=Contact")) {
        return new Promise((resolve) => { releaseContact = () => resolve({ ok: true, json: async () => ({ ok: true }) }); });
      }
      newsletterCalls += 1;
      return { ok: newsletterCalls > 1, json: async () => ({ ok: newsletterCalls > 1 }) };
    },
  });
  const first = forms[0].dispatch();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(forms[0].dataset.submitting, "true");
  await forms[0].dispatch();
  assert.equal(dataRequests(requests).filter(({ url }) => url.includes("sheet=Contact")).length, 1);
  releaseContact();
  await first;
  assert.match(forms[0].status.textContent, /Mesajul a fost trimis/);
  assert.equal(forms[0].status.children.length, 2);
  const retry = forms[0].status.children[1];
  await retry.click();
  assert.equal(newsletterCalls, 2);
  assert.equal(dataRequests(requests).filter(({ url }) => url.includes("sheet=Contact")).length, 1);
  assert.equal(dataRequests(requests).filter(({ url }) => url.includes("sheet=Newsletter")).length, 2);
  assert.match(forms[0].status.textContent, /înregistrată/);
});

test("retries public IP lookup with backoff and still submits an empty IP", async () => {
  let ipCalls = 0;
  const { forms, requests } = harness(["Newsletter"], {
    fetch: (url) => {
      if (url.includes("ipify")) {
        ipCalls += 1;
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve({ ok: true, json: () => ({ ok: true }) });
    },
  });
  await forms[0].dispatch();
  assert.equal(ipCalls, 3);
  assert.equal(JSON.parse(dataRequests(requests)[0].init.body).data.IP, "");
});

test("shows a Romanian network error and retries the same payload on demand", async () => {
  let submits = 0;
  const { forms, requests } = harness(["Newsletter"], {
    fetch: (url) => {
      if (url.includes("ipify")) return Promise.resolve({ ok: true, json: () => ({ ip: "203.0.113.7" }) });
      submits += 1;
      if (submits === 1) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ ok: true, json: () => ({ ok: true }) });
    },
  });
  await forms[0].dispatch();
  assert.match(forms[0].status.textContent, /Nu am putut contacta serverul/);
  assert.equal(forms[0].values.Email, "  ada@example.com ");
  const retry = forms[0].status.children[1];
  assert.equal(retry.textContent, "Încearcă din nou");
  await retry.click();
  assert.equal(submits, 2);
  assert.match(forms[0].status.textContent, /înregistrată/);
  assert.equal(forms[0].values.Email, "");
  assert.equal(dataRequests(requests).length, 2);
});

test("logs submit failures without emails, IPs, or field values", async () => {
  const { forms, logs } = harness(["Contact"], {
    fetch: (url) => {
      if (url.includes("ipify")) return Promise.resolve({ ok: true, json: () => ({ ip: "203.0.113.7" }) });
      return Promise.resolve({ ok: true, json: () => ({ ok: false, error: "Failed" }) });
    },
  });
  await forms[0].dispatch();
  const errorLogs = logs.filter((entry) => entry.level === "error");
  assert.equal(errorLogs.length, 1);
  const serialized = JSON.stringify(errorLogs[0].event);
  assert.equal(errorLogs[0].event.form, "Contact");
  assert.equal(errorLogs[0].event.reason, "unconfirmed");
  assert.doesNotMatch(serialized, /ada@example.com/i);
  assert.doesNotMatch(serialized, /203\.0\.113\.7/);
  assert.doesNotMatch(serialized, /Ada Lovelace/);
  assert.doesNotMatch(serialized, /Hello/);
});

test("logs successful submissions with the form type only", async () => {
  const { forms, logs } = harness(["Telefon"]);
  await forms[0].dispatch();
  const infoLogs = logs.filter((entry) => entry.level === "info" && entry.event.type === "form_submit_ok");
  assert.equal(infoLogs.length, 1);
  assert.equal(infoLogs[0].event.form, "Telefon");
  const serialized = JSON.stringify(infoLogs[0].event);
  assert.doesNotMatch(serialized, /ada@example.com/i);
  assert.doesNotMatch(serialized, /203\.0\.113\.7/);
  assert.doesNotMatch(serialized, /\+40 777/);
});
