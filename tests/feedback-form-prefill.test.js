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
  applyFeedbackUrlHygiene,
} = require(sourcePath);

test("feedback page loads prefill script before consent.min.js", () => {
  const prefillIdx = feedbackHtml.indexOf("feedback-form-prefill.min.js");
  const consentIdx = feedbackHtml.indexOf("consent.min.js");
  assert.ok(prefillIdx > -1, "missing feedback-form-prefill.min.js");
  assert.ok(consentIdx > -1, "missing consent.min.js");
  assert.ok(prefillIdx < consentIdx, "prefill must load before consent");
});

test("buildFeedbackFormSrc encodes plus in email for Google Forms entry", () => {
  const built = buildFeedbackFormSrc("a+b@x.ro");
  assert.ok(built);
  const url = new URL(built);
  assert.equal(url.searchParams.get("entry.1640447617"), "a+b@x.ro");
  assert.equal(url.searchParams.get("usp"), "pp_url");
  assert.equal(url.searchParams.get("embedded"), "true");
  assert.ok(built.startsWith(FEEDBACK_FORM_BASE_SRC.split("?")[0]));
});

test("invalid or injection-like email is ignored for form URL", () => {
  assert.equal(buildFeedbackFormSrc('<script>@x.ro'), null);
  assert.equal(buildFeedbackFormSrc("not-an-email"), null);
  assert.equal(buildFeedbackFormSrc("a@b"), null);
  assert.equal(normalizeFeedbackEmailParam('evil"@test.com'), null);
});

test("missing or empty param leaves buildFeedbackFormSrc null", () => {
  assert.equal(buildFeedbackFormSrc(""), null);
  assert.equal(buildFeedbackFormSrc(null), null);
  assert.equal(normalizeFeedbackEmailParam(), null);
});

test("stripFeedbackEmailFromHref removes e and keeps other params and hash", () => {
  const href = "https://solon.agency/feedback/?foo=1&e=user%40example.com&bar=2#section";
  const result = stripFeedbackEmailFromHref(href);
  assert.equal(result.stripped, true);
  assert.equal(result.pathAndQuery, "/feedback/?foo=1&bar=2#section");
});

test("applyFeedbackUrlHygiene strips e from location via replaceState", () => {
  const replaceCalls = [];
  const win = {
    location: {
      href: "https://solon.agency/feedback/?utm=1&e=client%40solon.agency#top",
      pathname: "/feedback/",
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
  assert.deepEqual(replaceCalls, ["/feedback/?utm=1#top"]);
  assert.equal(win.location.href, "https://solon.agency/feedback/?utm=1#top");
});

test("boot does not push email into dataLayer", () => {
  const dataLayer = [];
  const replaceCalls = [];
  const iframe = {
    title: "Formular feedback SOLON (Google Forms)",
    src: FEEDBACK_FORM_BASE_SRC,
  };
  const document = {
    readyState: "complete",
    location: undefined,
    querySelector(selector) {
      if (String(selector).includes("Formular feedback")) {
        return iframe;
      }
      return null;
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
  assert.match(iframe.src, /entry\.1640447617=/);
  const serialized = JSON.stringify(dataLayer);
  assert.ok(!serialized.includes("hidden@example.com"));
  assert.ok(!serialized.includes("hidden%40"));
});
