"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const { SUPPORT_CHAT_ENABLED } = require("../assets/js/support-chat-config.js");

const SKIP_PAGES = new Set([
  path.join(root, "templates/list.html"),
  path.join(root, "templates/post.html"),
]);

/**
 * @param {string} dir
 * @param {string[]} files
 */
function walkHtml(dir, files) {
  const skipDirs = new Set([".git", "node_modules", "assets", "scripts", "tests", "docs"]);
  for (const name of fs.readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkHtml(full, files);
    } else if (name.endsWith(".html")) {
      files.push(full);
    }
  }
}

test("SUPPORT_CHAT_ENABLED is false in support-chat-config.js", () => {
  assert.equal(SUPPORT_CHAT_ENABLED, false);
});

test("no built HTML page references support-chat.js", () => {
  const pages = [];
  walkHtml(root, pages);
  const offenders = [];
  for (const file of pages) {
    if (SKIP_PAGES.has(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    if (/support-chat(?:\.min)?\.js/i.test(html)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("CSP connect-src has no n8n host while support chat is disabled", () => {
  const htaccess = fs.readFileSync(path.join(root, ".htaccess"), "utf8");
  const cspLine = htaccess.split("\n").find((line) => line.includes("Content-Security-Policy-Report-Only"));
  assert.ok(cspLine, "missing CSP Report-Only header");
  assert.ok(!/n8n\.cloud/i.test(cspLine), "connect-src must not allow n8n while chat is off");
  assert.ok(!/solon-agency\.app/i.test(cspLine), "connect-src must not allow support-chat n8n host");
});
