"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  esc,
  render,
  renderFaqBlock,
  renderTestimonialsBlock,
  validateSnapshot,
  resolveData,
  readCommittedSnapshot,
  buildRenderData,
  pickFaqRows,
  pickTestimonialRows,
  ensureCarouselActive,
  replaceBlock,
  sanitizeFaqAnswer,
} = require("../scripts/build-homepage-sheets");

const ROOT = path.join(__dirname, "..");
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "homepage-sheets.snapshot.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const FORBIDDEN = [
  /script\.google\.com/iu,
  /script\.googleusercontent\.com/iu,
  /cdn\.jsdelivr\.net/iu,
];

/** @param {string} label */
const read = (label) => {
  const map = {
    home: path.join(ROOT, "index.html"),
    blog: path.join(ROOT, "blog", "index.html"),
    privacy: path.join(ROOT, "privacy", "index.html"),
    cookies: path.join(ROOT, "cookies", "index.html"),
    faqJs: path.join(ROOT, "assets", "js", "faq.min.js"),
    testimonialsJs: path.join(ROOT, "assets", "js", "testimonials.min.js"),
    formsJs: path.join(ROOT, "assets", "js", "forms.min.js"),
  };
  return fs.readFileSync(map[label], "utf8");
};

/** @param {string} source */
const forbiddenHits = (source) => FORBIDDEN.filter((re) => re.test(source));

test("committed index.html matches homepage sheets snapshot render", () => {
  const data = validateSnapshot(snapshot);
  assert.equal(render(indexHtml, data), indexHtml);
});

test("FAQ build output escapes sheet markup and script injection", () => {
  const payload = "<script>alert(1)</script>\" onload=\"x\"";
  const block = renderFaqBlock([
    { Intrebare: payload, Raspuns: payload, Visible: true },
  ]);
  assert.match(block, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(block, /onload=&quot;x&quot;/u);
  assert.doesNotMatch(block, /<script>alert\(1\)<\/script>/u);
  assert.doesNotMatch(block, / onload="x"/u);
});

test("ensureCarouselActive marks the first visible slide when none are Active", () => {
  const committed = readCommittedSnapshot();
  const rows = committed.Testimonials.map((row) => ({ ...row, Active: false }));
  const prepared = ensureCarouselActive(rows);
  const visible = prepared.filter((row) => row.Visible);
  assert.equal(visible.filter((row) => row.Active).length, 1);
  assert.equal(visible.find((row) => row.Active)?.id, visible[0].id);
});

test("malformed or empty Testimonials API rows fall back to committed snapshot", () => {
  const committed = readCommittedSnapshot();
  const fromMissing = pickTestimonialRows(undefined, committed.Testimonials);
  assert.deepEqual(fromMissing, committed.Testimonials);
  const fromGarbage = pickTestimonialRows([{ foo: "bar" }], committed.Testimonials);
  assert.deepEqual(fromGarbage, committed.Testimonials);
  const merged = buildRenderData({
    testimonialRows: [{ foo: "bar" }],
    committed,
  });
  assert.equal(merged.Testimonials.length, committed.Testimonials.length);
  assert.equal(merged.Testimonials.filter((row) => row.Visible).length, 4);
});

test("homepage FAQ and testimonials client bundles do not fetch Google Sheets", () => {
  for (const label of ["faqJs", "testimonialsJs"]) {
    const hits = forbiddenHits(read(label));
    assert.deepEqual(hits, [], `${label} must not reference ${hits.map(String).join(", ")}`);
    assert.equal(/\bfetch\s*\(/u.test(read(label)), false, `${label} must not call fetch()`);
  }
});

test("built HTML for /, /blog/, /privacy/, /cookies/ has no runtime Google Sheets or jsDelivr refs", () => {
  for (const page of ["home", "blog", "privacy", "cookies"]) {
    const hits = forbiddenHits(read(page));
    assert.deepEqual(hits, [], `${page} HTML must not reference ${hits.map(String).join(", ")}`);
  }
});

test("forms.js still posts leads to Apps Script (allowed third-party submit)", () => {
  const forms = read("formsJs");
  assert.match(forms, /script\.google\.com\/macros\/s\//u);
  assert.doesNotMatch(forms, /cdn\.jsdelivr\.net/iu);
});

test("Gurițanu testimonial alt text names Gurițanu, not Dumitrescu", () => {
  const guritanu = validateSnapshot(snapshot).Testimonials.find((row) => row.id === "guritanu");
  assert.ok(guritanu);
  assert.match(guritanu.Alt, /Gurițanu/u);
  assert.doesNotMatch(guritanu.Alt, /Dumitrescu/u);
  assert.match(indexHtml, /alt="Avocat Cristian Gurițanu - review pentru SOLON/);
});

test("resolveData offline uses committed snapshot without network", async () => {
  const { data, source } = await resolveData({ offline: true });
  assert.equal(source, "snapshot");
  assert.ok(Array.isArray(data.Testimonials));
  assert.equal(data.Testimonials.filter((row) => row.Visible).length, 4);
});

test("replaceBlock does not expand $ special sequences in generated FAQ", () => {
  const html = `<!DOCTYPE html>
<!-- HOME-FAQ:START -->old<!-- HOME-FAQ:END -->
<!-- TESTIMONIALS:START -->t<!-- TESTIMONIALS:END -->`;
  const block = renderFaqBlock([
    {
      Intrebare: "Q",
      Raspuns: '$$ $& $` $\' <script>x</script>',
      Visible: true,
    },
  ]);
  const out = replaceBlock(html, "HOME-FAQ", block);
  assert.equal((out.match(/<!DOCTYPE html>/gu) || []).length, 1);
  assert.match(out, /\$\$ \$&amp; \$` \$&#39;/u);
  assert.doesNotMatch(out, /<script>x<\/script>/u);
});

test("sanitizeFaqAnswer keeps safe links and strips unsafe markup", () => {
  const safe =
    'See <a href="https://solon.agency/x" target="_blank">site</a> or <strong>bold</strong> and <script>no</script>';
  const html = sanitizeFaqAnswer(safe);
  assert.match(html, /<a href="https:\/\/solon\.agency\/x" target="_blank" rel="noopener">site<\/a>/u);
  assert.match(html, /<strong>bold<\/strong>/u);
  assert.doesNotMatch(html, /<script>/u);
  assert.equal(sanitizeFaqAnswer('<a href="javascript:alert(1)">x</a>'), "x");
});

test("pickFaqRows keeps valid API rows when one row is malformed", () => {
  const committed = readCommittedSnapshot();
  const rows = pickFaqRows(
    [{ Intrebare: "Ok?", Raspuns: "Yes", Visible: true }, { bad: true }],
    committed.FAQ,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Intrebare, "Ok?");
});

test("malformed or empty FAQ API rows fall back to committed snapshot", () => {
  const committed = readCommittedSnapshot();
  assert.deepEqual(pickFaqRows(undefined, committed.FAQ), committed.FAQ);
  assert.deepEqual(
    pickFaqRows([{ Intrebare: "x", Raspuns: "y", Visible: false }], committed.FAQ),
    committed.FAQ,
  );
});

test("ensureCarouselActive keeps only the first Active slide when several are marked", () => {
  const committed = readCommittedSnapshot();
  const rows = committed.Testimonials.map((row, index) => ({
    ...row,
    Active: index < 2,
  }));
  const prepared = ensureCarouselActive(rows);
  const active = prepared.filter((row) => row.Active);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, committed.Testimonials[0].id);
});

test("empty baked FAQ block yields no list items for client hide logic", () => {
  const block = renderFaqBlock([]);
  assert.doesNotMatch(block, /<li\b/u);
});

test("testimonial render escapes sheet markup in visible fields", () => {
  const payload = '<img src=x onerror=alert(1)>';
  const block = renderTestimonialsBlock([
    {
      id: "x",
      Nume: payload,
      Subtitlu: payload,
      Citat: payload,
      Imagine: "/assets/img/solon-metaimage.png",
      Alt: payload,
      Width: "432",
      Height: "426",
      Visible: true,
      Active: true,
      QuoteClass: "",
    },
  ]);
  assert.doesNotMatch(block, /<img src=x/u);
  assert.match(block, /&lt;img src=x onerror=alert\(1\)&gt;/u);
});

test("pickTestimonialRows keeps valid API rows when one row is malformed", () => {
  const committed = readCommittedSnapshot();
  const good = committed.Testimonials[0];
  const rows = pickTestimonialRows([good, { foo: "bar" }], committed.Testimonials);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, good.id);
});
