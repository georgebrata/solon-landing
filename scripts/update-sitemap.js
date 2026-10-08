"use strict";

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://solon.agency";
const BLOG_PRIORITY = "0.80";
const BLOG_POST_PRIORITY = "0.50";

const SITEMAP_EXCLUDED_PATHS = new Set([
  "/404.html",
  "/500.html",
  "/403.html",
  "/404/",
  "/500/",
  "/403/",
]);

/**
 * True when a sitemap loc is an error document that must not be listed.
 * @param {string} loc Absolute sitemap URL.
 * @returns {boolean}
 */
const isExcludedFromSitemap = (loc) => {
  if (typeof loc !== "string" || !loc.startsWith(`${BASE_URL}/`)) {
    return false;
  }
  let pathname = loc.slice(BASE_URL.length);
  const queryIndex = pathname.indexOf("?");
  if (queryIndex !== -1) {
    pathname = pathname.slice(0, queryIndex);
  }
  return SITEMAP_EXCLUDED_PATHS.has(pathname);
};

/**
 * Today as YYYY-MM-DD in Europe/Bucharest.
 * @returns {string}
 */
const todayBucharest = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

/**
 * Turn a slug or posts.json url into a blog path with a trailing slash.
 * @param {string} value Slug or relative url.
 * @returns {string} Path such as `cat-costa/` or "" when the value is empty.
 */
const normalizeBlogPath = (value) => {
  const input = String(value || "").trim();
  if (!input) return "";
  const withoutLeadingSlash = input.replace(/^\/+/, "");
  const withoutIndexHtml = withoutLeadingSlash.replace(/\/?index\.html$/i, "/");
  return withoutIndexHtml.endsWith("/") ? withoutIndexHtml : `${withoutIndexHtml}/`;
};

/**
 * Calendar day at the start of a date or lastmod string.
 * @param {string|undefined} value ISO timestamp or YYYY-MM-DD.
 * @returns {string} YYYY-MM-DD, or "" when the value has no date prefix.
 */
const dayOf = (value) => {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

/**
 * Keep a stored lastmod unless the page's content date is newer.
 * The day written is max(stored day, content day), clamped to today.
 * Dates this function writes are YYYY-MM-DD. A stored value that is already
 * correct is returned unchanged, so a rebuild does not reformat it.
 * Nothing is emitted after today in Europe/Bucharest.
 * @param {string|undefined} existingLastmod
 * @param {string|undefined} contentDay YYYY-MM-DD
 * @param {string} [today] Fake clock YYYY-MM-DD. Defaults to today in Bucharest.
 * @returns {string}
 */
const resolveLastmod = (existingLastmod, contentDay, today = todayBucharest()) => {
  const existingDay = dayOf(existingLastmod);
  let day = existingDay;

  if (contentDay && contentDay > existingDay) day = contentDay;
  if (!day) day = contentDay || today;
  if (day > today) day = today;

  if (existingLastmod && day === existingDay && existingDay <= today) {
    return existingLastmod;
  }
  return day;
};

/**
 * Escape text for an XML text node.
 * @param {string} value Raw URL, date, or priority.
 * @returns {string}
 */
const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * One sitemap url entry, indented to match the existing file.
 * @param {{ loc: string, lastmod: string, priority: string }} entry
 * @returns {string}
 */
const buildUrlNode = ({ loc, lastmod, priority }) => [
  "    <url>",
  `        <loc>${escapeXml(loc)}</loc>`,
  `        <lastmod>${escapeXml(lastmod)}</lastmod>`,
  `        <priority>${escapeXml(priority)}</priority>`,
  "    </url>",
].join("\n");

/**
 * Replace one lastmod without disturbing the rest of the file.
 * @param {string} xml
 * @param {string} loc
 * @param {string} lastmod
 * @returns {string}
 */
const replaceLastmod = (xml, loc, lastmod) => {
  const pattern = new RegExp(
    `(<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>\\s*<lastmod>)[\\s\\S]*?(</lastmod>)`
  );
  return xml.replace(pattern, (_match, open, close) => `${open}${lastmod}${close}`);
};

const DEFAULT_SITEMAP_PATH = path.join(__dirname, "../sitemap.xml");
const DEFAULT_POSTS_PATH = path.join(__dirname, "../blog/posts.json");

/**
 * Read CLI flags. Paths default to the repo sitemap and posts.json.
 * `--today YYYY-MM-DD` is a fake clock for tests.
 * @param {string[]} argv
 * @returns {{ sitemapPath: string, postsJsonPath: string, today: string }}
 */
const parseCli = (argv) => {
  const options = {
    sitemapPath: DEFAULT_SITEMAP_PATH,
    postsJsonPath: DEFAULT_POSTS_PATH,
    today: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sitemap") {
      options.sitemapPath = argv[index + 1];
      index += 1;
    } else if (arg === "--posts") {
      options.postsJsonPath = argv[index + 1];
      index += 1;
    } else if (arg === "--today") {
      options.today = argv[index + 1];
      index += 1;
    }
  }
  return options;
};

/**
 * Rewrite lastmod values in one sitemap file.
 * @param {{ sitemapPath?: string, postsJsonPath?: string, today?: string }} [options]
 * @returns {string} The sitemap XML after the check. The file is written only when it changed.
 */
const updateSitemap = (options = {}) => {
  const sitemapFile = options.sitemapPath || DEFAULT_SITEMAP_PATH;
  const postsFile = options.postsJsonPath || DEFAULT_POSTS_PATH;
  const today = options.today || todayBucharest();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`Invalid sitemap clock ${today}; expected YYYY-MM-DD`);
  }

  const sitemapContent = fs.readFileSync(sitemapFile, "utf8");
  const urlNodeRegex = /<url>\s*<loc>([\s\S]*?)<\/loc>\s*<lastmod>([\s\S]*?)<\/lastmod>\s*<priority>([\s\S]*?)<\/priority>\s*<\/url>/g;

  const existingEntries = [];
  let match = null;
  while ((match = urlNodeRegex.exec(sitemapContent)) !== null) {
    existingEntries.push({
      loc: match[1].trim(),
      lastmod: match[2].trim(),
      priority: match[3].trim(),
    });
  }

  const posts = JSON.parse(fs.readFileSync(postsFile, "utf8"));
  const blogIndexLoc = `${BASE_URL}/blog/`;
  const postDateByUrl = new Map();

  posts.forEach((post) => {
    const postPath = normalizeBlogPath(post.url || post.slug);
    if (!postPath) return;
    const url = `${BASE_URL}/blog/${postPath}`;
    postDateByUrl.set(url, dayOf(post.date_modified || post.updated || post.date));
  });

  const existingByLoc = new Map(existingEntries.map((entry) => [entry.loc, entry]));
  let xml = sitemapContent;

  const sitemapPostUrls = existingEntries
    .map((entry) => entry.loc)
    .filter((loc) => loc.startsWith(`${BASE_URL}/blog/`) && loc !== blogIndexLoc);
  const postUrlSet = new Set(postDateByUrl.keys());
  const samePostSet = sitemapPostUrls.length === postUrlSet.size
    && sitemapPostUrls.every((loc) => postUrlSet.has(loc));

  for (const [url, contentDay] of postDateByUrl) {
    const existing = existingByLoc.get(url);
    if (!existing) {
      const lastmod = resolveLastmod("", contentDay, today);
      const node = buildUrlNode({ loc: url, lastmod, priority: BLOG_POST_PRIORITY });
      xml = xml.replace("</urlset>", `${node}\n</urlset>`);
      continue;
    }
    const lastmod = resolveLastmod(existing.lastmod, contentDay, today);
    if (lastmod !== existing.lastmod) xml = replaceLastmod(xml, url, lastmod);
  }

  if (!samePostSet) {
    const existingIndex = existingByLoc.get(blogIndexLoc);
    const lastmod = resolveLastmod(existingIndex ? existingIndex.lastmod : "", today, today);
    if (existingIndex) {
      if (lastmod !== existingIndex.lastmod) xml = replaceLastmod(xml, blogIndexLoc, lastmod);
    } else {
      const node = buildUrlNode({
        loc: blogIndexLoc,
        lastmod,
        priority: BLOG_PRIORITY,
      });
      xml = xml.replace("</urlset>", `${node}\n</urlset>`);
    }
  }

  for (const entry of existingEntries) {
    if (isExcludedFromSitemap(entry.loc)) continue;
    if (postDateByUrl.has(entry.loc)) continue;
    const lastmod = resolveLastmod(entry.lastmod, "", today);
    if (lastmod !== entry.lastmod) xml = replaceLastmod(xml, entry.loc, lastmod);
  }

  if (xml !== sitemapContent) {
    fs.writeFileSync(sitemapFile, xml, "utf8");
  }
  return xml;
};

if (require.main === module) {
  const cli = parseCli(process.argv.slice(2));
  updateSitemap(cli);
  console.log(`✅ Sitemap lastmods checked (today ${cli.today || todayBucharest()}, Europe/Bucharest)`);
}

module.exports = {
  resolveLastmod,
  todayBucharest,
  updateSitemap,
};
