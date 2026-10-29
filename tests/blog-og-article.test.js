"use strict";

/**
 * Open Graph type on blog pages (Trello gRwY2RZH, F5):
 * every built post has exactly one og:type "article" and an
 * article:published_time equal to its front-matter `date` and to the JSON-LD
 * Article datePublished. article:modified_time appears only when the post
 * has `date_modified`. The blog hub and the static root pages stay "website".
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const { calendarDay } = require("../scripts/json-ld");

const ROOT = path.join(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "blog", "posts");

/**
 * Values of one meta property in a page.
 * @param {string} html
 * @param {string} property
 * @returns {string[]}
 */
const metaValues = (html, property) => [...html.matchAll(
  new RegExp(`<meta property="${property.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`, "g"),
)].map((match) => match[1]);

/**
 * datePublished / dateModified of Article-like JSON-LD nodes in a page.
 * @param {string} html
 * @param {"datePublished"|"dateModified"} key
 * @returns {string[]}
 */
const jsonLdDates = (html, key) => {
  const out = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const data = JSON.parse(match[1]);
    const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    for (const node of nodes) {
      if (node && /Article|BlogPosting/.test(String(node["@type"])) && node[key]) out.push(node[key]);
    }
  }
  return out;
};

/** @returns {{ slug: string, date: string, modified: string }[]} */
const posts = () => fs.readdirSync(POSTS_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => {
    const source = fs.readFileSync(path.join(POSTS_DIR, name), "utf8");
    const frontmatter = yaml.load(source.split(/^---\s*$/m)[1]);
    return {
      slug: frontmatter.slug,
      date: calendarDay(frontmatter.date),
      modified: calendarDay(frontmatter.date_modified),
    };
  });

test("every post page is og:type article with published_time equal to date and JSON-LD datePublished", () => {
  const list = posts();
  assert.ok(list.length > 0, "no posts found");
  for (const post of list) {
    const html = fs.readFileSync(path.join(ROOT, "blog", post.slug, "index.html"), "utf8");
    assert.deepEqual(metaValues(html, "og:type"), ["article"], `${post.slug}: og:type`);
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${post.slug}: front-matter date`);
    assert.deepEqual(metaValues(html, "article:published_time"), [post.date], `${post.slug}: published_time`);
    const published = jsonLdDates(html, "datePublished");
    assert.ok(published.length > 0, `${post.slug}: JSON-LD datePublished missing`);
    for (const value of published) assert.equal(value, post.date, `${post.slug}: JSON-LD datePublished`);
    const modified = metaValues(html, "article:modified_time");
    if (post.modified) {
      assert.deepEqual(modified, [post.modified], `${post.slug}: modified_time`);
      for (const value of jsonLdDates(html, "dateModified")) assert.equal(value, post.modified, `${post.slug}: JSON-LD dateModified`);
    } else {
      assert.deepEqual(modified, [], `${post.slug}: modified_time without date_modified`);
    }
  }
});

test("blog hub and static root pages keep og:type website and no article tags", () => {
  for (const file of ["blog/index.html", "index.html", "newsletter.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.deepEqual(metaValues(html, "og:type"), ["website"], `${file}: og:type`);
    assert.deepEqual(metaValues(html, "article:published_time"), [], `${file}: published_time`);
  }
});

test("layout template has no hard-coded og:type", () => {
  const layout = fs.readFileSync(path.join(ROOT, "templates", "layout.html"), "utf8");
  assert.match(layout, /<meta property="og:type" content="\{\{og_type\}\}" \/>\{\{article_meta\}\}/);
});
