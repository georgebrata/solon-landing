"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const {
  ENV_APPEND_URL,
  APPEND_REQUEST_TIMEOUT_MS,
  resolveAppendUrl,
  buildAppendPayload,
  formatToday,
  appendRow,
} = require("../scripts/append-blog-google-sheets");

const root = path.join(__dirname, "..");
const scriptPath = path.join(root, "scripts", "append-blog-google-sheets.js");

const APPS_SCRIPT_SECRET_URL =
  /script\.google\.com\/macros\/s\/[^\s"']+\/exec\?[^\s"']*(?:secret|token)=/iu;

test("append script does not embed a committed Apps Script exec URL or query secret", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.ok(!/script\.google\.com\/macros\/s\//u.test(source));
  assert.ok(!/secret=/u.test(source));
  assert.ok(!/AKfycb/u.test(source));
});

test("tracked files do not contain Apps Script exec URLs with secret or token query params", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    let content = "";
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    assert.ok(!APPS_SCRIPT_SECRET_URL.test(content), `forbidden Apps Script credential URL in ${relativePath}`);
  }
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
  assert.ok(!out.includes("script.google.com"));
});

test("appendRow sends POST JSON body and never logs the webhook URL", async () => {
  /** @type {{ method?: string, headers?: Record<string, string | string[] | undefined>, body?: string }} */
  const captured = {};
  const server = http.createServer((req, res) => {
    captured.method = req.method;
    captured.headers = req.headers;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      captured.body = Buffer.concat(chunks).toString("utf8");
      res.statusCode = 200;
      res.end("ok");
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const webhookUrl = `http://127.0.0.1:${port}/append-test`;
  const title = "Mock article title";

  await appendRow(webhookUrl, title, { timeoutMs: 5000 });

  assert.strictEqual(captured.method, "POST");
  assert.strictEqual(captured.headers?.["content-type"], "application/json");
  assert.strictEqual(captured.body, buildAppendPayload(title));

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("success logging never references the webhook URL", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.ok(!/console\.log\([^)]*webhookUrl/u.test(source));
  assert.ok(!/console\.error\([^)]*webhookUrl/u.test(source));
});

test("appendRow times out slow responses", async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      setTimeout(() => {
        res.statusCode = 200;
        res.end("late");
      }, 400);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const webhookUrl = `http://127.0.0.1:${port}/slow`;

  const started = Date.now();
  await assert.rejects(appendRow(webhookUrl, "Slow", { timeoutMs: 80 }), /timed out/);
  assert.ok(Date.now() - started < 500);
  assert.ok(APPEND_REQUEST_TIMEOUT_MS >= 15000);

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("buildAppendPayload uses today and author", () => {
  const payload = JSON.parse(buildAppendPayload("X"));
  assert.deepStrictEqual(payload.row[0], formatToday());
  assert.strictEqual(payload.row[1], "");
  assert.strictEqual(payload.row[2], "X");
  assert.strictEqual(payload.row[3], "George");
});
