"use strict";

/**
 * One JSON-LD serializer for blog posts.
 * build.js is the only injector: it substitutes {{json_ld}} with a function
 * so replacement patterns such as $& are not expanded.
 */

const DEFAULT_ARTICLE_IMAGE = "https://solon.agency/assets/img/solon-metaimage.png";
const JSON_LD_SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;

/**
 * Calendar day in Europe/Bucharest.
 * @param {Date} value
 * @returns {string} YYYY-MM-DD
 */
const formatBucharestDay = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(value);

/**
 * YAML dates and date strings become YYYY-MM-DD in Europe/Bucharest.
 * A bare YYYY-MM-DD is kept as written. Unquoted YAML dates arrive as Date objects;
 * String(date).slice(0, 10) would be a weekday name such as "Tue Mar 24".
 * @param {Date|string|undefined} value
 * @returns {string}
 */
const calendarDay = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : formatBucharestDay(value);
  }
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(text) || /[A-Za-z]/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return formatBucharestDay(parsed);
  }
  const prefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return prefix ? prefix[1] : text;
};

/**
 * Anchor id for a glossary term: "Cuvânt cheie" → "term-cuvant-cheie".
 * @param {string} name Term name from the DefinedTerm node.
 * @returns {string} Fragment id beginning with `term-`.
 */
const termAnchor = (name) => {
  const slug = String(name)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `term-${slug}`;
};

/**
 * Fill an Article image and missing DefinedTerm urls.
 * @param {object} data Parsed JSON-LD document.
 * @param {string} pageUrl Canonical page URL.
 * @returns {object} The same document, with defaults applied.
 */
const applyJsonLdDefaults = (data, pageUrl) => {
  const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
  const base = pageUrl ? String(pageUrl).replace(/\/$/, "") : "";

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    if (node["@type"] === "Article") {
      if (!node.image) node.image = DEFAULT_ARTICLE_IMAGE;
      if (node.datePublished) node.datePublished = calendarDay(node.datePublished);
      if (node.dateModified) node.dateModified = calendarDay(node.dateModified);
    }

    if (node["@type"] === "DefinedTermSet" && Array.isArray(node.hasDefinedTerm) && base) {
      for (const term of node.hasDefinedTerm) {
        if (!term || typeof term !== "object" || term["@type"] !== "DefinedTerm") continue;
        if (term.url || !term.name) continue;
        term.url = `${base}/#${termAnchor(term.name)}`;
      }
    }
  }

  return data;
};

/**
 * JSON text safe to embed in HTML. `<` cannot close the script early.
 * @param {object} data Parsed JSON-LD document.
 * @returns {string} Indented JSON with `<` and line separators escaped.
 */
const serializeJsonLd = (data) => JSON.stringify(data, null, 2)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/gu, "\\u2028")
  .replace(/\u2029/gu, "\\u2029");

/**
 * Build one application/ld+json script, or "" when there is nothing to emit.
 * Invalid JSON fails the build instead of being written into the page.
 * @param {string|object|undefined} jsonLdValue Front-matter value or raw JSON.
 * @param {string} pageUrl Canonical page URL, included in the error when JSON is invalid.
 * @returns {string} A script element, or an empty string.
 */
const buildJsonLdTag = (jsonLdValue, pageUrl) => {
  if (jsonLdValue == null) return "";
  if (typeof jsonLdValue === "string" && jsonLdValue.trim() === "") return "";
  const source = typeof jsonLdValue === "string" ? jsonLdValue.trim() : JSON.stringify(jsonLdValue);
  if (!source) return "";

  let data = null;
  try {
    data = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON-LD${pageUrl ? ` for ${pageUrl}` : ""}: ${message}`);
  }

  if (data == null) return "";
  if (typeof data !== "object" || Array.isArray(data)) {
    const where = pageUrl ? ` for ${pageUrl}` : "";
    throw new Error(`Invalid JSON-LD${where}: expected a JSON object`);
  }

  applyJsonLdDefaults(data, pageUrl);
  const body = serializeJsonLd(data);
  return `<script type="application/ld+json">\n${body}\n</script>`;
};

/**
 * Article used when a post has no JSON-LD of its own.
 * @param {object} frontmatter Post front-matter (title, description, date).
 * @param {string} pageUrl Canonical page URL.
 * @returns {object} Schema.org Article with the default Solon image.
 */
const defaultArticleDocument = (frontmatter, pageUrl) => {
  const document = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: frontmatter.title,
    description: frontmatter.description,
    inLanguage: "ro-RO",
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    datePublished: calendarDay(frontmatter.date),
    author: { "@id": "https://solon.agency/#organization" },
    publisher: { "@id": "https://solon.agency/#organization" },
    image: DEFAULT_ARTICLE_IMAGE,
  };
  const modified = calendarDay(frontmatter.date_modified || frontmatter.updated);
  if (modified) document.dateModified = modified;
  return document;
};

/**
 * True when front-matter does not carry a custom JSON-LD document.
 * null, the JSON text "null", and whitespace are absent, not a document.
 * @param {string|object|undefined} jsonLdValue
 * @returns {boolean}
 */
const isAbsentJsonLd = (jsonLdValue) => {
  if (jsonLdValue == null) return true;
  if (typeof jsonLdValue === "string" && jsonLdValue.trim() === "") return true;
  if (typeof jsonLdValue === "string" && jsonLdValue.trim() === "null") return true;
  return false;
};

/**
 * Keep exactly one JSON-LD script. Front-matter wins over a script pasted in the markdown.
 * Blank custom JSON-LD falls through so the default Article is still emitted.
 * @param {string} htmlContent Rendered article HTML.
 * @param {object} frontmatter Post front-matter. `json_ld` overrides an embedded script.
 * @param {string} pageUrl Canonical page URL.
 * @returns {{ htmlContent: string, headJsonLd: string }} Body HTML and the head script, if any.
 */
const applyPostJsonLd = (htmlContent, frontmatter, pageUrl) => {
  if (!isAbsentJsonLd(frontmatter.json_ld)) {
    const tag = buildJsonLdTag(frontmatter.json_ld, pageUrl);
    if (tag) {
      JSON_LD_SCRIPT.lastIndex = 0;
      return {
        htmlContent: htmlContent.replace(JSON_LD_SCRIPT, ""),
        headJsonLd: `\n  ${tag}\n`,
      };
    }
  }

  JSON_LD_SCRIPT.lastIndex = 0;
  if (JSON_LD_SCRIPT.test(htmlContent)) {
    JSON_LD_SCRIPT.lastIndex = 0;
    const normalized = htmlContent.replace(JSON_LD_SCRIPT, (full) => {
      const inner = full.replace(/^<script[^>]*>/i, "").replace(/<\/script>\s*$/i, "");
      return buildJsonLdTag(inner, pageUrl);
    });
    return { htmlContent: normalized, headJsonLd: "" };
  }

  return {
    htmlContent,
    headJsonLd: `\n  ${buildJsonLdTag(defaultArticleDocument(frontmatter, pageUrl), pageUrl)}\n`,
  };
};

module.exports = {
  DEFAULT_ARTICLE_IMAGE,
  termAnchor,
  calendarDay,
  buildJsonLdTag,
  defaultArticleDocument,
  applyPostJsonLd,
};
