"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const indexnow = require(path.join(ROOT, "scripts/indexnow.js"));

const CURRENT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  "    <url>",
  "        <loc>https://solon.agency/</loc>",
  "        <lastmod>2026-10-01</lastmod>",
  "        <priority>1.00</priority>",
  "    </url>",
  "    <url>",
  "        <loc>https://solon.agency/blog/foo/</loc>",
  "        <lastmod>2026-10-08</lastmod>",
  "        <priority>0.50</priority>",
  "    </url>",
  "    <url>",
  "        <loc>https://solon.agency/terms/</loc>",
  "        <lastmod>2026-10-02</lastmod>",
  "        <priority>0.20</priority>",
  "    </url>",
  "</urlset>",
  "",
].join("\n");

const TERMS_BLOCK = [
  "    <url>",
  "        <loc>https://solon.agency/terms/</loc>",
  "        <lastmod>2026-10-02</lastmod>",
  "        <priority>0.20</priority>",
  "    </url>",
  "",
].join("\n");

const PREVIOUS = CURRENT
  .replace("<lastmod>2026-10-08</lastmod>", "<lastmod>2026-10-01</lastmod>")
  .replace(TERMS_BLOCK, "");

const sha = (digit) => digit.repeat(40);

/**
 * @param {string} line
 * @returns {string}
 */
const quietLog = (line) => {
  return line;
};

/**
 * @param {number} status
 * @param {string} body
 * @returns {{ status: number, text: function }}
 */
const httpResponse = (status, body) => ({
  status,
  text: () => Promise.resolve(body),
});

test("html paths map to canonical sitemap URLs", () => {
  assert.equal(indexnow.htmlFileToUrl("index.html"), "https://solon.agency/");
  assert.equal(indexnow.htmlFileToUrl("./index.html"), "https://solon.agency/");
  assert.equal(
    indexnow.htmlFileToUrl("blog/foo/index.html"),
    "https://solon.agency/blog/foo/"
  );
  assert.equal(
    indexnow.htmlFileToUrl("terms/index.html"),
    "https://solon.agency/terms/"
  );
  assert.equal(
    indexnow.htmlFileToUrl("newsletter.html"),
    "https://solon.agency/newsletter.html"
  );
  assert.equal(indexnow.htmlFileToUrl("assets/css/style.css"), "");
  assert.equal(indexnow.htmlFileToUrl("../index.html"), "");
  assert.equal(indexnow.htmlFileToUrl("sitemap.xml"), "");
});

test("changed HTML is kept only when the canonical URL is in the sitemap", () => {
  const urls = indexnow.selectChangedUrls({
    changedFiles: [
      "index.html",
      "blog/foo/index.html",
      "404.html",
      "newsletter.html",
      "templates/layout.html",
    ],
    sitemapChanged: false,
    previousSitemap: null,
    currentSitemap: CURRENT,
  });
  assert.deepEqual(urls, [
    "https://solon.agency/",
    "https://solon.agency/blog/foo/",
  ]);
});

test("sitemap adds and lastmod edits are included with HTML changes", () => {
  const urls = indexnow.selectChangedUrls({
    changedFiles: ["index.html"],
    sitemapChanged: true,
    previousSitemap: PREVIOUS,
    currentSitemap: CURRENT,
  });
  assert.deepEqual(urls, [
    "https://solon.agency/",
    "https://solon.agency/blog/foo/",
    "https://solon.agency/terms/",
  ]);
});

test("a sitemap lastmod edit is ignored when sitemap.xml is not in the diff", () => {
  const urls = indexnow.selectChangedUrls({
    changedFiles: ["terms/index.html"],
    sitemapChanged: false,
    previousSitemap: PREVIOUS,
    currentSitemap: CURRENT,
  });
  assert.deepEqual(urls, ["https://solon.agency/terms/"]);
});

test("name-status maps renames and skips deletions", () => {
  const parsed = indexnow.parseNameStatus([
    "M\tindex.html",
    "A\tblog/foo/index.html",
    "D\told/index.html",
    "R100\tterms/old/index.html\tterms/index.html",
    "M\tsitemap.xml",
    "M\tassets/css/style.css",
  ].join("\n"));
  assert.deepEqual(parsed.files, [
    "index.html",
    "blog/foo/index.html",
    "terms/index.html",
  ]);
  assert.equal(parsed.sitemapChanged, true);
});

test("zero or missing before SHA skips without calling git", () => {
  let calls = 0;
  const urls = indexnow.collectChangedUrls({
    before: sha("0"),
    sha: sha("a"),
    currentSitemap: CURRENT,
    gitRunner: () => {
      calls += 1;
      return null;
    },
    log: quietLog,
  });
  assert.equal(calls, 0);
  assert.deepEqual(urls, []);
  assert.equal(indexnow.isUsableSha(""), false);
  assert.equal(indexnow.isUsableSha(sha("0")), false);
  assert.equal(indexnow.isUsableSha(sha("b")), true);
});

test("an unreachable before SHA falls back to sitemap lastmod changes", () => {
  const logs = [];
  const urls = indexnow.collectChangedUrls({
    before: sha("a"),
    sha: sha("b"),
    currentSitemap: CURRENT,
    gitRunner: (args) => {
      if (args[0] === "diff") return null;
      if (args[0] === "show") return PREVIOUS;
      return null;
    },
    log: (line) => logs.push(line),
  });
  assert.deepEqual(urls, [
    "https://solon.agency/blog/foo/",
    "https://solon.agency/terms/",
  ]);
  assert.ok(logs.some((line) => line.includes("falling back")));
});

test("force-push with no previous sitemap skips", () => {
  const urls = indexnow.collectChangedUrls({
    before: sha("a"),
    sha: sha("b"),
    currentSitemap: CURRENT,
    gitRunner: () => null,
    log: quietLog,
  });
  assert.deepEqual(urls, []);
});

test("a readable diff unions HTML urls and sitemap edits", () => {
  const nameStatus = "M\tindex.html\nM\tsitemap.xml\n";
  const urls = indexnow.collectChangedUrls({
    before: sha("a"),
    sha: sha("b"),
    currentSitemap: CURRENT,
    gitRunner: (args) => {
      if (args[0] === "diff") return nameStatus;
      if (args[0] === "show") return PREVIOUS;
      return null;
    },
    log: quietLog,
  });
  assert.deepEqual(urls, [
    "https://solon.agency/",
    "https://solon.agency/blog/foo/",
    "https://solon.agency/terms/",
  ]);
});

test("payload batches stay at or under 10000 URLs", async () => {
  const calls = [];
  const urls = Array.from({ length: indexnow.BATCH_SIZE + 1 }, (_item, index) => (
    `https://solon.agency/p${index}/`
  ));
  const key = "a".repeat(32);
  const statusCodes = await indexnow.submitUrlList({
    urls,
    key,
    batchSize: indexnow.BATCH_SIZE,
    log: quietLog,
    fetchImpl: (endpoint, request) => {
      assert.ok(request.signal instanceof AbortSignal);
      calls.push({ endpoint, body: JSON.parse(request.body), method: request.method });
      return Promise.resolve(httpResponse(200, "{\"ok\":true}"));
    },
  });
  assert.deepEqual(statusCodes, [200, 200]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endpoint, indexnow.INDEXNOW_ENDPOINT);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.host, "solon.agency");
  assert.equal(calls[0].body.key, key);
  assert.equal(calls[0].body.keyLocation, `https://solon.agency/${key}.txt`);
  assert.equal(calls[0].body.urlList.length, indexnow.BATCH_SIZE);
  assert.equal(calls[1].body.urlList.length, 1);
  assert.ok(calls[0].body.urlList.length <= 10000);
});

test("HTTP 4xx responses are warnings and do not throw", async () => {
  const logs = [];
  const warnings = [];
  const statusCodes = await indexnow.submitUrlList({
    urls: ["https://solon.agency/"],
    key: "b".repeat(32),
    log: (line) => {
      logs.push(String(line));
      return line;
    },
    warn: (line) => {
      warnings.push(String(line));
      return line;
    },
    fetchImpl: () => Promise.resolve(httpResponse(422, "invalid")),
  });
  assert.deepEqual(statusCodes, [422]);
  assert.ok(logs.includes("IndexNow status 422"));
  assert.ok(logs.includes("invalid"));
  assert.deepEqual(warnings, ["IndexNow warning: HTTP 422"]);
});

test("a thrown fetch is reported and resolved", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-indexnow-"));
  const key = "c".repeat(32);
  fs.writeFileSync(path.join(dir, `${key}.txt`), key);
  fs.writeFileSync(path.join(dir, "sitemap.xml"), CURRENT);
  const logs = [];
  const result = await indexnow.runIndexNow({
    all: true,
    root: dir,
    log: (line) => logs.push(String(line)),
    fetchImpl: () => {
      throw new Error("network down");
    },
  });
  assert.equal(result.error, "network down");
  assert.equal(result.submitted, 0);
  assert.ok(logs.some((line) => line.includes("IndexNow error: network down")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a timed-out IndexNow request is logged and resolves", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-indexnow-timeout-"));
  const key = "e".repeat(32);
  fs.writeFileSync(path.join(dir, `${key}.txt`), key);
  fs.writeFileSync(path.join(dir, "sitemap.xml"), CURRENT);
  const logs = [];
  const result = await indexnow.runIndexNow({
    all: true,
    root: dir,
    log: (line) => {
      logs.push(String(line));
      return line;
    },
    fetchImpl: (endpoint, request) => {
      assert.equal(endpoint, indexnow.INDEXNOW_ENDPOINT);
      assert.equal(indexnow.REQUEST_TIMEOUT_MS, 15000);
      assert.ok(request.signal instanceof AbortSignal);
      const timeout = new Error("The operation was aborted due to timeout");
      timeout.name = "TimeoutError";
      return Promise.reject(timeout);
    },
  });
  assert.equal(result.submitted, 0);
  assert.equal(result.error, "The operation was aborted due to timeout");
  assert.ok(logs.some((line) => line.includes("timed out after 15000ms")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("mode all dry-run lists every sitemap loc and does not POST", async () => {
  let fetched = false;
  const result = await indexnow.runIndexNow({
    all: true,
    dryRun: true,
    root: ROOT,
    log: quietLog,
    fetchImpl: () => {
      fetched = true;
      return Promise.resolve(httpResponse(200, ""));
    },
  });
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  assert.equal(fetched, false);
  assert.deepEqual(result.urls, locs);
  assert.equal(result.submitted, 0);
  assert.ok(result.urls.includes("https://solon.agency/"));
  assert.ok(result.urls.every((url) => url.startsWith("https://solon.agency/")));
});

test("an empty diff skips the POST", async () => {
  let fetched = false;
  const result = await indexnow.runIndexNow({
    before: sha("a"),
    sha: sha("b"),
    root: ROOT,
    log: quietLog,
    gitRunner: () => "",
    fetchImpl: () => {
      fetched = true;
      return Promise.resolve(httpResponse(200, ""));
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(result.urls, []);
  assert.equal(result.submitted, 0);
});

test("the committed key file is exactly 32 hex chars and is not in the sitemap", () => {
  const names = fs.readdirSync(ROOT).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
  assert.deepEqual(names, ["23897578dc538f267009bf3fbf12e684.txt"]);
  const keyPath = path.join(ROOT, names[0]);
  const bytes = fs.readFileSync(keyPath);
  const key = names[0].slice(0, -4);
  assert.equal(bytes.length, 32);
  assert.equal(bytes.toString("utf8"), key);
  assert.equal(bytes.includes(10), false);
  assert.equal(bytes.includes(13), false);
  const found = indexnow.readIndexNowKey(ROOT);
  assert.deepEqual(found, { key, fileName: names[0] });
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  assert.equal(sitemap.includes(key), false);
  assert.equal(sitemap.includes(`${key}.txt`), false);
});

test("a key file with a trailing newline is ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-indexnow-key-"));
  fs.writeFileSync(path.join(dir, `${"d".repeat(32)}.txt`), `${"d".repeat(32)}\n`);
  assert.equal(indexnow.readIndexNowKey(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("FTP exclude does not drop the IndexNow key file", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/main.yml"), "utf8");
  const marker = "exclude: |";
  const start = workflow.indexOf(marker);
  assert.ok(start !== -1);
  const excludeLines = [];
  const rest = workflow.slice(start + marker.length).split("\n");
  for (const line of rest) {
    if (line.trim() === "") continue;
    if (!line.startsWith("            ")) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) excludeLines.push(trimmed);
  }
  assert.ok(excludeLines.length > 5);
  const keyName = "23897578dc538f267009bf3fbf12e684.txt";
  excludeLines.forEach((pattern) => {
    const bare = pattern.startsWith("!") ? pattern.slice(1) : pattern;
    assert.equal(bare.includes("*.txt"), false, pattern);
    assert.equal(bare.endsWith(".txt"), false, pattern);
    assert.equal(bare === keyName, false, pattern);
  });
  assert.match(workflow, /needs:\s*deploy/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /if:\s*success\(\)/);
  assert.match(workflow, /node scripts\/indexnow\.js/);

  const manual = fs.readFileSync(path.join(ROOT, ".github/workflows/indexnow.yml"), "utf8");
  assert.match(manual, /workflow_dispatch:/);
  assert.match(manual, /node scripts\/indexnow\.js --all/);
});
