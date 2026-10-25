"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const { GA_MEASUREMENT_ID } = require("./lib/ga-measurement");

const consentPath = path.join(root, "assets/js/consent.js");
const marker = "// @sync data/ga-measurement.json";
const pattern = /const GA_MEASUREMENT_ID = "([^"]+)"; \/\/ @sync data\/ga-measurement\.json/u;

const source = fs.readFileSync(consentPath, "utf8");
const match = source.match(pattern);
if (!match) {
  throw new Error(`consent.js must declare GA_MEASUREMENT_ID with ${marker}`);
}
if (match[1] !== GA_MEASUREMENT_ID) {
  const next = source.replace(pattern, `const GA_MEASUREMENT_ID = "${GA_MEASUREMENT_ID}"; ${marker}`);
  fs.writeFileSync(consentPath, next);
  console.log(`Synced GA_MEASUREMENT_ID in consent.js → ${GA_MEASUREMENT_ID}`);
}
