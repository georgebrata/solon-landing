"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ENV_APPEND_URL, resolveAppendUrl } = require("../scripts/append-blog-google-sheets");

const scriptPath = path.join(__dirname, "..", "scripts", "append-blog-google-sheets.js");

test("append script does not embed a committed Apps Script exec URL or query secret", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.ok(!/script\.google\.com\/macros\/s\//u.test(source));
  assert.ok(!/secret=/u.test(source));
  assert.ok(!/AKfycb/u.test(source));
});

test("resolveAppendUrl returns null when env is unset", () => {
  const previous = process.env[ENV_APPEND_URL];
  delete process.env[ENV_APPEND_URL];
  assert.strictEqual(resolveAppendUrl(), null);
  if (previous !== undefined) process.env[ENV_APPEND_URL] = previous;
});

test("CLI exits 0 and skips when append URL env is missing", () => {
  const env = { ...process.env };
  delete env[ENV_APPEND_URL];
  const out = execFileSync(process.execPath, [scriptPath, "Test title"], { env, encoding: "utf8" });
  assert.match(out, new RegExp(ENV_APPEND_URL));
  assert.match(out, /skip/i);
});
