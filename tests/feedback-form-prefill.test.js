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
  stripEFromHash,
  readRawEmailParamFromSearch,
  readRawEmailFromHash,
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

test("feedback iframe uses data-src, referrerpolicy, and noscript fallback", () => {
  assert.match(
    feedbackHtml,
    /data-src="https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLScGk[^"]+embedded=true"/
  );
  assert.match(feedbackHtml, /referrerpolicy="no-referrer"/);
  const iframeTags = feedbackHtml.match(/<iframe[^>]*Formular feedback SOLON[^>]*>/g);
  assert.ok(iframeTags && iframeTags.length >= 2);
  assert.ok(!/\ssrc="/u.test(iframeTags[0]), "main iframe must not have src in HTML");
});

test("feedback page sets strict-origin-when-cross-origin referrer meta", () => {
  assert.match(
    feedbackHtml,
    /<meta name="referrer" content="strict-origin-when-cross-origin">/
  );
});

test("buildFeedbackFormSrc encodes plus in email for Google Forms entry", () => {
  const built = buildFeedbackFormSrc("a+b@x.ro");
  assert.ok(built);
  assert.match(built, /entry\.1640447617=a%2Bb%40x\.ro/u);
});

test("hash e= is primary; query e= is fallback", () => {
  assert.equal(readRawEmailFromHash("#e=a%2Bb%40x.ro"), "a+b@x.ro");
  assert.equal(readRawEmailFromHash("#e=a+b@x.ro"), "a+b@x.ro");
  assert.equal(readRawEmailParamFromSearch("?E=query%40x.ro"), "query@x.ro");
  assert.equal(
    readRawEmailFromHash("#e=hash%40x.ro"),
    "hash@x.ro",
  );
  assert.equal(readRawEmailParamFromSearch("?e=query%40x.ro"), "query@x.ro");
  const href = "https://solon.agency/feedback/?e=query%40x.ro#e=hash%40x.ro";
  const stripped = stripFeedbackEmailFromHref(href);
  assert.equal(stripped.rawEmail, "hash@x.ro");
});

test("strip removes hash e and query e while preserving other parts", () => {
  const href = "https://solon.agency/feedback/index.html?foo=1&E=user%40example.com#section&e=drop%40x.ro";
  const result = stripFeedbackEmailFromHref(href);
  assert.equal(result.stripped, true);
  assert.equal(result.pathAndQuery, "/feedback/index.html?foo=1#section");
});

test("invalid or injection-like email is ignored for form URL", () => {
  assert.equal(buildFeedbackFormSrc('<script>@x.ro'), null);
  assert.equal(normalizeFeedbackEmailParam("a..b@x.ro"), null);
  assert.equal(normalizeFeedbackEmailParam(`${"a".repeat(65)}@x.ro`), null);
  assert.equal(normalizeFeedbackEmailParam(), null);
});

test("malformed percent-encoding in e= does not throw", () => {
  assert.equal(readRawEmailFromHash("#e=%"), "");
});

test("email longer than 254 characters is rejected without truncation", () => {
  const tooLong = `${"a".repeat(250)}@x.ro`;
  assert.equal(tooLong.length, 255);
  assert.equal(normalizeFeedbackEmailParam(tooLong), null);
});

test("stripEParamPreservingSearch preserves other query params byte-for-byte", () => {
  const search = "?foo=bar%26baz&E=user%40example.com&x=1";
  const result = stripEParamPreservingSearch(search);
  assert.equal(result.search, "?foo=bar%26baz&x=1");
});

test("stripEFromHash preserves other hash segments", () => {
  const result = stripEFromHash("#section&e=user%40example.com");
  assert.equal(result.hash, "#section");
  assert.equal(result.rawEmail, "user@example.com");
});

test("applyFeedbackUrlHygiene strips hash e from /feedback/index.html", () => {
  const replaceCalls = [];
  const win = {
    location: {
      href: "https://solon.agency/feedback/index.html?utm=1#e=client%40solon.agency",
      pathname: "/feedback/index.html",
    },
    history: {
      replaceState(_state, _title, url) {
        replaceCalls.push(url);
      },
    },
  };
  const email = applyFeedbackUrlHygiene(win);
  assert.equal(email, "client@solon.agency");
  assert.deepEqual(replaceCalls, ["/feedback/index.html?utm=1"]);
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
    setAttribute(name, value) {
      if (name === "src") {
        this.src = value;
      }
    },
  };
  applyFeedbackIframeSrc({ querySelector: () => iframe }, "a+b@x.ro");
  assert.equal(assignments.length, 1);
  assert.notEqual(assignments[0], FEEDBACK_FORM_BASE_SRC);
  assert.match(assignments[0], /entry\.1640447617=a%2Bb%40x\.ro/u);
});

test("boot does not push email into dataLayer", () => {
  const dataLayer = [];
  const assignments = [];
  const iframe = {
    title: "Formular feedback SOLON (Google Forms)",
    _src: "",
    getAttribute() {
      return FEEDBACK_FORM_BASE_SRC;
    },
    set src(value) {
      assignments.push(value);
      this._src = value;
    },
    get src() {
      return this._src;
    },
    setAttribute(name, value) {
      if (name === "src") {
        this.src = value;
      }
    },
  };
  const document = {
    readyState: "complete",
    querySelector: () => iframe,
    addEventListener() {
      /* DOMContentLoaded not used when readyState is complete */
    },
  };
  const win = {
    URL,
    location: { href: "https://solon.agency/feedback/#e=hidden%40example.com", pathname: "/feedback/" },
    history: {
      replaceState() {
        /* stub */
      },
    },
    dataLayer,
    document,
    module: { exports: {} },
  };
  win.window = win;
  vm.runInNewContext(source, win, { filename: "feedback-form-prefill.js" });
  assert.equal(assignments.length, 1);
  assert.ok(!JSON.stringify(dataLayer).includes("hidden@example.com"));
});

test("boot waits for DOMContentLoaded before setting iframe src", () => {
  const assignments = [];
  const listeners = {};
  const iframe = {
    title: "Formular feedback SOLON (Google Forms)",
    _src: "",
    getAttribute() {
      return FEEDBACK_FORM_BASE_SRC;
    },
    set src(value) {
      assignments.push(value);
      this._src = value;
    },
    get src() {
      return this._src;
    },
    setAttribute(name, value) {
      if (name === "src") {
        this.src = value;
      }
    },
  };
  const document = {
    readyState: "loading",
    querySelector: () => iframe,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
  const win = {
    URL,
    location: { href: "https://solon.agency/feedback/#e=wait%40example.com", pathname: "/feedback/" },
    history: {
      replaceState() {
        /* stub */
      },
    },
    document,
    module: { exports: {} },
  };
  win.window = win;
  vm.runInNewContext(source, win, { filename: "feedback-form-prefill.js" });
  assert.equal(assignments.length, 0);
  listeners.DOMContentLoaded();
  assert.equal(assignments.length, 1);
});
