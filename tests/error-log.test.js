"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createLogger, sanitize, parseSentryDsn } = require("../assets/js/error-log.js");

const noop = () => undefined;
const silentConsole = { info: noop, warn: noop, error: noop };
const noSleep = () => Promise.resolve();

test("redacts emails, IPs, and phone numbers from logged strings", () => {
  const sample =
    "user ada@example.com from 203.0.113.7 called +40 777 123 456";
  const cleaned = sanitize(sample);
  assert.match(cleaned, /\[redacted-email\]/);
  assert.match(cleaned, /\[redacted-ip\]/);
  assert.match(cleaned, /\[redacted-phone\]/);
  assert.doesNotMatch(cleaned, /ada@example.com/i);
  assert.doesNotMatch(cleaned, /203\.0\.113\.7/);
  assert.doesNotMatch(cleaned, /777 123 456/);
});

test("does not POST anywhere when no endpoint or DSN is configured", async () => {
  const calls = [];
  const logger = createLogger({
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true });
    },
    console: silentConsole,
    sleep: noSleep,
  });
  logger.error({ type: "form_submit_error", message: "offline", form: "Contact" });
  await logger.flush();
  assert.equal(calls.length, 0);
});

test("posts structured events to a configured webhook and retries network failures", async () => {
  const calls = [];
  const logger = createLogger({
    endpoint: "https://example.com/errors",
    fetch: (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ ok: true });
    },
    console: silentConsole,
    sleep: noSleep,
  });
  logger.error({
    type: "form_submit_error",
    message: "timeout",
    form: "Newsletter",
    email: "ada@example.com",
  });
  await logger.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://example.com/errors");
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.level, "error");
  assert.equal(body.type, "form_submit_error");
  assert.equal(body.context.form, "Newsletter");
  assert.equal(body.context.email, undefined);
  assert.doesNotMatch(JSON.stringify(body), /ada@example.com/i);
});

test("sends Sentry store events from a DSN without embedding the key in the body", async () => {
  const calls = [];
  const dsn = "https://publickey@o123.ingest.sentry.io/456";
  const parsed = parseSentryDsn(dsn);
  assert.equal(parsed.storeUrl, "https://o123.ingest.sentry.io/api/456/store/");
  const logger = createLogger({
    sentryDsn: dsn,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true });
    },
    console: silentConsole,
    sleep: noSleep,
  });
  logger.error({ type: "window_error", message: "boom" });
  await logger.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, parsed.storeUrl);
  assert.match(calls[0].init.headers["X-Sentry-Auth"], /sentry_key=publickey/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.platform, "javascript");
  assert.doesNotMatch(JSON.stringify(body), /publickey/);
});

test("installs an unhandledrejection listener that logs without PII", () => {
  const records = [];
  const listeners = {};
  const target = {
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
  };
  const logger = createLogger({
    console: {
      info: noop,
      warn: noop,
      error: (...args) => {
        records.push(args[1]);
      },
    },
    sleep: noSleep,
  });
  logger.install(target);
  listeners.unhandledrejection({
    reason: new Error("failed for ada@example.com"),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "unhandled_rejection");
  assert.match(records[0].message, /\[redacted-email\]/);
  assert.doesNotMatch(records[0].message, /ada@example.com/i);
});
