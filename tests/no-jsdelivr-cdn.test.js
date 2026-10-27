"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const JSDELIVR = /cdn\.jsdelivr\.net/iu;
const skipDirs = new Set([".git", ".worktrees", "node_modules", "tests", "docs", "scripts"]);

/**
 * @param {string} dir
 * @param {(file: string) => void} visit
 */
const walkTree = (dir, visit) => {
  for (const name of fs.readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkTree(full, visit);
    else visit(full);
  }
};

test("no committed HTML, templates, r/, or assets HTML/JS references cdn.jsdelivr.net", () => {
  const files = new Set();
  walkTree(root, (file) => {
    const rel = path.relative(root, file);
    if (rel.startsWith(`r${path.sep}`) && file.endsWith(".html")) files.add(file);
    if (!rel.startsWith(`assets${path.sep}`)) {
      if (file.endsWith(".html")) files.add(file);
      return;
    }
    if (file.endsWith(".html") || file.endsWith(".js")) files.add(file);
  });
  for (const name of ["layout.html", "list.html", "post.html"]) {
    files.add(path.join(root, "templates", name));
  }

  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, "utf8");
    if (JSDELIVR.test(source)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `jsDelivr must not appear in: ${hits.join(", ")}`);
});
