"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const gtagConfigSource = fs.readFileSync(path.join(root, "assets/js/gtag-config.js"), "utf8");

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
});
