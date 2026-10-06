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

const crypto = require("crypto");
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

function hashFile(absPath) {
  if (hashCache.has(absPath)) {
    return hashCache.get(absPath);
  }
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex")
    .slice(0, 10);
  hashCache.set(absPath, digest);
  return digest;
}

function clearHashCache() {
  hashCache.clear();
}

function stripQueryAndHash(url) {
  const q = url.indexOf("?");
  const h = url.indexOf("#");
  let end = url.length;
  if (q !== -1) end = Math.min(end, q);
  if (h !== -1) end = Math.min(end, h);
  return url.slice(0, end);
}

function resolveAssetPath(htmlFile, assetUrl) {
  const clean = stripQueryAndHash(assetUrl);
  const candidates = [];

  if (clean.startsWith("/")) {
    candidates.push(path.join(root, clean.replace(/^\/+/, "")));
  } else {
    candidates.push(path.resolve(path.dirname(htmlFile), clean));
  }

  // Browser URL resolution cannot climb above the site root, but path.resolve
  // can leave the repo (templates/layout.html and blog/index.html both use
  // ../../assets/...). Walk parents and always try repo-root assets/.
  const assetsAt = clean.indexOf("assets/");
  if (assetsAt !== -1) {
    const fromAssets = clean.slice(assetsAt);
    let dir = path.dirname(htmlFile);
    for (let i = 0; i < 8; i += 1) {
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
}

function stampHtml(html, htmlFile) {
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
}

function collectHtmlFiles(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".") {
      continue;
    }
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      collectHtmlFiles(path.join(dir, ent.name), acc);
      continue;
    }
    if (ent.isFile() && ent.name.endsWith(".html")) {
      acc.push(path.join(dir, ent.name));
    }
  }
  return acc;
}

function stampFile(htmlFile) {
  const original = fs.readFileSync(htmlFile, "utf8");
  const stamped = stampHtml(original, htmlFile);
  if (stamped !== original) {
    fs.writeFileSync(htmlFile, stamped);
    return true;
  }
  return false;
}

function stampAllHtmlFiles({ silent = false } = {}) {
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
}

function main() {
  stampAllHtmlFiles();
}

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
  main();
}
