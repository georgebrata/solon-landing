"use strict";

/**
 * Build short links from the ShortLinks sheet.
 *
 * Browsers (Accept contains text/html) are rewritten to r/<path>/index.html.
 * Every other client gets a 302 (or 301 when the row says so) from .htaccess.
 * The visitor query is copied byte for byte. The visitor wins on conflicts.
 *
 * Usage: node scripts/build-shortlinks.js [--offline] [--check]
 *   --offline  use data/shortlinks.snapshot.json (tests / no network)
 *   --check    exit 1 if .htaccess or r/ would change
 *
 * Live rows come from fetchTab("ShortLinks") in scripts/build-pricing.js
 * (SHEETS_API_URL + SHEETS_API_KEY). A missing key uses the committed snapshot.
 * A failed fetch logs ::error:: and does not write the snapshot, .htaccess, or r/.
 */

(() => {
const fs = require("fs");
const path = require("path");
const { fetchTab } = require("./build-pricing");

const ROOT = path.join(__dirname, "..");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTRA_RESERVED = Object.freeze([
  ".well-known",
  "tests",
  "scripts",
  "templates",
  "docs",
  "data",
  "node_modules",
  "skills",
  "cgi-bin",
  "wp-admin",
  "r",
  "cpanel",
  "webmail",
  "whm",
  "cpcalendars",
  "cpcontacts",
  "autodiscover",
  "mail",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "id",
  "Original URL",
  "Short URL",
  "Activ",
  "Tip redirect",
]);
const MARKER_START = "  # SHORTLINKS:START";
const MARKER_END = "  # SHORTLINKS:END";
const LATE_START = "  # SHORTLINKS-LATE:START";
const LATE_END = "  # SHORTLINKS-LATE:END";
const LATE_ANCHOR = "  <FilesMatch \"\\.(?i:html|htm)$\">\n    Header set Cache-Control \"no-cache, must-revalidate\"\n  </FilesMatch>";
const HTACCESS_ANCHOR = "  RewriteRule ^blog/posts(?:/|$) - [F,L]\n</IfModule>";
const ANALYTICS_HOSTS = Object.freeze([
  "googletagmanager.com",
  "google-analytics.com",
  "clarity.ms",
  "facebook.net",
  "facebook.com",
  "brevo.com",
  "metricool.com",
  "ahrefs.com",
  "counter.dev",
  "consent.min.js",
]);

/**
 * First path segment of every top-level file and directory, plus the fixed list.
 * @param {string} rootDir
 * @returns {Set<string>}
 */
function reservedFirstSegments(rootDir) {
  const names = new Set(EXTRA_RESERVED);
  fs.readdirSync(rootDir, { withFileTypes: true }).forEach((entry) => {
    names.add(entry.name.toLowerCase());
    if (entry.isFile()) {
      const stem = entry.name.replace(/\.[^.]+$/u, "");
      if (stem) names.add(stem.toLowerCase());
    }
  });
  return names;
}

/**
 * @param {string} value
 * @returns {string}
 */
function safeId(value) {
  const text = String(value || "").trim();
  return ID_RE.test(text) ? text : "invalid-id";
}

/**
 * One decode step. A broken escape returns null and never throws to the caller.
 * @param {string} text
 * @returns {string|null}
 */
function decodeOnce(text) {
  try {
    return decodeURIComponent(String(text).replace(/\+/gu, " "));
  } catch {
    return null;
  }
}

/**
 * True when the URL carries apiKey in the query or fragment, including
 * percent-encoded and nested forms (up to 3 decodes). Never throws.
 * @param {unknown} url
 * @returns {boolean}
 */
function originalUrlHasApiKey(url) {
  try {
    let text = String(url || "");
    for (let pass = 0; pass < 4; pass += 1) {
      if (/apiKey=/iu.test(text)) return true;
      const next = decodeOnce(text);
      if (next === null || next === text) break;
      text = next;
    }
    return /apiKey=/iu.test(text);
  } catch {
    return true;
  }
}

/**
 * Comma anywhere, or a flag-breaking character in the query.
 * Those characters are copied into Apache [E=...] flags.
 * @param {string} url
 * @returns {boolean}
 */
function destinationHasUnsafeFlag(url) {
  const text = String(url || "");
  if (text.indexOf(",") !== -1) return true;
  const hashAt = text.indexOf("#");
  const before = hashAt === -1 ? text : text.slice(0, hashAt);
  const queryAt = before.indexOf("?");
  if (queryAt === -1) return false;
  return hasFlagBreaker(before.slice(queryAt + 1));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasFlagBreaker(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
    const ch = text.charAt(index);
    if (ch === "," || ch === "]" || ch === "[" || ch === "\"" || ch === "'") return true;
  }
  return false;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasWhitespaceOrControl(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
    if (/\s/u.test(text.charAt(index))) return true;
  }
  return false;
}

/**
 * @param {unknown} url
 * @returns {string|null} The original string, or null when it cannot be published.
 */
function validateDestination(url) {
  const text = String(url || "");
  if (!text || text.length > 2048) return null;
  if (hasWhitespaceOrControl(text)) return null;
  if (/["<>\\`]/u.test(text)) return null;
  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null;
  return text;
}

/**
 * @param {unknown} raw
 * @returns {{ path: string, uppercased: boolean }|null}
 */
function parseShortPath(raw) {
  const text = String(raw || "").trim();
  if (!text || /[?#]/u.test(text)) return null;
  if (!/^https:\/\/solon\.agency\//iu.test(text)) return null;
  let remainder = text.replace(/^https:\/\/solon\.agency\//iu, "");
  const uppercased = /[A-Z]/u.test(remainder);
  remainder = remainder.replace(/\/+$/u, "").toLowerCase();
  if (!remainder || remainder.length > 64) return null;
  const segments = remainder.split("/");
  if (segments.length < 1 || segments.length > 3) return null;
  if (!segments.every((segment) => SEGMENT_RE.test(segment))) return null;
  return { path: remainder, uppercased };
}

/**
 * Missing or empty Activ means the row is published. FALSE hides it.
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function isActive(row) {
  if (!Object.prototype.hasOwnProperty.call(row, "Activ")) return true;
  const value = row.Activ;
  if (value === false) return false;
  if (value == null) return true;
  if (typeof value !== "string") return true;
  const text = value.trim().toLowerCase();
  if (text === "") return true;
  return text !== "false";
}

/**
 * @param {Record<string, unknown>} row
 * @returns {301|302}
 */
function redirectStatus(row) {
  const value = row["Tip redirect"];
  if (value === 301 || value === "301") return 301;
  if (typeof value === "string" && value.trim() === "301") return 301;
  return 302;
}

/**
 * @param {string} id
 * @param {string} reason
 * @param {{ warn?: (id: string, reason: string) => void }} options
 * @param {boolean} skipped
 * @returns {void}
 */
function emitRow(id, reason, options, skipped) {
  const safe = safeId(id);
  if (typeof options.warn === "function") {
    options.warn(safe, reason);
    return;
  }
  const label = skipped ? `skipping ${safe}` : safe;
  console.warn(`::warning::build-shortlinks: ${label}`);
}

/**
 * One parser for sheet rows and for the committed snapshot.
 * Bad rows are skipped. An apiKey query param is never published.
 * @param {unknown} rows
 * @param {{ reserved?: Set<string>, warn?: (id: string, reason: string) => void }} [options]
 * @returns {{ links: { id: string, path: string, destination: string, status: 301|302 }[], skipped: { id: string, reason: string }[] }}
 */
function classifyShortLinks(rows, options = {}) {
  const reserved = options.reserved || new Set();
  const skipped = [];
  /** @type {{ id: string, path: string, destination: string, status: 301|302 }[]} */
  const prepared = [];
  const list = Array.isArray(rows) ? rows : [];

  list.forEach((row, index) => {
    const record = row && typeof row === "object" ? /** @type {Record<string, unknown>} */ (row) : {};
    const id = String(record.id ?? "").trim();
    /** @param {string} reason */
    const skip = (reason) => {
      const safe = safeId(id || `row-${index + 1}`);
      skipped.push({ id: safe, reason });
      emitRow(id, reason, options, true);
    };

    if (!ID_RE.test(id)) {
      skip("bad-id");
      return;
    }
    if (originalUrlHasApiKey(record["Original URL"])) {
      skip("api-key");
      return;
    }
    const destination = validateDestination(record["Original URL"]);
    if (!destination) {
      skip("bad-destination");
      return;
    }
    if (destinationHasUnsafeFlag(destination)) {
      skip("unsafe-flag");
      return;
    }
    const shortPath = parseShortPath(record["Short URL"]);
    if (!shortPath) {
      skip("bad-short-url");
      return;
    }
    if (reserved.has(shortPath.path.split("/")[0])) {
      skip("reserved");
      return;
    }
    if (!isActive(record)) {
      skipped.push({ id, reason: "inactive" });
      return;
    }
    if (shortPath.uppercased) emitRow(id, "uppercase", options, false);
    prepared.push({
      id,
      path: shortPath.path,
      destination,
      status: redirectStatus(record),
    });
  });

  const uniqueIds = dropDuplicates(prepared, (link) => link.id, "duplicate-id", options, skipped);
  const links = dropDuplicatePaths(uniqueIds, options, skipped);
  return { links, skipped };
}

/**
 * @param {{ id: string, path: string, destination: string, status: 301|302 }[]} items
 * @param {(item: { id: string }) => string} keyOf
 * @param {string} reason
 * @param {{ warn?: (id: string, reason: string) => void }} options
 * @param {{ id: string, reason: string }[]} skipped
 * @returns {{ id: string, path: string, destination: string, status: 301|302 }[]}
 */
function dropDuplicates(items, keyOf, reason, options, skipped) {
  /** @type {Map<string, { id: string, path: string, destination: string, status: 301|302 }[]>} */
  const groups = new Map();
  items.forEach((item) => {
    const key = keyOf(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  });
  /** @type {{ id: string, path: string, destination: string, status: 301|302 }[]} */
  const kept = [];
  groups.forEach((group) => {
    if (group.length === 1) {
      kept.push(group[0]);
      return;
    }
    group.forEach((item) => {
      skipped.push({ id: item.id, reason });
      emitRow(item.id, reason, options, true);
    });
  });
  return kept;
}

/**
 * Same path, destination, and redirect type: keep the first row in sheet order.
 * A different destination or type skips every row in the group.
 * @param {{ id: string, path: string, destination: string, status: 301|302 }[]} items
 * @param {{ warn?: (id: string, reason: string) => void }} options
 * @param {{ id: string, reason: string }[]} skipped
 * @returns {{ id: string, path: string, destination: string, status: 301|302 }[]}
 */
function dropDuplicatePaths(items, options, skipped) {
  /** @type {Map<string, { id: string, path: string, destination: string, status: 301|302 }[]>} */
  const groups = new Map();
  items.forEach((item) => {
    const group = groups.get(item.path) || [];
    group.push(item);
    groups.set(item.path, group);
  });
  /** @type {{ id: string, path: string, destination: string, status: 301|302 }[]} */
  const kept = [];
  groups.forEach((group) => {
    if (group.length === 1) {
      kept.push(group[0]);
      return;
    }
    const first = group[0];
    const identical = group.every((item) => item.destination === first.destination && item.status === first.status);
    const losers = identical ? group.slice(1) : group;
    if (identical) kept.push(first);
    losers.forEach((item) => {
      skipped.push({ id: item.id, reason: "duplicate-path" });
      emitRow(item.id, "duplicate-path", options, true);
    });
  });
  return kept;
}

/**
 * Compact copy of mergeQuery inlined into each redirect page.
 * tests/shortlinks.test.js checks it against mergeQuery.
 */
const PAGE_MERGE = [
  "function mergeQuery(d,s,h){",
  "function k(p){var i=p.indexOf(\"=\"),r=i<0?p:p.slice(0,i),out=r;try{out=decodeURIComponent(r);}catch(e){out=r;}return out;}",
  "var t=String(d||\"\"),n=t.indexOf(\"#\"),a=n<0?t:t.slice(0,n),f=n<0?\"\":t.slice(n);",
  "var q=a.indexOf(\"?\"),b=q<0?a:a.slice(0,q),o=q<0?\"\":a.slice(q+1);",
  "var u=String(s||\"\"),v=u.charAt(0)===\"?\"?u.slice(1):u,seen=Object.create(null),ex=[],parts,i,p;",
  "parts=v.split(\"&\");for(i=0;i<parts.length;i++){p=parts[i];if(p)seen[k(p)]=1;}",
  "parts=o.split(\"&\");for(i=0;i<parts.length;i++){p=parts[i];if(p&&!seen[k(p)])ex.push(p);}",
  "var m=ex.length?(v?v+\"&\"+ex.join(\"&\"):ex.join(\"&\")):v;",
  "return b+(m?\"?\"+m:\"\")+(f||String(h||\"\"));}",
].join("");

/**
 * Visitor query wins, byte for byte. Keys are compared after decoding.
 * @param {string} dest
 * @param {string} search
 * @param {string} hash
 * @returns {string}
 */
function mergeQuery(dest, search, hash) {
  /** @param {string} part */
  const key = (part) => {
    const cut = part.indexOf("=");
    const raw = cut < 0 ? part : part.slice(0, cut);
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  const text = String(dest || "");
  const hashAt = text.indexOf("#");
  const head = hashAt < 0 ? text : text.slice(0, hashAt);
  const frag = hashAt < 0 ? "" : text.slice(hashAt);
  const queryAt = head.indexOf("?");
  const base = queryAt < 0 ? head : head.slice(0, queryAt);
  const own = queryAt < 0 ? "" : head.slice(queryAt + 1);
  const rawSearch = String(search || "");
  const visitor = rawSearch.charAt(0) === "?" ? rawSearch.slice(1) : rawSearch;
  const seen = new Set();
  const extra = [];
  visitor.split("&").forEach((part) => { if (part) seen.add(key(part)); });
  own.split("&").forEach((part) => { if (part && !seen.has(key(part))) extra.push(part); });
  const joined = extra.join("&");
  let merged = visitor;
  if (extra.length > 0) merged = visitor ? `${visitor}&${joined}` : joined;
  const query = merged ? `?${merged}` : "";
  return `${base}${query}${frag || String(hash || "")}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function jsString(value) {
  return JSON.stringify(String(value)).replace(/</gu, "\\u003c");
}

/**
 * @param {string} value
 * @returns {string}
 */
function htmlEscape(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

const PAGE_BYTE_LIMIT = 3072;
const LOGO_SVG = '<svg viewBox="0 0 24 24" role="img" aria-label="SOLON"><path fill="#F0EBD8" d="M2,0 4,0 24,20 24,22 23,23 21,24 20,23 1,4 0,2ZM2,9 4,10 14,20 15,22 14,23 11,24 0,13 0,11ZM21,0 23,0 24,2 24,4 20,7 24,12 24,13 22,15 20,14 14,7 15,6ZM2,18 4,19 5,21 6,22 5,24 2,24 0,22 0,20Z"/></svg>';

/**
 * @param {{ id: string, destination: string }} link
 * @param {string} hitEndpoint
 * @returns {string}
 */
function renderPage(link, hitEndpoint) {
  const dest = htmlEscape(link.destination);
  const hit = typeof hitEndpoint === "string" ? hitEndpoint : "";
  const html = `<!DOCTYPE html>
<html lang="ro" style="background:#03170C">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SOLON</title>
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<style>
html{--primary:#03170C;--secondary:#3E5C76;--tertiary:#F0EBD8;background:var(--primary);color:var(--tertiary)}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:var(--primary)}
svg{width:4rem;height:4rem}
.l{width:1.1rem;height:1.1rem;border:.12rem solid var(--secondary);border-top-color:var(--tertiary);border-radius:50%;animation:s .7s linear infinite}
@keyframes s{to{transform:rotate(1turn)}}
a{color:var(--tertiary);font:600 1rem Jost,system-ui,sans-serif;letter-spacing:.3em;text-decoration:none}
</style>
<script>
(function(){
var ID=${jsString(link.id)},D=${jsString(link.destination)},H=${jsString(hit)};
${PAGE_MERGE}
if(H&&typeof fetch==="function"){try{fetch(H,{method:'POST',mode:'no-cors',keepalive:true,credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'hit',id:ID})}).catch(function(){});}catch(e){}}
try{location.replace(mergeQuery(D,location.search,location.hash));}catch(e){location.replace(mergeQuery(D,location.search,location.hash));}
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${dest}"></noscript>
</head>
<body>
${LOGO_SVG}
<div class="l" aria-hidden="true"></div>
<noscript><a href="${dest}">SOLON</a></noscript>
</body>
</html>
`;
  const beacon = ["send", "Beacon"].join("");
  if (html.includes(beacon) || /apiKey=/iu.test(html)) {
    throw new Error(`refusing to write redirect page for ${safeId(link.id)}`);
  }
  ANALYTICS_HOSTS.forEach((host) => {
    if (html.includes(host)) {
      throw new Error(`refusing analytics on redirect page for ${safeId(link.id)}`);
    }
  });
  return html;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Escape % and $ so Apache does not treat them as backreferences.
 * @param {string} value
 * @returns {string}
 */
function escapeRewrite(value) {
  return String(value).replace(/[%$]/gu, "\\$&");
}

/**
 * @param {string} destination
 * @returns {{ path: string, params: string[], fragment: string }}
 */
function splitDestination(destination) {
  const hashAt = destination.indexOf("#");
  const beforeHash = hashAt === -1 ? destination : destination.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : destination.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const destPath = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const raw = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);
  const params = raw === "" ? [] : raw.split("&").filter((part) => part !== "");
  return { path: destPath, params, fragment };
}

/**
 * @param {string} linkPath
 * @returns {string}
 */
function rulePattern(linkPath) {
  return `^${linkPath.split("/").map((segment) => escapeRegex(segment)).join("\\/")}/?$`;
}

/**
 * @param {{ path: string, destination: string, status: 301|302 }} link
 * @returns {string[]}
 */
function renderLinkRules(link) {
  const pattern = rulePattern(link.path);
  const parts = splitDestination(link.destination);
  const flags = `[R=${link.status},L,NE]`;
  const target = escapeRewrite(parts.path);
  const fragment = escapeRewrite(parts.fragment);
  const lines = [
    "  RewriteCond %{HTTP:Accept} text/html",
    `  RewriteRule ${pattern} /r/${link.path}/index.html [L]`,
    "  RewriteCond %{HTTP:Accept} !text/html",
    `  RewriteRule ${pattern} - [E=SLQ:%{QUERY_STRING}]`,
  ];
  parts.params.forEach((param) => {
    const eq = param.indexOf("=");
    const key = eq === -1 ? param : param.slice(0, eq);
    lines.push("  RewriteCond %{HTTP:Accept} !text/html");
    lines.push(`  RewriteCond %{QUERY_STRING} !(^|&)${escapeRegex(key)}(=|&|$)`);
    lines.push(`  RewriteRule ${pattern} - [E=SLQ:%{ENV:SLQ}&${escapeRewrite(param)}]`);
  });
  lines.push("  RewriteCond %{HTTP:Accept} !text/html");
  lines.push("  RewriteCond %{ENV:SLQ} ^$");
  lines.push(`  RewriteRule ${pattern} ${target}${fragment} ${flags}`);
  lines.push("  RewriteCond %{HTTP:Accept} !text/html");
  lines.push("  RewriteCond %{ENV:SLQ} ^&?(.*)$");
  lines.push(`  RewriteRule ${pattern} ${target}?%1${fragment} ${flags}`);
  return lines;
}

/**
 * Refuse a flag field that Apache would split or misread.
 * @param {string} field
 * @returns {boolean}
 */
function flagFieldIsSafe(field) {
  if (field === "L" || field === "NE" || field === "R=301" || field === "R=302") return true;
  if (field === "E=SLQ:%{QUERY_STRING}") return true;
  const prefix = "E=SLQ:%{ENV:SLQ}&";
  if (field.indexOf(prefix) === 0) return !hasFlagBreaker(field.slice(prefix.length));
  return false;
}

/**
 * Scan generated [E=...] and [R=...] fields. Throws before any file is written.
 * @param {string} text
 * @returns {void}
 */
function assertSafeFlags(text) {
  String(text).split("\n").forEach((line) => {
    const start = line.indexOf("[");
    if (start === -1) return;
    const end = line.lastIndexOf("]");
    if (end <= start || line.slice(end + 1).trim() !== "") {
      throw new Error("unsafe rewrite flags");
    }
    const inner = line.slice(start + 1, end);
    if (hasFlagBreaker(inner.replace(/,/g, ""))) throw new Error("unsafe rewrite flags");
    inner.split(",").forEach((field) => {
      if (!flagFieldIsSafe(field)) throw new Error("unsafe rewrite flags");
    });
  });
}

/**
 * @param {string[]} paths
 * @returns {string}
 */
function requestExpr(paths) {
  const body = paths.map((item) => item.split("/").map((segment) => escapeRegex(segment)).join("\\/")).join("|");
  return `m#^/(?:r/)?(?:${body})(?:/index\\.html)?/?$#`;
}

/**
 * @param {{ path: string, destination: string, status: 301|302 }[]} links
 * @returns {string}
 */
function renderInner(links) {
  const lines = [
    "  # Generated by scripts/build-shortlinks.js. Do not edit by hand.",
    "  # Browsers (Accept contains text/html) rewrite to r/<path>/index.html.",
    "  # Every other client gets the redirect below. NE keeps the raw query.",
  ];
  links.forEach((link) => {
    lines.push(...renderLinkRules(link));
  });
  if (links.length > 0) {
    const expr = requestExpr(links.map((link) => link.path));
    lines.push("  <IfModule mod_headers.c>");
    lines.push(`    Header unset Cache-Control "expr=%{REQUEST_URI} =~ ${expr}"`);
    lines.push(`    Header always unset Cache-Control "expr=%{REQUEST_URI} =~ ${expr}"`);
    lines.push(`    Header always set Cache-Control "no-store" "expr=%{REQUEST_URI} =~ ${expr}"`);
    lines.push(`    Header always merge Vary "Accept" "expr=%{REQUEST_URI} =~ ${expr}"`);
    lines.push("  </IfModule>");
  }
  const inner = lines.join("\n");
  assertSafeFlags(inner);
  return inner;
}

/**
 * Runs after the HTML FilesMatch so /r/ keeps a single Cache-Control.
 * @param {{ path: string }[]} links
 * @returns {string}
 */
function renderLate(links) {
  if (links.length === 0) return "";
  const expr = requestExpr(links.map((link) => link.path));
  return [
    "  <IfModule mod_headers.c>",
    `    Header unset Cache-Control "expr=%{REQUEST_URI} =~ ${expr}"`,
    `    Header always set Cache-Control "no-store" "expr=%{REQUEST_URI} =~ ${expr}"`,
    "  </IfModule>",
  ].join("\n");
}

/**
 * @param {string} source
 * @param {string} lateInner
 * @returns {string}
 */
function applyLate(source, lateInner) {
  const existing = /\n\n {2}# SHORTLINKS-LATE:START[\s\S]*?\n {2}# SHORTLINKS-LATE:END\n+/u;
  if (!lateInner) {
    if (!existing.test(source)) return source;
    return source.replace(existing, () => "\n\n");
  }
  const block = `${LATE_START}\n${lateInner}\n${LATE_END}`;
  if (existing.test(source)) return source.replace(existing, () => `\n\n${block}\n\n`);
  const anchorBreak = `${LATE_ANCHOR}\n\n`;
  if (!source.includes(anchorBreak)) return source;
  return source.replace(anchorBreak, () => `${LATE_ANCHOR}\n\n${block}\n\n`);
}

/**
 * @param {string} source
 * @param {string} inner
 * @param {string} [lateInner]
 * @returns {string}
 */
function applyHtaccess(source, inner, lateInner = "") {
  const block = `${MARKER_START}\n${inner}\n${MARKER_END}`;
  const existing = /\n\n {2}# SHORTLINKS:START[\s\S]*?\n {2}# SHORTLINKS:END\n/u;
  let next = source;
  if (existing.test(source)) {
    next = source.replace(existing, () => `\n\n${block}\n`);
  } else if (!source.includes(HTACCESS_ANCHOR)) {
    throw new Error("mod_rewrite deny block not found in .htaccess");
  } else {
    next = source.replace(HTACCESS_ANCHOR, () => `  RewriteRule ^blog/posts(?:/|$) - [F,L]\n\n${block}\n</IfModule>`);
  }
  return applyLate(next, lateInner);
}

/**
 * Drop Clicks, Total clicks, and any row whose Original URL carries apiKey.
 * @param {unknown[]} rows
 * @returns {{ ShortLinks: Record<string, unknown>[] }}
 */
function snapshotDocument(rows) {
  const clean = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (row);
    if (originalUrlHasApiKey(record["Original URL"])) return;
    /** @type {Record<string, unknown>} */
    const copy = {};
    SNAPSHOT_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(record, key)) return;
      const value = record[key];
      if (typeof value === "string" && /apiKey=/iu.test(value)) return;
      copy[key] = value;
    });
    if (originalUrlHasApiKey(copy["Original URL"])) return;
    if (!copy.id || !copy["Original URL"] || !copy["Short URL"]) return;
    clean.push(copy);
  });
  return { ShortLinks: clean };
}

/**
 * @param {{ ShortLinks: unknown[] }} document
 * @returns {void}
 */
function assertNoApiKey(document) {
  const serialised = JSON.stringify(document);
  if (/apiKey=/iu.test(serialised)) {
    throw new Error("refusing to write a snapshot that contains an apiKey query");
  }
}

/**
 * @param {string} configPath
 * @returns {string}
 */
function readHitEndpoint(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config || typeof config.hitEndpoint !== "string") return "";
    return config.hitEndpoint.trim();
  } catch {
    return "";
  }
}

/**
 * Drop URLs and key material before anything is logged.
 * @param {unknown} value
 * @returns {string}
 */
function redactLog(value) {
  return String(value || "request failed")
    .replace(/https?:\/\/\S+/giu, "[url]")
    .replace(/apiKey=[^&\s]*/giu, "apiKey=[redacted]")
    .replace(/SHEETS_API_KEY[=:]\s*\S+/giu, "SHEETS_API_KEY=[redacted]")
    .slice(0, 400);
}

/**
 * options.apiKey wins, including an explicit empty string. Otherwise the env key.
 * @param {{ apiKey?: string }} options
 * @returns {string}
 */
function configuredApiKey(options) {
  if (Object.prototype.hasOwnProperty.call(options, "apiKey")) {
    return options.apiKey == null ? "" : String(options.apiKey);
  }
  const fromEnv = process.env.SHEETS_API_KEY;
  return fromEnv == null ? "" : String(fromEnv);
}

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function listHtml(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listHtml(full, acc);
    else if (entry.name.endsWith(".html")) acc.push(full);
  });
  return acc;
}

/**
 * @param {string} dir
 * @param {string} stop
 * @returns {void}
 */
function removeEmptyDirs(dir, stop) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name), stop);
  });
  if (dir !== stop && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * @param {string} root
 * @param {string} before
 * @param {string} after
 * @param {Map<string, string>} pages
 * @returns {boolean}
 */
function hasDrift(root, before, after, pages) {
  if (before !== after) return true;
  const base = path.join(root, "r");
  const expected = new Set([...pages.keys()].map((rel) => path.join(root, rel)));
  const found = listHtml(base);
  if (found.length !== expected.size) return true;
  if (found.some((file) => !expected.has(file))) return true;
  return [...pages.entries()].some(([rel, html]) => {
    const file = path.join(root, rel);
    return !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== html;
  });
}

/**
 * @param {string} root
 * @param {unknown[]} rows
 * @param {{ warn?: (id: string, reason: string) => void }} options
 * @returns {{ classified: ReturnType<typeof classifyShortLinks>, current: string, next: string, pages: Map<string, string>, htaccessPath: string }}
 */
function planPublish(root, rows, options) {
  const hitEndpoint = readHitEndpoint(path.join(root, "data", "shortlinks.config.json"));
  const classified = classifyShortLinks(rows, {
    reserved: reservedFirstSegments(root),
    warn: options.warn,
  });
  const htaccessPath = path.join(root, ".htaccess");
  const current = fs.readFileSync(htaccessPath, "utf8");
  const inner = renderInner(classified.links);
  const next = applyHtaccess(current, inner, renderLate(classified.links));
  /** @type {Map<string, string>} */
  const pages = new Map();
  classified.links.forEach((link) => {
    const rel = path.join("r", ...link.path.split("/"), "index.html");
    const html = renderPage(link, hitEndpoint);
    if (Buffer.byteLength(html) > PAGE_BYTE_LIMIT) {
      console.warn(`::warning::build-shortlinks: ${safeId(link.id)}`);
    }
    pages.set(rel, html);
  });
  return { classified, current, next, pages, htaccessPath };
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {void}
 */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * @param {string} root
 * @param {ReturnType<typeof planPublish>} plan
 * @param {string|null} snapshotText
 * @returns {void}
 */
function commitPublish(root, plan, snapshotText) {
  /** @type {{ tmp: string, file: string }[]} */
  const staged = [];
  try {
    plan.pages.forEach((html, rel) => {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, html);
      staged.push({ tmp, file });
    });
    staged.forEach((item) => {
      fs.renameSync(item.tmp, item.file);
    });
    staged.length = 0;
    if (plan.next !== plan.current) writeAtomic(plan.htaccessPath, plan.next);
    if (snapshotText != null) {
      writeAtomic(path.join(root, "data", "shortlinks.snapshot.json"), snapshotText);
    }
    const expected = new Set([...plan.pages.keys()].map((rel) => path.join(root, rel)));
    listHtml(path.join(root, "r")).forEach((file) => {
      if (!expected.has(file)) fs.rmSync(file);
    });
    removeEmptyDirs(path.join(root, "r"), path.join(root, "r"));
  } catch (error) {
    staged.forEach((item) => {
      fs.rmSync(item.tmp, { force: true });
    });
    throw error;
  }
  const ids = plan.classified.links.map((link) => link.id).join(", ");
  console.log(`build-shortlinks: published ${ids}`);
}

/**
 * @param {string} snapshotPath
 * @returns {unknown[]}
 */
function readSnapshotRows(snapshotPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    if (!parsed || !Array.isArray(parsed.ShortLinks)) return [];
    return parsed.ShortLinks;
  } catch {
    return [];
  }
}

/**
 * @param {string} snapshotPath
 * @returns {unknown[]|null}
 */
function loadSnapshotRows(snapshotPath) {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  } catch {
    console.error("::error::build-shortlinks: committed snapshot is unreadable");
    return null;
  }
  if (!parsed || !Array.isArray(parsed.ShortLinks)) {
    console.error("::error::build-shortlinks: snapshot has no ShortLinks array");
    return null;
  }
  return parsed.ShortLinks;
}

/**
 * @param {string} root
 * @param {unknown[]} rows
 * @param {{ check?: boolean, warn?: (id: string, reason: string) => void }} options
 * @param {string|null} snapshotText
 * @returns {number}
 */
function finishPublish(root, rows, options, snapshotText) {
  const plan = planPublish(root, rows, options);
  if (options.check === true) {
    if (hasDrift(root, plan.current, plan.next, plan.pages)) {
      console.error("::error::build-shortlinks: .htaccess or r/ is out of date; run node scripts/build-shortlinks.js --offline");
      return 1;
    }
    return 0;
  }
  commitPublish(root, plan, snapshotText);
  return 0;
}

/**
 * Prior-count classification must not print row warnings.
 * @returns {undefined}
 */
function silentWarning() {
  return undefined;
}

/**
 * @param {{ root?: string, offline?: boolean, check?: boolean, fetchImpl?: typeof fetch, baseUrl?: string, apiKey?: string, warn?: (id: string, reason: string) => void }} [options]
 * @returns {Promise<number>}
 */
async function run(options = {}) {
  const root = options.root || ROOT;
  const offline = options.offline === true;
  const snapshotPath = path.join(root, "data", "shortlinks.snapshot.json");

  if (!offline) {
    const apiKey = configuredApiKey(options);
    if (!apiKey.trim()) {
      console.log("build-shortlinks: SHEETS_API_KEY is not set; using committed snapshot");
    } else {
      try {
        /** @type {{ apiKey: string, fetchImpl?: typeof fetch, baseUrl?: string }} */
        const fetchOptions = { apiKey };
        if (options.fetchImpl) fetchOptions.fetchImpl = options.fetchImpl;
        if (options.baseUrl) fetchOptions.baseUrl = options.baseUrl;
        const fetched = await fetchTab("ShortLinks", fetchOptions);
        if (!Array.isArray(fetched)) throw new Error("ShortLinks data is not an array");
        const document = snapshotDocument(fetched);
        assertNoApiKey(document);
        const plan = planPublish(root, fetched, options);
        const priorRows = readSnapshotRows(snapshotPath);
        const priorCount = classifyShortLinks(priorRows, {
          reserved: reservedFirstSegments(root),
          warn: silentWarning,
        }).links.length;
        if (plan.classified.links.length === 0 || document.ShortLinks.length === 0) {
          throw new Error("no publishable ShortLinks rows");
        }
        if (priorCount > 0 && plan.classified.links.length * 2 < priorCount) {
          throw new Error("bulk drop of ShortLinks rows");
        }
        if (options.check === true) {
          if (hasDrift(root, plan.current, plan.next, plan.pages)) {
            console.error("::error::build-shortlinks: .htaccess or r/ is out of date; run node scripts/build-shortlinks.js --offline");
            return 1;
          }
          return 0;
        }
        commitPublish(root, plan, `${JSON.stringify(document, null, 2)}\n`);
        return 0;
      } catch (error) {
        const detail = redactLog(error instanceof Error ? error.message : error);
        console.error(`::error::build-shortlinks: SOLON API failed (${detail}); keeping the committed snapshot`);
        return 0;
      }
    }
  }

  const rows = loadSnapshotRows(snapshotPath);
  if (!rows) return 0;
  return finishPublish(root, rows, options, null);
}

if (require.main === module) {
  run({
    root: ROOT,
    offline: process.argv.includes("--offline"),
    check: process.argv.includes("--check"),
  }).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    const detail = redactLog(error instanceof Error ? error.message : error);
    console.error(`::error::build-shortlinks: ${detail}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ANALYTICS_HOSTS,
  applyHtaccess,
  classifyShortLinks,
  mergeQuery,
  PAGE_MERGE,
  assertSafeFlags,
  originalUrlHasApiKey,
  renderInner,
  renderPage,
  reservedFirstSegments,
  run,
  snapshotDocument,
};
})();
