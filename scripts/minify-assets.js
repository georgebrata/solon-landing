"use strict";

const fs = require("fs");
const path = require("path");
const CleanCSS = require("clean-css");
const { minify: terserMinify } = require("terser");
const { stampAllHtmlFiles } = require("./stamp-asset-refs");

const root = path.join(__dirname, "..");

/** style.css imports toggle.css in source; we merge before minify so one request carries both. */
const cssFiles = ["toggle.css", "two-up.css", "consent.css", "error-pages.css"];
/** Sources to minify. Cache-busting is NOT this list: stamp-asset-refs.js
 *  rewrites any HTML href/src under assets/css, assets/js, or assets/vendor,
 *  including files added later (e.g. consent.min.js). */
/** Vendor sources → sibling *.min.css / *.min.js (HTML links the minified paths). */
const vendorCssFiles = ["vendor/aos/aos.css"];
const vendorJsFiles = [
  "vendor/aos/aos.js",
  "vendor/waypoints/noframework.waypoints.js",
  "vendor/php-email-form/validate.js",
];

const jsFiles = [
  "error-log.js",
  "dynamic-year.js",
  "meta-pixel.js",
  "consent.js",
  "gtag-config.js",
  "clarity-init.js",
  "metricool-init.js",
  "brevo-tracker.js",
  "main.js",
  "price-toggle.js",
  "typeahead.js",
  "faq.js",
  "partners.js",
  "forms.js",
  "effects.js",
  "links-active-state.js",
  "testimonials.js",
  "support-chat.js",
  "error-pages.js",
];

/**
 * Merges toggle.css into style.css and writes style.min.css.
 * @returns {boolean}
 */
const minifyStyleMerged = function minifyStyleMerged() {
  const cssDir = path.join(root, "assets/css");
  const togglePath = path.join(cssDir, "toggle.css");
  const stylePath = path.join(cssDir, "style.css");
  const toggleCss = fs.readFileSync(togglePath, "utf8");
  let styleCss = fs.readFileSync(stylePath, "utf8");
  styleCss = styleCss.replace(
    /@import\s+url\(['"]?\.\/toggle\.css['"]?\)\s*;?/i,
    ""
  );
  const input = `${toggleCss}\n${styleCss}`;
  const out = new CleanCSS({
    level: 2,
    relativeTo: cssDir,
  }).minify(input);
  if (out.errors?.length) {
    console.error(out.errors);
    return false;
  }
  const outPath = path.join(cssDir, "style.min.css");
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK style.css (+ toggle.css) → style.min.css (${input.length} → ${out.styles.length} bytes)`
  );
  return true;
};

/**
 * @param {string} relPath
 * @returns {boolean}
 */
/**
 * @param {string} relPath under assets/
 * @returns {boolean}
 */
const minifyVendorCss = function minifyVendorCss(relPath) {
  const full = path.join(root, "assets", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing vendor CSS: ${relPath}`);
    return true;
  }
  const input = fs.readFileSync(full, "utf8");
  const cssDir = path.dirname(full);
  const out = new CleanCSS({
    level: 2,
    relativeTo: cssDir,
    inline: false,
  }).minify(input);
  if (out.errors?.length) {
    console.error(out.errors);
    return false;
  }
  const base = path.basename(relPath, ".css");
  const outPath = path.join(cssDir, `${base}.min.css`);
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK ${relPath} → ${base}.min.css (${input.length} → ${out.styles.length} bytes)`
  );
  return true;
};

const minifyCss = function minifyCss(relPath) {
  const full = path.join(root, "assets/css", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing CSS: ${relPath}`);
    return true;
  }
  const input = fs.readFileSync(full, "utf8");
  const cssDir = path.join(root, "assets/css");
  const out = new CleanCSS({
    level: 2,
    relativeTo: cssDir,
    inline: false,
  }).minify(input);
  if (out.errors?.length) {
    console.error(out.errors);
    return false;
  }
  const base = relPath.replace(/\.css$/, "");
  const outPath = path.join(root, "assets/css", `${base}.min.css`);
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK ${relPath} → ${base}.min.css (${input.length} → ${out.styles.length} bytes)`
  );
  return true;
};

/**
 * @param {string} relPath
 * @returns {Promise<boolean>}
 */
/**
 * @param {string} relPath under assets/
 * @returns {Promise<boolean>}
 */
const minifyVendorJs = async function minifyVendorJs(relPath) {
  const full = path.join(root, "assets", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing vendor JS: ${relPath}`);
    return true;
  }
  const input = fs.readFileSync(full, "utf8");
  const result = await terserMinify(input, {
    compress: true,
    mangle: true,
    format: { comments: false },
  });
  if (result.error) {
    console.error(result.error);
    return false;
  }
  const base = path.basename(relPath, ".js");
  const outPath = path.join(path.dirname(full), `${base}.min.js`);
  fs.writeFileSync(outPath, result.code);
  const outLen = Buffer.byteLength(result.code, "utf8");
  console.log(`OK ${relPath} → ${base}.min.js (${input.length} → ${outLen} bytes)`);
  return true;
};

const minifyJs = async function minifyJs(relPath) {
  const full = path.join(root, "assets/js", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing JS: ${relPath}`);
    return true;
  }
  const input = fs.readFileSync(full, "utf8");
  const result = await terserMinify(input, {
    compress: true,
    mangle: true,
    format: { comments: false },
  });
  if (result.error) {
    console.error(result.error);
    return false;
  }
  const base = relPath.replace(/\.js$/, "");
  const outPath = path.join(root, "assets/js", `${base}.min.js`);
  fs.writeFileSync(outPath, result.code);
  const outLen = Buffer.byteLength(result.code, "utf8");
  console.log(`OK ${relPath} → ${base}.min.js (${input.length} → ${outLen} bytes)`);
  return true;
};

(async () => {
  if (!minifyStyleMerged()) {
    process.exitCode = 1;
    return;
  }
  for (const f of cssFiles) {
    if (!minifyCss(f)) {
      process.exitCode = 1;
      return;
    }
  }
  for (const f of vendorCssFiles) {
    if (!minifyVendorCss(f)) {
      process.exitCode = 1;
      return;
    }
  }
  for (const f of vendorJsFiles) {
    if (!(await minifyVendorJs(f))) {
      process.exitCode = 1;
      return;
    }
  }
  for (const f of jsFiles) {
    if (!(await minifyJs(f))) {
      process.exitCode = 1;
      return;
    }
  }
  // Refresh ?v=<content-hash> on HTML/CSS/JS refs so long-cache stays safe.
  // Path-based: new files such as consent.min.js are stamped when HTML links them.
  stampAllHtmlFiles();
})();
