"use strict";

/**
 * Submit solon.agency URLs to IndexNow.
 *
 * Mode A (default, post-deploy): URLs for HTML files changed between
 * INDEXNOW_BEFORE and INDEXNOW_SHA, plus sitemap URLs added or given a new
 * lastmod. Only URLs still listed in sitemap.xml are sent.
 * Mode B (--all): every sitemap <loc>.
 *
 * The public key is /<32 lowercase hex>.txt at the site root. A zero or
 * missing before SHA skips submission. The script logs the HTTP status and
 * body, warns on 4xx responses, aborts the request after 15 seconds, and
 * always exits 0.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOST = "solon.agency";
const ORIGIN = `https://${HOST}`;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH_SIZE = 10000;
const REQUEST_TIMEOUT_MS = 15000;
const ROOT = path.join(__dirname, "..");
const KEY_FILE_NAME = /^[0-9a-f]{32}\.txt$/;
const SHA40 = /^[0-9a-f]{40}$/;
const STATUS_WITH_DEST = new Set(["R", "C"]);
const STATUS_SKIP = new Set(["D", "X", "B"]);

/**
 * @param {string} value
 * @returns {string}
 */
const decodeXml = (value) => String(value)
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

/**
 * A 40-hex commit that is not the all-zero first-push placeholder.
 * @param {string} value
 * @returns {boolean}
 */
const isUsableSha = (value) => {
  if (typeof value !== "string") return false;
  const sha = value.trim().toLowerCase();
  if (!SHA40.test(sha)) return false;
  return !/^0+$/.test(sha);
};

/**
 * Map a repo-relative HTML path to the canonical URL used in sitemap.xml.
 * `index.html` becomes the directory URL with a trailing slash.
 * @param {string} filePath
 * @returns {string} Absolute URL, or "" when the path is not an HTML page.
 */
const htmlFileToUrl = (filePath) => {
  const normalized = String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized.endsWith(".html")) return "";
  if (normalized.split("/").includes("..")) return "";
  if (normalized === "r" || normalized.startsWith("r/")) return "";
  if (normalized === "index.html") return `${ORIGIN}/`;
  if (normalized.endsWith("/index.html")) {
    return `${ORIGIN}/${normalized.slice(0, -"index.html".length)}`;
  }
  return `${ORIGIN}/${normalized}`;
};

/**
 * @param {string} xml
 * @returns {Map<string, string>} loc → lastmod, host URLs only.
 */
const parseSitemapEntries = (xml) => {
  const entries = new Map();
  const pattern = /<loc>([\s\S]*?)<\/loc>\s*<lastmod>([\s\S]*?)<\/lastmod>/g;
  const source = String(xml || "");
  for (const match of source.matchAll(pattern)) {
    const loc = decodeXml(match[1].trim());
    if (!loc.startsWith(`${ORIGIN}/`)) continue;
    entries.set(loc, match[2].trim());
  }
  return entries;
};

/**
 * Locs added in the current sitemap, or present with a different lastmod.
 * @param {string} previousXml
 * @param {string} currentXml
 * @returns {string[]}
 */
const urlsChangedInSitemap = (previousXml, currentXml) => {
  const previous = parseSitemapEntries(previousXml);
  const current = parseSitemapEntries(currentXml);
  const urls = [];
  for (const [loc, lastmod] of current) {
    if (!previous.has(loc) || previous.get(loc) !== lastmod) urls.push(loc);
  }
  return urls;
};

/**
 * @param {string} nameStatus `git diff --name-status` output.
 * @returns {{ files: string[], sitemapChanged: boolean }}
 */
const parseNameStatus = (nameStatus) => {
  const files = [];
  let sitemapChanged = false;
  String(nameStatus || "").split(/\r?\n/).forEach((line) => {
    if (!line) return;
    const parts = line.split("\t");
    const code = (parts[0] || "").charAt(0);
    if (!code || STATUS_SKIP.has(code)) return;
    const file = STATUS_WITH_DEST.has(code) ? parts[2] : parts[1];
    if (!file) return;
    const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized === "sitemap.xml") sitemapChanged = true;
    if (normalized.endsWith(".html")) files.push(normalized);
  });
  return { files, sitemapChanged };
};

/**
 * Redirect pages under /r/ are not submitted.
 * @param {string} loc
 * @returns {boolean}
 */
const isShortRedirectLoc = (loc) => {
  const prefix = `${ORIGIN}/r`;
  return loc === prefix || loc === `${prefix}/` || loc.startsWith(`${prefix}/`);
};

/**
 * HTML changes plus sitemap adds/lastmod edits, limited to current locs.
 * Redirect pages under /r/ are excluded.
 * @param {{ changedFiles: string[], sitemapChanged: boolean, previousSitemap: string|null, currentSitemap: string }} input
 * @returns {string[]}
 */
const selectChangedUrls = ({ changedFiles, sitemapChanged, previousSitemap, currentSitemap }) => {
  const allowed = new Set(parseSitemapEntries(currentSitemap).keys());
  const urls = new Set();
  (changedFiles || []).forEach((file) => {
    const url = htmlFileToUrl(file);
    if (url && allowed.has(url) && !isShortRedirectLoc(url)) urls.add(url);
  });
  if (sitemapChanged && typeof previousSitemap === "string") {
    urlsChangedInSitemap(previousSitemap, currentSitemap).forEach((loc) => {
      if (allowed.has(loc) && !isShortRedirectLoc(loc)) urls.add(loc);
    });
  }
  return [...urls];
};

/**
 * Keep a log call when the caller did not pass one.
 * @param {string} message
 * @returns {string}
 */
const fallbackLog = (message) => {
  return message;
};

/**
 * Mode A URL list. A null git result means the command failed.
 * A zero or missing before SHA skips submission. An unreachable before SHA
 * (force-push) falls back to sitemap lastmod changes when the previous
 * sitemap can be read, and otherwise skips.
 * @param {{ before: string, sha: string, currentSitemap: string, gitRunner: function, log: function }} input
 * @returns {string[]}
 */
const collectChangedUrls = ({ before, sha, currentSitemap, gitRunner, log }) => {
  const write = typeof log === "function" ? log : fallbackLog;
  if (!isUsableSha(before)) {
    write("IndexNow: before SHA is missing or zero; skipping");
    return [];
  }
  if (!isUsableSha(sha)) {
    write("IndexNow: head SHA is missing; skipping");
    return [];
  }
  const nameStatus = gitRunner(["diff", "--name-status", "--find-renames", `${before}..${sha}`]);
  if (typeof nameStatus !== "string") {
    write("IndexNow: git diff unavailable; falling back to sitemap lastmod changes");
    const previousSitemap = gitRunner(["show", `${before}:sitemap.xml`]);
    if (typeof previousSitemap !== "string") {
      write("IndexNow: previous sitemap unavailable; skipping");
      return [];
    }
    return urlsChangedInSitemap(previousSitemap, currentSitemap);
  }
  const parsed = parseNameStatus(nameStatus);
  let previousSitemap = null;
  if (parsed.sitemapChanged) {
    const shown = gitRunner(["show", `${before}:sitemap.xml`]);
    previousSitemap = typeof shown === "string" ? shown : null;
    if (previousSitemap == null) {
      write("IndexNow: sitemap.xml changed but the previous copy is unavailable");
    }
  }
  return selectChangedUrls({
    changedFiles: parsed.files,
    sitemapChanged: parsed.sitemapChanged,
    previousSitemap,
    currentSitemap,
  });
};

/**
 * @param {string[]} items
 * @param {number} size
 * @returns {string[][]}
 */
const chunk = (items, size) => {
  const limit = size > 0 ? size : items.length || 1;
  const batches = [];
  for (let index = 0; index < items.length; index += limit) {
    batches.push(items.slice(index, index + limit));
  }
  return batches;
};

/**
 * @param {string} key
 * @param {string[]} urlList
 * @returns {{ host: string, key: string, keyLocation: string, urlList: string[] }}
 */
const buildPayload = (key, urlList) => ({
  host: HOST,
  key,
  keyLocation: `${ORIGIN}/${key}.txt`,
  urlList,
});

/**
 * Read /<key>.txt whose body is exactly the key. No trailing newline.
 * @param {string} rootDir
 * @returns {{ key: string, fileName: string }|null}
 */
const readIndexNowKey = (rootDir) => {
  let names = [];
  try {
    names = fs.readdirSync(rootDir);
  } catch {
    return null;
  }
  const matches = names.filter((name) => KEY_FILE_NAME.test(name)).sort();
  for (const name of matches) {
    const key = name.slice(0, -".txt".length);
    try {
      const content = fs.readFileSync(path.join(rootDir, name), "utf8");
      if (content === key) return { key, fileName: name };
    } catch {
      continue;
    }
  }
  return null;
};

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {function} log
 * @returns {string|null}
 */
const defaultGit = (args, cwd, log) => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`IndexNow: git exited (${message})`);
    return null;
  }
};

/**
 * @param {number} status
 * @returns {boolean}
 */
const isClientError = (status) => status >= 400 && status < 500;

/**
 * POST urlList in batches of at most 10,000. Logs each status and body.
 * 4xx responses are also written as warnings. The request aborts after 15s.
 * @param {{ urls: string[], key: string, fetchImpl: function, log: function, warn?: function, batchSize?: number }} input
 * @returns {Promise<number[]>}
 */
const submitUrlList = async ({ urls, key, fetchImpl, log, warn, batchSize = BATCH_SIZE }) => {
  const warnOut = typeof warn === "function" ? warn : console.warn;
  const statusCodes = [];
  const batches = chunk(urls, batchSize);
  for (const urlList of batches) {
    const payload = buildPayload(key, urlList);
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    let body = "";
    if (response && typeof response.text === "function") {
      body = await response.text();
    }
    if (isClientError(response.status)) {
      warnOut(`IndexNow warning: HTTP ${response.status}`);
    }
    log(`IndexNow status ${response.status}`);
    log(body);
    statusCodes.push(response.status);
  }
  return statusCodes;
};

/**
 * @param {unknown} error
 * @returns {boolean}
 */
const isTimeoutError = (error) => {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
};

/**
 * @param {{ all?: boolean, before?: string, sha?: string, root?: string, dryRun?: boolean, fetchImpl?: function, log?: function, warn?: function, gitRunner?: function }} [options]
 * @returns {Promise<{ urls: string[], submitted: number, statusCodes: number[], error?: string }>}
 */
const runIndexNow = async (options = {}) => {
  const log = typeof options.log === "function" ? options.log : console.log;
  const warn = typeof options.warn === "function" ? options.warn : console.warn;
  const root = options.root || ROOT;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const keyInfo = readIndexNowKey(root);
    if (!keyInfo) {
      log("IndexNow: key file missing or does not match its name; skipping");
      return { urls: [], submitted: 0, statusCodes: [] };
    }
    const currentSitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
    const urls = (options.all
      ? [...parseSitemapEntries(currentSitemap).keys()]
      : collectChangedUrls({
        before: options.before || "",
        sha: options.sha || "",
        currentSitemap,
        gitRunner: options.gitRunner || ((args) => defaultGit(args, root, log)),
        log,
      })).filter((loc) => !isShortRedirectLoc(loc));
    if (urls.length === 0) {
      log("IndexNow: no URLs to submit");
      return { urls, submitted: 0, statusCodes: [] };
    }
    log(`IndexNow: ${urls.length} URL(s) to submit`);
    if (options.dryRun) {
      urls.forEach((url) => log(url));
      return { urls, submitted: 0, statusCodes: [] };
    }
    const statusCodes = await submitUrlList({
      urls,
      key: keyInfo.key,
      fetchImpl,
      log,
      warn,
    });
    return { urls, submitted: urls.length, statusCodes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTimeoutError(error)) {
      log(`IndexNow: request timed out after ${REQUEST_TIMEOUT_MS}ms (${message})`);
      return { urls: [], submitted: 0, statusCodes: [], error: message };
    }
    log(`IndexNow error: ${message}`);
    return { urls: [], submitted: 0, statusCodes: [], error: message };
  }
};

/**
 * @param {string[]} argv
 * @returns {{ all: boolean, before: string, sha: string, dryRun: boolean, root: string }}
 */
const parseArgs = (argv) => {
  const options = {
    all: false,
    before: "",
    sha: "",
    dryRun: false,
    root: ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--before") {
      options.before = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--sha") {
      options.sha = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--root") {
      options.root = argv[index + 1] || options.root;
      index += 1;
    }
  }
  return options;
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  runIndexNow({
    all: args.all,
    before: args.before || process.env.INDEXNOW_BEFORE || "",
    sha: args.sha || process.env.INDEXNOW_SHA || "",
    dryRun: args.dryRun,
    root: args.root,
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`IndexNow error: ${message}`);
  }).then(() => {
    process.exitCode = 0;
  });
}

module.exports = {
  BATCH_SIZE,
  REQUEST_TIMEOUT_MS,
  INDEXNOW_ENDPOINT,
  ORIGIN,
  isUsableSha,
  htmlFileToUrl,
  parseSitemapEntries,
  urlsChangedInSitemap,
  parseNameStatus,
  selectChangedUrls,
  collectChangedUrls,
  chunk,
  buildPayload,
  readIndexNowKey,
  submitUrlList,
  runIndexNow,
};
