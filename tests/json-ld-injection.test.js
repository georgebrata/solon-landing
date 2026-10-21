"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyPostJsonLd,
  buildJsonLdTag,
  defaultArticleDocument,
  DEFAULT_ARTICLE_IMAGE,
} = require("../scripts/json-ld");

const GRAPHEME_SEGMENTER = new Intl.Segmenter("ro", { granularity: "grapheme" });
const PAGE = "https://solon.agency/blog/example/";

/**
 * @param {string} text
 * @returns {number}
 */
const graphemeLength = (text) => [...GRAPHEME_SEGMENTER.segment(text)].length;

/**
 * @param {string} value
 * @returns {boolean}
 */
const hasLoneSurrogate = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
};

/**
 * @param {string|string[]|undefined} type
 * @returns {boolean}
 */
const isArticleType = (type) => {
  const types = Array.isArray(type) ? type : [type];
  return types.some((entry) => typeof entry === "string"
    && (/Article|BlogPosting/u.test(entry) || entry === "Report" || entry.endsWith("Report")));
};

/**
 * @param {object|object[]} node
 * @param {string} rel
 * @param {{ rel: string, headline: string }[]} found
 * @returns {void}
 */
const collectArticleHeadlines = (node, rel, found) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectArticleHeadlines(item, rel, found);
    return;
  }
  if (isArticleType(node["@type"]) && typeof node.headline === "string") {
    found.push({ rel, headline: node.headline });
  }
  for (const value of Object.values(node)) collectArticleHeadlines(value, rel, found);
};

/**
 * @param {string} title
 * @returns {string}
 */
const headlineFor = (title) => defaultArticleDocument({
  title,
  description: "D",
  date: "2026-10-15",
}, PAGE).headline;

test("JSON-LD injection escapes </script> and does not expand $&", () => {
  const payload = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Cost $& $1",
        acceptedAnswer: {
          "@type": "Answer",
          text: "before </script> $& $1 \u2028 after",
        },
      },
    ],
  };

  const tag = buildJsonLdTag(JSON.stringify(payload), PAGE);
  const html = "<head>{{json_ld}}</head>".replace(/\{\{json_ld\}\}/g, () => `\n${tag}\n`);

  assert.equal(html.includes("{{json_ld}}"), false);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.equal(html.includes("</script> $&"), false);
  assert.ok(html.includes("\\u003c/script>"));
  assert.ok(html.includes("$&"));
  assert.ok(html.includes("$1"));
  assert.ok(html.includes("\\u2028"));

  const inner = html.replace(/^[\s\S]*?<script[^>]*>\n/, "").replace(/\n<\/script>[\s\S]*$/, "");
  const parsed = JSON.parse(inner.replace(/\\u003c/g, "<").replace(/\\u2028/g, "\u2028"));
  assert.equal(parsed.mainEntity[0].acceptedAnswer.text, "before </script> $& $1 \u2028 after");
});

test("Article JSON-LD defaults image and keeps an author-supplied image", () => {
  const generated = JSON.parse(
    buildJsonLdTag(JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "H" }), PAGE)
      .replace(/<\/?script[^>]*>/g, "")
  );
  assert.equal(generated.image, DEFAULT_ARTICLE_IMAGE);

  const custom = "https://solon.agency/assets/img/custom.png";
  const kept = JSON.parse(
    buildJsonLdTag(JSON.stringify({ "@type": "Article", image: custom }), PAGE)
      .replace(/<\/?script[^>]*>/g, "")
  );
  assert.equal(kept.image, custom);
});

test("DefinedTerm entries can carry a url and missing urls point at #term- anchors", () => {
  const doc = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTermSet",
        hasDefinedTerm: [
          { "@type": "DefinedTerm", name: "Cuvânt cheie" },
          {
            "@type": "DefinedTerm",
            name: "SEO",
            url: "https://solon.agency/blog/example/#term-custom",
          },
        ],
      },
    ],
  };
  const parsed = JSON.parse(buildJsonLdTag(JSON.stringify(doc), PAGE).replace(/<\/?script[^>]*>/g, ""));
  const terms = parsed["@graph"][0].hasDefinedTerm;
  assert.equal(terms[0].url, "https://solon.agency/blog/example/#term-cuvant-cheie");
  assert.equal(terms[1].url, "https://solon.agency/blog/example/#term-custom");
});

test("invalid JSON-LD fails the build", () => {
  assert.throws(() => buildJsonLdTag("{not json", PAGE), /Invalid JSON-LD/);
});

test("null, JSON null, and whitespace are no custom JSON-LD and still emit the default Article", () => {
  assert.equal(buildJsonLdTag(null, PAGE), "");
  assert.equal(buildJsonLdTag("null", PAGE), "");
  assert.equal(buildJsonLdTag(" \n\t ", PAGE), "");

  const frontmatter = {
    title: "Titlu",
    description: "Descriere",
    date: "2026-01-02",
  };
  for (const jsonLd of [null, "null", " \n\t "]) {
    const page = applyPostJsonLd("<p>Body</p>", { ...frontmatter, json_ld: jsonLd }, PAGE);
    assert.equal(page.htmlContent.includes("application/ld+json"), false);
    assert.match(page.headJsonLd, /"@type": "Article"/);
    assert.match(page.headJsonLd, /"headline": "Titlu"/);
    assert.match(page.headJsonLd, /"image": "https:\/\/solon\.agency\/assets\/img\/solon-metaimage\.png"/);
  }
});

test("non-object JSON-LD fails the build", () => {
  for (const value of ["42", "[]", "\"text\"", "true"]) {
    assert.throws(() => buildJsonLdTag(value, PAGE), /expected a JSON object/);
  }
});

test("unquoted YAML dates become YYYY-MM-DD in Europe/Bucharest", () => {
  const document = defaultArticleDocument({
    title: "T",
    description: "D",
    date: new Date("2026-03-24T00:00:00.000Z"),
    date_modified: new Date("2026-10-08T21:30:00.000Z"),
  }, PAGE);
  assert.equal(document.datePublished, "2026-03-24");
  assert.equal(document.dateModified, "2026-10-09");

  const fromString = defaultArticleDocument({
    title: "T",
    description: "D",
    date: "Tue Mar 24 2026 00:00:00 GMT+0000 (Coordinated Universal Time)",
  }, PAGE);
  assert.equal(fromString.datePublished, "2026-03-24");
  assert.equal(Object.hasOwn(fromString, "dateModified"), false);
});

test("a headline over 110 characters uses seo_title, or a word-boundary cut", () => {
  const longTitle = "Ce are voie un avocat să publice online: ghid de publicitate conform Legii nr. 51/1995 și Statutului profesiei de avocat";
  assert.equal(longTitle.length, 120);
  const withSeo = defaultArticleDocument({
    title: longTitle,
    seo_title: "Publicitate pentru avocați: ce ai voie să publici online",
    description: "D",
    date: "2026-10-15",
  }, PAGE);
  assert.equal(withSeo.headline, "Publicitate pentru avocați: ce ai voie să publici online");
  assert.ok(withSeo.headline.length <= 110);

  const cut = defaultArticleDocument({
    title: longTitle,
    description: "D",
    date: "2026-10-15",
  }, PAGE);
  assert.equal(
    cut.headline,
    "Ce are voie un avocat să publice online: ghid de publicitate conform Legii nr. 51/1995 și Statutului profesiei"
  );
  assert.equal(cut.headline.includes("…"), false);
  assert.equal(cut.headline.endsWith(" "), false);
  assert.ok(cut.headline.length <= 110);
  assert.equal(longTitle.startsWith(cut.headline), true);
});

test("a headline cut keeps emoji, ZWJ sequences, and combining marks whole", () => {
  const emoji = "\uD83D\uDE00";
  const emojiHead = `${"a".repeat(109)}${emoji}`;
  assert.equal(graphemeLength(emojiHead), 110);
  assert.equal(emojiHead.length, 111);
  assert.equal(headlineFor(`${emojiHead} depaseste limita`), emojiHead);

  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  const familyHead = `${"b".repeat(109)}${family}`;
  assert.equal(graphemeLength(familyHead), 110);
  assert.ok(familyHead.length > 110);
  assert.equal(headlineFor(`${familyHead} depaseste limita`), familyHead);

  const combining = "a\u0306";
  assert.equal(graphemeLength(combining), 1);
  assert.equal(combining.length, 2);
  const combiningHead = `${"c".repeat(109)}${combining}`;
  assert.equal(headlineFor(`${combiningHead} depaseste limita`), combiningHead);

  assert.equal(hasLoneSurrogate(headlineFor(`${emojiHead} depaseste`)), false);
  assert.equal(hasLoneSurrogate(headlineFor(`${familyHead} depaseste`)), false);
});

test("a headline cut prefers the last whitespace inside the limit", () => {
  const head = "Prima propozitie scurta";
  assert.ok(head.includes(" "));
  assert.equal(headlineFor(`${head} ${"z".repeat(120)}`), head);
  assert.equal(headlineFor(`${head}\u00A0${"z".repeat(120)}`), head);
  assert.equal(headlineFor(`${head}\n${"z".repeat(120)}`), head);
});

test("a headline with no space is cut mid-word on a character boundary", () => {
  assert.equal(headlineFor("z".repeat(130)), "z".repeat(110));
  const emoji = "\uD83D\uDE00";
  assert.equal(headlineFor(`${"z".repeat(110)}${emoji}${"y".repeat(10)}`), "z".repeat(110));
});

test("a headline cut strips trailing punctuation and dashes", () => {
  const fitting = `${"A".repeat(109)}:`;
  assert.equal(graphemeLength(fitting), 110);
  assert.equal(headlineFor(fitting), fitting);

  for (const mark of [":", ",", ";", "\u2013", "\u2014", "-", "."]) {
    const head = `Cuvant ${"x".repeat(102)}${mark}`;
    assert.equal(graphemeLength(head), 110, mark);
    assert.equal(headlineFor(`${head} depaseste limita`), head.slice(0, -mark.length));
  }
});

test("a headline cut drops short dangling words repeatedly", () => {
  for (const word of ["și", "și/sau", "si", "de", "la", "în", "pe", "cu", "pentru", "din", "a", "o", "un", "al", "ale", "sau", "or"]) {
    const tail = ` ${word}`;
    const stem = "Y".repeat(110 - graphemeLength(tail));
    const head = `${stem}${tail}`;
    assert.equal(graphemeLength(head), 110, word);
    assert.equal(headlineFor(`${head} continuare peste limita`), stem, word);
  }

  const repeated = `${"Y".repeat(104)} și de`;
  assert.equal(graphemeLength(repeated), 110);
  assert.equal(headlineFor(`${repeated} continuare`), "Y".repeat(104));

  const uppercase = `${"Y".repeat(107)} Și`;
  assert.equal(graphemeLength(uppercase), 110);
  assert.equal(headlineFor(`${uppercase} continuare`), "Y".repeat(107));

  const afterPunctuation = `${"Y".repeat(106)}: și`;
  assert.equal(graphemeLength(afterPunctuation), 110);
  assert.equal(headlineFor(`${afterPunctuation} continuare`), "Y".repeat(106));

  assert.equal(headlineFor("Publicitate: ce ai voie și"), "Publicitate: ce ai voie și");

  const keptPhrase = `${"Y".repeat(110 - graphemeLength(" de trei ori"))} de trei ori`;
  assert.equal(graphemeLength(keptPhrase), 110);
  assert.equal(headlineFor(`${keptPhrase} continuare`), keptPhrase);
});

test("a headline cut keeps the period on abbreviations", () => {
  for (const abbr of ["nr.", "art.", "alin.", "lit.", "etc.", "pct.", "ed.", "vol.", "cf.", "pag.", "cap.", "sec.", "Nr."]) {
    const tail = ` ${abbr}`;
    const stem = "Y".repeat(110 - graphemeLength(tail));
    const head = `${stem}${tail}`;
    assert.equal(graphemeLength(head), 110, abbr);
    assert.equal(headlineFor(`${head} continuare peste limita`), head, abbr);
  }
});

test("a headline cut removes an unclosed parenthesis, bracket, or Romanian quote", () => {
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ["\u201E", "\u201D"]]) {
    const stem = "Titlu clar";
    const head = `${stem} ${open}${"z".repeat(110 - stem.length - 2)}`;
    assert.equal(graphemeLength(head), 110, open);
    assert.equal(headlineFor(`${head}${close} si inca text`), stem, open);
  }

  const balanced = "Ghid (2026)";
  const prefix = `${balanced} (`;
  const head = `${prefix}${"z".repeat(110 - graphemeLength(prefix))}`;
  assert.equal(graphemeLength(head), 110);
  assert.equal(headlineFor(`${head}) overflow text here`), balanced);

  const quoted = "Ghid \u201E2026\u201D";
  const quotePrefix = `${quoted} \u201E`;
  const quoteHead = `${quotePrefix}${"z".repeat(110 - graphemeLength(quotePrefix))}`;
  assert.equal(graphemeLength(quoteHead), 110);
  assert.equal(headlineFor(`${quoteHead}\u201D overflow text here`), quoted);

  const quotedWithLeft = "Ghid \u201E2026\u201C";
  const leftPrefix = `${quotedWithLeft} \u201E`;
  const leftHead = `${leftPrefix}${"z".repeat(110 - graphemeLength(leftPrefix))}`;
  assert.equal(graphemeLength(leftHead), 110);
  assert.equal(headlineFor(`${leftHead}\u201C overflow text here`), quotedWithLeft);
});

test("a title that starts with an unclosed opener keeps the word-boundary cut", () => {
  const stem = `(${"a".repeat(50)}`;
  const title = `${stem} ${"z".repeat(80)}`;
  assert.ok(graphemeLength(title) > 110);
  assert.equal(headlineFor(title), stem);

  const quoted = `\u201E${"a".repeat(40)}`;
  const quotedTitle = `${quoted} ${"z".repeat(90)}`;
  assert.ok(graphemeLength(quotedTitle) > 110);
  assert.equal(headlineFor(quotedTitle), quoted);
});

test("every built JSON-LD article headline is at most 110 graphemes", () => {
  const root = path.join(__dirname, "..");
  const listed = execFileSync("git", ["ls-files", "-z", "--", "*.html"], {
    cwd: root,
    encoding: "utf8",
  });
  const files = listed.split("\0").filter(Boolean).filter((rel) => {
    const parts = rel.split("/");
    return parts[0] !== "templates"
      && !parts.includes("node_modules")
      && !(parts[0] === "assets" && parts[1] === "vendor");
  });
  const required = [
    "blog/ce-are-voie-avocat-sa-publice-online/index.html",
    "blog/mentenanta-site-avocati/index.html",
    "blog/cat-costa-un-site-de-avocat-in-2026/index.html",
    "blog/glosar-marketing-digital-avocati/index.html",
    "blog/creare-site-avocati/index.html",
    "blog/google-business-profile-avocati/index.html",
    "blog/date-structurate-schema-org-pentru-avocati/index.html",
    "blog/microsoft-copilot-pentru-avocati/index.html",
    "blog/pagini-arii-de-practica-website-avocat/index.html",
    "blog/avocat-chatgpt-gemini-ai-overviews/index.html",
    "blog/domeniu-email-profesional-cabinet-avocat/index.html",
  ];
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  const found = [];

  for (const rel of files) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    for (const match of html.matchAll(scriptPattern)) {
      let data = null;
      try {
        data = JSON.parse(match[1]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assert.fail(`${rel} has invalid JSON-LD: ${message}`);
      }
      collectArticleHeadlines(data, rel, found);
    }
  }

  for (const item of found) {
    const length = graphemeLength(item.headline);
    assert.ok(
      length <= 110,
      `${item.rel} headline has ${length} graphemes: ${item.headline}`
    );
  }

  const seen = new Set(found.map((item) => item.rel));
  assert.ok(found.length >= required.length, `expected article headlines, found ${found.length}`);
  for (const rel of required) {
    assert.ok(seen.has(rel), `missing a JSON-LD headline on ${rel}`);
  }
});
