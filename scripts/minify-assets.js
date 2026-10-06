"use strict";

const fs = require("fs");
const path = require("path");
const CleanCSS = require("clean-css");
const { minify: terserMinify } = require("terser");

const root = path.join(__dirname, "..");

/** style.css imports toggle.css in source; we merge before minify so one request carries both. */
const cssFiles = ["toggle.css", "two-up.css"];
const jsFiles = [
  "error-log.js",
  "dynamic-year.js",
  "meta-pixel.js",
  "main.js",
  "price-toggle.js",
  "typeahead.js",
  "faq.js",
  "forms.js",
  "effects.js",
  "links-active-state.js",
  "testimonials.js",
  "support-chat.js",
];

function logScriptError(payload, error) {
  const body = Object.assign(
    {
      ok: false,
      script: "minify-assets.js",
    },
    payload
  );
  if (error) {
    body.message = error.message || String(error);
    if (error.line != null) body.line = error.line;
    if (error.col != null) body.column = error.col;
    if (error.stack) body.stack = error.stack;
  }
  console.error(JSON.stringify(body));
  if (error && error.stack) console.error(error.stack);
}

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
    logScriptError(
      {
        file: "assets/css/style.css",
        message: out.errors.join("; "),
      }
    );
    return false;
  }
  const outPath = path.join(cssDir, "style.min.css");
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK style.css (+ toggle.css) → style.min.css (${input.length} → ${out.styles.length} bytes)`
  );
  return true;
}

function minifyCss(relPath) {
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
  if (out.errors && out.errors.length) {
    logScriptError({
      file: `assets/css/${relPath}`,
      message: out.errors.join("; "),
    });
    return false;
  }
  const base = relPath.replace(/\.css$/, "");
  const outPath = path.join(root, "assets/css", `${base}.min.css`);
  fs.writeFileSync(outPath, out.styles);
  console.log(
    `OK ${relPath} → ${base}.min.css (${input.length} → ${out.styles.length} bytes)`
  );
  return true;
}

async function minifyJs(relPath) {
  const full = path.join(root, "assets/js", relPath);
  if (!fs.existsSync(full)) {
    console.warn(`Skip missing JS: ${relPath}`);
    return true;
  }
  const input = fs.readFileSync(full, "utf8");
  let result;
  try {
    result = await terserMinify(input, {
      compress: true,
      mangle: true,
      format: { comments: false },
    });
  } catch (error) {
    logScriptError({ file: `assets/js/${relPath}` }, error);
    return false;
  }
  if (result.error) {
    logScriptError({ file: `assets/js/${relPath}` }, result.error);
    return false;
  }
  const base = relPath.replace(/\.js$/, "");
  const outPath = path.join(root, "assets/js", `${base}.min.js`);
  fs.writeFileSync(outPath, result.code);
  const outLen = Buffer.byteLength(result.code, "utf8");
  console.log(`OK ${relPath} → ${base}.min.js (${input.length} → ${outLen} bytes)`);
  return true;
}

(async () => {
  try {
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
    for (const f of jsFiles) {
      if (!(await minifyJs(f))) {
        process.exitCode = 1;
        return;
      }
    }
  } catch (error) {
    logScriptError({ file: root }, error);
    process.exitCode = 1;
  }
})();
