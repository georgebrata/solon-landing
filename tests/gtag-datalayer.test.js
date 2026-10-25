"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const gtagConfigSource = fs.readFileSync(path.join(root, "assets/js/gtag-config.js"), "utf8");
const consentSource = fs.readFileSync(path.join(root, "assets/js/consent.js"), "utf8");

/**
 * @param {unknown} value
 * @returns {void}
 */
const assertIsArgumentsObject = (value) => {
  assert.equal(
    Object.prototype.toString.call(value),
    "[object Arguments]",
    `expected Arguments object, got ${Object.prototype.toString.call(value)}`,
  );
  assert.equal(Array.isArray(value), false);
};

/**
 * Minimal consumer that mirrors gtag.js rejecting array-shaped queue entries.
 * @param {unknown[]} dataLayer
 * @returns {unknown[]}
 */
const consumeLikeGtagJs = (dataLayer) => {
  const accepted = [];
  for (const entry of dataLayer) {
    if (Object.prototype.toString.call(entry) !== "[object Arguments]") {
      throw new Error("gtag.js consumer rejected non-Arguments dataLayer entry");
    }
    accepted.push(entry);
  }
  return accepted;
};

test("gtag-config stub pushes Arguments objects for js and config", () => {
  const dataLayer = [];
  const context = {
    window: {
      dataLayer,
      location: {
        href: "https://solon.agency/",
        pathname: "/",
      },
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(gtagConfigSource, context, { filename: "gtag-config.js" });
  assert.equal(dataLayer.length, 2);
  for (const entry of dataLayer) {
    assertIsArgumentsObject(entry);
  }
  assert.equal(dataLayer[0][0], "js");
  assert.equal(dataLayer[1][0], "config");
  consumeLikeGtagJs(dataLayer);
});

test("foreign gtag on window is upgraded to Arguments-pushing stub in gtag-config", () => {
  const dataLayer = [];
  const foreignCalls = [];
  const context = {
    window: {
      dataLayer,
      gtag(...args) {
        foreignCalls.push([...args]);
      },
      location: {
        href: "https://solon.agency/",
        pathname: "/",
      },
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(gtagConfigSource, context, { filename: "gtag-config.js" });
  assert.equal(context.window.gtag.__solonArgumentsStub, true);
  assert.ok(foreignCalls.length >= 2);
  for (const entry of dataLayer) {
    assertIsArgumentsObject(entry);
  }
  consumeLikeGtagJs(dataLayer);
});

test("consent gtag stub output is accepted by a gtag.js-like Arguments-only consumer", () => {
  const dataLayer = [];
  const context = {
    console,
    Date,
    JSON,
    Object,
    Array,
    document: {
      readyState: "complete",
      cookie: "",
      body: {
        appendChild() {},
        addEventListener() {},
      },
      head: { appendChild() {} },
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return { setAttribute() {}, appendChild() {}, attributes: [], addEventListener() {} };
      },
      createTextNode(text) {
        return { textContent: String(text) };
      },
      addEventListener() {},
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    location: {
      pathname: "/",
      protocol: "https:",
      hostname: "solon.agency",
      href: "https://solon.agency/",
    },
    addEventListener() {},
    requestAnimationFrame(fn) {
      fn();
    },
    dataLayer,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(consentSource, context);
  context.gtag("event", "probe", { ok: true });
  consumeLikeGtagJs(dataLayer);
});
