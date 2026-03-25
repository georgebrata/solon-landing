"use strict";

const fs = require("fs");
const path = require("path");
const CleanCSS = require("clean-css");
const { minify: terserMinify } = require("terser");

const root = path.join(__dirname, "..");

/** style.css imports toggle.css in source; we merge before minify so one request carries both. */
const cssFiles = ["toggle.css", "two-up.css"];
const jsFiles = [
  "meta-pixel.js",
  "main.js",
  "price-toggle.js",
  "typeahead.js",
  "faq.js",
  "contact.js",
  "effects.js",
  "links-active-state.js",
  "testimonials.js",
];

function minifyStyleMerged() {
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
  if (out.errors && out.errors.length) {
    console.error(out.errors);
    process.exit(1);
  }
  const outPath = path.join(cssDir, "style.min.css");
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK style.css (+ toggle.css) → style.min.css (${input.length} → ${out.styles.length} bytes)`
  );
}

function minifyCss(relPath) {
  const full = path.join(root, "assets/css", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing CSS: ${relPath}`);
    return;
  }
  const input = fs.readFileSync(full, "utf8");
  const cssDir = path.join(root, "assets/css");
  const out = new CleanCSS({
    level: 2,
    relativeTo: cssDir,
    inline: false,
  }).minify(input);
  if (out.errors && out.errors.length) {
    console.error(out.errors);
    process.exit(1);
  }
  const base = relPath.replace(/\.css$/, "");
  const outPath = path.join(root, "assets/css", `${base}.min.css`);
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK ${relPath} → ${base}.min.css (${input.length} → ${out.styles.length} bytes)`
  );
}

async function minifyJs(relPath) {
  const full = path.join(root, "assets/js", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing JS: ${relPath}`);
    return;
  }
  const input = fs.readFileSync(full, "utf8");
  const result = await terserMinify(input, {
    compress: true,
    mangle: true,
    format: { comments: false },
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  const base = relPath.replace(/\.js$/, "");
  const outPath = path.join(root, "assets/js", `${base}.min.js`);
  fs.writeFileSync(outPath, result.code);
  const outLen = Buffer.byteLength(result.code, "utf8");
  console.log(`OK ${relPath} → ${base}.min.js (${input.length} → ${outLen} bytes)`);
}

(async () => {
  minifyStyleMerged();
  for (const f of cssFiles) minifyCss(f);
  for (const f of jsFiles) await minifyJs(f);
})();
