"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "assets/js/feedback-form-prefill.js");
const source = fs.readFileSync(sourcePath, "utf8");
const feedbackHtml = fs.readFileSync(path.join(root, "feedback/index.html"), "utf8");

const {
  FEEDBACK_FORM_BASE_SRC,
  normalizeFeedbackEmailParam,
  buildFeedbackFormSrc,
  stripFeedbackEmailFromHref,
  stripEParamPreservingSearch,
  readRawEmailParamFromSearch,
  applyFeedbackUrlHygiene,
  applyFeedbackIframeSrc,
} = require(sourcePath);

test("feedback page loads prefill script before consent.min.js", () => {
  const prefillIdx = feedbackHtml.indexOf("feedback-form-prefill.min.js");
  const consentIdx = feedbackHtml.indexOf("consent.min.js");
  assert.ok(prefillIdx > -1, "missing feedback-form-prefill.min.js");
  assert.ok(consentIdx > -1, "missing consent.min.js");
  assert.ok(prefillIdx < consentIdx, "prefill must load before consent");
});

test("feedback iframe uses data-src without src in HTML", () => {
  assert.match(
    feedbackHtml,
    /data-src="https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLScGk[^"]+embedded=true"/
  );
  const iframeTags = feedbackHtml.match(/<iframe[^>]*Formular feedback SOLON[^>]*>/g);
  assert.ok(iframeTags);
  const mainFrame = iframeTags[0];
  assert.ok(!/\ssrc="/u.test(mainFrame), "main iframe must not have src in HTML");
});

test("feedback page sets strict-origin-when-cross-origin referrer", () => {
  assert.match(
    feedbackHtml,
    /<meta name="referrer" content="strict-origin-when-cross-origin">/
  );
});

test("buildFeedbackFormSrc encodes plus in email for Google Forms entry", () => {
  const built = buildFeedbackFormSrc("a+b@x.ro");
  assert.ok(built);
  assert.match(built, /entry\.1640447617=a%2Bb%40x\.ro/u);
  const url = new URL(built);
  assert.equal(url.searchParams.get("entry.1640447617"), "a+b@x.ro");
});

test("readRawEmailParamFromSearch keeps plus sign from query string", () => {
  assert.equal(readRawEmailParamFromSearch("?e=a+b@x.ro"), "a+b@x.ro");
  assert.equal(readRawEmailParamFromSearch("?E=a+b@x.ro"), "a+b@x.ro");
});

test("invalid or injection-like email is ignored for form URL", () => {
  assert.equal(buildFeedbackFormSrc('<script>@x.ro'), null);
  assert.equal(buildFeedbackFormSrc("not-an-email"), null);
  assert.equal(buildFeedbackFormSrc("a@b"), null);
  assert.equal(normalizeFeedbackEmailParam('evil"@test.com'), null);
  assert.equal(normalizeFeedbackEmailParam("a..b@x.ro"), null);
  assert.equal(normalizeFeedbackEmailParam("a@x.c"), null);
  assert.equal(normalizeFeedbackEmailParam(`${"a".repeat(65)}@x.ro`), null);
});

test("email longer than 254 characters is rejected without truncation", () => {
  const tooLong = `${"a".repeat(250)}@x.ro`;
  assert.equal(tooLong.length, 255);
  assert.equal(normalizeFeedbackEmailParam(tooLong), null);
  assert.equal(buildFeedbackFormSrc(tooLong), null);
});

test("stripEParamPreservingSearch removes e/E and preserves other params byte-for-byte", () => {
  const search = "?foo=bar%26baz&E=user%40example.com&x=1";
  const result = stripEParamPreservingSearch(search);
  assert.equal(result.stripped, true);
  assert.equal(result.search, "?foo=bar%26baz&x=1");
  assert.equal(result.rawEmail, "user@example.com");
});

test("stripFeedbackEmailFromHref on /feedback/index.html keeps other params and hash", () => {
  const href = "https://solon.agency/feedback/index.html?foo=1&e=user%40example.com&bar=2#section";
  const result = stripFeedbackEmailFromHref(href);
  assert.equal(result.stripped, true);
  assert.equal(result.pathAndQuery, "/feedback/index.html?foo=1&bar=2#section");
});

test("applyFeedbackUrlHygiene strips e from /feedback/index.html via replaceState", () => {
  const replaceCalls = [];
  const win = {
    location: {
      href: "https://solon.agency/feedback/index.html?utm=1&e=client%40solon.agency#top",
      pathname: "/feedback/index.html",
    },
    history: {
      replaceState(_state, _title, url) {
        replaceCalls.push(url);
        win.location.href = `https://solon.agency${url}`;
      },
    },
  };
  const email = applyFeedbackUrlHygiene(win);
  assert.equal(email, "client@solon.agency");
  assert.deepEqual(replaceCalls, ["/feedback/index.html?utm=1#top"]);
});

test("applyFeedbackIframeSrc sets src once and skips base when e is valid", () => {
  const assignments = [];
  const iframe = {
    title: "Formular feedback SOLON (Google Forms)",
    _src: "",
    getAttribute(name) {
      if (name === "data-src") {
        return FEEDBACK_FORM_BASE_SRC;
      }
      return null;
    },
    set src(value) {
      assignments.push(value);
      this._src = value;
    },
    get src() {
      return this._src;
    },
  };
  const document = {
    querySelector() {
      return iframe;
    },
  };
  applyFeedbackIframeSrc(document, "a+b@x.ro");
  assert.equal(assignments.length, 1);
  assert.notEqual(assignments[0], FEEDBACK_FORM_BASE_SRC);
  assert.match(assignments[0], /entry\.1640447617=a%2Bb%40x\.ro/u);
});

test("boot does not push email into dataLayer", () => {
  const dataLayer = [];
  const replaceCalls = [];
  const assignments = [];
  const iframe = {
    title: "Formular feedback SOLON (Google Forms)",
    _src: "",
    getAttribute(name) {
      if (name === "data-src") {
        return FEEDBACK_FORM_BASE_SRC;
      }
      return null;
    },
    set src(value) {
      assignments.push(value);
      this._src = value;
    },
    get src() {
      return this._src;
    },
  };
  const document = {
    readyState: "complete",
    querySelector() {
      return iframe;
    },
    addEventListener() {
      /* DOMContentLoaded not used when readyState is complete */
    },
  };
  const win = {
    URL,
    location: {
      href: "https://solon.agency/feedback/?e=hidden%40example.com",
      pathname: "/feedback/",
    },
    history: {
      replaceState(_state, _title, url) {
        replaceCalls.push(url);
      },
    },
    dataLayer,
    document,
    module: { exports: {} },
  };
  win.window = win;
  vm.runInNewContext(source, win, { filename: "feedback-form-prefill.js" });

  assert.ok(replaceCalls.length > 0);
  assert.equal(assignments.length, 1);
  assert.match(assignments[0], /entry\.1640447617=/);
  const serialized = JSON.stringify(dataLayer);
  assert.ok(!serialized.includes("hidden@example.com"));
});

test("boot waits for DOMContentLoaded before setting iframe src", () => {
  const assignments = [];
  const listeners = {};
  const iframe = {
    title: "Formular feedback SOLON (Google Forms)",
    _src: "",
    getAttribute(name) {
      if (name === "data-src") {
        return FEEDBACK_FORM_BASE_SRC;
      }
      return null;
    },
    set src(value) {
      assignments.push(value);
      this._src = value;
    },
    get src() {
      return this._src;
    },
  };
  const document = {
    readyState: "loading",
    querySelector() {
      return iframe;
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
  const win = {
    URL,
    location: {
      href: "https://solon.agency/feedback/?e=wait%40example.com",
      pathname: "/feedback/",
    },
    history: {
      replaceState() {},
    },
    document,
    module: { exports: {} },
  };
  win.window = win;
  vm.runInNewContext(source, win, { filename: "feedback-form-prefill.js" });

  assert.equal(assignments.length, 0);
  assert.equal(typeof listeners.DOMContentLoaded, "function");
  listeners.DOMContentLoaded();
  assert.equal(assignments.length, 1);
  assert.match(assignments[0], /entry\.1640447617=wait%40example\.com/u);
});
