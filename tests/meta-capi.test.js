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

// Exact Romanian sentence with proper Unicode diacritics (U+0219 = ș, U+0103 = ă).
const CAPI_SENTENCE =
  "\u201ePentru unele conversii (solicitare trimis\u0103, plat\u0103 finalizat\u0103), putem transmite evenimentul c\u0103tre Meta \u0219i de pe serverul nostru (Conversions API), cu acelea\u0219i date \u0219i doar dac\u0103 ai acceptat Marketing.\u201d";

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

const capiPost = (sheet, extraData = {}) => ({
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
        ...extraData,
      },
    }),
  },
  parameter: { sheet },
});

// ---------------------------------------------------------------------------
// CAPI payload builder tests
// ---------------------------------------------------------------------------

test("buildCapiLeadPayload_ returns null when meta_event_id is absent", () => {
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
      marketing_consent: false,
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

test("buildCapiLeadPayload_ includes event_source_url only for solon.agency URLs", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const withGoodUrl = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, page_url: "https://solon.agency/contact/", marketing_consent: false },
  });
  assert.equal(withGoodUrl.data[0].event_source_url, "https://solon.agency/contact/");

  const withBadUrl = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, page_url: "https://evil.example/", marketing_consent: false },
  });
  assert.equal("event_source_url" in withBadUrl.data[0], false);

  const withNoUrl = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, marketing_consent: false },
  });
  assert.equal("event_source_url" in withNoUrl.data[0], false);
});

test("buildCapiLeadPayload_ includes fbp/fbc only when marketing_consent is true", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const noConsent = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, marketing_consent: false, fbp: "fb.1.1.abc", fbc: "fb.1.1.xyz" },
  });
  assert.equal("user_data" in noConsent.data[0], false);

  const withConsent = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, marketing_consent: true, fbp: "fb.1.1.abc", fbc: "fb.1.1.xyz" },
  });
  assert.ok(withConsent.data[0].user_data, "user_data must be present with consent");
  assert.equal(withConsent.data[0].user_data.fbp, "fb.1.1.abc");
  assert.equal(withConsent.data[0].user_data.fbc, "fb.1.1.xyz");

  const consentNoCookies = buildCapiLeadPayload_("Contact", {
    data: { meta_event_id: validUuid, marketing_consent: true, fbp: "", fbc: "" },
  });
  assert.equal("user_data" in consentNoCookies.data[0], false);
});

test("buildCapiLeadPayload_ never contains PII keys (email, phone, name, IP)", () => {
  const { buildCapiLeadPayload_ } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const payload = buildCapiLeadPayload_("Contact", {
    data: {
      meta_event_id: validUuid,
      marketing_consent: true,
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
    data: { meta_event_id: validUuid, marketing_consent: false },
  });
  assert.equal(payload.test_event_code, "TEST12345");

  const { buildCapiLeadPayload_: noCode } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  const payloadNoCode = noCode("Contact", {
    data: { meta_event_id: validUuid, marketing_consent: false },
  });
  assert.equal("test_event_code" in payloadNoCode, false);
});

test("sendCapiLead_ skips silently when META_CAPI_TOKEN is missing", () => {
  const { doPost, fetchCalls } = loadAppsScript({ scriptProps: {} });
  const result = doPost(capiPost("Contact", { meta_event_id: validUuid, marketing_consent: false }));
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
  const result = doPost(capiPost("Contact", { meta_event_id: validUuid, marketing_consent: false }));
  assert.equal(JSON.parse(result._text).ok, true);
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 1);
});

test("sendCapiLead_ does not log the CAPI token", () => {
  const { doPost, loggerLines } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "VERY_SECRET_TOKEN_DO_NOT_LOG" },
    fetchImpl: () => { throw new Error("network down"); },
  });
  doPost(capiPost("Contact", { meta_event_id: validUuid, marketing_consent: false }));
  for (const line of loggerLines) {
    assert.doesNotMatch(line, /VERY_SECRET_TOKEN_DO_NOT_LOG/);
  }
});

test("sendCapiLead_ only fires for Contact and Telefon, not Newsletter", () => {
  const { doPost, fetchCalls } = loadAppsScript({
    scriptProps: { META_CAPI_TOKEN: "tok123" },
  });
  doPost(capiPost("Newsletter", { meta_event_id: validUuid }));
  const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
  assert.equal(capiCalls.length, 0);
});

test("sendCapiLead_ fires CAPI for Contact and Telefon with valid event_id", () => {
  for (const sheet of ["Contact", "Telefon"]) {
    const { doPost, fetchCalls } = loadAppsScript({
      scriptProps: { META_CAPI_TOKEN: "tok123" },
    });
    doPost(capiPost(sheet, { meta_event_id: validUuid, marketing_consent: false }));
    const capiCalls = fetchCalls.filter(({ url }) => url.includes(GRAPH_API_HOST));
    assert.equal(capiCalls.length, 1, `CAPI should fire for ${sheet}`);
    const body = JSON.parse(capiCalls[0].opts.payload);
    assert.equal(body.data[0].event_id, validUuid);
    assert.equal(body.data[0].event_name, "Lead");
  }
});

// ---------------------------------------------------------------------------
// Privacy page tests
// ---------------------------------------------------------------------------

test("privacy page A2: CAPI sentence present verbatim in #meta-pixel Ce date paragraph area", () => {
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
});

test("privacy page B2: CAPI sentence present verbatim in Dezvăluiri (destinatari) section", () => {
  const dezvStart = privacyHtml.indexOf("Dezvăluirea datelor cu caracter personal");
  assert.ok(dezvStart >= 0, "Dezvăluiri section must exist");
  const dreptStart = privacyHtml.indexOf("Drepturile tale", dezvStart);
  const dezvSection = dreptStart > 0
    ? privacyHtml.slice(dezvStart, dreptStart)
    : privacyHtml.slice(dezvStart, dezvStart + 3000);
  assert.ok(
    dezvSection.includes(CAPI_SENTENCE),
    "CAPI sentence must appear in the Dezvăluiri section"
  );
});

test("privacy page 'Ultima actualizare' is 28.10.2026", () => {
  assert.ok(privacyHtml.includes("28.10.2026"), "Ultima actualizare must be 28.10.2026");
  assert.doesNotMatch(privacyHtml, /26\.10\.2026/);
});

// ---------------------------------------------------------------------------
// Frontend forms: CAPI fields in POST body
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
      classList: { add(c) { submitCls.add(c); }, remove(c) { submitCls.delete(c); }, contains(c) { return submitCls.has(c); } },
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

test("forms include page_url and marketing_consent in Contact/Telefon POST body", async () => {
  const { forms, requests } = formsHarness(["Contact"]);
  await forms[0].dispatch();
  const body = JSON.parse(dataRequests(requests)[0].init.body);
  assert.equal(typeof body.data.page_url, "string");
  assert.equal(body.data.marketing_consent, false);
});

test("forms include fbp/fbc only when marketing consent is granted", async () => {
  const withConsent = formsHarness(["Contact"], {
    cookies: "_fbp=fb.1.1.abc123; _fbc=fb.1.1.def456",
    marketingConsent: true,
  });
  await withConsent.forms[0].dispatch();
  const bodyWith = JSON.parse(dataRequests(withConsent.requests)[0].init.body);
  assert.equal(bodyWith.data.fbp, "fb.1.1.abc123");
  assert.equal(bodyWith.data.fbc, "fb.1.1.def456");

  const noConsent = formsHarness(["Contact"], {
    cookies: "_fbp=fb.1.1.abc123; _fbc=fb.1.1.def456",
    marketingConsent: false,
  });
  await noConsent.forms[0].dispatch();
  const bodyNo = JSON.parse(dataRequests(noConsent.requests)[0].init.body);
  assert.equal("fbp" in bodyNo.data, false);
  assert.equal("fbc" in bodyNo.data, false);
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
