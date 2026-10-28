"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const CODE_PATH = path.join(root, "docs/apps-script/Code.gs");
const FORMS_PATH = path.join(root, "assets/js/forms.js");
const PRIVACY_PATH = path.join(root, "privacy/index.html");
const SOURCE = fs.readFileSync(CODE_PATH, "utf8");
const formsSource = fs.readFileSync(FORMS_PATH, "utf8");
const privacyHtml = fs.readFileSync(PRIVACY_PATH, "utf8");

// Exact approved sentence — no quotation marks, exact Romanian diacritics.
const CAPI_SENTENCE =
  "Pentru unele conversii (solicitare trimis\u0103, plat\u0103 finalizat\u0103), putem transmite evenimentul c\u0103tre Meta \u0219i de pe serverul nostru (Conversions API), cu acelea\u0219i date \u0219i doar dac\u0103 ai acceptat Marketing.";

// ---------------------------------------------------------------------------
// Apps Script harness (minimal, focused on CAPI)
// ---------------------------------------------------------------------------

const { createSheetGetRange } = require("./apps-script-brevo-get-range");

const makeDataSheet = (headers) => {
  const rows = [headers.slice()];
  return {
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length,
    getRange: createSheetGetRange(rows),
    appendRow(row) { rows.push(row); },
    deleteRow(rowIndex) { rows.splice(rowIndex - 1, 1); },
    _rows: rows,
  };
};

const makeQueueSheet = () => {
  const rows = [["QueuedAt", "Payload", "Attempts", "Status", "LastError"]];
  return {
    rows,
    appendRow(row) { rows.push(row); },
    getLastRow() { return rows.length; },
    getRange: createSheetGetRange(rows),
    deleteRow(rowIndex) { rows.splice(rowIndex - 1, 1); },
    hideSheet() {},
  };
};

const loadAppsScript = (options = {}) => {
  const fetchCalls = [];
  const loggerLines = [];
  const scriptProps = { ...(options.scriptProps || {}) };
  const brevoQueue = options.brevoQueue || makeQueueSheet();
  const sheetsByName = {
    Contact: makeDataSheet(["Data", "Email", "Nume", "Mesaj"]),
    Telefon: makeDataSheet(["Data", "Telefon", "IP"]),
    Newsletter: makeDataSheet(["Data", "Email", "IP"]),
    BrevoQueue: brevoQueue,
  };
  const spreadsheet = {
    getSheetByName: (name) => sheetsByName[name] || null,
    insertSheet: (name) => {
      const sheet = makeQueueSheet();
      sheetsByName[name] = sheet;
      return sheet;
    },
  };

  const context = {
    JSON,
    Date,
    Number,
    String,
    Boolean,
    isFinite,
    Error,
    Array,
    Object,
    encodeURIComponent,
    Math,
    Utilities: {
      formatDate: (date, _tz, fmt) => {
        const d = date instanceof Date ? date : new Date(date);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return fmt === "yyyy-MM-dd" ? `${y}-${m}-${day}` : d.toISOString();
      },
    },
    console: { warn: () => undefined },
    Logger: { log: (msg) => { loggerLines.push(String(msg)); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) =>
          Object.prototype.hasOwnProperty.call(scriptProps, key) ? scriptProps[key] : null,
      }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetchCalls.push({ url, opts });
        if (options.fetchImpl) return options.fetchImpl(url, opts);
        return {
          getResponseCode: () => options.capiHttpCode || 200,
          getContentText: () => options.capiBody || '{"events_received":1}',
        };
      },
    },
    CacheService: {
      getScriptCache: () => ({ get: () => null, put: () => undefined }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => undefined, tryLock: () => true, releaseLock: () => undefined }),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: (handler) => ({
        timeBased: () => ({
          everyMinutes: () => ({ create: () => undefined }),
          onMonthDay: () => ({ atHour: () => ({ create: () => undefined }) }),
        }),
      }),
    },
    ContentService: {
      createTextOutput: (text) => {
        const o = { _text: text };
        o.setMimeType = () => o;
        return o;
      },
      MimeType: { JSON: "application/json" },
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  };

  vm.runInNewContext(SOURCE, context, { filename: "Code.gs" });

  return {
    ...context,
    fetchCalls,
    loggerLines,
    responseJson(output) { return JSON.parse(output._text); },
  };
};

const validUuid = "123e4567-e89b-12d3-a456-426614174000";
const GRAPH_API_HOST = "graph.facebook.com";

// capiPost builds a form POST body; marketingConsent defaults to true so most
// tests that expect CAPI to fire work without repeating the flag.
const capiPost = (sheet, extraData = {}, { marketingConsent = true } = {}) => ({
  postData: {
    contents: JSON.stringify({
      action: "append",
      data: {
        Data: "2026-10-28",
        Email: "test@example.com",
        Telefon: "0712345678",
        Mesaj: "hello",
        IP: "203.0.113.1",
        formLoadedAt: Date.now() - 5000,
        marketing_consent: marketingConsent,
        ...extraData,
      },
    }),
  },
  parameter: { sheet },
});

// ---------------------------------------------------------------------------
// CAPI payload builder tests
// ---------------------------------------------------------------------------

test("buildCapiLeadPayload_ returns null when meta_event_id is absent or invalid", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  assert.equal(buildCapiLeadPayload_("Contact", { data: {} }), null);
  assert.equal(buildCapiLeadPayload_("Contact", { data: { meta_event_id: "" } }), null);
  assert.equal(buildCapiLeadPayload_("Contact", { data: { meta_event_id: "not-a-uuid" } }), null);
  assert.equal(buildCapiLeadPayload_("Contact", { data: { meta_event_id: null } }), null);
});

test("buildCapiLeadPayload_ returns a payload with the valid UUID as event_id", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const parsed = {
    data: {
      meta_event_id: validUuid,
      page_url: "https://solon.agency/contact/",
      user_agent: "Mozilla/5.0 TestBrowser",
    },
  };
  const payload = buildCapiLeadPayload_("Contact", parsed);
  assert.ok(payload, "payload should not be null");
  assert.equal(payload.data.length, 1);
  const event = payload.data[0];
  assert.equal(event.event_name, "Lead");
  assert.equal(event.event_id, validUuid);
  assert.equal(event.action_source, "website");
  assert.equal(typeof event.event_time, "number");
  assert.ok(event.event_time > 0);
});

test("buildCapiLeadPayload_ includes event_source_url only for solon.agency URLs, stripped of query and hash", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const withGoodUrl = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, page_url: "https://solon.agency/contact/", user_agent: "UA" },
  });
  assert.equal(withGoodUrl.data[0].event_source_url, "https://solon.agency/contact/");

  const withQueryHash = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, page_url: "https://solon.agency/contact/?utm=x#form", user_agent: "UA" },
  });
  assert.equal(withQueryHash.data[0].event_source_url, "https://solon.agency/contact/");

  const withBadUrl = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, page_url: "https://evil.example/", user_agent: "UA" },
  });
  assert.equal("event_source_url" in withBadUrl.data[0], false);

  const withNoUrl = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, user_agent: "UA" },
  });
  assert.equal("event_source_url" in withNoUrl.data[0], false);
});

test("buildCapiLeadPayload_ includes client_user_agent and fbp/fbc in user_data when provided", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const withAll = buildCapiLeadPayload_("Contact", {
    data: {
      meta_event_id: validUuid,
      user_agent: "Mozilla/5.0 TestBrowser",
      fbp: "fb.1.1.abc123",
      fbc: "fb.1.1.def456",
    },
  });
  assert.equal(withAll.data[0].user_data.client_user_agent, "Mozilla/5.0 TestBrowser");
  assert.equal(withAll.data[0].user_data.fbp, "fb.1.1.abc123");
  assert.equal(withAll.data[0].user_data.fbc, "fb.1.1.def456");

  const noOptional = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, user_agent: "UA only" },
  });
  assert.equal(noOptional.data[0].user_data.client_user_agent, "UA only");
  assert.equal("fbp" in noOptional.data[0].user_data, false);
  assert.equal("fbc" in noOptional.data[0].user_data, false);

  const noUserAgent = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, fbp: "fb.1.1.x" },
  });
  assert.equal("client_user_agent" in noUserAgent.data[0].user_data, false);
  assert.equal(noUserAgent.data[0].user_data.fbp, "fb.1.1.x");
});

test("buildCapiLeadPayload_ never contains PII keys (email, phone, name, IP)", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const payload = buildCapiLeadPayload_("Contact", {
    data: {
      meta_event_id: validUuid,
      user_agent: "UA",
      fbp: "fb.1.1.abc",
      Email: "user@example.com",
      Telefon: "0712345678",
      Nume: "Ion Popescu",
      IP: "203.0.113.1",
    },
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /user@example\.com/i);
  assert.doesNotMatch(serialized, /Ion Popescu/i);
  assert.doesNotMatch(serialized, /203\.0\.113\.1/);
  assert.doesNotMatch(serialized, /0712345678/);
});

test("buildCapiLeadPayload_ includes test_event_code when META_CAPI_TEST_EVENT_CODE is set", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123", META_CAPI_TEST_EVENT_CODE: "TEST12345" },
  });
  const payload = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, user_agent: "UA" },
  });
  assert.equal(payload.test_event_code, "TEST12345");

  const { buildCapiLeadPayload_: noCode } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const payloadNoCode = noCode("Contact", {
    data: { meta_event_id: validUuid, user_agent: "UA" },
  });
  assert.equal("test_event_code" in payloadNoCode, false);
});

// ---------------------------------------------------------------------------
// Consent gate tests (Fix 1)
// ---------------------------------------------------------------------------

test("sendCapiLead_ skips entirely when marketing_consent is not strict true", () => {
  const nonConsentValues = [false, undefined, null, "true", 1, 0, ""];
  for (const consent of nonConsentValues) {
    const extraData = { meta_event_id: validUuid, user_agent: "UA" };
    if (consent !== undefined) extraData.marketing_consent = consent;
    const { doPost, fetchCalls } = loadAppsScript({
      scriptProps: { META_CAPI_TOKEN: "tok123" },
    });
    doPost(capiPost("Contact", extraData, { marketingConsent: false }));
    // Override marketing_consent with the test value
    const { doPost: doPost2, fetchCalls: fc2 } = loadAppsScript({
      scriptProps: { META_CAPI_TOKEN: "tok123" },
    });
    doPost2({
      postData: {
        contents: JSON.stringify({
          action: "append",
          data: {
            Data: "2026-10-28",
            Email: "test@example.com",
            formLoadedAt: Date.now() - 5000,
            meta_event_id: validUuid,
            marketing_consent: consent,
          },
        }),
      },
      parameter: { sheet: "Contact" },
    });
    const capiCalls = fc2.filter(({ url }) => url.includes(GRAPH_API_HOST));
    assert.equal(
      capiCalls.length,
      0,
      `CAPI must be skipped when marketing_consent=${JSON.stringify(consent)}`
    );
  }
});

test("sendCapiLead_ fires when marketing_consent is strict true", () => {
  const { doPost, fetchCalls } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  doPost(capiPost("Contact", { meta_event_id: validUuid, user_agent: "UA" }));
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 1);
});

// ---------------------------------------------------------------------------
// Token / failure tests
// ---------------------------------------------------------------------------

test("sendCapiLead_ skips silently when META_CAPI_TOKEN is missing", () => {
  const { doPost, fetchCalls } = loadAppsScript({ scriptProps: {} });
  const result = doPost(capiPost("Contact", { meta_event_id: validUuid, user_agent: "UA" }));
  const json = JSON.parse(result._text);
  assert.equal(json.ok, true);
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 0);
});

test("CAPI failure does not affect the form save response", () => {
  const { doPost, fetchCalls } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
    capiHttpCode: 500,
    capiBody: '{"error":"fail"}',
  });
  const result = doPost(capiPost("Contact", { meta_event_id: validUuid, user_agent: "UA" }));
  assert.equal(JSON.parse(result._text).ok, true);
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 1);
});

test("fetched URL has no access_token query param; token is in JSON body", () => {
  const { doPost, fetchCalls } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok_body_only" },
  });
  doPost(capiPost("Contact", { meta_event_id: validUuid, user_agent: "UA" }));
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 1);
  // URL must be exactly META_CAPI_URL — no query string at all.
  assert.doesNotMatch(capiCalls[0].url, /access_token/);
  assert.doesNotMatch(capiCalls[0].url, /\?/);
  // Token must be in the JSON payload body.
  const body = JSON.parse(capiCalls[0].opts.payload);
  assert.equal(body.access_token, "tok_body_only");
});

test("sendCapiLead_ does not log the CAPI token even when exception message contains it", () => {
  const SECRET = "VERY_SECRET_TOKEN_DO_NOT_LOG";
  // Simulate UrlFetchApp embedding the request URL (with token) in the error message.
  const { doPost, loggerLines } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: SECRET },
    fetchImpl: () => {
      throw new Error("Request to https://graph.facebook.com/v26.0/400022442507673/events failed: " + SECRET);
    },
  });
  doPost(capiPost("Contact", { meta_event_id: validUuid, user_agent: "UA" }));
  for (const line of loggerLines) {
    assert.doesNotMatch(line, new RegExp(SECRET), "token must not appear in any log line");
  }
  // err.name should be logged instead of err.message.
  assert.ok(loggerLines.some((l) => l.includes("CAPI exception")), "must log CAPI exception");
  assert.ok(loggerLines.some((l) => l.includes("Error")), "must log err.name");
});

test("sendCapiLead_ only fires for Contact and Telefon, not Newsletter", () => {
  const { doPost, fetchCalls } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  doPost(capiPost("Newsletter", { meta_event_id: validUuid, user_agent: "UA" }));
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 0);
});

test("sendCapiLead_ fires CAPI for Contact and Telefon with valid event_id", () => {
  for (const sheet of ["Contact", "Telefon"]) {
    const { doPost, fetchCalls } = loadAppsScript({
      scriptProps: { META_CAPI_TOKEN: "tok123" },
    });
    doPost(capiPost(sheet, { meta_event_id: validUuid, user_agent: "UA/1.0" }));
    const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
    assert.equal(capiCalls.length, 1, `CAPI should fire for ${sheet}`);
    const body = JSON.parse(capiCalls[0].opts.payload);
    assert.equal(body.data[0].event_id, validUuid);
    assert.equal(body.data[0].event_name, "Lead");
    assert.equal(body.data[0].user_data.client_user_agent, "UA/1.0");
  }
});

// ---------------------------------------------------------------------------
// event_source_url stripping (server-side, Fix 4)
// ---------------------------------------------------------------------------

test("event_source_url is stripped of query string and hash before sending to Meta", () => {
  const { doPost, fetchCalls } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  doPost(capiPost("Contact", {
    meta_event_id: validUuid,
    user_agent: "UA",
    page_url: "https://solon.agency/contact/?utm_source=google&utm_medium=cpc#formular",
  }));
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 1);
  const body = JSON.parse(capiCalls[0].opts.payload);
  assert.equal(body.data[0].event_source_url, "https://solon.agency/contact/");
});

// ---------------------------------------------------------------------------
// Privacy page tests
// ---------------------------------------------------------------------------

test("privacy page A2: CAPI sentence present verbatim in #meta-pixel section", () => {
  const metaPixelStart = privacyHtml.indexOf('id="meta-pixel"');
  assert.ok(metaPixelStart >= 0, "#meta-pixel section must exist");
  const prospStart = privacyHtml.indexOf('id="prospectare-b2b"');
  const metaPixelSection = prospStart > 0
    ? privacyHtml.slice(metaPixelStart, prospStart)
    : privacyHtml.slice(metaPixelStart, metaPixelStart + 4000);
  assert.ok(
    metaPixelSection.includes(CAPI_SENTENCE),
    "CAPI sentence must appear in the #meta-pixel section"
  );
  assert.ok(
    !metaPixelSection.includes("\u201e" + CAPI_SENTENCE),
    "CAPI sentence must not be wrapped in „ quotation marks in A2"
  );
});

test("privacy page B2: CAPI sentence present verbatim in Dezv\u0103luiri section", () => {
  const dezvStart = privacyHtml.indexOf("Dezv\u0103luirea datelor cu caracter personal");
  assert.ok(dezvStart >= 0, "Dezv\u0103luiri section must exist");
  const dreptStart = privacyHtml.indexOf("Drepturile tale", dezvStart);
  const dezvSection = dreptStart > 0
    ? privacyHtml.slice(dezvStart, dreptStart)
    : privacyHtml.slice(dezvStart, dezvStart + 3000);
  assert.ok(
    dezvSection.includes(CAPI_SENTENCE),
    "CAPI sentence must appear in the Dezv\u0103luiri section"
  );
  assert.ok(
    !dezvSection.includes("\u201e" + CAPI_SENTENCE),
    "CAPI sentence must not be wrapped in \u201e quotation marks in B2"
  );
});

test("privacy page 'Ultima actualizare' is 28.10.2026", () => {
  assert.ok(privacyHtml.includes("28.10.2026"), "Ultima actualizare must be 28.10.2026");
  assert.doesNotMatch(privacyHtml, /26\.10\.2026/);
});

// ---------------------------------------------------------------------------
// Frontend forms: CAPI fields in POST body (Fix 2, Fix 4)
// ---------------------------------------------------------------------------

const formsHarness = (types, options = {}) => {
  const requests = [];
  const clock = { now: 1_700_000_000_000 };
  class HarnessDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now); }
    static now() { return clock.now; }
  }
  HarnessDate.parse = Date.parse;
  HarnessDate.UTC = Date.UTC;

  const forms = types.map((type) => {
    const values = {
      Email: "ada@example.com",
      Nume: "Ada Lovelace",
      Mesaj: "Hello",
      Telefon: "+40 777 123 456",
    };
    const status = {
      hidden: true, textContent: "", children: [],
      classList: { toggle: () => undefined },
      append(...ch) { this.children.push(...ch); },
    };
    const submitCls = new Set();
    const submit = {
      disabled: false, innerHTML: "Trimite", textContent: "Trimite",
      classList: {
        add(c) { submitCls.add(c); },
        remove(c) { submitCls.delete(c); },
        contains(c) { return submitCls.has(c); },
      },
    };
    const form = {
      dataset: { solonForm: type },
      parentElement: { querySelector(sel) { return sel === "[data-form-status]" ? status : null; } },
      elements: {
        namedItem(name) {
          if (name === "NewsletterOptIn") return { checked: false };
          if (values[name] === undefined) return null;
          return { get value() { return values[name]; }, set value(v) { values[name] = v; } };
        },
      },
      reportValidity() { return true; },
      reset() { Object.keys(values).forEach((k) => { values[k] = ""; }); },
      addEventListener(name, fn) { this.listeners = this.listeners || {}; this.listeners[name] = fn; },
      querySelectorAll() { return [submit]; },
      querySelector() { return null; },
      appendChild(node) { return node; },
      dispatch() {
        clock.now += 5000;
        let prevented = false;
        const result = this.listeners.submit({ preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
        return result;
      },
      values,
      status,
      submit,
    };
    return form;
  });

  const cookies = options.cookies || "";
  const marketingConsent = options.marketingConsent === true;
  const userAgent = options.userAgent !== undefined ? options.userAgent : "TestBrowser/1.0";

  const context = {
    window: undefined,
    document: {
      head: { appendChild(n) { if (n?.onload) n.onload(); return n; } },
      documentElement: { appendChild(n) { return n; } },
      cookie: cookies,
      querySelectorAll() { return forms; },
      createElement() {
        return { type: "", className: "", textContent: "", disabled: false, src: "",
          setAttribute() {}, addEventListener() {}, innerHTML: "" };
      },
    },
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (options.fetch) return options.fetch(String(url), init);
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
    RegExp,
    decodeURIComponent,
    encodeURIComponent,
    Error,
    crypto: globalThis.crypto,
    navigator: { userAgent },
    console: { info: () => undefined, warn: () => undefined, error: () => undefined, log: () => undefined },
    SolonLog: { info: () => undefined, warn: () => undefined, error: () => undefined },
    setTimeout: (fn, ms) => { if (ms > 0 && ms <= 1000) return setTimeout(fn, 0); return setTimeout(fn, ms); },
    clearTimeout,
    turnstile: undefined,
    location: options.location || { href: "https://solon.agency/contact/" },
    SolonConsent: marketingConsent
      ? { hasConsent: (c) => c === "marketing" }
      : { hasConsent: () => false },
    SolonBrevo: { identify() { return true; } },
    solonTrack: options.solonTrack,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(formsSource, context, { filename: "forms.js" });
  return { forms, requests };
};

const dataRequests = (reqs) => reqs.filter(({ url }) => !url.includes("ipify"));

test("Contact and Telefon forms include meta_event_id as a valid UUID in POST body", async () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const type of ["Contact", "Telefon"]) {
    const { forms, requests } = formsHarness([type]);
    await forms[0].dispatch();
    const body = JSON.parse(dataRequests(requests)[0].init.body);
    assert.ok("meta_event_id" in body.data, `${type}: meta_event_id must be in POST body`);
    assert.match(body.data.meta_event_id, UUID_RE, `${type}: meta_event_id must be a valid UUID`);
  }
});

test("Newsletter form does not include meta_event_id in POST body", async () => {
  const { forms, requests } = formsHarness(["Newsletter"]);
  await forms[0].dispatch();
  const body = JSON.parse(dataRequests(requests)[0].init.body);
  assert.equal("meta_event_id" in body.data, false);
});

test("forms include page_url without query string or hash in Contact/Telefon POST body", async () => {
  const { forms, requests } = formsHarness(["Contact"], {
    location: { href: "https://solon.agency/contact/?utm_source=google&fbclid=abc#formular" },
  });
  await forms[0].dispatch();
  const body = JSON.parse(dataRequests(requests)[0].init.body);
  assert.equal(body.data.page_url, "https://solon.agency/contact/");
});

test("forms include marketing_consent false when consent not granted", async () => {
  const { forms, requests } = formsHarness(["Contact"], { marketingConsent: false });
  await forms[0].dispatch();
  const body = JSON.parse(dataRequests(requests)[0].init.body);
  assert.equal(body.data.marketing_consent, false);
  assert.equal("fbp" in body.data, false);
  assert.equal("fbc" in body.data, false);
  assert.equal("user_agent" in body.data, false);
});

test("forms include fbp, fbc and user_agent only when marketing consent is granted", async () => {
  const withConsent = formsHarness(["Contact"], {
    cookies: "_fbp=fb.1.1.abc123; _fbc=fb.1.1.def456",
    marketingConsent: true,
    userAgent: "Mozilla/5.0 TestBot",
  });
  await withConsent.forms[0].dispatch();
  const bodyWith = JSON.parse(dataRequests(withConsent.requests)[0].init.body);
  assert.equal(bodyWith.data.fbp, "fb.1.1.abc123");
  assert.equal(bodyWith.data.fbc, "fb.1.1.def456");
  assert.equal(bodyWith.data.user_agent, "Mozilla/5.0 TestBot");
  assert.equal(bodyWith.data.marketing_consent, true);

  const noConsent = formsHarness(["Contact"], {
    cookies: "_fbp=fb.1.1.abc123; _fbc=fb.1.1.def456",
    marketingConsent: false,
  });
  await noConsent.forms[0].dispatch();
  const bodyNo = JSON.parse(dataRequests(noConsent.requests)[0].init.body);
  assert.equal("fbp" in bodyNo.data, false);
  assert.equal("fbc" in bodyNo.data, false);
  assert.equal("user_agent" in bodyNo.data, false);
});

test("solonTrack for Lead is called with the same event_id sent in POST body", async () => {
  const trackCalls = [];
  const { forms, requests } = formsHarness(["Contact"], {
    solonTrack(meta, ga4, params, opts) {
      trackCalls.push({ meta, ga4, params, opts });
      return (opts && opts.eventId) || "";
    },
  });
  await forms[0].dispatch();
  const body = JSON.parse(dataRequests(requests)[0].init.body);
  const sentId = body.data.meta_event_id;
  assert.equal(trackCalls.length, 1);
  assert.equal(trackCalls[0].meta, "Lead");
  assert.ok(trackCalls[0].opts, "opts must be passed to solonTrack");
  assert.equal(trackCalls[0].opts.eventId, sentId);
});
