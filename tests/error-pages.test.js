"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ERROR_PAGES = ["403.html", "404.html", "500.html"];

const TRACKER_PATTERNS = [
  /googletagmanager/i,
  /google-analytics/i,
  /gtag\(/i,
  /facebook\.com\/tr/i,
  /connect\.facebook\.net/i,
  /clarity\.ms/i,
  /counter\.dev/i,
  /metricool/i,
  /cdn\.brevo\.com/i,
  /analytics\.ahrefs\.com/i,
  /meta-pixel/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
];

/**
 * Read a repository file as UTF-8 text.
 * @param {string} rel Path relative to the repo root.
 * @returns {string}
 */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("branded error pages", () => {
  for (const file of ERROR_PAGES) {
    it(`${file} exists and is Romanian HTML with noindex`, () => {
      const html = read(file);
      assert.match(html, /<!DOCTYPE html>/i);
      assert.match(html, /<html lang="ro">/);
      assert.match(html, /<meta charset="utf-8">/i);
      assert.match(html, /name="robots" content="noindex, follow"/);
      assert.match(html, /<h1[^>]*>/);
      assert.match(html, /href="\/"/);
      assert.match(html, /href="\/blog\/"/);
      assert.match(html, /href="\/#contact"|href="mailto:contact@solon\.agency"/);
    });

    it(`${file} uses root-absolute local assets and omits trackers`, () => {
      const html = read(file);
      const relativeAsset = /(?:href|src)="(?:\.\/|\.\.\/)?assets\//;
      assert.equal(relativeAsset.test(html), false, "relative asset paths would break on deep URLs");
      assert.match(html, /href="\/assets\/css\/style\.min\.css\?v=[a-f0-9]+"/);
      assert.match(html, /src="\/assets\/img\/solon-logo\.webp"/);
      assert.match(html, /src="\/assets\/js\/consent\.min\.js\?v=[a-f0-9]+"/);
      assert.match(html, /src="\/assets\/js\/error-log\.min\.js\?v=[a-f0-9]+"/);
      assert.doesNotMatch(html, /data-consent-category=/);
      for (const pattern of TRACKER_PATTERNS) {
        assert.equal(pattern.test(html), false, `tracker ${pattern} must not load on error pages`);
      }
    });
  }

  it("self-hosts Jost and Open Sans instead of requesting Google Fonts", () => {
    const css = read("assets/css/error-pages.css");
    assert.match(css, /@font-face/);
    assert.match(css, /url\("\/assets\/fonts\/jost-latin-400-normal\.woff2"\)/);
    assert.match(css, /url\("\/assets\/fonts\/open-sans-latin-400-normal\.woff2"\)/);
    for (const file of ERROR_PAGES) {
      const html = read(file);
      assert.doesNotMatch(html, /fonts\.googleapis\.com/);
      assert.doesNotMatch(html, /fonts\.gstatic\.com/);
    }
    const requiredFiles = [
      "assets/fonts/jost-latin-400-normal.woff2",
      "assets/fonts/jost-latin-700-normal.woff2",
      "assets/fonts/jost-latin-ext-400-normal.woff2",
      "assets/fonts/jost-latin-ext-700-normal.woff2",
      "assets/fonts/open-sans-latin-400-normal.woff2",
      "assets/fonts/open-sans-latin-600-normal.woff2",
      "assets/fonts/open-sans-latin-ext-400-normal.woff2",
      "assets/fonts/open-sans-latin-ext-600-normal.woff2",
    ];
    for (const file of requiredFiles) {
      assert.equal(fs.existsSync(path.join(ROOT, file)), true, `missing ${file}`);
    }
  });
});

describe(".htaccess ErrorDocument", () => {
  const htaccess = read(".htaccess");

  it("has a marked issue #32 block last, after redirects, deny, headers, and caching", () => {
    const begin = htaccess.indexOf("# BEGIN issue #32: error documents");
    const end = htaccess.indexOf("# END issue #32");
    const denyMarker = htaccess.lastIndexOf("Require all denied");
    const headersBegin = htaccess.indexOf("# BEGIN issue #29: security headers");
    const cachingBegin = htaccess.indexOf("# BEGIN issue #30: caching");
    const cachingEnd = htaccess.indexOf("# END issue #30: caching");
    assert.ok(begin > 0 && end > begin);
    assert.ok(headersBegin > denyMarker, "headers (#29) must follow deny rules");
    assert.ok(cachingBegin > headersBegin, "caching (#30) must follow headers (#29)");
    assert.ok(begin > cachingEnd, "ErrorDocument (#32) must follow caching (#30)");
    assert.doesNotMatch(htaccess, /ErrorDocument \(#32\) belongs here/);
  });

  it("maps 403, 404, 500 and optional 502/503 to local documents", () => {
    assert.match(htaccess, /ErrorDocument 403 \/403\.html/);
    assert.match(htaccess, /ErrorDocument 404 \/404\.html/);
    assert.match(htaccess, /ErrorDocument 500 \/500\.html/);
    assert.match(htaccess, /ErrorDocument 502 \/500\.html/);
    assert.match(htaccess, /ErrorDocument 503 \/500\.html/);
  });

  it("still allows .well-known and does not forbid blog/posts.json or /feedback/", () => {
    assert.match(htaccess, /RewriteRule \^\\\.well-known/);
    assert.doesNotMatch(
      htaccess,
      /RewriteRule[^\n]*blog\/posts\.json/,
      "must not deny /blog/posts.json"
    );
    assert.doesNotMatch(
      htaccess,
      /RewriteRule[^\n]*feedback/,
      "must not deny /feedback/"
    );
    const postsRule = htaccess.match(/RewriteRule \^blog\/posts\(\?:\/\|\$\)/);
    assert.ok(postsRule, "directory deny for blog/posts/ must remain");
    const endMarker = htaccess.indexOf("# END issue #32");
    const trailing = htaccess.slice(endMarker + "# END issue #32".length).trim();
    assert.equal(trailing, "", "ErrorDocument block must remain last in .htaccess");
  });
});

describe("sitemap exclusions", () => {
  it("sitemap.xml does not list error documents", () => {
    const xml = read("sitemap.xml");
    assert.doesNotMatch(xml, /solon\.agency\/404/);
    assert.doesNotMatch(xml, /solon\.agency\/500/);
    assert.doesNotMatch(xml, /solon\.agency\/403/);
  });

  it("update-sitemap.js filters error-document paths", () => {
    const script = read("scripts/update-sitemap.js");
    assert.match(script, /SITEMAP_EXCLUDED_PATHS/);
    assert.match(script, /\/404\.html/);
    assert.match(script, /\/500\.html/);
    assert.match(script, /\/403\.html/);
  });
});
