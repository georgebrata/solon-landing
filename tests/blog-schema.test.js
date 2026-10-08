"use strict";

/**
 * One JSON-LD check for every built blog post:
 * exactly one application/ld+json block, it parses, Article has an image,
 * each FAQ question matches its own visible answer, and each HowTo step
 * name matches the visible headings in order with step text quoted inside
 * that step's section. Scripts are stripped before the visible comparison.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DEFAULT_ARTICLE_IMAGE } = require("../scripts/json-ld");

const BLOG_DIR = path.join(__dirname, "../blog");

/**
 * Built post pages. The blog hub is a list, not a post, and has no JSON-LD.
 * @returns {string[]} Absolute paths to blog/<slug>/index.html.
 */
const blogPostFiles = () => fs.readdirSync(BLOG_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "posts")
  .map((entry) => path.join(BLOG_DIR, entry.name, "index.html"))
  .filter((file) => fs.existsSync(file))
  .sort();

/**
 * Remove script elements so their text cannot satisfy a visible-text check.
 * @param {string} html
 * @returns {string}
 */
const stripScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ");

/**
 * Drop tags and collapse whitespace. The caller strips scripts first.
 * @param {string} html
 * @returns {string}
 */
const stripTags = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Decode the entities the markdown renderer emits in visible text.
 * @param {string} text
 * @returns {string}
 */
const decode = (text) => text
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&apos;/g, "'");

/**
 * Collapse whitespace so JSON-LD strings can be compared with rendered HTML.
 * @param {string} value
 * @returns {string}
 */
const normalize = (value) => decode(String(value || "")).replace(/\s+/g, " ").trim();

/**
 * Visible text of an HTML fragment, with scripts already removed by the caller.
 * @param {string} html
 * @returns {string}
 */
const plainText = (html) => normalize(stripTags(html));

/**
 * Raw JSON inside every application/ld+json script.
 * @param {string} html
 * @returns {string[]}
 */
const jsonLdBlocks = (html) => {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = null;
  while ((match = re.exec(html)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
};

/**
 * Nodes of a JSON-LD document, including each member of @graph.
 * @param {object} data
 * @returns {object[]}
 */
const nodesOf = (data) => {
  if (!data || typeof data !== "object") return [];
  return Array.isArray(data["@graph"]) ? data["@graph"] : [data];
};

/**
 * FAQ pairs from a FAQPage node, in document order.
 * @param {object} node
 * @returns {Array<{name: string, text: string}>}
 */
const faqPairsFromNode = (node) => (node.mainEntity || []).map((item) => ({
  name: normalize(item?.name),
  text: normalize(item?.acceptedAnswer?.text),
}));

/**
 * Visible FAQ pairs under the "Întrebări frecvente" heading.
 * Several paragraphs in one answer are joined with a space. Scripts are ignored.
 * @param {string} html Full page HTML.
 * @returns {Array<{name: string, text: string}>|null}
 */
const extractVisibleFaqPairs = (html) => {
  const visible = stripScripts(html);
  const sectionMatch = visible.match(
    /<h2[^>]*>[^<]*Întrebări frecvente[^<]*<\/h2>([\s\S]*?)(?=<h2[^>]*>|<\/article>)/iu
  );
  if (!sectionMatch) return null;

  const pairs = [];
  const h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/g;
  for (const questionMatch of sectionMatch[1].matchAll(h3Re)) {
    const name = plainText(questionMatch[1]);
    const paragraphs = [];
    for (const paragraphMatch of questionMatch[2].matchAll(/<p>([\s\S]*?)<\/p>/g)) {
      const text = plainText(paragraphMatch[1]);
      if (text) paragraphs.push(text);
    }
    if (name) pairs.push({ name, text: paragraphs.join(" ") });
  }
  return pairs.length > 0 ? pairs : null;
};

/**
 * Pairing failures. Each JSON-LD question must equal its own visible answer.
 * @param {Array<{name: string, text: string}>} jsonPairs
 * @param {Array<{name: string, text: string}>|null} visiblePairs
 * @returns {string[]}
 */
const faqPairMismatches = (jsonPairs, visiblePairs) => {
  if (!visiblePairs) return ["FAQPage in JSON-LD but no visible Întrebări frecvente section"];
  if (jsonPairs.length !== visiblePairs.length) {
    return [`JSON-LD has ${jsonPairs.length} Q&As, visible section has ${visiblePairs.length}`];
  }
  const failures = [];
  for (let index = 0; index < jsonPairs.length; index += 1) {
    if (jsonPairs[index].name !== visiblePairs[index].name) {
      failures.push(`Q${index + 1} question does not match its visible heading`);
    }
    if (jsonPairs[index].text !== visiblePairs[index].text) {
      failures.push(`Q${index + 1} answer does not match its own visible answer`);
    }
  }
  return failures;
};

/**
 * Heading text matches a HowTo step name, including a leading "1." ordinal.
 * @param {string} heading
 * @param {string} name
 * @returns {boolean}
 */
const headingsMatch = (heading, name) => {
  const visibleHeading = normalize(heading);
  const stepName = normalize(name);
  const withoutOrdinal = (value) => value.replace(/^\d+[.)]\s+/, "");
  return visibleHeading === stepName
    || withoutOrdinal(visibleHeading) === stepName
    || visibleHeading === withoutOrdinal(stepName);
};

/**
 * Headings in document order, taken from HTML whose scripts were removed.
 * @param {string} html
 * @returns {Array<{name: string, end: number, start: number}>}
 */
const extractHeadings = (html) => {
  const headings = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match = null;
  while ((match = re.exec(html)) !== null) {
    headings.push({
      name: plainText(match[2]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return headings;
};

/**
 * HowTo failures. Step names must match a contiguous run of headings, in order.
 * Each step.text must appear word for word inside that heading's section.
 * @param {string} html Full page HTML.
 * @param {object[]} steps HowTo step nodes.
 * @returns {string[]}
 */
const howtoMismatches = (html, steps) => {
  const visible = stripScripts(html);
  const headings = extractHeadings(visible);
  let runStart = -1;
  for (let index = 0; index <= headings.length - steps.length; index += 1) {
    const matches = steps.every((step, offset) => headingsMatch(headings[index + offset].name, step.name));
    if (!matches) continue;
    if (runStart !== -1) return ["more than one heading sequence matches HowTo step names"];
    runStart = index;
  }
  if (runStart < 0) return ["step names do not match the visible step headings in order"];

  const failures = [];
  for (let offset = 0; offset < steps.length; offset += 1) {
    const heading = headings[runStart + offset];
    const next = headings[runStart + offset + 1];
    const sectionText = plainText(visible.slice(heading.end, next ? next.start : visible.length));
    const text = normalize(steps[offset].text);
    if (!text) {
      failures.push(`step ${offset + 1} has no text`);
      continue;
    }
    if (!sectionText.includes(text)) {
      failures.push(`step ${offset + 1} text is not word for word inside its visible section`);
    }
  }
  return failures;
};

/**
 * Minimal page used to prove swapped FAQ answers fail.
 * @param {string} firstAnswer
 * @param {string} secondAnswer
 * @returns {string}
 */
const faqFixture = (firstAnswer, secondAnswer) => `<article>
<h2>Întrebări frecvente</h2>
<h3>Prima întrebare?</h3>
<p>Răspunsul unu este vizibil aici.</p>
<h3>A doua întrebare?</h3>
<p>Răspunsul doi este vizibil aici.</p>
</article>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "Prima întrebare?", acceptedAnswer: { "@type": "Answer", text: firstAnswer } },
    { "@type": "Question", name: "A doua întrebare?", acceptedAnswer: { "@type": "Answer", text: secondAnswer } },
  ],
})}
</script>`;

/**
 * Minimal page used to prove HowTo text must sit inside its own step.
 * @param {string} firstText
 * @param {string} secondText
 * @returns {string}
 */
const howtoFixture = (firstText, secondText) => `<article>
<h2>Pașii, pe rând</h2>
<h3>1. Alege domeniul</h3>
<p>Alege o adresă care conține denumirea cabinetului.</p>
<p>Mai sunt și alte propoziții în această secțiune.</p>
<h3>2. Alege hostingul</h3>
<p>Alege un serviciu de găzduire cu certificat SSL.</p>
<script type="application/ld+json">{"@type":"HowTo","step":[{"text":"nu contează"}]}</script>
</article>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HowTo",
  step: [
    { "@type": "HowToStep", name: "Alege domeniul", text: firstText },
    { "@type": "HowToStep", name: "Alege hostingul", text: secondText },
  ],
})}
</script>`;

test("every blog post has one JSON-LD block whose FAQ and HowTo match the visible page", () => {
  const files = blogPostFiles();
  assert.ok(files.length >= 50, `expected blog posts, found ${files.length}`);

  const failures = [];
  let postsWithFaq = 0;

  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    const rel = path.relative(path.join(__dirname, ".."), file);
    const blocks = jsonLdBlocks(html);

    if (blocks.length !== 1) {
      failures.push(`${rel}: expected exactly 1 JSON-LD block, found ${blocks.length}`);
      continue;
    }

    let data = null;
    try {
      data = JSON.parse(blocks[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${rel}: JSON-LD did not parse: ${message}`);
      continue;
    }

    for (const node of nodesOf(data)) {
      if (!node || typeof node !== "object") continue;

      if (node["@type"] === "Article" && !node.image) {
        failures.push(`${rel}: Article JSON-LD has no image`);
      }

      if (node["@type"] === "FAQPage" && Array.isArray(node.mainEntity)) {
        postsWithFaq += 1;
        const mismatches = faqPairMismatches(faqPairsFromNode(node), extractVisibleFaqPairs(html));
        mismatches.forEach((message) => failures.push(`${rel}: ${message}`));
      }

      if (node["@type"] === "HowTo" && Array.isArray(node.step) && node.step.length > 0) {
        const mismatches = howtoMismatches(html, node.step);
        mismatches.forEach((message) => failures.push(`${rel}: ${message}`));
      }
    }
  }

  assert.ok(postsWithFaq > 0, "Expected at least one post with FAQPage schema");
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(DEFAULT_ARTICLE_IMAGE, "https://solon.agency/assets/img/solon-metaimage.png");
});

test("swapped FAQ answers fail and paired answers pass", () => {
  const paired = faqFixture(
    "Răspunsul unu este vizibil aici.",
    "Răspunsul doi este vizibil aici."
  );
  const swapped = faqFixture(
    "Răspunsul doi este vizibil aici.",
    "Răspunsul unu este vizibil aici."
  );
  const pairedNode = JSON.parse(jsonLdBlocks(paired)[0]);
  const swappedNode = JSON.parse(jsonLdBlocks(swapped)[0]);

  assert.deepEqual(faqPairMismatches(faqPairsFromNode(pairedNode), extractVisibleFaqPairs(paired)), []);
  const mismatches = faqPairMismatches(faqPairsFromNode(swappedNode), extractVisibleFaqPairs(swapped));
  assert.ok(mismatches.some((message) => message.includes("its own visible answer")));
});

test("HowTo step text must be quoted inside its own section, in heading order", () => {
  const quoted = howtoFixture(
    "Alege o adresă care conține denumirea cabinetului.",
    "Alege un serviciu de găzduire cu certificat SSL."
  );
  const swapped = howtoFixture(
    "Alege un serviciu de găzduire cu certificat SSL.",
    "Alege o adresă care conține denumirea cabinetului."
  );
  const summarized = howtoFixture(
    "Alege un domeniu scurt pentru cabinet.",
    "Alege hosting în Uniunea Europeană."
  );
  const quotedSteps = JSON.parse(jsonLdBlocks(quoted).at(-1)).step;
  const swappedSteps = JSON.parse(jsonLdBlocks(swapped).at(-1)).step;
  const summarizedSteps = JSON.parse(jsonLdBlocks(summarized).at(-1)).step;

  assert.deepEqual(howtoMismatches(quoted, quotedSteps), []);
  const swappedFailures = howtoMismatches(swapped, swappedSteps);
  assert.equal(swappedFailures.length, 2);
  assert.ok(swappedFailures.every((message) => message.includes("word for word")));
  const summaryFailures = howtoMismatches(summarized, summarizedSteps);
  assert.ok(summaryFailures.some((message) => message.includes("word for word")));
});
