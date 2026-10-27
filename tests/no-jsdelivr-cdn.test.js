"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const JSDELIVR = /cdn\.jsdelivr\.net/iu;

const skipDirs = new Set([".git", ".worktrees", "node_modules", "assets", "scripts", "tests", "docs", "r"]);

/**
 * @param {string} dir
 * @param {string[]} files
 */
const walkHtml = (dir, files) => {
  for (const name of fs.readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkHtml(full, files);
    else if (name.endsWith(".html")) files.push(full);
  }
};

test("no committed HTML page or blog template references cdn.jsdelivr.net", () => {
  const files = [];
  walkHtml(root, files);
  for (const name of ["layout.html", "list.html", "post.html"]) {
    files.push(path.join(root, "templates", name));
  }
  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, "utf8");
    if (JSDELIVR.test(source)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `jsDelivr must not appear in: ${hits.join(", ")}`);
});
