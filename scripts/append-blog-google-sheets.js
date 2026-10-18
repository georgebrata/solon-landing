"use strict";

const http = require("http");
const https = require("https");

/** Full Apps Script web app URL including any required query secret (never commit the value). */
const ENV_APPEND_URL = "BLOG_SHEETS_APPEND_URL";
const AUTHOR = "George";
/** Per POST request (Apps Script cold start). */
const APPEND_REQUEST_TIMEOUT_MS = 20000;

const formatToday = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * @param {string} title
 * @returns {string}
 */
const buildAppendPayload = (title) => JSON.stringify({ row: [formatToday(), "", title, AUTHOR] });

/**
 * @param {string} webhookUrl
 * @param {string} title
 * @param {{ timeoutMs?: number }} [options]
 */
const appendRow = (webhookUrl, title, options = {}) =>
  new Promise((resolve, reject) => {
    const payload = buildAppendPayload(title);
    const parsed = new URL(webhookUrl);
    const transport = parsed.protocol === "https:" ? https : http;
    const timeoutMs = options.timeoutMs ?? APPEND_REQUEST_TIMEOUT_MS;

    const request = transport.request(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 400) {
            resolve(body);
          } else {
            reject(new Error(`Request failed with status ${response.statusCode}: ${body}`));
          }
        });
      },
    );

    const timer = setTimeout(() => {
      request.destroy(new Error("append request timed out"));
    }, timeoutMs);

    /** Clears the per-request timeout when the socket closes or errors. */
    const clearTimer = () => clearTimeout(timer);
    request.on("close", clearTimer);
    request.on("error", (err) => {
      clearTimer();
      reject(err);
    });
    request.write(payload);
    request.end();
  });

/** @returns {string | null} */
const resolveAppendUrl = () => {
  const raw = process.env[ENV_APPEND_URL];
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).trim();
};

const main = async () => {
  const webhookUrl = resolveAppendUrl();
  if (!webhookUrl) {
    console.log(`append-blog-google-sheets: skip (${ENV_APPEND_URL} is not set)`);
    return;
  }

  const title = process.argv.slice(2).join(" ").trim();

  if (!title) {
    console.error('Error: "title" is required.');
    console.error('Usage: node scripts/append-blog-google-sheets.js "Article title"');
    process.exitCode = 1;
    return;
  }

  try {
    await appendRow(webhookUrl, title);
    console.log(`Appended row to Google Sheet: ["${formatToday()}", "", "${title}", "${AUTHOR}"]`);
  } catch (error) {
    console.error(`Failed to append row: ${error.message}`);
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  ENV_APPEND_URL,
  APPEND_REQUEST_TIMEOUT_MS,
  AUTHOR,
  resolveAppendUrl,
  buildAppendPayload,
  formatToday,
  appendRow,
};
