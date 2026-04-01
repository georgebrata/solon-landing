const fs = require("fs");
const path = require("path");

const BASE_URL = "https://solon.agency";
const BLOG_PRIORITY = "0.80";
const BLOG_POST_PRIORITY = "0.80";

const now = new Date().toISOString();
const sitemapPath = path.join(__dirname, "../sitemap.xml");
const postsJsonPath = path.join(__dirname, "../blog/posts.json");

const normalizeBlogPath = (value) => {
  const input = String(value || "").trim();
  if (!input) return "";
  const withoutLeadingSlash = input.replace(/^\/+/, "");
  const withoutIndexHtml = withoutLeadingSlash.replace(/\/?index\.html$/i, "/");
  return withoutIndexHtml.endsWith("/") ? withoutIndexHtml : `${withoutIndexHtml}/`;
};

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildUrlNode = ({ loc, lastmod, priority }) => [
  "    <url>",
  `        <loc>${escapeXml(loc)}</loc>`,
  `        <lastmod>${escapeXml(lastmod)}</lastmod>`,
  `        <priority>${escapeXml(priority)}</priority>`,
  "    </url>",
].join("\n");

const sitemapContent = fs.readFileSync(sitemapPath, "utf8");
const urlNodeRegex = /<url>\s*<loc>([\s\S]*?)<\/loc>\s*<lastmod>([\s\S]*?)<\/lastmod>\s*<priority>([\s\S]*?)<\/priority>\s*<\/url>/g;

const existingEntries = [];
let match;
while ((match = urlNodeRegex.exec(sitemapContent)) !== null) {
  existingEntries.push({
    loc: match[1].trim(),
    lastmod: match[2].trim(),
    priority: match[3].trim(),
  });
}

const posts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8"));
const blogUrls = new Set([`${BASE_URL}/blog`]);

posts.forEach((post) => {
  const postPath = normalizeBlogPath(post.url || post.slug);
  if (!postPath) return;
  blogUrls.add(`${BASE_URL}/blog/${postPath}`);
});

const normalizeTrailingSlash = (url) =>
  url.endsWith("/") ? url : `${url}/`;

const existingByLoc = new Map(existingEntries.map((entry) => [entry.loc, entry]));
const updatedEntries = existingEntries
  .filter((entry) => !entry.loc.startsWith(`${BASE_URL}/blog/`))
  .map((entry) => ({ ...entry, loc: normalizeTrailingSlash(entry.loc) }));

const blogIndexLoc = `${BASE_URL}/blog`;
const existingBlogIndex = existingByLoc.get(blogIndexLoc);
updatedEntries.push({
  loc: blogIndexLoc,
  lastmod: now,
  priority: existingBlogIndex ? existingBlogIndex.priority : BLOG_PRIORITY,
});

Array.from(blogUrls)
  .filter((url) => url !== blogIndexLoc)
  .sort((a, b) => a.localeCompare(b))
  .forEach((url) => {
    const existing = existingByLoc.get(url);
    updatedEntries.push({
      loc: url,
      lastmod: now,
      priority: existing ? existing.priority : BLOG_POST_PRIORITY,
    });
  });

const finalSitemap = [
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">',
  ...updatedEntries.map(buildUrlNode),
  "</urlset>",
  "",
].join("\n");

fs.writeFileSync(sitemapPath, finalSitemap, "utf8");

console.log(`✅ Updated sitemap.xml with blog URLs at ${now}`);
