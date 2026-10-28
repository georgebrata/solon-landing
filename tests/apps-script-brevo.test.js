"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const CODE_PATH = path.join(__dirname, "../docs/apps-script/Code.gs");
const SOURCE = fs.readFileSync(CODE_PATH, "utf8");
const { createSheetGetRange } = require("./apps-script-brevo-get-range");

const wrapFetch = (fetchCalls, impl) => (url, opts) => {
  fetchCalls.push({ url, opts });
  return impl(url, opts);
};

const makeQueueSheet = () => {
  const rows = [
    ["QueuedAt", "Payload", "Attempts", "Status", "LastError"],
  ];
  return {
    hidden: false,
    rows,
    appendRow(row) {
      rows.push(row);
    },
    getLastRow() {
      return rows.length;
    },
    getRange: createSheetGetRange(rows),
    deleteRow(rowIndex) {
      rows.splice(rowIndex - 1, 1);
    },
    hideSheet() {
      this.hidden = true;
    },
  };
};

const loadAppsScript = (options = {}) => {
  const fetchCalls = [];
  const warnings = [];
  const loggerLines = [];
  const scriptProps = { ...(options.scriptProps || {}) };
  const appendedRows = [];
  const brevoQueue = options.brevoQueue || makeQueueSheet();
  const triggers = options.triggers || [];
  const createdTriggers = [];

  const makeDataSheet = (headers) => {
    const rows = [headers.slice()];
    return {
      getLastColumn: () => headers.length,
      getLastRow: () => rows.length,
      getRange: createSheetGetRange(rows),
      appendRow(row) {
        rows.push(row);
        appendedRows.push(row);
      },
      deleteRow(rowIndex) {
        rows.splice(rowIndex - 1, 1);
      },
      _rows: rows,
    };
  };
  const sheetsByName = {
    Contact: options.contactSheet || makeDataSheet(["Data", "Email", "Nume", "Mesaj"]),
    Telefon: options.telefonSheet || makeDataSheet(["Data", "Telefon", "IP"]),
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
    Utilities: {
      formatDate: (date, _tz, fmt) => {
        const parsedDate = date instanceof Date ? date : new Date(date);
        const year = parsedDate.getUTCFullYear();
        const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
        const dayOfMonth = String(parsedDate.getUTCDate()).padStart(2, "0");
        if (fmt === "yyyy-MM-dd") return `${year}-${month}-${dayOfMonth}`;
        return parsedDate.toISOString();
      },
    },
    console: {
      warn: (msg) => {
        warnings.push(String(msg));
      },
    },
    Logger: {
      log: (msg) => {
        loggerLines.push(String(msg));
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) =>
          Object.prototype.hasOwnProperty.call(scriptProps, key)
            ? scriptProps[key]
            : null,
      }),
    },
    UrlFetchApp: {
      fetch: wrapFetch(
        fetchCalls,
        options.fetchImpl ||
          (() => ({
            getResponseCode: () => 201,
            getContentText: () => "{}",
          }))
      ),
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => undefined,
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (options.lockWaitThrows) throw new Error("Lock timeout");
        },
        tryLock: () => true,
        releaseLock: () => undefined,
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: (handler) => ({
        timeBased: () => ({
          everyMinutes: () => ({
            create: () => {
              createdTriggers.push({ handler, kind: "queue" });
              triggers.push({ getHandlerFunction: () => handler });
            },
          }),
          onMonthDay: (day) => ({
            atHour: (hour) => ({
              create: () => {
                createdTriggers.push({ handler, kind: "retention", day, hour });
                triggers.push({ getHandlerFunction: () => handler });
              },
            }),
          }),
        }),
      }),
    },
    ContentService: {
      createTextOutput: (text) => {
        const output = { _text: text };
        output.setMimeType = () => output;
        return output;
      },
      MimeType: { JSON: "application/json" },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
    },
  };

  vm.runInNewContext(SOURCE, context, { filename: "Code.gs" });

  return {
    ...context,
    fetchCalls,
    warnings,
    loggerLines,
    appendedRows,
    brevoQueue,
    createdTriggers,
    responseJson(output) {
      return JSON.parse(output._text);
    },
  };
};

const validPost = (sheet, data) => ({
  postData: {
    contents: JSON.stringify({ action: "append", data }),
  },
  parameter: { sheet },
});

const queuePayloads = (queue) =>
  queue.rows.slice(1).map((row) => JSON.parse(row[1]));

test("normalizeRomanianPhoneE164_ accepts mobile and landline formats", () => {
  const { normalizeRomanianPhoneE164_ } = loadAppsScript();
  const cases = [
    ["0712345678", "+40712345678"],
    ["07 12 34 56 78", "+40712345678"],
    ["0212345678", "+40212345678"],
    ["02 12 34 56 78", "+40212345678"],
    ["0040712345678", "+40712345678"],
    ["+40712345678", "+40712345678"],
    ["+40 212 345 678", "+40212345678"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeRomanianPhoneE164_(input), expected, input);
  }
});

test("normalizeRomanianPhoneE164_ rejects invalid and double-zero numbers", () => {
  const { normalizeRomanianPhoneE164_ } = loadAppsScript();
  for (const bad of [
    "",
    "123",
    "07123",
    "not-a-phone",
    null,
    "+07221234567",
    "+40 0722 123 456",
    "0040 0722 123 456",
  ]) {
    assert.equal(normalizeRomanianPhoneE164_(bad), null, String(bad));
  }
});

test("buildBrevoContactPayload_ validates email before building", () => {
  const { buildBrevoContactPayload_, isValidEmailForBrevo_ } = loadAppsScript();
  assert.equal(isValidEmailForBrevo_("not-an-email"), false);
  assert.equal(isValidEmailForBrevo_("ada@example.com"), true);
  const payload = buildBrevoContactPayload_({
    Data: "2026-10-15",
    Email: "  ada@example.com ",
    Nume: " Ada Lovelace ",
  });
  assert.equal(payload.email, "ada@example.com");
  assert.equal(payload.attributes.NUME, "Ada Lovelace");
  assert.equal(payload.attributes.LAST_INQUIRY, "2026-10-15");
  assert.equal(payload.attributes.CHANNEL, "contact");
  assert.equal(Object.hasOwn(payload.attributes, "FIRSTNAME"), false);
  assert.equal(payload.listIds[0], 11);
  assert.equal(buildBrevoContactPayload_({ Email: "bad@", Nume: "Ada" }), null);
  assert.equal(buildBrevoContactPayload_({ Nume: "Ada" }), null);
});

test("truncateBrevoErrorDetail_ logs code only and truncates long messages", () => {
  const { truncateBrevoErrorDetail_ } = loadAppsScript();
  const short = truncateBrevoErrorDetail_(
    400,
    JSON.stringify({ code: "duplicate_parameter", message: "ignored detail" })
  );
  assert.equal(short, "HTTP 400 duplicate_parameter");
  assert.ok(!short.includes("ignored"));
  assert.ok(!short.includes("ada@"));
  assert.equal(
    truncateBrevoErrorDetail_(500, JSON.stringify({ message: "x".repeat(200) })),
    "HTTP 500 http_error"
  );
});

test("enqueueBrevoContactList_ appends to BrevoQueue without UrlFetchApp", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.enqueueBrevoContactList_("Contact", {
    Data: "2026-10-15",
    Email: "ada@example.com",
    Nume: "Ada",
  });
  assert.equal(ctx.fetchCalls.length, 0);
  assert.equal(ctx.brevoQueue.rows.length, 2);
  const queued = queuePayloads(ctx.brevoQueue)[0];
  assert.equal(queued.email, "ada@example.com");
  assert.equal(queued.attributes.NUME, "Ada");
  assert.equal(queued.attributes.CHANNEL, "contact");
});

test("enqueueBrevoContactList_ skips bad email and bad phone", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.enqueueBrevoContactList_("Contact", { Email: "not-valid", Nume: "Ada" });
  ctx.enqueueBrevoContactList_("Telefon", { Telefon: "+07221234567" });
  assert.equal(ctx.brevoQueue.rows.length, 1);
  assert.ok(ctx.warnings.some((line) => line.includes("no payload")));
});

test("processBrevoQueue sends queued items and removes successes", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.enqueueBrevoPayload_({
    email: "ada@example.com",
    listIds: [11],
    updateEnabled: true,
  });
  ctx.processBrevoQueue();
  assert.equal(ctx.fetchCalls.length, 1);
  assert.equal(ctx.brevoQueue.rows.length, 1);
});

test("processBrevoQueue updates retry columns on failure and still processes other rows", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: (_url, opts) => {
      const body = JSON.parse(opts.payload || "{}");
      if (body.email === "first@example.com") {
        return {
          getResponseCode: () => 500,
          getContentText: () => JSON.stringify({ code: "internal_error" }),
        };
      }
      return { getResponseCode: () => 201, getContentText: () => "{}" };
    },
  });
  ctx.enqueueBrevoPayload_({
    email: "first@example.com",
    listIds: [11],
    updateEnabled: true,
  });
  ctx.enqueueBrevoPayload_({
    email: "second@example.com",
    listIds: [11],
    updateEnabled: true,
  });
  ctx.processBrevoQueue();
  assert.equal(ctx.fetchCalls.length, 2);
  assert.equal(ctx.brevoQueue.rows.length, 2);
  const failedRow = ctx.brevoQueue.rows[1];
  assert.equal(failedRow[2], 1);
  assert.equal(failedRow[3], "pending");
  assert.equal(failedRow[4], "HTTP 500 internal_error");
  assert.equal(JSON.parse(failedRow[1]).email, "first@example.com");
});

test("processBrevoQueue retries then marks failed after three attempts", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => ({
      getResponseCode: () => 500,
      getContentText: () =>
        JSON.stringify({ code: "internal_error", message: "secret" }),
    }),
  });
  ctx.enqueueBrevoPayload_({
    email: "ada@example.com",
    listIds: [11],
    updateEnabled: true,
  });
  ctx.processBrevoQueue();
  assert.equal(ctx.brevoQueue.rows[1][2], 1);
  assert.equal(ctx.brevoQueue.rows[1][3], "pending");
  ctx.processBrevoQueue();
  assert.equal(ctx.brevoQueue.rows[1][2], 2);
  ctx.processBrevoQueue();
  assert.equal(ctx.brevoQueue.rows[1][2], 3);
  assert.equal(ctx.brevoQueue.rows[1][3], "failed");
  assert.ok(ctx.warnings.every((line) => !line.includes("secret")));
  assert.ok(ctx.warnings.some((line) => line.includes("HTTP 500")));
});

test("processBrevoQueue survives UrlFetchApp exceptions", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => {
      throw new Error("timeout");
    },
  });
  ctx.enqueueBrevoPayload_({
    email: "ada@example.com",
    listIds: [11],
    updateEnabled: true,
  });
  ctx.processBrevoQueue();
  assert.equal(ctx.brevoQueue.rows[1][2], 1);
  assert.equal(ctx.brevoQueue.rows[1][5 - 1], "exception");
});

test("installBrevoTrigger is idempotent", () => {
  const existing = [{ getHandlerFunction: () => "processBrevoQueue" }];
  const ctx = loadAppsScript({ triggers: existing });
  ctx.installBrevoTrigger();
  assert.equal(ctx.createdTriggers.length, 0);

  const fresh = loadAppsScript({ triggers: [] });
  fresh.installBrevoTrigger();
  assert.equal(fresh.createdTriggers.length, 1);
  assert.equal(fresh.createdTriggers[0].handler, "processBrevoQueue");
  fresh.installBrevoTrigger();
  assert.equal(fresh.createdTriggers.length, 1);
});

test("installBrevoRetentionTrigger is idempotent and not run by installBrevoTrigger", () => {
  const fresh = loadAppsScript({ triggers: [] });
  fresh.installBrevoRetentionTrigger();
  assert.equal(fresh.createdTriggers.length, 1);
  assert.equal(fresh.createdTriggers[0].handler, "purgeStaleBrevoLeads");
  fresh.installBrevoRetentionTrigger();
  assert.equal(fresh.createdTriggers.length, 1);
  const queueOnly = loadAppsScript({ triggers: [] });
  queueOnly.installBrevoTrigger();
  assert.equal(queueOnly.createdTriggers[0].handler, "processBrevoQueue");
});

test("SMS-only phone payloads are dropped when Brevo requires email", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => ({
      getResponseCode: () => 400,
      getContentText: () => JSON.stringify({ code: "missing_parameter" }),
    }),
  });
  const result = ctx.postBrevoContactPayload_("test-key", {
    attributes: { SMS: "+40712345678", CHANNEL: "telefon", LAST_INQUIRY: "2026-10-15" },
    listIds: [11],
    updateEnabled: true,
    _smsOnly: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.errorDetail, "sms_only_skipped");
  assert.ok(ctx.warnings.some((line) => line.includes("SMS-only not accepted")));
  const body = JSON.parse(ctx.fetchCalls[0].opts.payload);
  assert.equal(Object.hasOwn(body, "_smsOnly"), false);
});

test("postBrevoContactPayload_ never sends _smsOnly to the API", () => {
  const ctx = loadAppsScript({ scriptProps: { BREVO_API_KEY: "test-key" } });
  ctx.postBrevoContactPayload_("key", {
    attributes: { SMS: "+40712345678" },
    listIds: [11],
    updateEnabled: true,
    _smsOnly: true,
  });
  const body = JSON.parse(ctx.fetchCalls[0].opts.payload);
  assert.equal(Object.hasOwn(body, "_smsOnly"), false);
});

test("purgeStaleBrevoLeads aborts when BREVO_NEWSLETTER_LIST_ID is missing", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.purgeStaleBrevoLeads();
  assert.equal(ctx.fetchCalls.length, 0);
  assert.ok(
    ctx.warnings.some((line) => line.includes("BREVO_NEWSLETTER_LIST_ID missing"))
  );
  assert.equal(ctx.fetchCalls.length, 0);
});

test("purgeStaleBrevoLeads deletes, unlinks, and skips newsletter subscribers", () => {
  const contactRows = [
    ["Data", "Email", "Nume", "Mesaj"],
    ["2020-01-01", "old@example.com", "Old", "Hi"],
    ["2026-10-15", "new@example.com", "New", "Hi"],
  ];
  const contactSheet = {
    getLastColumn: () => 4,
    getLastRow: () => contactRows.length,
    getRange: createSheetGetRange(contactRows),
    deleteRow(rowIndex) {
      contactRows.splice(rowIndex - 1, 1);
    },
  };
  const telefonSheet = {
    getLastColumn: () => 3,
    getLastRow: () => 1,
    getRange: createSheetGetRange([["Data", "Telefon", "IP"]]),
    deleteRow: () => undefined,
  };
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key", BREVO_NEWSLETTER_LIST_ID: "99" },
    contactSheet,
    telefonSheet,
    fetchImpl: (url, opts) => {
      if (opts.method === "get" && url.includes("/lists/11/contacts")) {
        return {
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              contacts: [
                {
                  id: 101,
                  email: "solo@example.com",
                  listIds: [11],
                  attributes: { LAST_INQUIRY: "2020-01-01" },
                },
                {
                  id: 102,
                  email: "sub@example.com",
                  listIds: [11, 99],
                  attributes: { LAST_INQUIRY: "2020-01-01" },
                },
                {
                  id: 103,
                  email: "also@example.com",
                  listIds: [11, 5],
                  attributes: { LAST_INQUIRY: "2020-01-01" },
                },
              ],
            }),
        };
      }
      if (opts.method === "delete") {
        return { getResponseCode: () => 204, getContentText: () => "" };
      }
      if (opts.method === "post" && url.includes("/contacts/remove")) {
        return { getResponseCode: () => 201, getContentText: () => "{}" };
      }
      return { getResponseCode: () => 201, getContentText: () => "{}" };
    },
  });
  ctx.purgeStaleBrevoLeads();
  assert.equal(
    ctx.fetchCalls.filter((c) => c.opts.method === "delete").length,
    1
  );
  const removeCalls = ctx.fetchCalls.filter(
    (c) => c.opts.method === "post" && c.url.includes("/contacts/remove")
  );
  assert.equal(removeCalls.length, 1);
  assert.deepEqual(JSON.parse(removeCalls[0].opts.payload), { ids: [103] });
  assert.equal(
    removeCalls[0].url,
    "https://api.brevo.com/v3/contacts/lists/11/contacts/remove"
  );
  const deleteCall = ctx.fetchCalls.find((c) => c.opts.method === "delete");
  assert.equal(
    deleteCall.url,
    "https://api.brevo.com/v3/contacts/101?identifierType=contact_id"
  );
  assert.equal(contactRows.length, 2);
});

test("purgeStaleBrevoLeads uses contact id for SMS-only delete and list removal", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key", BREVO_NEWSLETTER_LIST_ID: "99" },
    contactSheet: {
      getLastColumn: () => 4,
      getLastRow: () => 1,
      getRange: createSheetGetRange([["Data", "Email", "Nume", "Mesaj"]]),
      deleteRow: () => undefined,
    },
    telefonSheet: {
      getLastColumn: () => 3,
      getLastRow: () => 1,
      getRange: createSheetGetRange([["Data", "Telefon", "IP"]]),
      deleteRow: () => undefined,
    },
    fetchImpl: (url, opts) => {
      if (opts.method === "get" && url.includes("/lists/11/contacts")) {
        return {
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              contacts: [
                {
                  id: 501,
                  listIds: [11],
                  attributes: {
                    SMS: "+40711111111",
                    LAST_INQUIRY: "2020-01-01",
                  },
                },
                {
                  id: 502,
                  listIds: [11, 5],
                  attributes: {
                    SMS: "+40722222222",
                    LAST_INQUIRY: "2020-01-01",
                  },
                },
              ],
            }),
        };
      }
      if (opts.method === "delete") {
        return { getResponseCode: () => 204, getContentText: () => "" };
      }
      if (opts.method === "post" && url.includes("/contacts/remove")) {
        return { getResponseCode: () => 201, getContentText: () => "{}" };
      }
      return { getResponseCode: () => 200, getContentText: () => "{}" };
    },
  });
  ctx.purgeStaleBrevoLeads();
  const deleteCall = ctx.fetchCalls.find((c) => c.opts.method === "delete");
  assert.equal(
    deleteCall.url,
    "https://api.brevo.com/v3/contacts/501?identifierType=contact_id"
  );
  const removeCalls = ctx.fetchCalls.filter(
    (c) => c.opts.method === "post" && c.url.includes("/contacts/remove")
  );
  assert.equal(removeCalls.length, 1);
  assert.equal(
    removeCalls[0].url,
    "https://api.brevo.com/v3/contacts/lists/11/contacts/remove"
  );
  assert.deepEqual(JSON.parse(removeCalls[0].opts.payload), { ids: [502] });
});

test("parseSheetDateIso_ accepts Date objects for sheet pruning", () => {
  const contactRows = [
    ["Data", "Email", "Nume", "Mesaj"],
    [new Date("2020-01-01T12:00:00.000Z"), "old@example.com", "Old", "Hi"],
    [new Date("2026-10-15T12:00:00.000Z"), "new@example.com", "New", "Hi"],
  ];
  const contactSheet = {
    getLastColumn: () => 4,
    getLastRow: () => contactRows.length,
    getRange: createSheetGetRange(contactRows),
    deleteRow(rowIndex) {
      contactRows.splice(rowIndex - 1, 1);
    },
  };
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key", BREVO_NEWSLETTER_LIST_ID: "99" },
    contactSheet,
    telefonSheet: {
      getLastColumn: () => 3,
      getLastRow: () => 1,
      getRange: createSheetGetRange([["Data", "Telefon", "IP"]]),
      deleteRow: () => undefined,
    },
    fetchImpl: (url, opts) => {
      if (opts.method === "get" && url.includes("/lists/11/contacts")) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ contacts: [] }),
        };
      }
      return { getResponseCode: () => 200, getContentText: () => "{}" };
    },
  });
  ctx.purgeStaleBrevoLeads();
  assert.equal(contactRows.length, 2);
  assert.equal(contactRows[1][1], "new@example.com");
});

test("enqueueBrevoPayload_ appends without lock after waitLock times out", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    lockWaitThrows: true,
  });
  ctx.enqueueBrevoPayload_({ email: "ada@example.com", listIds: [11] });
  assert.equal(ctx.brevoQueue.rows.length, 2);
  assert.ok(ctx.warnings.some((line) => line.includes("without lock")));
});

test("doPost enqueues Brevo work and never blocks on fetch", () => {
  const loadedAt = Date.now() - 5000;
  const data = {
    Data: "2026-10-15",
    Email: "ada@example.com",
    Nume: "Ada",
    Mesaj: "Hello",
    IP: "203.0.113.7",
    formLoadedAt: loadedAt,
  };

  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => {
      throw new Error("would block");
    },
  });
  const out = ctx.doPost(validPost("Contact", data));
  assert.deepEqual(ctx.responseJson(out), { ok: true });
  assert.equal(ctx.appendedRows.length, 1);
  assert.equal(ctx.fetchCalls.length, 0);
  assert.equal(queuePayloads(ctx.brevoQueue).length, 1);

  const telefonData = {
    Data: "2026-10-15",
    Telefon: "0712345678",
    IP: "203.0.113.7",
    formLoadedAt: loadedAt,
  };
  const phoneCtx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  const outPhone = phoneCtx.doPost(validPost("Telefon", telefonData));
  assert.deepEqual(phoneCtx.responseJson(outPhone), { ok: true });
  assert.equal(phoneCtx.fetchCalls.length, 0);
  const phonePayload = queuePayloads(phoneCtx.brevoQueue)[0];
  assert.equal(phonePayload.attributes.SMS, "+40712345678");
  assert.equal(phonePayload.attributes.CHANNEL, "telefon");
  assert.equal(phonePayload._smsOnly, true);
});

test("doPost does not enqueue Brevo for Newsletter", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  const out = ctx.doPost(
    validPost("Newsletter", {
      Data: "2026-10-15",
      Email: "ada@example.com",
      IP: "203.0.113.7",
      formLoadedAt: Date.now() - 5000,
    })
  );
  assert.deepEqual(ctx.responseJson(out), { ok: true });
  assert.equal(ctx.brevoQueue.rows.length, 1);
});

test("CAPI fields are never written to the sheet even when headers include them", () => {
  // Build a Contact sheet whose headers include every CAPI/internal field.
  const capiHeaders = [
    "Data", "Email", "Nume", "Mesaj", "IP",
    "meta_event_id", "page_url", "marketing_consent", "user_agent", "fbp", "fbc",
  ];
  const rows = [capiHeaders.slice()];
  const contactSheet = {
    getLastColumn: () => capiHeaders.length,
    getLastRow: () => rows.length,
    getRange: require("./apps-script-brevo-get-range").createSheetGetRange(rows),
    appendRow(row) { rows.push(row); },
    _rows: rows,
  };
  const ctx = loadAppsScript({ contactSheet });
  ctx.doPost(validPost("Contact", {
    Data: "2026-10-28",
    Email: "test@example.com",
    Nume: "Ion",
    Mesaj: "Hello",
    IP: "203.0.113.1",
    formLoadedAt: Date.now() - 5000,
    meta_event_id: "123e4567-e89b-12d3-a456-426614174000",
    page_url: "https://solon.agency/contact/",
    marketing_consent: true,
    user_agent: "Mozilla/5.0",
    fbp: "fb.1.1.abc",
    fbc: "fb.1.1.def",
  }));
  assert.equal(rows.length, 2, "one data row must be appended");
  const written = rows[1];
  const headerMap = Object.fromEntries(capiHeaders.map((h, i) => [h, written[i]]));
  // Regular fields are written.
  assert.equal(headerMap.Email, "test@example.com");
  assert.equal(headerMap.Nume, "Ion");
  // CAPI fields must all be blank.
  for (const key of ["meta_event_id", "page_url", "marketing_consent", "user_agent", "fbp", "fbc"]) {
    assert.equal(headerMap[key], "", `${key} must not be written to the sheet`);
  }
});
