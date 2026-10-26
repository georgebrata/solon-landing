"use strict";

/**
 * Merge-integrity scan: every HTML page must keep #38 honeypot / Turnstile
 * wiring, #40 error-log + SolonLog, and this PR's consent loader.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

const SKIP_PAGES = new Set([
  path.join(root, "100/index.html"),
  path.join(root, "1000/index.html"),
  path.join(root, "templates/list.html"),
  path.join(root, "templates/post.html"),
]);

const TRACKER_HOSTS = [
  "www.googletagmanager.com",
  "www.google-analytics.com",
  "connect.facebook.net",
  "www.clarity.ms",
  "cdn.brevo.com",
  "tracker.metricool.com",
  "analytics.ahrefs.com",
  "cdn.counter.dev",
  "challenges.cloudflare.com",
  "mny.ro",
];

/**
 * @param {string} dir
 * @param {string[]} files
 * @returns {void}
 */
const walkHtml = function walkHtml(dir, files) {
  const skipDirs = new Set([".git", ".worktrees", "node_modules", "assets", "scripts", "tests", "docs", "r"]);
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
};

/**
 * @returns {string[]}
 */
const htmlFiles = function htmlFiles() {
  const files = [];
  walkHtml(root, files);
  return files.sort();
};

/**
 * @param {string} html
 * @param {string} needle
 * @returns {number}
 */
const firstIndex = function firstIndex(html, needle) {
  return html.indexOf(needle);
};

test("every HTML page keeps consent, error-log, and #38 form protection", () => {
  const files = htmlFiles();
  assert.ok(files.length >= 80, `expected ~90 HTML files, found ${files.length}`);

  const failures = [];
  let scanned = 0;
  let formPages = 0;
  let chromePages = 0;

  for (const file of files) {
    const rel = path.relative(root, file);
    const html = fs.readFileSync(file, "utf8");
    const isFullPage = /<html[\s>]/i.test(html);

    if (SKIP_PAGES.has(file) || !isFullPage) {
      if (/data-solon-form=/.test(html)) {
        failures.push(`${rel}: skipped page unexpectedly has a form`);
      }
      continue;
    }

    scanned += 1;

    if (!html.includes("consent.min.js")) {
      failures.push(`${rel}: missing consent.min.js`);
    }

    const hasForm = /data-solon-form=/.test(html);
    const hasFormsScript = html.includes("forms.min.js") || html.includes("{{scripts}}");
    const hasChrome =
      html.includes("main.min.js") ||
      html.includes('id="footer"') ||
      hasFormsScript ||
      html.includes("error-log.min.js");

    if (hasForm) {
      formPages += 1;
      if (!html.includes("solon-hp")) {
        failures.push(`${rel}: form missing .solon-hp honeypot`);
      }
      if (!html.includes('name="company_url"')) {
        failures.push(`${rel}: form missing company_url honeypot field`);
      }
      if (!/\binert\b/.test(html) || !html.includes('tabindex="-1"')) {
        failures.push(`${rel}: honeypot missing inert/tabindex`);
      }
      if (!hasFormsScript) {
        failures.push(`${rel}: form page missing forms.min.js (timing + Turnstile)`);
      }
      if (!html.includes("error-log.min.js")) {
        failures.push(`${rel}: form page missing error-log.min.js`);
      }
      const errorIdx = firstIndex(html, "error-log.min.js");
      const formsIdx = hasFormsScript
        ? Math.max(firstIndex(html, "forms.min.js"), firstIndex(html, "{{scripts}}"))
        : -1;
      if (errorIdx === -1 || formsIdx === -1 || errorIdx > formsIdx) {
        failures.push(`${rel}: error-log.min.js must load before forms.min.js`);
      }
    }

    if (hasChrome) {
      chromePages += 1;
      if (!html.includes("error-log.min.js")) {
        failures.push(`${rel}: site chrome missing error-log.min.js / SolonLog`);
      }
    }
  }

  assert.equal(
    failures.length,
    0,
    `HTML integrity failures (${failures.length}):\n${failures.join("\n")}`
  );
  assert.ok(scanned >= 70, `scanned too few full pages: ${scanned}`);
  assert.ok(formPages >= 60, `too few form pages: ${formPages}`);
  assert.ok(chromePages >= 70, `too few chrome pages: ${chromePages}`);
});

test("error-log.js exposes SolonLog and forms.js keeps Turnstile + timing", () => {
  const errorLog = fs.readFileSync(path.join(root, "assets/js/error-log.js"), "utf8");
  assert.match(errorLog, /root\.SolonLog\s*=/);
  assert.match(errorLog, /createLogger/);

  const forms = fs.readFileSync(path.join(root, "assets/js/forms.js"), "utf8");
  assert.match(forms, /TURNSTILE_SITE_KEY/);
  assert.match(forms, /challenges\.cloudflare\.com\/turnstile/);
  assert.match(forms, /formLoadedAt/);
  assert.match(forms, /dataset\.formLoadedAt/);
  assert.match(forms, /company_url/);
  assert.match(forms, /prea rapidă/);
  assert.match(forms, /Verificarea de securitate/);
  assert.match(forms, /prea multe cereri/);
});

test(".htaccess CSP allows Turnstile and consent-gated tracker hosts", () => {
  const htaccess = fs.readFileSync(path.join(root, ".htaccess"), "utf8");
  assert.match(htaccess, /# BEGIN issue #29: security headers/);
  assert.match(htaccess, /Block order: redirects \(#33\) above, deny \(#35\) above/);
  assert.match(htaccess, /Content-Security-Policy-Report-Only/);
  for (const host of TRACKER_HOSTS) {
    assert.ok(htaccess.includes(host), `.htaccess CSP missing ${host}`);
  }
  const cspLine = htaccess
    .split("\n")
    .find((line) => line.includes("Content-Security-Policy-Report-Only"));
  assert.ok(cspLine, "missing CSP Report-Only header");
  assert.match(cspLine, /script-src[^"]*challenges\.cloudflare\.com/);
  assert.match(cspLine, /frame-src[^"]*challenges\.cloudflare\.com/);
  assert.match(cspLine, /connect-src[^"]*challenges\.cloudflare\.com/);
});

test("support chat is disabled: loader returns no script URL and minified main does not embed chat", () => {
  const vm = require("vm");
  const {
    SUPPORT_CHAT_ENABLED,
    isSupportChatEnabled,
    resolveSupportChatScriptSrc,
    buildBrowserRuntimePrefix,
  } = require("../assets/js/support-chat-config.js");
  assert.equal(SUPPORT_CHAT_ENABLED, false);
  assert.equal(isSupportChatEnabled(), false);
  assert.equal(
    resolveSupportChatScriptSrc({ src: "https://solon.agency/assets/js/main.min.js?v=abc" }),
    null
  );

  const browserCtx = { result: null };
  vm.createContext(browserCtx);
  vm.runInContext(
    `${buildBrowserRuntimePrefix()}result = SOLON_SUPPORT_CHAT_RUNTIME.resolveSupportChatScriptSrc({ src: "https://solon.agency/assets/js/main.min.js?v=abc" });`,
    browserCtx
  );
  assert.equal(browserCtx.result, null, "browser runtime prefix must match config when chat is off");

  const mainMin = fs.readFileSync(path.join(root, "assets/js/main.min.js"), "utf8");
  assert.ok(
    mainMin.startsWith("var SOLON_SUPPORT_CHAT_RUNTIME="),
    "main.min.js must load the browser runtime prefix from minify"
  );
  assert.ok(!/support-chat(?:\.min)?\.js/i.test(mainMin), "main.min.js must not reference support-chat");

  const offenders = [];
  for (const file of htmlFiles()) {
    if (SKIP_PAGES.has(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    if (/support-chat(?:\.min)?\.js/i.test(html)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);

  const htaccess = fs.readFileSync(path.join(root, ".htaccess"), "utf8");
  const cspLine = htaccess.split("\n").find((line) => line.includes("Content-Security-Policy-Report-Only"));
  assert.ok(cspLine, "missing CSP Report-Only header");
  assert.ok(!/n8n\.cloud/i.test(cspLine), "connect-src must not allow n8n while chat is off");
});
