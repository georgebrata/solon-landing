#!/usr/bin/env node
/**
 * Back-to-top aria-label; header logo duplicate text; placeholder social icons.
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

function fix(html) {
  let h = html;

  h = h.replace(
    /<a href="#" class="back-to-top d-flex align-items-center justify-content-center"><i\s*\n\s*class="bi bi-arrow-up-short"><\/i><\/a>/g,
    '<a href="#" class="back-to-top d-flex align-items-center justify-content-center" aria-label="Înapoi la începutul paginii"><i class="bi bi-arrow-up-short" aria-hidden="true"></i></a>',
  );

  h = h.replace(
    /<a href="#" class="back-to-top d-flex align-items-center justify-content-center"><i class="bi bi-arrow-up-short"><\/i><\/a>/g,
    '<a href="#" class="back-to-top d-flex align-items-center justify-content-center" aria-label="Înapoi la începutul paginii"><i class="bi bi-arrow-up-short" aria-hidden="true"></i></a>',
  );

  h = h.replace(
    /<a href="([^"]+)" class="hover-no-underline">\s*(<img[^>]*\salt="SOLON"[^>]*>)\s*SOLON<\/a>/g,
    (m, href, img) => {
      const img2 = img.replace(/\s*alt="SOLON"/, ' alt=""');
      return `<a href="${href}" class="hover-no-underline" aria-label="SOLON — pagina principală">${img2}<span aria-hidden="true">SOLON</span></a>`;
    },
  );

  h = h.replace(
    /<a href="#" class="facebook"><i class="bx bxl-facebook"><\/i><\/a>/g,
    '<a href="#" class="facebook" aria-label="Facebook SOLON (în curând)"><i class="bx bxl-facebook" aria-hidden="true"></i></a>',
  );
  h = h.replace(
    /<a href="#" class="instagram"><i class="bx bxl-instagram"><\/i><\/a>/g,
    '<a href="#" class="instagram" aria-label="Instagram SOLON (în curând)"><i class="bx bxl-instagram" aria-hidden="true"></i></a>',
  );
  h = h.replace(
    /<a href="#" class="linkedin"><i class="bx bxl-linkedin"><\/i><\/a>/g,
    '<a href="#" class="linkedin" aria-label="LinkedIn SOLON (în curând)"><i class="bx bxl-linkedin" aria-hidden="true"></i></a>',
  );

  return h;
}

function main() {
  for (const f of walkHtml(ROOT)) {
    let html = fs.readFileSync(f, "utf8");
    const next = fix(html);
    if (next !== html) {
      fs.writeFileSync(f, next, "utf8");
      console.log("updated:", path.relative(ROOT, f));
    }
  }
}

main();
