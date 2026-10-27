"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/forms.js"), "utf8");

const harness = (types, options = {}) => {
  const requests = [];
  const logs = [];
  const clock = { now: 1_700_000_000_000 };
  const BaseDate = options.Date || Date;
  class HarnessDate extends BaseDate {
    constructor(...args) {
      if (args.length) super(...args);
      else if (options.Date) super();
      else super(clock.now);
    }
    static now() {
      return clock.now;
    }
  }
  HarnessDate.parse = BaseDate.parse;
  HarnessDate.UTC = BaseDate.UTC;

  const forms = types.map((type, index) => {
    const values = {
      Email: options.email || "  ada@example.com ",
      Nume: " Ada Lovelace ",
      Mesaj: "  Hello\nworld  ",
      Telefon: "  +40 777 123 456  ",
      NewsletterOptIn: { checked: type === "Contact" && options.optIn === true },
    };
    if (Object.prototype.hasOwnProperty.call(options, "honeypot")) {
      values.company_url = options.honeypot;
    }
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
      querySelector() { return null; },
      appendChild(node) { this._children = this._children || []; this._children.push(node); return node; },
      dispatch() {
        if (options.elapsedMs !== 0) clock.now += options.elapsedMs ?? 5000;
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

  let code = source;
  if (options.turnstileSiteKey) {
    code = code.replace(
      'const TURNSTILE_SITE_KEY = "TURNSTILE_SITE_KEY";',
      `const TURNSTILE_SITE_KEY = ${JSON.stringify(options.turnstileSiteKey)};`
    );
  }

  const identifies = [];
  const context = {
    window: undefined,
    document: {
      head: {
        appendChild(node) {
          if (node && typeof node.onload === "function") node.onload();
          return node;
        },
      },
      documentElement: { appendChild(node) { return node; } },
      querySelectorAll() { return forms; },
      createElement(tag) {
        return {
          tagName: String(tag || "div").toUpperCase(),
          type: "",
          className: "",
          textContent: "",
          disabled: false,
          src: "",
          async: false,
          onload: null,
          onerror: null,
          setAttribute(name, value) { this.attrs = this.attrs || {}; this.attrs[name] = value; },
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
    Date: HarnessDate,
    URLSearchParams,
    JSON,
    Promise,
    SyntaxError,
    TypeError,
    WeakMap,
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
    turnstile: options.turnstile,
    location: options.location || { href: "https://solon.agency/contact/#formular" },
    SolonBrevo:
      options.SolonBrevo === null
        ? undefined
        : options.SolonBrevo || {
            identify(email, attributes) {
              identifies.push({ email, attributes });
              return true;
            },
          },
    solonTrack: options.solonTrack,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(code, context, { filename: "forms.js" });
  return { forms, requests, logs, clock, identifies };
};

const dataRequests = (requests) => requests.filter(({ url }) => !url.includes("ipify"));

const spamFetch = (errorCode) => (url) => {
  if (url.includes("ipify")) {
    return Promise.resolve({ ok: true, json: () => ({ ip: "203.0.113.7" }) });
  }
  return Promise.resolve({ ok: true, json: () => ({ ok: false, error: errorCode }) });
};

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
    ["Data", "IP", "Email", "Nume", "Mesaj", "formLoadedAt"],
    ["Data", "IP", "Telefon", "formLoadedAt"],
    ["Data", "IP", "Email", "formLoadedAt"],
  ]);
  assert.equal(typeof parsed[0].body.data.formLoadedAt, "number");
  assert.ok(parsed[0].body.data.formLoadedAt > 0);
  assert.equal(Object.hasOwn(parsed[0].body.data, "turnstileToken"), false);
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

test("fires solonTrack Lead only after a confirmed Contact save", async () => {
  const trackCalls = [];
  const { forms } = harness(["Contact"], {
    solonTrack(meta, ga4, params) {
      trackCalls.push({ meta, ga4, params });
      return "evt-contact";
    },
  });
  await forms[0].dispatch();
  assert.equal(trackCalls.length, 1);
  assert.equal(trackCalls[0].meta, "Lead");
  assert.equal(trackCalls[0].ga4, "generate_lead");
  assert.equal(trackCalls[0].params.content_name, "Contact");
});

test("does not fire solonTrack when the honeypot trips", async () => {
  const trackCalls = [];
  const { forms } = harness(["Contact"], {
    honeypot: "https://spam.example",
    solonTrack() {
      trackCalls.push(true);
    },
  });
  await forms[0].dispatch();
  assert.equal(trackCalls.length, 0);
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

test("does not call the API when the honeypot is filled and shows fake success", async () => {
  const { forms, requests } = harness(["Newsletter"], { honeypot: "https://spam.example" });
  await forms[0].dispatch();
  assert.equal(requests.length, 0);
  assert.match(forms[0].status.textContent, /înregistrată/);
  assert.equal(forms[0].status.hidden, false);
  assert.equal(forms[0].values.Email, "");
});

test("rejects submits faster than three seconds without calling the API", async () => {
  const { forms, requests } = harness(["Telefon"], { elapsedMs: 0 });
  await forms[0].dispatch();
  assert.equal(requests.length, 0);
  assert.match(forms[0].status.textContent, /prea rapidă/);
  assert.equal(forms[0].values.Telefon, "  +40 777 123 456  ");
  assert.equal(forms[0].status.children.length, 0);
});

test("includes a Turnstile token in the body when the site key is configured", async () => {
  const { forms, requests } = harness(["Newsletter"], {
    turnstileSiteKey: "1x00000000000000000000AA",
    turnstile: {
      render: () => "widget-1",
      getResponse: () => "turnstile-token-test",
      reset: () => true,
    },
  });
  await forms[0].dispatch();
  const sent = dataRequests(requests);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].init.body).data.turnstileToken, "turnstile-token-test");
});

test("fails when Turnstile is configured but the token is missing", async () => {
  const { forms, requests } = harness(["Newsletter"], {
    turnstileSiteKey: "1x00000000000000000000AA",
    turnstile: {
      render: () => "widget-1",
      getResponse: () => "",
      reset: () => true,
    },
  });
  await forms[0].dispatch();
  assert.equal(dataRequests(requests).length, 0);
  assert.match(forms[0].status.textContent, /Verificarea de securitate/);
  assert.equal(forms[0].values.Email, "  ada@example.com ");
});

test("skips Turnstile when the site key is the placeholder and still sends after the delay", async () => {
  const { forms, requests } = harness(["Newsletter"]);
  await forms[0].dispatch();
  const body = JSON.parse(dataRequests(requests)[0].init.body).data;
  assert.equal(Object.hasOwn(body, "turnstileToken"), false);
  assert.equal(typeof body.formLoadedAt, "number");
});

test("shows a Romanian captcha error and allows a user-initiated retry", async () => {
  let submits = 0;
  const { forms, requests } = harness(["Newsletter"], {
    fetch: (url) => {
      if (url.includes("ipify")) {
        return Promise.resolve({ ok: true, json: () => ({ ip: "203.0.113.7" }) });
      }
      submits += 1;
      if (submits === 1) {
        return Promise.resolve({ ok: true, json: () => ({ ok: false, error: "captcha" }) });
      }
      return Promise.resolve({ ok: true, json: () => ({ ok: true }) });
    },
  });
  await forms[0].dispatch();
  assert.match(forms[0].status.textContent, /Verificarea de securitate/);
  assert.equal(forms[0].values.Email, "  ada@example.com ");
  const retry = forms[0].status.children[1];
  assert.equal(retry.textContent, "Încearcă din nou");
  await retry.click();
  assert.equal(submits, 2);
  assert.match(forms[0].status.textContent, /înregistrată/);
  assert.equal(dataRequests(requests).length, 2);
});

test("maps too_fast from the API without an immediate retry control", async () => {
  const { forms, requests } = harness(["Newsletter"], { fetch: spamFetch("too_fast") });
  await forms[0].dispatch();
  assert.match(forms[0].status.textContent, /prea rapidă/);
  assert.equal(forms[0].values.Email, "  ada@example.com ");
  assert.equal(forms[0].status.children.length, 0);
  assert.equal(dataRequests(requests).length, 1);
});

test("maps rate_limited from the API without an immediate retry control", async () => {
  const { forms, requests } = harness(["Newsletter"], { fetch: spamFetch("rate_limited") });
  await forms[0].dispatch();
  assert.match(forms[0].status.textContent, /prea multe cereri/);
  assert.equal(forms[0].values.Email, "  ada@example.com ");
  assert.equal(forms[0].status.children.length, 0);
  assert.equal(dataRequests(requests).length, 1);
});

const TELEFON_FORM_NOTICE =
  'Folosim numărul tău doar ca să te sunăm în legătură cu solicitarea ta și îl păstrăm (în Google Sheets și Brevo) cel mult 24 de luni de la ultima interacțiune. Nu îți trimitem mesaje de marketing. Detalii în <a href="/privacy/">Politica de confidențialitate</a>.';

const walkHtmlFiles = (dir, acc = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".worktrees") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkHtmlFiles(full, acc);
    else if (ent.name.endsWith(".html")) acc.push(full);
  }
  return acc;
};

test("every HTML page with a Telefon form includes the legal phone notice after the form", () => {
  const root = path.join(__dirname, "..");
  const telefonPages = walkHtmlFiles(root).filter((file) =>
    fs.readFileSync(file, "utf8").includes('data-solon-form="Telefon"')
  );
  assert.equal(telefonPages.length, 10);
  for (const file of telefonPages) {
    const html = fs.readFileSync(file, "utf8");
    const start = html.indexOf('data-solon-form="Telefon"');
    const formEnd = html.indexOf("</form>", start);
    assert.ok(formEnd > start, path.relative(root, file));
    const afterForm = html.slice(formEnd, formEnd + 700);
    assert.ok(afterForm.includes(TELEFON_FORM_NOTICE), path.relative(root, file));
    const noticeAt = afterForm.indexOf("Folosim numărul");
    const statusAt = afterForm.indexOf("data-form-status");
    assert.ok(noticeAt >= 0 && statusAt > noticeAt, path.relative(root, file));
    assert.ok(afterForm.includes('<p class="solon-form-note">'), path.relative(root, file));
  }
});

test("contact and newsletter forms carry their privacy notice above submit", () => {
  const contactNote = "Folosim datele tale ca să-ți răspundem la mesaj.";
  const contactOptIn = "Dacă bifezi abonarea, primești newsletterul SOLON, trimis prin Brevo. Te poți dezabona oricând, din linkul din fiecare email.";
  const visitLink = "Brevo poate lega vizitele";
  const newsletterNoteBlog =
    "Te abonezi la newsletterul SOLON, trimis prin Brevo. Te poți dezabona oricând, din linkul din fiecare email. Dacă ai acceptat cookie-urile de Marketing, Brevo poate lega vizitele tale pe website de adresa ta.";
  const newsletterNoteStandalone =
    "Te abonezi la newsletterul SOLON, trimis prin Brevo. Te poți dezabona oricând, din linkul din fiecare email. Dacă ai acceptat cookie-urile de Marketing, Brevo poate lega vizitele tale pe website de adresa ta.";
  const contactPages = ["index.html", "studii-de-caz/index.html"];
  const newsletterPages = [
    { rel: "templates/layout.html", note: newsletterNoteBlog },
    { rel: "newsletter.html", note: newsletterNoteStandalone },
    { rel: "index.html", note: newsletterNoteStandalone },
  ];
  for (const rel of contactPages) {
    const html = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const form = html.slice(html.indexOf('data-solon-form="Contact"'), html.indexOf("</form>", html.indexOf('data-solon-form="Contact"')));
    const noteStart = form.indexOf('class="solon-form-note"');
    const note = form.slice(noteStart, form.indexOf("</p>", noteStart));
    const optInStart = form.indexOf('class="solon-opt-in"');
    const optIn = form.slice(optInStart, form.indexOf("</label>", optInStart));
    assert.ok(form.includes(contactNote), rel);
    assert.equal(note.includes(visitLink), false, rel);
    assert.equal(optIn.includes(visitLink), false, rel);
    assert.ok(optIn.includes(contactOptIn), rel);
    assert.ok(form.indexOf("solon-form-note") < form.indexOf('type="submit"'), rel);
  }
  for (const { rel, note } of newsletterPages) {
    const html = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const start = html.indexOf('data-solon-form="Newsletter"');
    const form = html.slice(start, html.indexOf("</form>", start));
    assert.ok(form.includes(note), rel);
    assert.ok(form.indexOf("solon-form-note") < form.indexOf('type="submit"'), rel);
  }
});

test("honeypot markup is hidden from assistive tech and the keyboard", () => {
  const pages = [
    fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../templates/layout.html"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../newsletter.html"), "utf8"),
  ];
  for (const html of pages) {
    assert.match(html, /name="company_url"/);
    assert.match(html, /class="solon-hp"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /\binert\b/);
  }
});

test("never identifies Brevo from the Telefon form", async () => {
  const { forms, identifies } = harness(["Telefon"]);
  await forms[0].dispatch();
  assert.equal(identifies.length, 0);
});

test("identifies Brevo only for the standalone newsletter form, never from contact", async () => {
  const plain = harness(["Contact", "Telefon", "Newsletter"]);
  for (const form of plain.forms) await form.dispatch();
  assert.equal(plain.identifies.length, 1);
  assert.equal(
    JSON.stringify(plain.identifies[0]),
    JSON.stringify({
      email: "ada@example.com",
      attributes: {
        SOURCE: "Newsletter",
        PAGE_URL: "https://solon.agency/contact/#formular",
      },
    })
  );

  const contact = harness(["Contact"]);
  await contact.forms[0].dispatch();
  assert.equal(contact.identifies.length, 0);

  const opted = harness(["Contact"], { optIn: true });
  await opted.forms[0].dispatch();
  assert.equal(opted.identifies.length, 0);
  const sent = dataRequests(opted.requests);
  assert.deepEqual(
    sent.map(({ url }) => new URL(url).searchParams.get("sheet")),
    ["Contact", "Newsletter"]
  );
});

test("sends FIRSTNAME only from an explicit first-name or name field", async () => {
  const fromFirstName = harness(["Newsletter"]);
  fromFirstName.forms[0].values["first-name"] = "  Ada  ";
  await fromFirstName.forms[0].dispatch();
  assert.equal(fromFirstName.identifies.length, 1);
  assert.equal(fromFirstName.identifies[0].attributes.FIRSTNAME, "Ada");
  assert.equal(fromFirstName.identifies[0].attributes.SOURCE, "Newsletter");

  const fromName = harness(["Newsletter"]);
  fromName.forms[0].values.name = "  Grace  ";
  await fromName.forms[0].dispatch();
  assert.equal(fromName.identifies[0].attributes.FIRSTNAME, "Grace");

  const blank = harness(["Newsletter"]);
  blank.forms[0].values["first-name"] = "   ";
  blank.forms[0].values.name = "   ";
  await blank.forms[0].dispatch();
  assert.equal(blank.identifies.length, 1);
  assert.equal(Object.hasOwn(blank.identifies[0].attributes, "FIRSTNAME"), false);
  assert.equal(blank.identifies[0].attributes.SOURCE, "Newsletter");

  const contact = harness(["Contact"], { optIn: true });
  contact.forms[0].values["first-name"] = "  Ada  ";
  await contact.forms[0].dispatch();
  assert.equal(contact.identifies.length, 0);
});

test("does not identify Brevo when the save fails, the honeypot trips, or the tracker is absent", async () => {
  const failed = harness(["Contact"], {
    fetch: (url) => {
      if (url.includes("ipify")) return Promise.resolve({ ok: true, json: () => ({ ip: "203.0.113.7" }) });
      return Promise.resolve({ ok: true, json: () => ({ ok: false, error: "Failed" }) });
    },
  });
  await failed.forms[0].dispatch();
  assert.equal(failed.identifies.length, 0);

  const honeypot = harness(["Newsletter"], { honeypot: "https://spam.example" });
  await honeypot.forms[0].dispatch();
  assert.equal(honeypot.identifies.length, 0);

  const absent = harness(["Contact"], { SolonBrevo: null });
  await absent.forms[0].dispatch();
  assert.equal(absent.identifies.length, 0);
});
