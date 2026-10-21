"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ROOT,
  applyShrink,
  assertBaselineShape,
  assertConfig,
  assertConfigRatchet,
  assertRatchet,
  collectServedHtml,
  diffBaseline,
  gateProblems,
  failValidation,
  handleCliError,
  HtmlValidationError,
  loadGitText,
  shouldValidate,
  validateServedHtml,
} = require("../scripts/validate-html");

const baseline = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "html-validate-baseline.json"), "utf8")
);

test("served HTML includes pages, posts, case studies, and short links", () => {
  const files = collectServedHtml(ROOT, baseline).map((file) =>
    path.relative(ROOT, file).split(path.sep).join("/")
  );
  assert.ok(files.length >= 100, `expected at least 100 served pages, found ${files.length}`);
  for (const required of [
    "index.html",
    "404.html",
    "500.html",
    "403.html",
    "newsletter.html",
    "blog/index.html",
    "studii-de-caz/index.html",
    "studii-de-caz/tslaw/index.html",
    "r/api/index.html",
    "onboarding/bronze/index.html",
  ]) {
    assert.ok(files.includes(required), `missing ${required}`);
  }
  assert.equal(
    files.includes("studii-de-caz/avocat-dumitrescu-alexandru/index.html"),
    false
  );
  assert.equal(files.includes("templates/layout.html"), false);
  assert.equal(
    files.some((file) => file.startsWith("assets/vendor/")),
    false
  );
});

test("templates, vendor files, and the held case study are not validated", () => {
  assert.equal(shouldValidate("templates/layout.html", baseline), false);
  assert.equal(shouldValidate("templates/post.html", baseline), false);
  assert.equal(shouldValidate("node_modules/html-validate/index.html", baseline), false);
  assert.equal(shouldValidate("assets/vendor/example.html", baseline), false);
  assert.equal(
    shouldValidate("studii-de-caz/avocat-dumitrescu-alexandru/index.html", baseline),
    false
  );
  assert.equal(shouldValidate("index.html", baseline), true);
  assert.equal(shouldValidate("r/bronze/lunar/index.html", baseline), true);
});

test("recommended rules stay at error with their defaults", async () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, ".htmlvalidate.json"), "utf8"));
  assert.deepEqual(await assertConfig(config), []);
  assert.deepEqual(
    await assertConfig({
      extends: ["html-validate:recommended"],
      rules: { "no-inline-style": "off", "no-trailing-whitespace": "off", "void-style": "off" },
    }),
    ["config disables no-inline-style; do not weaken html-validate rules"]
  );
  assert.deepEqual(
    await assertConfig({
      extends: ["html-validate:recommended"],
      rules: { "no-inline-style": "warn", "no-trailing-whitespace": "off", "void-style": "off" },
    }),
    ["config sets to warn no-inline-style; do not weaken html-validate rules"]
  );
  assert.ok(
    (await assertConfig({
      extends: ["html-validate:recommended"],
      rules: {
        "long-title": ["error", { maxlength: 300 }],
        "no-trailing-whitespace": "off",
        "void-style": "off",
      },
    })).some((message) => message.includes("long-title"))
  );
});

test("an empty exclusion list is valid and the Dumitrescu reason says fix", () => {
  assert.deepEqual(
    assertBaselineShape({ rules: {}, files: {}, excludedFiles: [] }, ROOT),
    []
  );
  assert.equal(baseline.excludedFiles[0].reason.includes("fix or baseline"), false);
  assert.match(baseline.excludedFiles[0].reason, /fix whatever is left/);
});

test("baseline fails when a finding is new, and a fixed finding does not free its slot", () => {
  const sample = {
    files: { "index.html": { "no-inline-style": ["style-a", "style-b"] } },
    rules: { "no-inline-style": "documented" },
    excludedFiles: [],
  };
  const same = diffBaseline({ "index.html": { "no-inline-style": ["style-a", "style-b"] } }, sample);
  assert.deepEqual(same.problems, []);
  assert.deepEqual(same.shrinkable, []);

  const gained = diffBaseline(
    { "index.html": { "no-inline-style": ["style-a", "style-b", "style-b"] } },
    sample
  );
  assert.equal(gained.problems[0].kind, "regression");

  const fresh = diffBaseline({ "blog/new/index.html": { "long-title": ["title"] } }, sample);
  assert.equal(fresh.problems[0].kind, "unexpected");

  const swapped = diffBaseline({ "index.html": { "no-inline-style": ["style-b", "style-c"] } }, sample);
  assert.equal(swapped.problems[0].kind, "unexpected");
  assert.equal(swapped.shrinkable[0].got, 0);
  assert.equal(gateProblems([], swapped.shrinkable, true)[0].kind, "leftover");
});

test("shrink only drops leftover occurrences", () => {
  const sample = {
    version: 1,
    rules: {
      "no-inline-style": "documented",
      "empty-heading": "documented",
    },
    files: {
      "index.html": { "no-inline-style": ["style-a", "style-b"] },
      "cookies/index.html": { "empty-heading": ["heading"] },
    },
  };
  const lowered = applyShrink(sample, { "index.html": { "no-inline-style": ["style-a"] } });
  assert.deepEqual(lowered.problems, []);
  assert.deepEqual(lowered.next.files, { "index.html": { "no-inline-style": ["style-a"] } });
  assert.deepEqual(lowered.next.rules, { "no-inline-style": "documented" });

  const raised = applyShrink(sample, { "index.html": { "no-inline-style": ["style-a", "style-b", "style-c"] } });
  assert.equal(raised.next, null);
  assert.equal(raised.problems[0].kind, "unexpected");

  const added = applyShrink(sample, {
    "index.html": { "no-inline-style": ["style-a", "style-b"] },
    "blog/new/index.html": { "long-title": ["title"] },
  });
  assert.equal(added.next, null);
  assert.equal(added.problems[0].kind, "unexpected");
});

test("a later baseline cannot rise above main or add an exclusion", () => {
  const onMain = {
    files: { "index.html": { "no-inline-style": ["style-a", "style-b"] } },
    excludedFiles: [{ file: "held.html", reason: "held" }],
  };
  assert.deepEqual(assertRatchet(null, onMain), []);
  assert.deepEqual(
    assertRatchet(onMain, { files: { "index.html": { "no-inline-style": ["style-a"] } }, excludedFiles: [] }),
    []
  );
  assert.equal(
    assertRatchet(onMain, { files: { "index.html": { "no-inline-style": ["style-a", "style-b", "style-c"] } } })[0].kind,
    "ratchet"
  );
  assert.equal(
    assertRatchet(onMain, { files: { "blog/new/index.html": { "long-title": ["title"] } } })[0].kind,
    "ratchet"
  );
  assert.equal(
    assertRatchet(onMain, {
      files: onMain.files,
      excludedFiles: [{ file: "held.html" }, { file: "extra.html" }],
    })[0].rule,
    "excluded"
  );
});

test("config options cannot loosen compared with main", () => {
  const onMain = { "long-title": [2, {}] };
  assert.deepEqual(assertConfigRatchet(null, onMain), []);
  assert.equal(
    assertConfigRatchet(onMain, { "long-title": [2, { maxlength: 300 }] })[0].kind,
    "ratchet"
  );
  assert.equal(assertConfigRatchet(onMain, { "long-title": [1, {}] })[0].kind, "ratchet");
});

test("git enumeration ignores untracked HTML and CI requires origin/main", () => {
  const probe = path.join(ROOT, "untracked-html-validate-probe.html");
  fs.writeFileSync(probe, "<!DOCTYPE html><html><body></body></html>\n");
  try {
    const files = collectServedHtml(ROOT, baseline).map((file) => path.basename(file));
    assert.equal(files.includes("untracked-html-validate-probe.html"), false);
  } finally {
    fs.unlinkSync(probe);
  }
  assert.equal(loadGitText(ROOT, "origin/main:data/html-validate-baseline.json", true), null);
  assert.throws(
    () => loadGitText(ROOT, "origin/does-not-exist:data/html-validate-baseline.json", true),
    /fetch origin\/main/
  );
  assert.equal(loadGitText(ROOT, "origin/does-not-exist:data/html-validate-baseline.json", false), null);
});

test("a missing origin/main ref prints its error, and a reported failure is not printed twice", () => {
  const lines = [];
  const original = console.error;
  console.error = (value) => {
    lines.push(String(value));
  };
  const previousCode = process.exitCode;
  try {
    handleCliError(new HtmlValidationError(
      "Could not read origin/main:data/html-validate-baseline.json. CI must fetch origin/main before HTML validation."
    ));
    assert.match(lines.join("\n"), /Could not read origin\/main/);
    assert.equal(process.exitCode, 1);

    lines.length = 0;
    process.exitCode = undefined;
    try {
      failValidation("HTML validation failed (1 served files).", []);
    } catch (error) {
      handleCliError(error);
    }
    assert.deepEqual(lines, ["HTML validation failed (1 served files)."]);
  } finally {
    console.error = original;
    process.exitCode = previousCode;
  }
});

test("every served page matches the HTML baseline", async () => {
  const result = await validateServedHtml(ROOT);
  assert.deepEqual(result.problems, []);
});
