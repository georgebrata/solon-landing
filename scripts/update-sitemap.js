"use strict";

const { execFileSync } = require("child_process");
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

const INDEXNOW_KEY_PATH = /^\/[0-9a-f]{32}\.txt$/;

/**
 * Pathname of an absolute sitemap loc, without a query string.
 * @param {string} loc Absolute sitemap URL.
 * @returns {string} Path such as `/blog/`, or "" when loc is not on this host.
 */
const pathnameOfLoc = (loc) => {
  if (typeof loc !== "string" || !loc.startsWith(`${BASE_URL}/`)) return "";
  let pathname = loc.slice(BASE_URL.length);
  const queryIndex = pathname.indexOf("?");
  if (queryIndex !== -1) pathname = pathname.slice(0, queryIndex);
  return pathname;
};

/**
 * True for the public IndexNow key file (`/<32 lowercase hex>.txt`).
 * That file must stay reachable and must not be listed in the sitemap.
 * @param {string} loc Absolute sitemap URL.
 * @returns {boolean}
 */
const isIndexNowKeyLoc = (loc) => INDEXNOW_KEY_PATH.test(pathnameOfLoc(loc));

/**
 * True when a sitemap loc is an error document or the IndexNow key file.
 * @param {string} loc Absolute sitemap URL.
 * @returns {boolean}
 */
const isExcludedFromSitemap = (loc) => {
  const pathname = pathnameOfLoc(loc);
  if (!pathname) return false;
  return SITEMAP_EXCLUDED_PATHS.has(pathname) || INDEXNOW_KEY_PATH.test(pathname);
};

/**
 * Drop IndexNow key-file URLs. Other url nodes are copied unchanged.
 * @param {string} xml Sitemap document.
 * @returns {string}
 */
const stripIndexNowKeyUrls = (xml) => String(xml).replace(
  /[ \t]*<url>[\s\S]*?<\/url>\r?\n?/g,
  (block) => {
    const locMatch = /<loc>([\s\S]*?)<\/loc>/.exec(block);
    if (!locMatch) return block;
    return isIndexNowKeyLoc(locMatch[1].trim()) ? "" : block;
  }
);

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
 * Later of two calendar days. Empty values drop out.
 * @param {string|undefined} left
 * @param {string|undefined} right
 * @returns {string}
 */
const laterDay = (left, right) => {
  const a = dayOf(left);
  const b = dayOf(right);
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
};

/**
 * YYYY-MM-DD in Europe/Bucharest for an ISO timestamp.
 * @param {string} iso
 * @returns {string}
 */
const bucharestDay = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

/**
 * Repo-relative page file for a sitemap loc, or "" when loc is not a page here.
 * @param {string} loc
 * @returns {string}
 */
const repoPathForLoc = (loc) => {
  const pathname = pathnameOfLoc(loc);
  if (!pathname || pathname.includes("..")) return "";
  const trimmed = pathname.replace(/\/$/, "");
  if (trimmed === "") return "index.html";
  return `${trimmed.slice(1)}/index.html`;
};

/**
 * Remove one element, including nested copies of the same tag.
 * An unclosed tag is left in place so a broken block cannot hide the page.
 * @param {string} html
 * @param {string} tag
 * @param {string} className
 * @returns {string}
 */
const removeBlock = (html, tag, className) => {
  const source = String(html);
  const startRe = new RegExp(
    `<${tag}\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`,
    "gi"
  );
  let out = "";
  let cursor = 0;
  for (const match of source.matchAll(startRe)) {
    const start = match.index;
    if (start < cursor) continue;
    const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    token.lastIndex = start;
    let depth = 0;
    let end = -1;
    let found = null;
    while ((found = token.exec(source)) !== null) {
      depth += found[1] ? -1 : 1;
      if (depth === 0) {
        end = token.lastIndex;
        break;
      }
    }
    if (end === -1) {
      out += source.slice(cursor);
      return out;
    }
    out += source.slice(cursor, start);
    cursor = end;
  }
  return out + source.slice(cursor);
};

/**
 * Page HTML with deploy noise removed: cache-bust query tokens, the generated
 * "Articole recente" list, and the generated "Articole similare" block.
 * Those change when another page is published or an asset is rebuilt.
 * @param {string} html
 * @returns {string}
 */
const normalizePageHtml = (html) => {
  let text = removeBlock(html, "div", "blog-recent-articles");
  text = removeBlock(text, "section", "blog-related-posts");
  text = text.replace(/([?&])v=[0-9a-fA-F]+/g, "$1");
  text = text.replace(/\?&/g, "?");
  text = text.replace(/[?&](?=["'>])/g, "");
  return text;
};

/**
 * Calendar day of the newest revision that changed normalized page content.
 * A working tree that differs from HEAD uses `today` (this deploy edited the page).
 * Revisions are newest first. `before === null` means the file was added.
 * @param {{ revisions: { committedAt: string, before: string|null, after: string }[], working?: string|null, head?: string|null, today: string }} input
 * @returns {string}
 */
const contentChangeDay = ({ revisions, working = null, head = null, today }) => {
  const hasWorking = typeof working === "string";
  const hasHead = typeof head === "string";
  if (hasWorking && hasHead && normalizePageHtml(working) !== normalizePageHtml(head)) {
    return today;
  }
  if (hasWorking && !hasHead && normalizePageHtml(working)) return today;
  for (const revision of revisions || []) {
    const after = typeof revision.after === "string" ? revision.after : "";
    const added = revision.before == null;
    if (added || normalizePageHtml(after) !== normalizePageHtml(revision.before)) {
      return bucharestDay(revision.committedAt);
    }
  }
  return "";
};

const gitCache = new Map();

/**
 * @param {string} repoRoot
 * @param {string[]} args
 * @returns {string|null}
 */
const gitOutput = (repoRoot, args) => {
  const key = `${repoRoot}\0${args.join("\0")}`;
  if (gitCache.has(key)) return gitCache.get(key);
  let value = null;
  try {
    value = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    value = null;
  }
  gitCache.set(key, value);
  return value;
};

/**
 * True when the parent commit object is in this clone.
 * A shallow checkout records the parent SHA but does not have the object,
 * and that is not enough to tell a cache-bust commit from a real edit.
 * @param {string} repoRoot
 * @param {string} sha
 * @returns {"root"|"present"|"missing"}
 */
const parentObjectState = (repoRoot, sha) => {
  const listed = gitOutput(repoRoot, ["rev-list", "--parents", "-n", "1", sha]);
  const parts = String(listed || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    // A shallow tip also has no visible parent. That is not the file being added.
    const shallowText = gitOutput(repoRoot, ["rev-parse", "--is-shallow-repository"]);
    return String(shallowText || "").trim() === "true" ? "missing" : "root";
  }
  const object = gitOutput(repoRoot, ["cat-file", "-e", `${sha}^`]);
  return object == null ? "missing" : "present";
};

/**
 * Last content-changing day of one page file, from git history plus the
 * working tree. Empty when a parent commit is missing (shallow clone) or
 * the file has no history. A shallow boundary older than the page history
 * still yields a real day, because each commit's parent object is checked.
 * @param {string} repoRoot
 * @param {string} file
 * @param {string} today
 * @returns {string}
 */
const gitContentDay = (repoRoot, file, today) => {
  const head = gitOutput(repoRoot, ["show", `HEAD:${file}`]);
  const absolute = path.join(repoRoot, file);
  const working = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  if (typeof working === "string" && typeof head === "string"
    && normalizePageHtml(working) !== normalizePageHtml(head)) {
    return today;
  }
  if (typeof working === "string" && head == null && normalizePageHtml(working)) return today;

  const log = gitOutput(repoRoot, ["log", "--format=%H%x09%cI", "--", file]);
  if (!log || !log.trim()) return "";
  for (const line of log.trim().split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const sha = line.slice(0, tab);
    const committedAt = line.slice(tab + 1);
    const after = gitOutput(repoRoot, ["show", `${sha}:${file}`]);
    if (after == null) continue;
    const parentState = parentObjectState(repoRoot, sha);
    if (parentState === "missing") return "";
    const before = parentState === "root" ? null : gitOutput(repoRoot, ["show", `${sha}^:${file}`]);
    const day = contentChangeDay({
      revisions: [{ committedAt, before, after }],
      working: null,
      head: null,
      today,
    });
    if (day) return day;
  }
  return "";
};

/**
 * Content day for each sitemap loc, from git. Empty map when git cannot be read.
 * @param {string} repoRoot
 * @param {string[]} locs
 * @param {string} today
 * @returns {Map<string, string>}
 */
const loadGitContentDays = (repoRoot, locs, today) => {
  gitCache.clear();
  const days = new Map();
  const inside = gitOutput(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    console.warn("sitemap: git history unavailable; keeping stored lastmod values");
    return days;
  }
  const shallowText = gitOutput(repoRoot, ["rev-parse", "--is-shallow-repository"]);
  const shallow = String(shallowText || "").trim() === "true";
  if (shallow) {
    console.warn("sitemap: git history is shallow; a page keeps its stored lastmod when the changing commit has no parent object");
  }
  for (const loc of locs) {
    const file = repoPathForLoc(loc);
    if (!file) continue;
    const day = gitContentDay(repoRoot, file, today);
    if (day) days.set(loc, day);
  }
  return days;
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
 * `--from-git` dates each page from its last content-changing commit.
 * `--repo` is the git working tree for `--from-git` (default: this repo).
 * @param {string[]} argv
 * @returns {{ sitemapPath: string, postsJsonPath: string, today: string, fromGit: boolean, repoRoot: string }}
 */
const parseCli = (argv) => {
  const options = {
    sitemapPath: DEFAULT_SITEMAP_PATH,
    postsJsonPath: DEFAULT_POSTS_PATH,
    today: "",
    fromGit: false,
    repoRoot: path.join(__dirname, ".."),
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
    } else if (arg === "--from-git") {
      options.fromGit = true;
    } else if (arg === "--repo") {
      options.repoRoot = argv[index + 1];
      index += 1;
    }
  }
  return options;
};

/**
 * Rewrite lastmod values in one sitemap file.
 * With `fromGit`, each loc also takes the newest commit that changed the
 * page content (working-tree edits count as `today`). Stored days that are
 * already newer stay as they are. Cache-bust tokens and generated blog
 * sidebars do not count as content.
 * @param {{ sitemapPath?: string, postsJsonPath?: string, today?: string, fromGit?: boolean, repoRoot?: string }} [options]
 * @returns {string} The sitemap XML after the check. The file is written only when it changed.
 */
const updateSitemap = (options = {}) => {
  const sitemapFile = options.sitemapPath || DEFAULT_SITEMAP_PATH;
  const postsFile = options.postsJsonPath || DEFAULT_POSTS_PATH;
  const today = options.today || todayBucharest();
  const fromGit = options.fromGit === true;
  const repoRoot = options.repoRoot || path.join(__dirname, "..");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`Invalid sitemap clock ${today}; expected YYYY-MM-DD`);
  }

  const original = fs.readFileSync(sitemapFile, "utf8");
  const sitemapContent = stripIndexNowKeyUrls(original);
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

  const gitLocs = existingEntries.map((entry) => entry.loc);
  for (const url of postDateByUrl.keys()) {
    if (!gitLocs.includes(url)) gitLocs.push(url);
  }
  if (!gitLocs.includes(blogIndexLoc)) gitLocs.push(blogIndexLoc);
  const gitDays = fromGit ? loadGitContentDays(repoRoot, gitLocs, today) : new Map();

  const existingByLoc = new Map(existingEntries.map((entry) => [entry.loc, entry]));
  let xml = sitemapContent;

  const sitemapPostUrls = existingEntries
    .map((entry) => entry.loc)
    .filter((loc) => loc.startsWith(`${BASE_URL}/blog/`) && loc !== blogIndexLoc);
  const postUrlSet = new Set(postDateByUrl.keys());
  const samePostSet = sitemapPostUrls.length === postUrlSet.size
    && sitemapPostUrls.every((loc) => postUrlSet.has(loc));

  for (const [url, contentDay] of postDateByUrl) {
    const pageDay = laterDay(contentDay, gitDays.get(url));
    const existing = existingByLoc.get(url);
    if (!existing) {
      const lastmod = resolveLastmod("", pageDay, today);
      const node = buildUrlNode({ loc: url, lastmod, priority: BLOG_POST_PRIORITY });
      xml = xml.replace("</urlset>", `${node}\n</urlset>`);
      continue;
    }
    const lastmod = resolveLastmod(existing.lastmod, pageDay, today);
    if (lastmod !== existing.lastmod) xml = replaceLastmod(xml, url, lastmod);
  }

  const existingIndex = existingByLoc.get(blogIndexLoc);
  const indexContentDay = laterDay(gitDays.get(blogIndexLoc), samePostSet ? "" : today);
  if (existingIndex) {
    const lastmod = resolveLastmod(existingIndex.lastmod, indexContentDay, today);
    if (lastmod !== existingIndex.lastmod) xml = replaceLastmod(xml, blogIndexLoc, lastmod);
  } else if (indexContentDay) {
    const node = buildUrlNode({
      loc: blogIndexLoc,
      lastmod: resolveLastmod("", indexContentDay, today),
      priority: BLOG_PRIORITY,
    });
    xml = xml.replace("</urlset>", `${node}\n</urlset>`);
  }

  for (const entry of existingEntries) {
    if (isExcludedFromSitemap(entry.loc)) continue;
    if (postDateByUrl.has(entry.loc) || entry.loc === blogIndexLoc) continue;
    const lastmod = resolveLastmod(entry.lastmod, gitDays.get(entry.loc) || "", today);
    if (lastmod !== entry.lastmod) xml = replaceLastmod(xml, entry.loc, lastmod);
  }

  if (xml !== original) {
    fs.writeFileSync(sitemapFile, xml, "utf8");
  }
  return xml;
};

if (require.main === module) {
  const cli = parseCli(process.argv.slice(2));
  updateSitemap(cli);
  const source = cli.fromGit ? ", from git content history" : "";
  console.log(`✅ Sitemap lastmods checked (today ${cli.today || todayBucharest()}, Europe/Bucharest${source})`);
}

module.exports = {
  resolveLastmod,
  todayBucharest,
  updateSitemap,
  isIndexNowKeyLoc,
  isExcludedFromSitemap,
  stripIndexNowKeyUrls,
  normalizePageHtml,
  contentChangeDay,
  repoPathForLoc,
  laterDay,
};
