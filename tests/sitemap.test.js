"use strict";

/**
 * Sitemap lastmod stays honest: max(stored day, content day), clamped to a
 * fake clock. The script runs only on temp copies and must not touch sitemap.xml.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const BASE_URL = "https://solon.agency";
const SITEMAP = path.join(ROOT, "sitemap.xml");
const POSTS = path.join(ROOT, "blog/posts.json");
const SCRIPT = path.join(ROOT, "scripts/update-sitemap.js");
const CLOCKS = ["2026-10-08", "2026-10-09", "2026-10-15", "2026-01-01"];

/**
 * Expected lastmod: max(stored day, content day), clamped to today.
 * A stored value whose day is already that result is kept verbatim.
 * @param {string} stored
 * @param {string} contentDay
 * @param {string} today
 * @returns {string}
 */
const expectedLastmod = (stored, contentDay, today) => {
  const storedMatch = /^(\d{4}-\d{2}-\d{2})/.exec(stored || "");
  const existingDay = storedMatch ? storedMatch[1] : "";
  let day = existingDay;
  if (contentDay && contentDay > existingDay) day = contentDay;
  if (!day) day = contentDay || today;
  if (day > today) day = today;
  if (stored && day === existingDay && existingDay <= today) return stored;
  return day;
};

/**
 * Map each sitemap loc to its lastmod text.
 * @param {string} xml
 * @returns {Map<string, string>}
 */
const parseEntries = (xml) => {
  const entries = new Map();
  const re = /<url>\s*<loc>([\s\S]*?)<\/loc>\s*<lastmod>([\s\S]*?)<\/lastmod>/g;
  let match = null;
  while ((match = re.exec(xml)) !== null) {
    entries.set(match[1].trim(), match[2].trim());
  }
  return entries;
};

/**
 * Local index.html that should exist for a sitemap loc.
 * @param {string} loc Absolute page URL.
 * @returns {string|null}
 */
const locToFile = (loc) => {
  if (!loc.startsWith(BASE_URL)) return null;
  const pathname = loc.slice(BASE_URL.length).replace(/\/$/, "");
  if (pathname === "") return path.join(ROOT, "index.html");
  return path.join(ROOT, pathname, "index.html");
};

/**
 * Content day the sitemap script reads: date_modified, else updated, else date.
 * @param {object[]} posts
 * @returns {Map<string, string>}
 */
const contentDayByUrl = (posts) => {
  const days = new Map();
  posts.forEach((post) => {
    const slug = String(post.url || post.slug || "").replace(/^\/+|\/?index\.html$/g, "").replace(/\/$/, "");
    if (!slug) return;
    const raw = post.date_modified || post.updated || post.date || "";
    const day = String(raw).slice(0, 10);
    days.set(`${BASE_URL}/blog/${slug}/`, day);
  });
  return days;
};

/**
 * Run update-sitemap.js against a temp sitemap and posts file.
 * @param {string} sitemapPath
 * @param {string} postsPath
 * @param {string} today
 * @returns {string}
 */
const runScript = (sitemapPath, postsPath, today) => {
  execFileSync(process.execPath, [
    SCRIPT,
    "--sitemap", sitemapPath,
    "--posts", postsPath,
    "--today", today,
  ], { cwd: ROOT, encoding: "utf8" });
  return fs.readFileSync(sitemapPath, "utf8");
};

/**
 * @param {string} body Sitemap url nodes without the urlset wrapper.
 * @returns {string}
 */
const wrapSitemap = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

test("real sitemap pages resolve and the file is never rewritten by this test", () => {
  const before = fs.readFileSync(SITEMAP, "utf8");
  const entries = parseEntries(before);
  const failures = [];

  for (const [loc] of entries) {
    const filePath = locToFile(loc);
    if (!filePath || !fs.existsSync(filePath)) {
      failures.push(`${loc}: no local page`);
      continue;
    }
    const html = fs.readFileSync(filePath, "utf8");
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
    if (!canonicalMatch) {
      failures.push(`${loc}: missing canonical`);
    } else if (canonicalMatch[1].trim() !== loc) {
      failures.push(`${loc}: canonical is ${canonicalMatch[1].trim()}`);
    }
    if (/content=["'][^"']*noindex/i.test(html)) {
      failures.push(`${loc}: noindex`);
    }
  }

  assert.equal(failures.length, 0, failures.join("\n"));
  assert.ok(
    before.includes("<loc>https://solon.agency/studii-de-caz/avocat-dumitrescu-alexandru/</loc>"),
    "the Dumitrescu case-study sitemap entry must stay"
  );
  assert.equal(fs.readFileSync(SITEMAP, "utf8"), before);
});

test("a temp copy of sitemap.xml follows max(stored, content) clamped to the fake clock", () => {
  const realBefore = fs.readFileSync(SITEMAP, "utf8");
  const posts = JSON.parse(fs.readFileSync(POSTS, "utf8"));
  const contentDays = contentDayByUrl(posts);

  for (const today of CLOCKS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-sitemap-"));
    const sitemapCopy = path.join(dir, "sitemap.xml");
    const postsCopy = path.join(dir, "posts.json");
    fs.copyFileSync(SITEMAP, sitemapCopy);
    fs.copyFileSync(POSTS, postsCopy);

    const beforeEntries = parseEntries(realBefore);
    const once = runScript(sitemapCopy, postsCopy, today);
    const twice = runScript(sitemapCopy, postsCopy, today);
    assert.equal(twice, once, `second run changed the temp sitemap on ${today}`);

    const afterEntries = parseEntries(once);
    assert.equal(afterEntries.size, beforeEntries.size, `URL set changed on ${today}`);

    const failures = [];
    for (const [loc, stored] of beforeEntries) {
      const next = afterEntries.get(loc);
      if (next == null) {
        failures.push(`${today} ${loc}: dropped`);
        continue;
      }
      const contentDay = contentDays.get(loc) || "";
      const expected = expectedLastmod(stored, contentDay, today);
      if (next !== expected) {
        failures.push(`${today} ${loc}: expected ${expected}, got ${next} (stored ${stored}, content ${contentDay || "-"})`);
      }
    }
    assert.equal(failures.length, 0, failures.join("\n"));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(fs.readFileSync(SITEMAP, "utf8"), realBefore, "update-sitemap.js wrote the real sitemap.xml");
});

test("date_modified moves an updated post lastmod forward, clamped to the fake clock", () => {
  const realBefore = fs.readFileSync(SITEMAP, "utf8");
  const buildSource = fs.readFileSync(path.join(ROOT, "scripts/build.js"), "utf8");
  const omitBody = buildSource.match(/POSTS_JSON_OMIT = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(omitBody, "POSTS_JSON_OMIT set missing");
  assert.equal(omitBody[1].includes("date_modified"), false, "date_modified must stay in posts.json");

  const postsOnDisk = JSON.parse(fs.readFileSync(POSTS, "utf8"));
  postsOnDisk.forEach((post) => {
    const keys = Object.keys(post);
    assert.equal(keys[keys.length - 1], "url");
  });

  const cases = [
    {
      today: "2026-10-09",
      modified: "2026-06-15",
      stored: "2026-01-01T00:00:00Z",
      expected: "2026-06-15",
    },
    {
      today: "2026-10-09",
      modified: "2026-10-20",
      stored: "2026-01-01T00:00:00Z",
      expected: "2026-10-09",
    },
    {
      today: "2026-10-15",
      modified: "2026-06-15",
      stored: "2026-08-01T12:00:00Z",
      expected: "2026-08-01T12:00:00Z",
    },
    {
      today: "2026-10-09",
      modified: "2026-10-08",
      stored: "2026-10-09T00:00:00+00:00",
      expected: "2026-10-09T00:00:00+00:00",
    },
    {
      today: "2026-10-08",
      modified: "2026-10-08",
      stored: "2026-10-09T00:00:00+00:00",
      expected: "2026-10-08",
    },
  ];

  for (const item of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-sitemap-mod-"));
    const sitemapCopy = path.join(dir, "sitemap.xml");
    const postsCopy = path.join(dir, "posts.json");
    const loc = `${BASE_URL}/blog/example/`;
    fs.writeFileSync(sitemapCopy, wrapSitemap(
      `    <url>\n        <loc>${loc}</loc>\n        <lastmod>${item.stored}</lastmod>\n        <priority>0.50</priority>\n    </url>`
    ));
    fs.writeFileSync(postsCopy, JSON.stringify([{
      title: "Example",
      date: "2026-01-01",
      date_modified: item.modified,
      slug: "example",
      url: "example/",
    }], null, 2));

    const once = runScript(sitemapCopy, postsCopy, item.today);
    const twice = runScript(sitemapCopy, postsCopy, item.today);
    assert.equal(twice, once, `second run changed the fixture on ${item.today}`);
    assert.equal(parseEntries(once).get(loc), item.expected, JSON.stringify(item));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(fs.readFileSync(SITEMAP, "utf8"), realBefore);
});
