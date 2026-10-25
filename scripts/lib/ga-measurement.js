"use strict";

const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "..", "data", "ga-measurement.json");

/**
 * @returns {{ measurementId: string }}
 */
const readGaMeasurementConfig = () => {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.measurementId !== "string" || !/^G-[A-Z0-9]+$/u.test(parsed.measurementId)) {
    throw new Error("data/ga-measurement.json must define a valid measurementId");
  }
  return parsed;
};

const { measurementId: GA_MEASUREMENT_ID } = readGaMeasurementConfig();

module.exports = {
  GA_MEASUREMENT_ID,
  GA_DISABLE_PROPERTY: `ga-disable-${GA_MEASUREMENT_ID}`,
  gtagLoaderUrl: `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`,
  configPath,
  readGaMeasurementConfig,
};
