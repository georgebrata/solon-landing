"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyPostJsonLd,
  buildJsonLdTag,
  defaultArticleDocument,
  DEFAULT_ARTICLE_IMAGE,
} = require("../scripts/json-ld");

const PAGE = "https://solon.agency/blog/example/";

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
