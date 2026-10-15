"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const CODE_PATH = path.join(__dirname, "../docs/apps-script/Code.gs");
const SOURCE = fs.readFileSync(CODE_PATH, "utf8");

const loadAppsScript = (options = {}) => {
  const fetchCalls = [];
  const warnings = [];
  const loggerLines = [];
  const scriptProps = { ...(options.scriptProps || {}) };
  const appendedRows = [];

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
    ContentService: {
      createTextOutput: (text) => {
        const output = { _text: text };
        output.setMimeType = () => output;
        return output;
      },
      MimeType: { JSON: "application/json" },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheetsByName[name],
      }),
    },
  };

  vm.runInNewContext(SOURCE, context, { filename: "Code.gs" });

  return {
    ...context,
    fetchCalls,
    warnings,
    loggerLines,
    appendedRows,
    responseJson(output) {
      return JSON.parse(output._text);
    },
  };
};

const sameJson = (actual, expected) => {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
};

const validPost = (sheet, data, parameterSheet) => ({
  postData: {
    contents: JSON.stringify({ action: "append", data }),
  },
  parameter: parameterSheet ? { sheet: parameterSheet } : { sheet },
});

test("normalizeRomanianPhoneE164_ accepts common Romanian formats", () => {
  const { normalizeRomanianPhoneE164_ } = loadAppsScript();
  const cases = [
    ["0712345678", "+40712345678"],
    ["07 12 34 56 78", "+40712345678"],
    ["07-12-34-56-78", "+40712345678"],
    ["07.12.34.56.78", "+40712345678"],
    ["0040712345678", "+40712345678"],
    ["+40712345678", "+40712345678"],
    ["+40 712 345 678", "+40712345678"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeRomanianPhoneE164_(input), expected, input);
  }
});

test("normalizeRomanianPhoneE164_ rejects invalid numbers", () => {
  const { normalizeRomanianPhoneE164_ } = loadAppsScript();
  for (const bad of ["", "123", "0812345678", "07123", "not-a-phone", null]) {
    assert.equal(normalizeRomanianPhoneE164_(bad), null, String(bad));
  }
});

test("buildBrevoContactPayload_ matches Brevo contact shape", () => {
  const { buildBrevoContactPayload_ } = loadAppsScript();
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
  sameJson(
    buildBrevoContactPayload_({ Email: "solo@example.com", Nume: "   " }),
    {
      email: "solo@example.com",
      attributes: {},
      listIds: [11],
      updateEnabled: true,
    }
  );
  assert.equal(buildBrevoContactPayload_({ Nume: "Ada" }), null);
});

test("buildBrevoPhonePayload_ uses E.164 SMS without email", () => {
  const { buildBrevoPhonePayload_ } = loadAppsScript();
  sameJson(buildBrevoPhonePayload_({ Telefon: "0712345678" }), {
    attributes: { SMS: "+40712345678" },
    listIds: [11],
    updateEnabled: true,
  });
  sameJson(
    buildBrevoPhonePayload_({ Telefon: "0712345678", Nume: "George" }),
    {
      attributes: { SMS: "+40712345678", FIRSTNAME: "George" },
      listIds: [11],
      updateEnabled: true,
    }
  );
  assert.equal(buildBrevoPhonePayload_({ Telefon: "invalid" }), null);
});

test("syncToBrevoContactList_ skips when API key is missing", () => {
  const ctx = loadAppsScript({ scriptProps: {} });
  ctx.syncToBrevoContactList_("Contact", {
    Email: "ada@example.com",
    Nume: "Ada",
  });
  assert.equal(ctx.fetchCalls.length, 0);
  assert.ok(
    ctx.warnings.some((line) => line.includes("BREVO_API_KEY missing"))
  );
});

test("syncToBrevoContactList_ POSTs contact payload with required headers", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.syncToBrevoContactList_("Contact", {
    Email: "ada@example.com",
    Nume: "Ada",
  });
  assert.equal(ctx.fetchCalls.length, 1);
  assert.equal(ctx.fetchCalls[0].url, "https://api.brevo.com/v3/contacts");
  assert.equal(ctx.fetchCalls[0].opts.method, "post");
  assert.equal(ctx.fetchCalls[0].opts.muteHttpExceptions, true);
  sameJson(ctx.fetchCalls[0].opts.headers, {
    "api-key": "test-key",
    accept: "application/json",
    "content-type": "application/json",
  });
  sameJson(JSON.parse(ctx.fetchCalls[0].opts.payload), {
    email: "ada@example.com",
    attributes: { FIRSTNAME: "Ada" },
    listIds: [11],
    updateEnabled: true,
  });
});

test("syncToBrevoContactList_ skips bad phone numbers and logs", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  ctx.syncToBrevoContactList_("Telefon", { Telefon: "123" });
  assert.equal(ctx.fetchCalls.length, 0);
  assert.ok(ctx.warnings.some((line) => line.includes("no payload")));
});

test("syncToBrevoContactList_ logs non-2xx without throwing", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => ({
      getResponseCode: () => 400,
      getContentText: () => '{"message":"bad"}',
    }),
  });
  ctx.syncToBrevoContactList_("Contact", { Email: "ada@example.com" });
  assert.ok(ctx.warnings.some((line) => line.includes("HTTP 400")));

  const ctx500 = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => ({
      getResponseCode: () => 500,
      getContentText: () => "error",
    }),
  });
  ctx500.syncToBrevoContactList_("Contact", { Email: "ada@example.com" });
  assert.ok(ctx500.warnings.some((line) => line.includes("HTTP 500")));
});

test("syncToBrevoContactList_ survives UrlFetchApp exceptions", () => {
  const ctx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => {
      throw new Error("timeout");
    },
  });
  ctx.syncToBrevoContactList_("Contact", { Email: "ada@example.com" });
  assert.ok(ctx.warnings.some((line) => line.includes("timeout")));
});

test("doPost still returns ok after Brevo failures and saves the sheet row", () => {
  const loadedAt = Date.now() - 5000;
  const data = {
    Data: "2026-10-15",
    Email: "ada@example.com",
    Nume: "Ada",
    Mesaj: "Hello",
    IP: "203.0.113.7",
    formLoadedAt: loadedAt,
  };

  const missingKey = loadAppsScript({ scriptProps: {} });
  const outMissing = missingKey.doPost(validPost("Contact", data));
  assert.deepEqual(missingKey.responseJson(outMissing), { ok: true });
  assert.equal(missingKey.appendedRows.length, 1);
  assert.equal(missingKey.fetchCalls.length, 0);

  const brevoError = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => ({
      getResponseCode: () => 400,
      getContentText: () => '{"code":"duplicate"}',
    }),
  });
  const out400 = brevoError.doPost(validPost("Contact", data));
  assert.deepEqual(brevoError.responseJson(out400), { ok: true });
  assert.equal(brevoError.appendedRows.length, 1);

  const fetchThrows = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
    fetchImpl: () => {
      throw new Error("network");
    },
  });
  const outThrow = fetchThrows.doPost(validPost("Contact", data));
  assert.deepEqual(fetchThrows.responseJson(outThrow), { ok: true });
  assert.equal(fetchThrows.appendedRows.length, 1);

  const telefonCtx = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  const telefonData = {
    Data: "2026-10-15",
    Telefon: "0712345678",
    IP: "203.0.113.7",
    formLoadedAt: loadedAt,
  };
  const outPhone = telefonCtx.doPost(validPost("Telefon", telefonData));
  assert.deepEqual(telefonCtx.responseJson(outPhone), { ok: true });
  assert.equal(telefonCtx.fetchCalls.length, 1);
  sameJson(JSON.parse(telefonCtx.fetchCalls[0].opts.payload), {
    attributes: { SMS: "+40712345678" },
    listIds: [11],
    updateEnabled: true,
  });

  const badPhone = loadAppsScript({
    scriptProps: { BREVO_API_KEY: "test-key" },
  });
  const outBadPhone = badPhone.doPost(
    validPost("Telefon", { ...telefonData, Telefon: "invalid" })
  );
  assert.deepEqual(badPhone.responseJson(outBadPhone), { ok: true });
  assert.equal(badPhone.fetchCalls.length, 0);
});

test("doPost does not call Brevo for Newsletter", () => {
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
  assert.equal(ctx.fetchCalls.length, 0);
});
