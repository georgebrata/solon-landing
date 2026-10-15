"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const CODE_PATH = path.join(__dirname, "../docs/apps-script/Code.gs");
const SOURCE = fs.readFileSync(CODE_PATH, "utf8");

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
    getRange(rowStart, colStart, rowEnd, colEnd) {
      const slice = rows.slice(rowStart - 1, rowEnd).map((row) =>
        row.slice(colStart - 1, colEnd)
      );
      return {
        getValues: () => slice,
        setValue(value) {
          rows[rowStart - 1][colStart - 1] = value;
        },
        setValues(values) {
          for (let r = 0; r < values.length; r++) {
            for (let c = 0; c < values[r].length; c++) {
              rows[rowStart - 1 + r][colStart - 1 + c] = values[r][c];
            }
          }
        },
      };
    },
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

  const makeSheet = (headers) => ({
    getLastColumn: () => headers.length,
    getRange: () => ({
      getValues: () => [headers],
    }),
    appendRow(row) {
      appendedRows.push(row);
    },
  });
  const sheetsByName = {
    Contact: makeSheet(["Data", "Email", "Nume", "Mesaj"]),
    Telefon: makeSheet(["Data", "Telefon", "IP"]),
    Newsletter: makeSheet(["Data", "Email", "IP"]),
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
      fetch: options.fetchImpl || ((url, opts) => {
        fetchCalls.push({ url, opts });
        return {
          getResponseCode: () => 201,
          getContentText: () => "{}",
        };
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => undefined,
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => undefined,
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
              createdTriggers.push(handler);
              triggers.push({ getHandlerFunction: () => handler });
            },
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

const sameJson = (actual, expected) => {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
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
  sameJson(
    buildBrevoContactPayload_({
      Email: "  ada@example.com ",
      Nume: " Ada Lovelace ",
    }),
    {
      email: "ada@example.com",
      attributes: { FIRSTNAME: "Ada Lovelace" },
      listIds: [11],
      updateEnabled: true,
    }
  );
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
  const long = truncateBrevoErrorDetail_(
    500,
    JSON.stringify({ message: "x".repeat(200) })
  );
  assert.match(long, /^HTTP 500 /);
  assert.ok(long.length <= 90);
});

test("enqueueBrevoContactList_ appends to BrevoQueue without UrlFetchApp", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.enqueueBrevoContactList_("Contact", {
    Email: "ada@example.com",
    Nume: "Ada",
  });
  assert.equal(ctx.fetchCalls.length, 0);
  assert.equal(ctx.brevoQueue.rows.length, 2);
  sameJson(queuePayloads(ctx.brevoQueue)[0], {
    email: "ada@example.com",
    attributes: { FIRSTNAME: "Ada" },
    listIds: [11],
    updateEnabled: true,
  });
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
  assert.deepEqual(fresh.createdTriggers, ["processBrevoQueue"]);
  fresh.installBrevoTrigger();
  assert.equal(fresh.createdTriggers.length, 1);
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
  sameJson(queuePayloads(phoneCtx.brevoQueue)[0], {
    attributes: { SMS: "+40712345678" },
    listIds: [11],
    updateEnabled: true,
  });
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
