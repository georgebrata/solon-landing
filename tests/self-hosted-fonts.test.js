"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const fontsCssPath = path.join(root, "assets", "css", "fonts.css");
const oflPath = path.join(root, "assets", "fonts", "OFL.txt");

const SKIP_DIRS = new Set([".git", "node_modules", "r", "assets/vendor"]);

/**
 * @returns {string[]}
 */
const shippedFontScanPaths = () => {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) {
        continue;
      }
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (name.endsWith(".html") || name.endsWith(".css")) {
        files.push(full);
      }
    }
  };
  walk(root);
  for (const rel of ["templates/layout.html", "templates/list.html", "templates/post.html"]) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) {
      files.push(full);
    }
  }
  return files;
};

test("shipped HTML, templates, and CSS do not reference Google Fonts hosts", () => {
  const offenders = [];
  for (const file of shippedFontScanPaths()) {
    const rel = path.relative(root, file).replace(/\\/gu, "/");
    if (rel.startsWith("r/") || /^(?:403|404|500)\.html$/u.test(rel)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (/googleapis\.com\/css2\?family=Jost|gstatic\.com\/s\/(jost|opensans)\//u.test(source)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});

test("fonts.css @font-face src files exist and OFL.txt is present", () => {
  assert.ok(fs.existsSync(oflPath), "assets/fonts/OFL.txt missing");
  const css = fs.readFileSync(fontsCssPath, "utf8");
  const srcs = [...css.matchAll(/url\("\/assets\/fonts\/([^"]+\.woff2)"\)/gu)].map((m) => m[1]);
  assert.ok(srcs.length >= 16, "expected latin/latin-ext @font-face src entries");
  for (const name of srcs) {
    const full = path.join(root, "assets", "fonts", name);
    assert.ok(fs.existsSync(full), `missing font file ${name}`);
    assert.ok(fs.statSync(full).size > 0, `empty font file ${name}`);
  }
});

test("error-pages.css does not duplicate @font-face rules", () => {
  const css = fs.readFileSync(path.join(root, "assets", "css", "error-pages.css"), "utf8");
  assert.equal(/@font-face/u.test(css), false);
});
