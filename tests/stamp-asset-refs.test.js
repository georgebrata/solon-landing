"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, afterEach } = require("node:test");

const {
  clearHashCache,
  hashFile,
  stampHtml,
} = require("../scripts/stamp-asset-refs");

let tmpDir = "";

beforeEach(() => {
  clearHashCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-stamp-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearHashCache();
});

/** Write a fixture file under the temp directory. */
const write = (rel, contents) => {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
};

test("appends a content hash query string to first-party CSS and JS", () => {
  const cssPath = write("assets/css/style.min.css", "body{color:red}");
  write("assets/js/main.min.js", "console.log(1)");
  const htmlPath = write(
    "index.html",
    '<link href="assets/css/style.min.css" rel="stylesheet">\n' +
      '<script src="assets/js/main.min.js"></script>\n'
  );

  const stamped = stampHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
  const cssHash = hashFile(cssPath);

  assert.match(stamped, new RegExp(`assets/css/style\\.min\\.css\\?v=${cssHash}`));
  assert.match(stamped, /assets\/js\/main\.min\.js\?v=[0-9a-f]{10}/);
});

test("replaces an existing ?v= token and is idempotent for unchanged files", () => {
  write("assets/js/forms.min.js", "void 0");
  const htmlPath = write(
    "index.html",
    '<script src="assets/js/forms.min.js?v=oldtoken"></script>'
  );
  const first = stampHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
  const second = stampHtml(first, htmlPath);
  assert.equal(first, second);
  assert.doesNotMatch(first, /oldtoken/);
  assert.match(first, /assets\/js\/forms\.min\.js\?v=[0-9a-f]{10}/);
});

test("changing a file changes the bust token", () => {
  const jsRel = "assets/js/consent.min.js";
  const jsPath = write(jsRel, "window.consent=false");
  const htmlPath = write(
    "privacy/index.html",
    '<script src="../assets/js/consent.min.js"></script>'
  );

  const before = stampHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
  const hashBefore = hashFile(jsPath);
  fs.writeFileSync(jsPath, "window.consent=true");
  clearHashCache();
  const after = stampHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
  const hashAfter = hashFile(jsPath);

  assert.notEqual(hashBefore, hashAfter);
  assert.ok(before.includes(`?v=${hashBefore}`));
  assert.ok(after.includes(`?v=${hashAfter}`));
});

test("stamps vendor CSS/JS and future assets without an allowlist", () => {
  write("assets/vendor/aos/aos.css", "/* aos */");
  write("assets/css/cookie-banner.min.css", ".cb{}");
  const htmlPath = write(
    "templates/layout.html",
    [
      '<link href="../../assets/vendor/aos/aos.css" rel="stylesheet">',
      '<link href="../../assets/css/cookie-banner.min.css" rel="stylesheet">',
      '<script src="../../assets/js/missing.min.js"></script>',
    ].join("\n")
  );

  const stamped = stampHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
  assert.match(stamped, /assets\/vendor\/aos\/aos\.css\?v=[0-9a-f]{10}/);
  assert.match(stamped, /assets\/css\/cookie-banner\.min\.css\?v=[0-9a-f]{10}/);
  // Missing files stay unstamped so a later PR can add them.
  assert.match(stamped, /src="\.\.\/\.\.\/assets\/js\/missing\.min\.js"/);
  assert.doesNotMatch(stamped, /missing\.min\.js\?v=/);
});

test("does not stamp images, HTML, or third-party URLs", () => {
  const htmlPath = write(
    "index.html",
    [
      '<img src="assets/img/solon-logo.png" alt="">',
      '<link rel="canonical" href="https://solon.agency/">',
      '<script src="https://analytics.ahrefs.com/analytics.js"></script>',
      '<meta property="og:image" content="https://solon.agency/assets/img/solon-metaimage.png">',
    ].join("\n")
  );

  const original = fs.readFileSync(htmlPath, "utf8");
  const stamped = stampHtml(original, htmlPath);
  assert.equal(stamped, original);
});

test("stamps self-hosted partner logos under assets/img/partners/", () => {
  const logoPath = write(
    "assets/img/partners/lexeto-wordmark.svg",
    "<svg></svg>"
  );
  const htmlPath = write(
    "index.html",
    '<img src="assets/img/partners/lexeto-wordmark.svg" alt="">'
  );

  const stamped = stampHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
  const hash = hashFile(logoPath);
  assert.match(
    stamped,
    new RegExp(`assets/img/partners/lexeto-wordmark\\.svg\\?v=${hash}`)
  );
});
