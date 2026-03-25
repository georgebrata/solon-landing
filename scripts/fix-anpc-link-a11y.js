#!/usr/bin/env node
/**
 * Normalize ANPC footer links: aria-label on <a>, empty img alt, intrinsic dimensions.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function walkHtml(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory() && !ent.name.startsWith(".")) walkHtml(p, out);
    else if (ent.isFile() && ent.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function fixAnpc(html) {
  return html.replace(/<a href="https:\/\/anpc\.ro\/">[\s\S]*?<\/a>/g, (block) => {
    if (!block.includes("anpc-sal.png")) return block;
    const m = block.match(/src="([^"]+)"/);
    if (!m) return block;
    const src = m[1];
    return `<a href="https://anpc.ro/" aria-label="ANPC — Soluționarea alternativă a litigiilor (legătură externă)"><img src="${src}" alt="" width="500" height="124" decoding="async" /></a>`;
  });
}

function main() {
  for (const f of walkHtml(ROOT)) {
    let html = fs.readFileSync(f, "utf8");
    const next = fixAnpc(html);
    if (next !== html) {
      fs.writeFileSync(f, next, "utf8");
      console.log("updated:", path.relative(ROOT, f));
    }
  }
}

main();
