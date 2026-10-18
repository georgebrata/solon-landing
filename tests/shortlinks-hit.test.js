"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const assert = require("node:assert/strict");

(() => {
const SOURCE = fs.readFileSync(path.join(__dirname, "../docs/apps-script/shortlinks-hit.gs"), "utf8");

/**
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @returns {{ values: unknown[][], writes: { row: number, col: number, value: unknown }[], getDataRange: () => { getValues: () => unknown[][] }, getRange: (row: number, col: number) => { setValue: (value: unknown) => void } }}
 */
function makeSheet(headers, rows) {
  const values = [headers, ...rows.map((row) => row.slice())];
  /** @type {{ row: number, col: number, value: unknown }[]} */
  const writes = [];
  return {
    values,
    writes,
    getDataRange() {
      return {
        getValues() {
          return values.map((row) => row.slice());
        },
      };
    },
    getRange(row, col) {
      return {
        setValue(value) {
          writes.push({ row, col, value });
          values[row - 1][col - 1] = value;
        },
      };
    },
  };
}

/**
 * @param {{ sheet: ReturnType<typeof makeSheet>|null, cache?: Record<string, string>, lock?: boolean }} options
 * @returns {(body: { id?: string }) => { text: string }}
 */
function loadHit(options) {
  const cache = options.cache || {};
  const sandbox = {
    CacheService: {
      getScriptCache() {
        return {
          /**
           * @param {string} key
           * @returns {string|null}
           */
          get(key) {
            return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
          },
          /**
           * @param {string} key
           * @param {string} value
           * @returns {void}
           */
          put(key, value) {
            cache[key] = String(value);
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            return options.lock !== false;
          },
          releaseLock() {
            return undefined;
          },
        };
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          /**
           * @param {string} name
           * @returns {ReturnType<typeof makeSheet>|null}
           */
          getSheetByName(name) {
            return name === "ShortLinks" ? options.sheet : null;
          },
        };
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      /**
       * @param {string} text
       * @returns {{ text: string, setMimeType: () => { text: string } }}
       */
      createTextOutput(text) {
        const output = {
          text,
          setMimeType() {
            return output;
          },
        };
        return output;
      },
    },
  };
  vm.runInNewContext(SOURCE, sandbox);
  return sandbox.handleHit_;
}

/**
 * @param {{ text: string }} output
 * @returns {{ success: boolean, error?: { code: string } }}
 */
function parseHit(output) {
  return JSON.parse(output.text);
}

/**
 * @param {string} source
 * @returns {string}
 */
function handleHitSource(source) {
  const start = source.indexOf("function handleHit_(body) {");
  const end = source.indexOf("function hitOut_(", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end).trim();
}

test("handleHit_ in solon-api.js matches shortlinks-hit.gs", () => {
  const api = fs.readFileSync(path.join(__dirname, "../docs/apps-script/solon-api.js"), "utf8");
  assert.equal(handleHitSource(api), handleHitSource(SOURCE));
});

test("the hit script increments Clicks and falls back to Total clicks", () => {
  assert.equal(SOURCE.includes("https://"), false);
  assert.equal(SOURCE.includes("apiKey"), false);

  const clicks = makeSheet(
    ["id", "Total Clicks", " CLICKS ", "Activ"],
    [["abc", 9, 4, true]]
  );
  const hitClicks = loadHit({ sheet: clicks });
  assert.deepEqual(parseHit(hitClicks({ id: "abc" })), { success: true });
  assert.deepEqual(clicks.writes, [{ row: 2, col: 3, value: 5 }]);
  assert.equal(clicks.values[1][1], 9);

  const clicksOnly = makeSheet(
    ["id", "Clicks", "Activ"],
    [["abc", 4, true]]
  );
  const hitOnly = loadHit({ sheet: clicksOnly });
  assert.deepEqual(parseHit(hitOnly({ id: "abc" })), { success: true });
  assert.deepEqual(clicksOnly.writes, [{ row: 2, col: 2, value: 5 }]);

  const legacy = makeSheet(
    ["id", "Total Clicks", "Activ"],
    [["abc", 4, true]]
  );
  const hitLegacy = loadHit({ sheet: legacy });
  assert.deepEqual(parseHit(hitLegacy({ id: "abc" })), { success: true });
  assert.deepEqual(legacy.writes, [{ row: 2, col: 2, value: 5 }]);

  const inactive = makeSheet(
    ["id", "Clicks", "Activ"],
    [["abc", 4, false]]
  );
  const hitInactive = loadHit({ sheet: inactive });
  assert.deepEqual(parseHit(hitInactive({ id: "abc" })), { success: false, error: { code: "NOT_FOUND" } });
  assert.deepEqual(inactive.writes, []);

  const minute = Math.floor(Date.now() / 60000);
  const limited = makeSheet(["id", "Clicks"], [["abc", 1]]);
  const hitLimited = loadHit({
    sheet: limited,
    cache: { [`hit:abc:${minute}`]: "60" },
  });
  assert.deepEqual(parseHit(hitLimited({ id: "abc" })), { success: false, error: { code: "RATE_LIMITED" } });
  assert.deepEqual(limited.writes, []);

  const busy = makeSheet(["id", "Clicks"], [["abc", 1]]);
  const hitBusy = loadHit({ sheet: busy, lock: false });
  assert.deepEqual(parseHit(hitBusy({ id: "abc" })), { success: false, error: { code: "BUSY" } });
  assert.deepEqual(busy.writes, []);
});
})();
