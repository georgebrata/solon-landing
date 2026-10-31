"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const buildHomepageSheets = require("../scripts/build-homepage-sheets");
const {
  esc,
  render,
  renderFaqBlock,
  renderHomeFaqSection,
  renderHomeFaqNav,
  renderHomeFaqJsonLd,
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
  sanitizeRichText,
  truthyVisible,
  normalizeFaqRow,
  visibleFaqItems,
} = buildHomepageSheets;

const ROOT = path.join(__dirname, "..");
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "homepage-sheets.snapshot.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const FORBIDDEN = [
  /script\.google\.com/iu,
  /script\.googleusercontent\.com/iu,
  /cdn\.jsdelivr\.net/iu,
];

const MARKER_FIXTURE = `<!DOCTYPE html>
<head>
<!-- HOME-FAQ-JSONLD:START -->old-json<!-- HOME-FAQ-JSONLD:END -->
</head>
<body>
<nav><!-- HOME-FAQ-NAV:START -->old-nav<!-- HOME-FAQ-NAV:END --></nav>
<!-- HOME-FAQ-SECTION:START -->old-section<!-- HOME-FAQ-SECTION:END -->
<!-- TESTIMONIALS:START -->t<!-- TESTIMONIALS:END -->
</body>`;

/** @param {ReturnType<typeof validateSnapshot>} data */
const assertHomeFaqAbsent = (html) => {
  assert.doesNotMatch(html, /id="faq"/u);
  assert.doesNotMatch(html, /href="#faq"/u);
  assert.doesNotMatch(html, /"@type":\s*"FAQPage"/u);
};

/** @param {ReturnType<typeof validateSnapshot>} data */
const assertHomeFaqPresent = (html) => {
  assert.match(html, /id="faq"/u);
  assert.match(html, /href="#faq"/u);
  assert.match(html, /"@type":\s*"FAQPage"/u);
};

/** @param {Record<string, unknown[]>} tabs @param {{ envelope?: Record<string, unknown> }} [options] */
const fakeHomepageApi = (tabs, { envelope } = {}) => {
  const calls = [];
  const fetchImpl = (url, init) => {
    const requestUrl = new URL(url);
    calls.push({ url: requestUrl, init });
    if (envelope) return { ok: true, json: () => Promise.resolve(envelope) };
    const sheet = requestUrl.searchParams.get("sheet");
    const rows = tabs[sheet];
    if (!rows) {
      return {
        ok: true,
        json: () => Promise.resolve({ success: false, error: { code: "NOT_FOUND", message: "Sheet not found." } }),
      };
    }
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sheet,
          data: rows,
          pagination: { total: rows.length, offset: 0, limit: rows.length, hasMore: false },
        }),
    };
  };
  return { fetchImpl, calls };
};

/** @param {() => void} fn */
const withSheetsApiEnv = async (fn) => {
  const origKey = process.env.SHEETS_API_KEY;
  const origUrl = process.env.SHEETS_API_URL;
  process.env.SHEETS_API_KEY = "test-key-not-real";
  process.env.SHEETS_API_URL = "https://example.test/exec";
  try {
    await fn();
  } finally {
    if (origKey === undefined) delete process.env.SHEETS_API_KEY;
    else process.env.SHEETS_API_KEY = origKey;
    if (origUrl === undefined) delete process.env.SHEETS_API_URL;
    else process.env.SHEETS_API_URL = origUrl;
  }
};

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
  assert.equal(data.FAQ.filter((row) => row.Visible).length, 0);
});

test("API FAQ with zero visible rows does not fall back to snapshot", () => {
  const committed = readCommittedSnapshot();
  const merged = buildRenderData({
    faqRows: committed.FAQ.map((row) => ({ ...row, Visible: false })),
    committed,
  });
  assert.equal(merged.sources.FAQ, "api");
  assert.equal(visibleFaqItems(merged.FAQ).length, 0);
  assertHomeFaqAbsent(render(MARKER_FIXTURE, merged));
});

test("successful API FAQ with visible rows renders section, nav, and FAQPage JSON-LD", () => {
  const committed = readCommittedSnapshot();
  const merged = buildRenderData({
    faqRows: [{ Intrebare: "Live?", Raspuns: "Yes.", Visible: true }],
    committed,
  });
  const html = render(MARKER_FIXTURE, merged);
  assertHomeFaqPresent(html);
  assert.match(html, /Live\?/u);
});

test("FAQ fetch failure uses snapshot rows for render data", async () => {
  await withSheetsApiEnv(async () => {
    const { fetchImpl } = fakeHomepageApi({});
    const { data, sources } = await resolveData({ fetchImpl });
    assert.equal(sources.FAQ, "snapshot");
    assert.equal(data.FAQ.length, 3);
    assert.equal(visibleFaqItems(data.FAQ).length, 0);
  });
});

test("committed FAQ snapshot keeps rows hidden until sheet ids are refreshed", () => {
  const committed = readCommittedSnapshot();
  assert.equal(committed.FAQ.length, 3);
  assert.equal(visibleFaqItems(committed.FAQ).length, 0);
});

test("blank Visible column hides FAQ and testimonial rows", () => {
  assert.equal(truthyVisible({ Visible: "" }), false);
  assert.equal(truthyVisible({ Visible: "   " }), false);
  const faq = normalizeFaqRow({ Intrebare: "Q?", Raspuns: "A.", Visible: "" });
  assert.ok(faq);
  assert.equal(faq.Visible, false);
  assert.doesNotMatch(renderFaqBlock([faq]), /<li\b/u);
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

test("sanitizeRichText allows https anchors and br only after escaping", () => {
  const safe = 'Line one<br>See <a href="https://solon.agency/x">site</a> end';
  const html = sanitizeRichText(safe);
  assert.match(html, /Line one<br>See <a href="https:\/\/solon\.agency\/x" rel="noopener">site<\/a> end/u);
});

test("sanitizeRichText blocks XSS vectors and keeps following https links", () => {
  const assertNoLiveHandlers = (html) => {
    assert.doesNotMatch(html, /<[^>]*\bon\w+\s*=/iu);
    assert.doesNotMatch(html, /<a\s[^>]*href\s*=\s*["']javascript:/iu);
    assert.doesNotMatch(html, /<a\s[^>]*href\s*=\s*["']data:/iu);
  };
  const unclosed = sanitizeRichText('bad <a href="https://evil.example">oops');
  assert.match(unclosed, /&lt;a href=/u);
  assertNoLiveHandlers(unclosed);

  const handler = sanitizeRichText('<a href="https://ok.example" onmouseover="alert(1)">x</a>');
  assert.match(handler, /&lt;a href=/u);
  assertNoLiveHandlers(handler);

  const jsProto = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
  assert.match(jsProto, /&lt;a href=&quot;javascript:alert\(1\)&quot;&gt;/u);
  assertNoLiveHandlers(jsProto);

  const dataUri = sanitizeRichText('<a href="data:text/html,1">x</a>');
  assert.match(dataUri, /&lt;a href=/u);
  assertNoLiveHandlers(dataUri);

  const gtInAttr = sanitizeRichText('<a href="https://x.example?a=1>b=2">x</a>');
  assert.match(gtInAttr, /&lt;a href=/u);
  assertNoLiveHandlers(gtInAttr);

  const closeInAttr = sanitizeRichText('<a href="https://x.example" title="</a>">x</a>');
  assert.match(closeInAttr, /&lt;a href=/u);
  assertNoLiveHandlers(closeInAttr);

  const nested = sanitizeRichText('<a href="https://x.example"><strong>x</strong></a>');
  assert.doesNotMatch(nested, /<a href="https:\/\/x\.example"/u);
  assertNoLiveHandlers(nested);

  const combo =
    'bad <a onmouseover="alert(1)">x</a> then <a href="https://solon.agency/good">ok</a>';
  const comboOut = sanitizeRichText(combo);
  assert.match(comboOut, /<a href="https:\/\/solon\.agency\/good" rel="noopener">ok<\/a>/u);
  assertNoLiveHandlers(comboOut);
});

test("sanitizeRichText does not double-escape entities or apostrophes", () => {
  assert.equal(sanitizeRichText("Tom &amp; Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(sanitizeRichText("A &amp; B"), "A &amp; B");
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

test("malformed or empty FAQ API rows fall back to committed snapshot when snapshotFallback is enabled", () => {
  const committed = readCommittedSnapshot();
  assert.deepEqual(pickFaqRows(undefined, committed.FAQ), committed.FAQ);
  assert.deepEqual(
    pickFaqRows([{ Intrebare: "x", Raspuns: "y", Visible: false }], committed.FAQ, { snapshotFallback: true }),
    committed.FAQ,
  );
});

test("pickFaqRows from API keeps empty visible set without snapshot fallback", () => {
  const committed = readCommittedSnapshot();
  const rows = pickFaqRows(
    [{ Intrebare: "Hidden?", Raspuns: "Nope", Visible: false }],
    committed.FAQ,
    { snapshotFallback: false },
  );
  assert.equal(rows.length, 1);
  assert.equal(visibleFaqItems(rows).length, 0);
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

test("LEGACY_FAQ_URL is not exported (legacy fallback removed)", () => {
  assert.ok(!("LEGACY_FAQ_URL" in buildHomepageSheets), "LEGACY_FAQ_URL must not be exported after legacy removal");
});

test("resolveData without SHEETS_API_KEY uses snapshot directly, no network call", async () => {
  const origKey = process.env.SHEETS_API_KEY;
  delete process.env.SHEETS_API_KEY;
  try {
    let networkCalled = false;
    const fakeFetch = () => { networkCalled = true; return Promise.reject(new Error("should not fetch")); };
    const { data, source, sources } = await resolveData({ fetchImpl: fakeFetch });
    assert.equal(source, "snapshot", "should be snapshot when no API key");
    assert.equal(sources.FAQ, "snapshot");
    assert.equal(sources.Testimonials, "snapshot");
    assert.equal(networkCalled, false, "must not make any network call without SHEETS_API_KEY");
    assert.equal(data.FAQ.filter((r) => r.Visible).length, 0, "snapshot FAQ has no visible rows");
  } finally {
    if (origKey !== undefined) process.env.SHEETS_API_KEY = origKey;
  }
});

test("resolveData uses API FAQ when Testimonials tab is NOT_FOUND", async () => {
  await withSheetsApiEnv(async () => {
    const apiFaq = [{ Intrebare: "API-only FAQ?", Raspuns: "From live tab.", Visible: true }];
    const { fetchImpl, calls } = fakeHomepageApi({ FAQ: apiFaq });
    const { data, sources } = await resolveData({ fetchImpl });
    assert.equal(sources.FAQ, "api");
    assert.equal(sources.Testimonials, "snapshot");
    assert.equal(data.FAQ.filter((row) => row.Visible).length, 1);
    assert.equal(data.FAQ[0].Intrebare, "API-only FAQ?");
    assert.equal(data.Testimonials.filter((row) => row.Visible).length, 4);
    assert.deepEqual([...new Set(calls.map((call) => call.url.searchParams.get("sheet")))], ["FAQ", "Testimonials"]);
    assert.ok(calls.every((call) => call.url.searchParams.get("apiKey") === "test-key-not-real"));
  });
});

test("resolveData uses API Testimonials when FAQ tab is NOT_FOUND", async () => {
  await withSheetsApiEnv(async () => {
    const committed = readCommittedSnapshot();
    const apiTestimonial = {
      ...committed.Testimonials[0],
      id: "api-only-testimonial",
      Nume: "API-only Client",
      Visible: true,
      Active: true,
    };
    const { fetchImpl, calls } = fakeHomepageApi({ Testimonials: [apiTestimonial] });
    const { data, sources } = await resolveData({ fetchImpl });
    assert.equal(sources.FAQ, "snapshot");
    assert.equal(sources.Testimonials, "api");
    assert.equal(visibleFaqItems(data.FAQ).length, 0);
    assert.equal(data.Testimonials.filter((row) => row.Visible).length, 1);
    assert.equal(data.Testimonials.find((row) => row.Visible)?.Nume, "API-only Client");
    assert.deepEqual([...new Set(calls.map((call) => call.url.searchParams.get("sheet")))], ["FAQ", "Testimonials"]);
  });
});
