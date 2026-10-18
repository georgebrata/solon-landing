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
const {
  stripIndexNowKeyUrls,
  isIndexNowKeyLoc,
  normalizePageHtml,
  contentChangeDay,
  repoPathForLoc,
} = require(path.join(ROOT, "scripts/update-sitemap.js"));
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
 * @param {string[]} [extraArgs]
 * @returns {string}
 */
const runScript = (sitemapPath, postsPath, today, extraArgs = []) => {
  execFileSync(process.execPath, [
    SCRIPT,
    "--sitemap", sitemapPath,
    "--posts", postsPath,
    "--today", today,
    ...extraArgs,
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
  const caseStudyRoot = path.join(ROOT, "studii-de-caz");
  for (const entry of fs.readdirSync(caseStudyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const page = path.join(caseStudyRoot, entry.name, "index.html");
    if (!fs.existsSync(page)) continue;
    const loc = `${BASE_URL}/studii-de-caz/${entry.name}/`;
    assert.ok(before.includes(`<loc>${loc}</loc>`), `${loc} must stay in the sitemap`);
  }
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

test("update-sitemap strips an IndexNow key URL and does not rewrite the real sitemap", () => {
  const realBefore = fs.readFileSync(SITEMAP, "utf8");
  const key = "0123456789abcdef0123456789abcdef";
  const keyLoc = `${BASE_URL}/${key}.txt`;
  assert.equal(stripIndexNowKeyUrls(realBefore), realBefore);
  assert.equal(isIndexNowKeyLoc(keyLoc), true);
  assert.equal(isIndexNowKeyLoc(`${BASE_URL}/`), false);
  assert.equal(realBefore.includes(keyLoc), false);

  const pageLoc = `${BASE_URL}/blog/example/`;
  const indexLoc = `${BASE_URL}/blog/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-sitemap-key-"));
  const sitemapCopy = path.join(dir, "sitemap.xml");
  const postsCopy = path.join(dir, "posts.json");
  fs.writeFileSync(sitemapCopy, wrapSitemap([
    `    <url>\n        <loc>${keyLoc}</loc>\n        <lastmod>2026-10-09</lastmod>\n        <priority>0.10</priority>\n    </url>`,
    `    <url>\n        <loc>${indexLoc}</loc>\n        <lastmod>2026-10-09</lastmod>\n        <priority>0.80</priority>\n    </url>`,
    `    <url>\n        <loc>${pageLoc}</loc>\n        <lastmod>2026-10-09</lastmod>\n        <priority>0.50</priority>\n    </url>`,
  ].join("\n")));
  fs.writeFileSync(postsCopy, JSON.stringify([{
    title: "Example",
    date: "2026-01-01",
    date_modified: "2026-06-15",
    slug: "example",
    url: "example/",
  }], null, 2));

  const once = runScript(sitemapCopy, postsCopy, "2026-10-09");
  const twice = runScript(sitemapCopy, postsCopy, "2026-10-09");
  assert.equal(twice, once);
  assert.equal(once.includes(keyLoc), false);
  assert.equal(once.includes(`${key}.txt`), false);
  assert.equal(parseEntries(once).get(pageLoc), "2026-10-09");
  assert.equal(parseEntries(once).get(indexLoc), "2026-10-09");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.readFileSync(SITEMAP, "utf8"), realBefore);
});

test("normalizePageHtml ignores cache-bust tokens and generated blog sidebars", () => {
  const left = [
    "<p>Body</p>",
    "<link href=\"assets/css/style.min.css?v=abc123def0\" rel=\"stylesheet\">",
    "<div class=\"blog-recent-articles\"><ul><li>Old</li></ul></div>",
    "<section class=\"blog-related-posts\" aria-labelledby=\"related-posts-heading\"><ul><li>A</li></ul></section>",
  ].join("");
  const right = [
    "<p>Body</p>",
    "<link href=\"assets/css/style.min.css?v=ffffffffff\" rel=\"stylesheet\">",
    "<div class=\"wrap blog-recent-articles\"><ul><li>New</li></ul></div>",
    "<section class=\"blog-related-posts\"><ul><li>B</li></ul></section>",
  ].join("");
  assert.equal(normalizePageHtml(left), normalizePageHtml(right));
  assert.match(normalizePageHtml(left), /Body/);
  assert.doesNotMatch(normalizePageHtml(left), /blog-recent-articles|Old|Articole/);
  assert.equal(repoPathForLoc(`${BASE_URL}/`), "index.html");
  assert.equal(repoPathForLoc(`${BASE_URL}/cookies/`), "cookies/index.html");
  assert.equal(repoPathForLoc("https://example.com/cookies/"), "");
  assert.equal(repoPathForLoc(`${BASE_URL}/../../etc/passwd`), "");
});

test("contentChangeDay uses the newest real edit and the Bucharest day", () => {
  const body = "<p>Body</p>";
  const stamped = (token) => `${body}<link href="a.css?v=${token}" rel="stylesheet">`;
  assert.equal(contentChangeDay({
    today: "2026-10-18",
    revisions: [
      {
        committedAt: "2026-10-19T10:00:00+03:00",
        before: stamped("aaa"),
        after: stamped("bbb"),
      },
      {
        committedAt: "2026-10-15T22:30:00Z",
        before: null,
        after: body,
      },
    ],
  }), "2026-10-16");

  assert.equal(contentChangeDay({
    today: "2026-10-18",
    head: body,
    working: "<p>Pricing</p>",
    revisions: [],
  }), "2026-10-18");

  assert.equal(contentChangeDay({
    today: "2026-10-18",
    head: stamped("aaa"),
    working: stamped("bbb"),
    revisions: [{ committedAt: "2026-09-01T10:00:00+03:00", before: null, after: body }],
  }), "2026-09-01");
});

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} [iso]
 */
const gitCommitEnv = (iso) => ({
  ...process.env,
  GIT_AUTHOR_NAME: "Sitemap Test",
  GIT_AUTHOR_EMAIL: "sitemap-test@example.com",
  GIT_COMMITTER_NAME: "Sitemap Test",
  GIT_COMMITTER_EMAIL: "sitemap-test@example.com",
  GIT_AUTHOR_DATE: iso,
  GIT_COMMITTER_DATE: iso,
});

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} [iso]
 */
const gitIn = (cwd, args, iso) => {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: iso ? gitCommitEnv(iso) : process.env,
  });
};

/**
 * Tiny site whose history mixes real edits with cache-bust and sidebar noise.
 * @returns {string} repo directory
 */
const buildHistoryRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-sitemap-git-"));
  gitIn(dir, ["init", "-b", "main"]);
  gitIn(dir, ["config", "user.email", "sitemap-test@example.com"]);
  gitIn(dir, ["config", "user.name", "Sitemap Test"]);

  const write = (relative, body) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const page = (copy, token, extra = "") => `<!DOCTYPE html><html><head><link href="assets/css/style.min.css?v=${token}" rel="stylesheet"></head><body><p>${copy}</p>${extra}</body></html>\n`;
  const notes = (item, token) => page(
    "Notes body",
    token,
    `<div class="blog-recent-articles"><ul><li>${item}</li></ul></div>`
  );

  write("index.html", page("Home", "aaa"));
  write("cookies/index.html", page("Cookies", "aaa"));
  write("notes/index.html", notes("Old", "aaa"));
  write("stay/index.html", page("Stay", "aaa"));
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-m", "initial pages"], "2026-09-01T10:00:00+03:00");

  write("cookies/index.html", page("Cookies", "bbb"));
  write("notes/index.html", notes("New", "bbb"));
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-m", "cache bust and recent list"], "2026-10-10T10:00:00+03:00");

  write("index.html", page("Home pricing", "aaa"));
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-m", "homepage pricing"], "2026-10-18T09:00:00+03:00");

  write("index.html", page("Home pricing", "ccc"));
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-m", "homepage token only"], "2026-10-19T09:00:00+03:00");

  write("future/index.html", page("Future", "aaa"));
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-m", "future page"], "2026-12-01T09:00:00+03:00");

  return dir;
};

/**
 * @param {string} dir
 * @returns {string}
 */
const historySitemap = (dir) => {
  const loc = (slug) => `${BASE_URL}${slug}`;
  const file = path.join(dir, "sitemap.xml");
  fs.writeFileSync(file, wrapSitemap([
    `    <url>\n        <loc>${loc("/")}</loc>\n        <lastmod>2026-09-01T00:00:00Z</lastmod>\n        <priority>1.00</priority>\n    </url>`,
    `    <url>\n        <loc>${loc("/cookies/")}</loc>\n        <lastmod>2026-09-01T08:00:00Z</lastmod>\n        <priority>0.20</priority>\n    </url>`,
    `    <url>\n        <loc>${loc("/notes/")}</loc>\n        <lastmod>2026-09-01T08:00:00Z</lastmod>\n        <priority>0.50</priority>\n    </url>`,
    `    <url>\n        <loc>${loc("/stay/")}</loc>\n        <lastmod>2026-08-01T00:00:00Z</lastmod>\n        <priority>0.50</priority>\n    </url>`,
    `    <url>\n        <loc>${loc("/future/")}</loc>\n        <lastmod>2026-01-01</lastmod>\n        <priority>0.50</priority>\n    </url>`,
  ].join("\n")));
  fs.writeFileSync(path.join(dir, "posts.json"), "[]\n");
  return file;
};

test("--from-git dates changed pages and leaves noise-only pages on their stored lastmod", () => {
  const realBefore = fs.readFileSync(SITEMAP, "utf8");
  const dir = buildHistoryRepo();
  const sitemapPath = historySitemap(dir);
  const postsPath = path.join(dir, "posts.json");
  const home = `${BASE_URL}/`;
  const cookies = `${BASE_URL}/cookies/`;
  const notes = `${BASE_URL}/notes/`;
  const stay = `${BASE_URL}/stay/`;
  const future = `${BASE_URL}/future/`;

  const withoutGit = runScript(sitemapPath, postsPath, "2026-10-18");
  assert.equal(parseEntries(withoutGit).get(home), "2026-09-01T00:00:00Z");
  assert.equal(parseEntries(withoutGit).get(cookies), "2026-09-01T08:00:00Z");

  const once = runScript(sitemapPath, postsPath, "2026-10-18", ["--from-git", "--repo", dir]);
  const twice = runScript(sitemapPath, postsPath, "2026-10-18", ["--from-git", "--repo", dir]);
  assert.equal(twice, once, "second --from-git run changed the sitemap");
  const dated = parseEntries(once);
  assert.equal(dated.get(home), "2026-10-18");
  assert.equal(dated.get(cookies), "2026-09-01T08:00:00Z");
  assert.equal(dated.get(notes), "2026-09-01T08:00:00Z");
  assert.equal(dated.get(stay), "2026-09-01");
  assert.equal(dated.get(future), "2026-10-18");

  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), "solon-sitemap-shallow-"));
  execFileSync("git", ["clone", "--depth", "1", `file://${dir}`, shallow], { encoding: "utf8" });
  const shallowSitemap = historySitemap(shallow);
  const shallowXml = runScript(shallowSitemap, path.join(shallow, "posts.json"), "2026-10-18", ["--from-git", "--repo", shallow]);
  const shallowEntries = parseEntries(shallowXml);
  assert.equal(shallowEntries.get(home), "2026-09-01T00:00:00Z");
  assert.equal(shallowEntries.get(future), "2026-01-01");

  fs.writeFileSync(path.join(dir, "stay/index.html"), "<!DOCTYPE html><html><body><p>Stay updated</p></body></html>\n");
  const edited = runScript(sitemapPath, postsPath, "2026-10-18", ["--from-git", "--repo", dir]);
  assert.equal(parseEntries(edited).get(stay), "2026-10-18");
  assert.equal(parseEntries(edited).get(cookies), "2026-09-01T08:00:00Z");
  const editedAgain = runScript(sitemapPath, postsPath, "2026-10-18", ["--from-git", "--repo", dir]);
  assert.equal(editedAgain, edited);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(shallow, { recursive: true, force: true });
  assert.equal(fs.readFileSync(SITEMAP, "utf8"), realBefore);
});
