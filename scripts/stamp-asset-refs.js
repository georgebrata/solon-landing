"use strict";

/**
 * Cache-busting for first-party and vendor CSS/JS (issue #30).
 *
 * Strategy: query-string tokens (`?v=<content-hash>`), not hashed filenames.
 * Tokens are the first 10 hex chars of SHA-256 of the referenced file, so a
 * CSS/JS change updates the URL and long-cache headers stay safe.
 *
 * This walker is path-based, not an allowlist. New assets from later work
 * (for example consent.min.js from #26, or extra CSS from #31) are stamped
 * as soon as HTML references `assets/css/`, `assets/js/`, or `assets/vendor/`.
 * You do not need to edit this script when adding those files; add the
 * <link>/<script> tag and run `npm run minify` (or `npm run stamp-assets`).
 *
 * Images under assets/img/ are left unstamped (unique filenames). HTML,
 * /blog/posts.json, and sitemap.xml are not long-cached; see .htaccess.
 */

const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "scratch",
  "tests",
]);

/**
 * href/src pointing at css, js, or vendor files, including an existing ?v=.
 * Does not match absolute http(s) URLs or assets/img/.
 */
const ASSET_REF_RE =
  /(\b(?:href|src)\s*=\s*)(["'])((?:\.\.?\/|\/)?(?:(?:\.\.\/)+)?assets\/(?:css|js|vendor)\/[^"'?#]+(?:\?[^"'#]*)?)\2/gi;

const hashCache = new Map();

/** SHA-256 prefix (10 hex chars) of a file, cached per absolute path. */
const hashFile = (absPath) => {
  if (hashCache.has(absPath)) {
    return hashCache.get(absPath);
  }
  const digest = nodeCrypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex")
    .slice(0, 10);
  hashCache.set(absPath, digest);
  return digest;
};

/** Drop memoized hashes (needed when tests rewrite fixture files). */
const clearHashCache = () => {
  hashCache.clear();
};

/** Strip `?query` and `#fragment` from a URL. */
const stripQueryAndHash = (url) => {
  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  let end = url.length;
  if (queryIndex !== -1) end = Math.min(end, queryIndex);
  if (hashIndex !== -1) end = Math.min(end, hashIndex);
  return url.slice(0, end);
};

/**
 * Resolve an HTML asset URL to a file on disk.
 * Extra `../` is valid in the browser (cannot leave the origin) but can
 * leave the repo for templates/layout.html and blog/index.html.
 */
const resolveAssetPath = (htmlFile, assetUrl) => {
  const clean = stripQueryAndHash(assetUrl);
  const candidates = [];

  if (clean.startsWith("/")) {
    candidates.push(path.join(root, clean.replace(/^\/+/, "")));
  } else {
    candidates.push(path.resolve(path.dirname(htmlFile), clean));
  }

  const assetsAt = clean.indexOf("assets/");
  if (assetsAt !== -1) {
    const fromAssets = clean.slice(assetsAt);
    let dir = path.dirname(htmlFile);
    for (let depth = 0; depth < 8; depth += 1) {
      candidates.push(path.join(dir, fromAssets));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    candidates.push(path.join(root, fromAssets));
  }

  for (const abs of candidates) {
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return abs;
      }
    } catch {
      // ignore unreadable candidates
    }
  }
  return candidates[0];
};

/** Rewrite CSS/JS/vendor href/src in one HTML string with `?v=<hash>`. */
const stampHtml = (html, htmlFile) => {
  ASSET_REF_RE.lastIndex = 0;
  return html.replace(ASSET_REF_RE, (match, attr, quote, url) => {
    const cleanUrl = stripQueryAndHash(url);
    const abs = resolveAssetPath(htmlFile, cleanUrl);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      console.warn(
        `stamp-asset-refs: skip missing ${cleanUrl} (from ${path.relative(root, htmlFile)})`
      );
      return match;
    }
    const version = hashFile(abs);
    return `${attr}${quote}${cleanUrl}?v=${version}${quote}`;
  });
};

/** Recursively collect `.html` files, skipping VCS and tooling dirs. */
const collectHtmlFiles = (dir, acc = []) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") {
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectHtmlFiles(path.join(dir, entry.name), acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
};

/** Stamp one HTML file in place. Returns true when the file changed. */
const stampFile = (htmlFile) => {
  const original = fs.readFileSync(htmlFile, "utf8");
  const stamped = stampHtml(original, htmlFile);
  if (stamped !== original) {
    fs.writeFileSync(htmlFile, stamped);
    return true;
  }
  return false;
};

/** Stamp every HTML page under the repo root. */
const stampAllHtmlFiles = ({ silent = false } = {}) => {
  clearHashCache();
  const files = collectHtmlFiles(root);
  let changed = 0;
  for (const file of files) {
    if (stampFile(file)) {
      changed += 1;
      if (!silent) {
        console.log(`stamped ${path.relative(root, file)}`);
      }
    }
  }
  if (!silent) {
    console.log(
      `stamp-asset-refs: ${changed} HTML file(s) updated (${files.length} scanned)`
    );
  }
  return { scanned: files.length, changed };
};

module.exports = {
  ASSET_REF_RE,
  clearHashCache,
  collectHtmlFiles,
  hashFile,
  resolveAssetPath,
  stampAllHtmlFiles,
  stampFile,
  stampHtml,
  stripQueryAndHash,
};

if (require.main === module) {
  stampAllHtmlFiles();
}
