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
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  HUMANIZE_SKIP_FILENAMES,
  humanizeFiles,
  humanizeMarkdown,
  isPathInsideRealPostsDir,
  resolveRealPostsDir,
} = require("../scripts/humanize.js");

/** @param {string} filename */
const skippedLegalClearedLogLine = (filename) => `${filename}: skipped (legal-cleared)`;

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

test("requiring humanize.js does not read from the filesystem", () => {
  const fs = require("node:fs");
  const originalReaddir = fs.readdirSync;
  let readdirCallsDuringRequire = 0;
  fs.readdirSync = (...args) => {
    readdirCallsDuringRequire += 1;
    return originalReaddir(...args);
  };

  try {
    const resolved = require.resolve("../scripts/humanize.js");
    delete require.cache[resolved];
    require("../scripts/humanize.js");
    assert.equal(readdirCallsDuringRequire, 0);
  } finally {
    fs.readdirSync = originalReaddir;
  }
});

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
    assert.ok(output.includes(`${skippedLegalClearedLogLine(SKIP_LISTED_FILENAME)}\n`));
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
    assert.equal(output, `${skippedLegalClearedLogLine(SKIP_LISTED_FILENAME)}\n`);
    assert.equal(fs.readFileSync(listedPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file on a missing skip-listed basename exits 1 with stderr only", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-skip-missing-"));

  try {
    const result = spawnSync(
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
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Nu pot procesa fișierul/u);
    assert.match(result.stderr, /nu l-am găsit/u);
    assert.match(result.stderr, new RegExp(SKIP_LISTED_FILENAME));
    assert.ok(result.stderr.includes(tmpDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file normalizes nested paths to basename", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-skip-basename-"));
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
        `blog/posts/${SKIP_LISTED_FILENAME}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(output, `${skippedLegalClearedLogLine(SKIP_LISTED_FILENAME)}\n`);
    assert.equal(fs.readFileSync(listedPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/** @param {string} tmpDir @param {string} fileArg @param {RegExp} stderrPattern */
const assertHumanizeFileRejected = (tmpDir, fileArg, stderrPattern) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/humanize.js"),
      "--posts-dir",
      tmpDir,
      "--file",
      fileArg,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, stderrPattern);
  assert.ok(result.stderr.includes(fileArg));
  assert.ok(result.stderr.includes(tmpDir));
  assert.doesNotMatch(result.stderr, /EISDIR/u);
};

test("humanize.js --file rejects .generation-log.jsonl with not-md error", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-file-jsonl-"));

  try {
    fs.writeFileSync(path.join(tmpDir, ".generation-log.jsonl"), "{}\n", "utf8");
    assertHumanizeFileRejected(tmpDir, ".generation-log.jsonl", /nu este \.md\./u);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file rejects . without EISDIR", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-file-dot-"));

  try {
    assertHumanizeFileRejected(tmpDir, ".", /Nu pot procesa fișierul \. din/u);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file rejects .. without EISDIR", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-file-dotdot-"));

  try {
    assertHumanizeFileRejected(tmpDir, "..", /Nu pot procesa fișierul \.\. din/u);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file rejects uppercase .MD extension", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-file-upper-md-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "uppercase-post.MD"), JARGON_FIXTURE, "utf8");
    assertHumanizeFileRejected(tmpDir, "uppercase-post.MD", /nu este \.md\./u);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file does not follow a symlinked .md outside postsDir", () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-outside-"));
  const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-symlink-file-"));
  const outsidePath = path.join(outsideDir, "outside-target.md");
  const linkName = "linked-outside.md";

  try {
    fs.writeFileSync(outsidePath, JARGON_FIXTURE, "utf8");
    fs.symlinkSync(outsidePath, path.join(postsDir, linkName));
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "../scripts/humanize.js"),
        "--posts-dir",
        postsDir,
        "--file",
        linkName,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /legătură simbolică/u);
    assert.match(result.stderr, /Nu pot procesa fișierul/u);
    assert.ok(result.stderr.includes(linkName));
    assert.ok(result.stderr.includes(postsDir));
    assert.equal(fs.readFileSync(outsidePath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(postsDir, { recursive: true, force: true });
  }
});

test("humanize.js full-folder run does not follow a symlinked .md outside postsDir", () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-outside-batch-"));
  const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-symlink-batch-"));
  const outsidePath = path.join(outsideDir, "outside-batch.md");
  const linkName = "linked-batch.md";
  const localPath = path.join(postsDir, "local-jargon-probe.md");

  try {
    fs.writeFileSync(outsidePath, JARGON_FIXTURE, "utf8");
    fs.symlinkSync(outsidePath, path.join(postsDir, linkName));
    fs.writeFileSync(localPath, JARGON_FIXTURE, "utf8");
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", postsDir],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /legătură simbolică/u);
    assert.match(result.stderr, /Nu pot procesa fișierul/u);
    assert.ok(result.stderr.includes(linkName));
    assert.equal(fs.readFileSync(outsidePath, "utf8"), JARGON_FIXTURE);
    assert.notEqual(fs.readFileSync(localPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(postsDir, { recursive: true, force: true });
  }
});

test("humanize.js full-folder run skips a directory named like a .md file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-dir-md-"));
  const dirAsMd = path.join(tmpDir, "fake-post.md");

  try {
    fs.mkdirSync(dirAsMd);
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", tmpDir],
      { encoding: "utf8" },
    );
    assert.match(result.stderr, /fake-post\.md din .* nu este fișier regulat; îl sar/u);
    assert.doesNotMatch(result.stderr, /EISDIR/u);
    assert.equal(result.status, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js --file succeeds when postsDir is reached through a symlink", () => {
  const realPostsDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-real-posts-"));
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-posts-wrapper-"));
  const postsLink = path.join(wrapperDir, "posts-link");
  const targetPath = path.join(realPostsDir, "via-symlink-postsdir.md");

  try {
    fs.symlinkSync(realPostsDir, postsLink);
    fs.writeFileSync(targetPath, JARGON_FIXTURE, "utf8");
    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../scripts/humanize.js"),
        "--posts-dir",
        postsLink,
        "--file",
        "via-symlink-postsdir.md",
      ],
      { encoding: "utf8" },
    );
    assert.match(output, /updated via-symlink-postsdir\.md/u);
    assert.notEqual(fs.readFileSync(targetPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(wrapperDir, { recursive: true, force: true });
    fs.rmSync(realPostsDir, { recursive: true, force: true });
  }
});

test("humanize.js full-folder run humanizes posts when postsDir is reached through a symlink", () => {
  const realPostsDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-real-batch-"));
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-batch-wrapper-"));
  const postsLink = path.join(wrapperDir, "posts-link");
  const targetPath = path.join(realPostsDir, "batch-via-symlink-postsdir.md");

  try {
    fs.symlinkSync(realPostsDir, postsLink);
    fs.writeFileSync(targetPath, JARGON_FIXTURE, "utf8");
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, "../scripts/humanize.js"), "--posts-dir", postsLink],
      { encoding: "utf8" },
    );
    assert.match(output, /updated batch-via-symlink-postsdir\.md/u);
    assert.notEqual(fs.readFileSync(targetPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(wrapperDir, { recursive: true, force: true });
    fs.rmSync(realPostsDir, { recursive: true, force: true });
  }
});

test("humanizeFiles rewrites a pre-validated basename without re-classifying entries", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-files-api-"));
  const targetPath = path.join(tmpDir, "api-probe.md");

  try {
    fs.writeFileSync(targetPath, JARGON_FIXTURE, "utf8");
    humanizeFiles(["api-probe.md"], { postsDir: tmpDir, dryRun: false });
    assert.notEqual(fs.readFileSync(targetPath, "utf8"), JARGON_FIXTURE);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("humanize.js missing --posts-dir prints a clean error without a stack trace", () => {
  const missingDir = path.join(os.tmpdir(), `solon-humanize-missing-posts-${Date.now()}`);

  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/humanize.js"),
      "--posts-dir",
      missingDir,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Nu am găsit folderul de articole/u);
  assert.ok(result.stderr.includes(missingDir));
  assert.doesNotMatch(result.stderr, /ENOENT/u);
  assert.doesNotMatch(result.stderr, /\n\s+at /u);
});

test("isPathInsideRealPostsDir accepts files under the filesystem root postsDir", () => {
  const rootDir = path.parse(os.tmpdir()).root;
  const realRoot = resolveRealPostsDir(rootDir);
  const probePath = path.join(os.tmpdir(), `solon-humanize-root-prefix-${Date.now()}.md`);
  fs.writeFileSync(probePath, "probe\n", "utf8");
  try {
    const realFile = fs.realpathSync(probePath);
    assert.equal(isPathInsideRealPostsDir(realRoot, realFile), true);
  } finally {
    fs.rmSync(probePath, { force: true });
  }
});

test("isPathInsideRealPostsDir rejects a sibling directory that shares a path prefix", () => {
  const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-humanize-posts-"));
  const evilDir = `${postsDir}-evil`;
  const evilFile = path.join(evilDir, "x.md");

  try {
    fs.mkdirSync(evilDir);
    fs.writeFileSync(evilFile, JARGON_FIXTURE, "utf8");
    const realPosts = resolveRealPostsDir(postsDir);
    const realEvil = fs.realpathSync(evilFile);
    assert.equal(isPathInsideRealPostsDir(realPosts, realEvil), false);
  } finally {
    fs.rmSync(evilDir, { recursive: true, force: true });
    fs.rmSync(postsDir, { recursive: true, force: true });
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
