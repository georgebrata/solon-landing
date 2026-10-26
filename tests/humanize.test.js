"use strict";

/**
 * Proves that humanize.js rule 8 does not alter blog post prose containing:
 *   - semicolons before lowercase letters (valid Romanian punctuation)
 *   - en-dashes (–) used in numeric ranges (300–1.000 €)
 *   - FAQ section text (must stay byte-identical to its JSON-LD counterpart)
 *
 * Before the fix, rule 8 converted ; → . and – → " - ", causing "lowercase after
 * period" typos and drift between visible FAQ text and FAQPage JSON-LD schema.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  HUMANIZE_SKIP_FILENAMES,
  humanizeMarkdown,
  SKIP_LEGAL_CLEARED_LOG_PREFIX,
} = require("../scripts/humanize.js");

const FIXTURE = `---
title: "Test: semicolons, en-dashes, FAQ"
date: "2026-01-01"
slug: "test-semicolons-en-dashes-faq"
description: "Fixture for humanize rule-8 regression test."
categories: ["test"]
tags: ["test"]
---

# Test Post

Scopul acestui ghid este să te ajute; prezentăm doar intervale publice de pe piață.

Prețurile pornesc de la 300–1.000 € la un freelancer și ajung la 1.500–3.500 € la o agenție.

Costurile recurente includ găzduirea (200–2.000 lei/an) și domeniul (60–150 lei/an).

Regulile profesiei influențează ce conținut poate apărea pe site; le tratăm separat.

## Întrebări frecvente

### Cât costă un site de avocat?

Depinde de numărul de pagini, de conținut, de SEO și de mentenanță. Prețurile publicate în 2026 pornesc de la câteva sute de euro la un freelancer și de la 900 € la o agenție mică. Site-urile cu design personalizat se plasează de regulă în intervalul 1.500–3.500 €. Intervalele și sursele sunt prezentate în articol.

### De ce diferă atât de mult prețurile?

Ofertele nu descriu același produs; diferențele vin din design, numărul de pagini, cine scrie textele și nivelul de SEO.

## Vrei să afli mai multe?

Contactează-ne pentru o consultanță gratuită.

---

Materialul are caracter informativ; prețurile citate pot fi modificate.
`;

test("humanize.js rule 8: semicolons, en-dashes and FAQ text pass through unchanged", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-test-"));
  const fixturePath = path.join(tmpDir, "test-post.md");

  try {
    fs.writeFileSync(fixturePath, FIXTURE, "utf8");

    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", tmpDir, "--dry-run"],
      { encoding: "utf8" }
    );

    assert.match(output, /No humanizing changes found/);
    assert.equal(fs.readFileSync(fixturePath, "utf8"), FIXTURE);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const ASTFEL_FRONTMATTER = `---
title: "Test: astfel încât"
date: "2026-01-01"
slug: "test-astfel-incat"
description: "Fixture for the astfel încât rule."
categories: ["test"]
tags: ["test"]
---

`;

/**
 * Runs humanize.js in write mode against one temporary post.
 * @param {string} markdown
 * @param {number} [runs]
 * @returns {{text: string, outputs: string[]}}
 */
const humanizePost = (markdown, runs = 1) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-astfel-"));
  const fixturePath = path.join(tmpDir, "test-post.md");
  const outputs = [];

  try {
    fs.writeFileSync(fixturePath, markdown, "utf8");
    for (let run = 0; run < runs; run += 1) {
      outputs.push(
        execFileSync(
          process.execPath,
          [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", tmpDir],
          { encoding: "utf8" }
        )
      );
    }
    return { text: fs.readFileSync(fixturePath, "utf8"), outputs };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

test("humanize.js rewrites only «astfel încât să» and leaves the broken shapes untouched", () => {
  const source = `${ASTFEL_FRONTMATTER}Structurează pagina astfel încât cabinetul să apară în rezultate.

Textele sunt formulate astfel încât să rămână clare.

Optimizează conținutului astfel încât ChatGPT, Gemini, Perplexity și Claude să îl poată cita.

Astfel încât să rămână lizibil, păstrează propozițiile scurte.

Păstrează în așa fel încât clientul să înțeleagă termenii.

Alege așa încât dosarul să rămână complet.

Pregătește documentele pentru ca secretariatul să opereze fără întârzieri.
`;
  const expected = `${ASTFEL_FRONTMATTER}Structurează pagina astfel încât cabinetul să apară în rezultate.

Textele sunt formulate ca să rămână clare.

Optimizează conținutului astfel încât ChatGPT, Gemini, Perplexity și Claude să îl poată cita.

Ca să rămână lizibil, păstrează propozițiile scurte.

Păstrează în așa fel încât clientul să înțeleagă termenii.

Alege așa încât dosarul să rămână complet.

Pregătește documentele pentru ca secretariatul să opereze fără întârzieri.
`;

  const { text, outputs } = humanizePost(source, 2);

  assert.equal(text, expected);
  assert.match(outputs[0], /Transforma «astfel incat sa»: 2/u);
  assert.match(outputs[1], /No humanizing changes found/u);
  assert.doesNotMatch(text, /ca să să/u);
  assert.doesNotMatch(text, /ca să cabinetul să/u);
  assert.doesNotMatch(text, /ca să ChatGPT/u);
});

const LEGAL_CITATION_FIXTURE = `---
title: "Test: legal citations"
date: "2026-01-01"
slug: "test-legal-citations"
description: "Fixture for legal citation burstiness protection."
categories: ["test"]
tags: ["test"]
---

# Test

Devii implementator al unui sistem AI (art. 3 pct. 4). Separat, obligații proprii (art. 51–55). Transparență din art. 50, din 2 august 2026. Alfabetizare (art. 4) și, după caz, transparență. E evident (art. 50 alin. (1) și (5)). Supraveghere (art. 26 alin. (2)). Sancțiuni din art. 50, și până la 7,5 milioane. Regulamentul (UE) 2024/1689 se aplică direct.

Atenție: regulamentul nu cere marcarea fiecărui e-mail.

Îl modifici substanțial sau îl schimbi scopul pentru sistemele cu risc ridicat folosite de furnizor și implementator.
`;

test("humanize.js does not split or rewrite EU AI Act legal citations and terms", () => {
  const { text, outputs } = humanizePost(LEGAL_CITATION_FIXTURE, 2);

  assert.equal(text, LEGAL_CITATION_FIXTURE);
  assert.match(outputs[0], /No humanizing changes found/u);
  assert.match(outputs[1], /No humanizing changes found/u);
  assert.doesNotMatch(text, /\(art\.\s*\n\n/iu);
  assert.match(text, /modifici substanțial/u);
  assert.match(text, /Atenție: regulamentul/u);
});

test("humanize.js leaves similar connectors untouched and is stable on a second run", () => {
  const source = `${ASTFEL_FRONTMATTER}Formulează clauzele în așa fel încât să rămână aplicabile.

Redactează așa încât să poată fi verificate.

Stabilește pașii pentru ca echipa să poată relua dosarul.

Notează încât sensul să rămână același.
`;

  const first = humanizePost(source, 1);
  const second = humanizePost(first.text, 1);

  assert.equal(first.text, source);
  assert.match(first.outputs[0], /No humanizing changes found/u);
  assert.equal(second.text, first.text);
  assert.match(second.outputs[0], /No humanizing changes found/u);
});

const SKIP_LISTED_FILENAME = "proiect-modificare-legea-51-1995-website-avocat.md";

const JARGON_FIXTURE = `---
title: "Skip list fixture"
date: "2026-01-01"
slug: "skip-list-fixture"
description: "Humanize jargon probe."
categories: ["test"]
tags: ["test"]
---

Paragraf scurt cu tehnologia utilizată în propunere și suportul utilizat în text.
`;

test("humanize.js exports skip set and humanizeMarkdown rewrites jargon in memory", () => {
  assert.equal(HUMANIZE_SKIP_FILENAMES.has(SKIP_LISTED_FILENAME), true);
  assert.equal(HUMANIZE_SKIP_FILENAMES.has("viteza-website-avocat.md"), true);
  const { updated, counts } = humanizeMarkdown(JARGON_FIXTURE);
  assert.ok(counts.size > 0);
  assert.doesNotMatch(updated, /utilizată/u);
  assert.doesNotMatch(updated, /utilizat/u);
});

test("humanize.js skips legal-cleared post filenames byte-for-byte and logs each skip", () => {
  const source = JARGON_FIXTURE;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-skip-"));
  const listedPath = path.join(tmpDir, SKIP_LISTED_FILENAME);

  try {
    fs.writeFileSync(listedPath, source, "utf8");
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", tmpDir],
      { encoding: "utf8" },
    );
    assert.match(output, new RegExp(`${SKIP_LEGAL_CLEARED_LOG_PREFIX} ${SKIP_LISTED_FILENAME}`, "u"));
    assert.match(output, /No humanizing changes found/u);
    assert.equal(fs.readFileSync(listedPath, "utf8"), source);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file on a skip-listed basename exits 0 with one skip log line", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-skip-file-"));
  const listedPath = path.join(tmpDir, SKIP_LISTED_FILENAME);

  try {
    fs.writeFileSync(listedPath, JARGON_FIXTURE, "utf8");
    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../scripts/humanize.js"),
        "--posts-dir",
        tmpDir,
        "--file",
        SKIP_LISTED_FILENAME,
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      output.trim(),
      `${SKIP_LEGAL_CLEARED_LOG_PREFIX} ${SKIP_LISTED_FILENAME}`,
    );
    assert.equal(fs.readFileSync(listedPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js still humanizes unlisted post sources", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-skip-other-"));
  const otherPath = path.join(tmpDir, "unlisted-jargon-probe.md");

  try {
    fs.writeFileSync(otherPath, JARGON_FIXTURE, "utf8");
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", tmpDir],
      { encoding: "utf8" },
    );
    assert.match(output, /updated unlisted-jargon-probe\.md/u);
    const updated = fs.readFileSync(otherPath, "utf8");
    assert.notEqual(updated, JARGON_FIXTURE);
    assert.doesNotMatch(updated, /utilizată/u);
    assert.doesNotMatch(updated, /utilizat/u);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
