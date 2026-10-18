"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  applyHtaccess,
  classifyShortLinks,
  mergeQuery,
  originalUrlHasApiKey,
  PAGE_MERGE,
  renderInner,
  renderPage,
  reservedFirstSegments,
  run,
  snapshotDocument,
} = require("../scripts/build-shortlinks");
const indexnow = require("../scripts/indexnow");
const { isExcludedFromSitemap, stripShortRedirectUrls } = require("../scripts/update-sitemap");

const ROOT = path.join(__dirname, "..");
const HTACCESS_HASH = "e0239483a7a8f483fef424f89e3f2fa138d06dce594a9ac84382941a72229ffc";
const HIT_FETCH = "fetch(H,{method:'POST',mode:'no-cors',keepalive:true,credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'hit',id:ID})}).catch(function(){})";
const PRIVACY_PARAGRAPH = "<p class=\"px-lg-5\"><strong>Linkuri scurte solon.agency.</strong> Când deschizi un link scurt de pe solon.agency, pagina de redirecționare trimite către Google Apps Script doar identificatorul public al linkului, ca să creștem un contor total de clicuri într-un tabel Google Sheets. Nu trimitem pagina de proveniență, parametrii din link, cookie-uri sau alți identificatori și nu păstrăm date despre tine, ci doar numărul total de clicuri pentru fiecare link. Google, ca persoană împuternicită, vede adresa IP a cererii, ca la orice conexiune la serverele sale. Temeiul este interesul nostru legitim de a ști de câte ori este folosit un link (art. 6 alin. (1) lit. f) RGPD).</p>";
const COOKIES_PARAGRAPH = "<p class=\"px-lg-5\">Linkurile scurte solon.agency nu folosesc cookie-uri și nu citesc nimic de pe dispozitivul tău; contorul de clicuri numără doar totalul pentru fiecare link.</p>";
const PUBLISHED_IDS = [
  "a3hb4931",
  "d1ea9ba3",
  "nfdajfds3",
  "dfsfsddf34",
  "9nr2323n",
  "de2nd432",
  "32d43dnc",
  "d234c439",
  "d3ejci334",
];
const SKIPPED_KEY_IDS = ["hu43hb44", "fdsk43244", "96t5n5434", "9fdsjfd04n"];

/**
 * @param {string} htaccess
 * @returns {string}
 */
function stripBlock(htaccess) {
  return htaccess.replace(/\n\n  # SHORTLINKS:START[\s\S]*?\n  # SHORTLINKS:END\n/u, "\n");
}

/**
 * @param {string} line
 * @returns {{ test: string, neg: boolean, pattern: string }}
 */
function parseCond(line) {
  const match = line.match(/^RewriteCond\s+(\S+)\s+(!)?(\S.*)$/u);
  assert.ok(match, line);
  return { test: match[1], neg: Boolean(match[2]), pattern: match[3] };
}

/**
 * @param {string} line
 * @returns {{ pattern: string, subst: string, flags: string }}
 */
function parseRule(line) {
  const match = line.match(/^RewriteRule\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]$/u);
  assert.ok(match, line);
  return { pattern: match[1], subst: match[2], flags: match[3] };
}

/**
 * @param {string} token
 * @param {{ accept: string, query: string, env: { SLQ: string } }} ctx
 * @returns {string}
 */
function lookup(token, ctx) {
  if (token === "%{HTTP:Accept}") return ctx.accept;
  if (token === "%{QUERY_STRING}") return ctx.query;
  if (token === "%{ENV:SLQ}") return ctx.env.SLQ;
  return "";
}

/**
 * @param {string} text
 * @param {{ accept: string, query: string, env: { SLQ: string } }} ctx
 * @param {string} capture
 * @returns {string}
 */
function expand(text, ctx, capture) {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\" && (text[index + 1] === "%" || text[index + 1] === "$")) {
      out += text[index + 1];
      index += 1;
      continue;
    }
    if (text.startsWith("%{QUERY_STRING}", index)) {
      out += ctx.query;
      index += "%{QUERY_STRING}".length - 1;
      continue;
    }
    if (text.startsWith("%{ENV:SLQ}", index)) {
      out += ctx.env.SLQ;
      index += "%{ENV:SLQ}".length - 1;
      continue;
    }
    if (text[index] === "%" && text[index + 1] === "1") {
      out += capture;
      index += 1;
      continue;
    }
    out += text[index];
  }
  return out;
}

/**
 * Small mod_rewrite emulator for the generated SHORTLINKS block.
 * @param {string} htaccess
 * @param {{ path: string, accept?: string, query?: string }} request
 * @returns {{ type: string, status?: number, location?: string, target?: string }}
 */
function emulateRewrite(htaccess, request) {
  const blockMatch = htaccess.match(/# SHORTLINKS:START([\s\S]*?)# SHORTLINKS:END/u);
  assert.ok(blockMatch, "shortlinks block missing");
  const lines = blockMatch[1].split("\n").map((line) => line.trim()).filter((line) => line.startsWith("Rewrite"));
  const ctx = {
    accept: request.accept == null ? "" : String(request.accept),
    query: request.query == null ? "" : String(request.query),
    env: { SLQ: "" },
  };
  const requestPath = String(request.path || "").replace(/^\//u, "");
  /** @type {{ test: string, neg: boolean, pattern: string }[]} */
  let conds = [];
  for (const line of lines) {
    if (line.startsWith("RewriteCond ")) {
      conds.push(parseCond(line));
      continue;
    }
    const rule = parseRule(line);
    let capture = "";
    let ok = true;
    conds.forEach((cond) => {
      if (!ok) return;
      const matched = new RegExp(cond.pattern).exec(lookup(cond.test, ctx));
      const hit = Boolean(matched);
      if (cond.neg ? hit : !hit) ok = false;
      else if (matched && matched[1] != null) capture = matched[1];
    });
    conds = [];
    if (!ok || !new RegExp(rule.pattern).test(requestPath)) continue;
    const envFlag = rule.flags.split(",").find((flag) => flag.startsWith("E="));
    if (envFlag) {
      const raw = envFlag.slice(2);
      const colon = raw.indexOf(":");
      ctx.env[raw.slice(0, colon)] = expand(raw.slice(colon + 1), ctx, capture);
    }
    const statusMatch = rule.flags.match(/(?:^|,)R=(\d+)/u);
    if (statusMatch) {
      return { type: "redirect", status: Number(statusMatch[1]), location: expand(rule.subst, ctx, capture) };
    }
    if (rule.flags.includes("L") && rule.subst !== "-") {
      return { type: "rewrite", target: expand(rule.subst, ctx, capture) };
    }
  }
  return { type: "none" };
}

/**
 * @param {{ id?: string, path: string, destination: string, status?: 301|302 }} link
 * @returns {string}
 */
function rulesFor(link) {
  return applyHtaccess(
    "  RewriteRule ^blog/posts(?:/|$) - [F,L]\n</IfModule>\n",
    renderInner([{ id: link.id || "id", status: link.status || 302, ...link }])
  );
}

/**
 * @param {string} html
 * @param {{ search?: string, hash?: string, hit?: string }} [page]
 * @returns {{ landed: string, calls: { url: string, body: string, init: object }[] }}
 */
function runPage(html, page = {}) {
  const match = html.match(/<script>\n([\s\S]*?)<\/script>/u);
  assert.ok(match, "page has no script");
  const calls = [];
  const location = {
    search: page.search || "",
    hash: page.hash || "",
    landed: "",
    replace(url) {
      this.landed = url;
    },
  };
  const context = {
    location,
    JSON,
    decodeURIComponent,
    setTimeout(fn) {
      fn();
    },
    fetch(url, init) {
      calls.push({ url, body: init.body, init });
      return Promise.resolve();
    },
  };
  vm.runInNewContext(match[1], context);
  return { landed: location.landed, calls };
}

test("query merge keeps the visitor query byte for byte and lets the visitor win", () => {
  const dest = "https://x/p?language=ro&a=1";
  assert.equal(
    mergeQuery(dest, "?language=en&q=%C8%99+x", ""),
    "https://x/p?language=en&q=%C8%99+x&a=1"
  );
  assert.equal(mergeQuery(dest, "", ""), "https://x/p?language=ro&a=1");
  assert.equal(mergeQuery(dest, "?", ""), "https://x/p?language=ro&a=1");
  assert.equal(mergeQuery(dest, "?a=", "#v"), "https://x/p?a=&language=ro#v");
  assert.equal(mergeQuery(dest, "?flag", ""), "https://x/p?flag&language=ro&a=1");
  assert.equal(mergeQuery(dest, "?a=1&a=2", ""), "https://x/p?a=1&a=2&language=ro");
  assert.equal(mergeQuery(dest, "?q=%2B", ""), "https://x/p?q=%2B&language=ro&a=1");
  assert.equal(mergeQuery(dest, "?q=%26", ""), "https://x/p?q=%26&language=ro&a=1");
  assert.equal(mergeQuery(dest, "?q=%3D", ""), "https://x/p?q=%3D&language=ro&a=1");
  assert.equal(mergeQuery(dest, "?b=1&a=2", ""), "https://x/p?b=1&a=2&language=ro");
  assert.equal(mergeQuery("https://x/p?a%20b=2", "?a%20b=1", ""), "https://x/p?a%20b=1");
  assert.equal(mergeQuery("https://x/p?a=1#frag", "?b=2", "#visitor"), "https://x/p?b=2&a=1#frag");
  assert.equal(mergeQuery("https://x/p", "", "#top"), "https://x/p#top");
  assert.equal(mergeQuery.toString().includes("URLSearchParams"), false);
  assert.equal(mergeQuery.toString().includes("encodeURIComponent"), false);
  const pageMerge = vm.runInNewContext(`${PAGE_MERGE}; mergeQuery`, { decodeURIComponent });
  const samples = [
    ["https://x/p?language=ro&a=1", "?language=en&q=%C8%99+x", ""],
    ["https://x/p?language=ro&a=1", "", ""],
    ["https://x/p?language=ro&a=1", "?", ""],
    ["https://x/p?language=ro&a=1", "?a=", "#v"],
    ["https://x/p?language=ro&a=1", "?flag", ""],
    ["https://x/p?language=ro&a=1", "?a=1&a=2", ""],
    ["https://x/p?language=ro&a=1", "?q=%2B", ""],
    ["https://x/p?language=ro&a=1", "?q=%26", ""],
    ["https://x/p?language=ro&a=1", "?q=%3D", ""],
    ["https://x/p?a%20b=2", "?a%20b=1", ""],
    ["https://x/p?a=1#frag", "?b=2", "#visitor"],
    ["https://x/p", "", "#top"],
    ["https://x/p?language=ro", "?apiKey=k&sheet=Abonamente&page=2&limit=500", ""],
  ];
  samples.forEach(([dest, search, hash]) => {
    assert.equal(pageMerge(dest, search, hash), mergeQuery(dest, search, hash));
  });
});

test("generated Apache rules merge the same way for browsers and other clients", () => {
  const htaccess = rulesFor({
    path: "bronze/lunar",
    destination: "https://mpy.ro/99mzfyjht?language=ro&a=1",
  });
  const browser = emulateRewrite(htaccess, {
    path: "/bronze/lunar",
    accept: "text/html,application/xhtml+xml",
    query: "language=en&q=%C8%99+x",
  });
  assert.deepEqual(browser, { type: "rewrite", target: "/r/bronze/lunar/index.html" });

  const client = emulateRewrite(htaccess, {
    path: "/bronze/lunar/",
    accept: "*/*",
    query: "language=en&q=%C8%99+x",
  });
  assert.equal(client.type, "redirect");
  assert.equal(client.status, 302);
  assert.equal(client.location, "https://mpy.ro/99mzfyjht?language=en&q=%C8%99+x&a=1");

  const untouched = emulateRewrite(htaccess, {
    path: "/bronze/lunar",
    accept: "",
    query: "apiKey=k&sheet=Abonamente&page=2&limit=500",
  });
  assert.equal(
    untouched.location,
    "https://mpy.ro/99mzfyjht?apiKey=k&sheet=Abonamente&page=2&limit=500&language=ro&a=1"
  );
  assert.equal(
    emulateRewrite(htaccess, { path: "/bronze/lunar", accept: "application/json", query: "" }).location,
    "https://mpy.ro/99mzfyjht?language=ro&a=1"
  );
  assert.equal(
    emulateRewrite(htaccess, { path: "/bronze/lunar", query: "q=%2B+%26%3D&a=&flag&a=1&a=2" }).location,
    "https://mpy.ro/99mzfyjht?q=%2B+%26%3D&a=&flag&a=1&a=2&language=ro"
  );
});

test("301 is used only when Tip redirect is 301", () => {
  const reserved = new Set(["blog"]);
  const rows = [
    row({ id: "ok302", short: "https://solon.agency/go", dest: "https://example.com/a" }),
    row({ id: "ok301", short: "https://solon.agency/stay", dest: "https://example.com/b", tip: "301" }),
    row({ id: "num301", short: "https://solon.agency/num", dest: "https://example.com/c", tip: 301 }),
    row({ id: "other", short: "https://solon.agency/other", dest: "https://example.com/d", tip: "302" }),
  ];
  const { links } = classifyShortLinks(rows, { reserved });
  const byId = Object.fromEntries(links.map((link) => [link.id, link.status]));
  assert.equal(byId.ok302, 302);
  assert.equal(byId.ok301, 301);
  assert.equal(byId.num301, 301);
  assert.equal(byId.other, 302);
  const htaccess = rulesFor({ path: "stay", destination: "https://example.com/b", status: 301 });
  assert.equal(
    emulateRewrite(htaccess, { path: "/stay", accept: "", query: "" }).status,
    301
  );
});

test("validation skips bad rows, reserved paths, duplicates, and inactive rows", () => {
  const warnings = [];
  const reserved = reservedFirstSegments(ROOT);
  const longDest = `https://example.com/${"a".repeat(2040)}`;
  const rows = [
    row({ id: "good", short: "https://solon.agency/bronze/lunar", dest: "https://cdn.example/pay?language=ro" }),
    row({ id: "Bad Id", short: "https://solon.agency/x", dest: "https://example.com/" }),
    row({ id: "js", short: "https://solon.agency/js", dest: "javascript:alert(1)" }),
    row({ id: "data", short: "https://solon.agency/bin", dest: "data:text/html,hi" }),
    row({ id: "space", short: "https://solon.agency/sp", dest: "https://example.com/a b" }),
    row({ id: "quote", short: "https://solon.agency/q", dest: "https://example.com/?a=\"b\"" }),
    row({ id: "long", short: "https://solon.agency/long", dest: longDest }),
    row({ id: "www", short: "https://www.solon.agency/www", dest: "https://example.com/" }),
    row({ id: "query", short: "https://solon.agency/query?x=1", dest: "https://example.com/" }),
    row({ id: "four", short: "https://solon.agency/a/b/c/d", dest: "https://example.com/" }),
    row({ id: "upper", short: "https://solon.agency/Go-Upper/", dest: "https://example.com/upper" }),
    row({ id: "off", short: "https://solon.agency/hidden", dest: "https://example.com/hidden", activ: false }),
    row({ id: "offtext", short: "https://solon.agency/hidden2", dest: "https://example.com/hidden", activ: "FALSE" }),
    row({ id: "empty", short: "https://solon.agency/shown", dest: "https://example.com/shown", activ: "" }),
    row({ id: "path1", short: "https://solon.agency/same", dest: "https://example.com/1" }),
    row({ id: "path2", short: "https://solon.agency/same/", dest: "https://example.com/2" }),
    row({ id: "iddup", short: "https://solon.agency/alpha", dest: "https://example.com/3" }),
    row({ id: "iddup", short: "https://solon.agency/beta", dest: "https://example.com/4" }),
    row({ id: "blog", short: "https://solon.agency/blog", dest: "https://example.com/blog" }),
    row({ id: "assets", short: "https://solon.agency/assets/img", dest: "https://example.com/assets" }),
  ];
  const { links, skipped } = classifyShortLinks(rows, {
    reserved,
    warn(id, reason) {
      warnings.push({ id, reason });
    },
  });
  const ids = links.map((link) => link.id);
  assert.deepEqual(ids, ["good", "upper", "empty"]);
  assert.equal(links.find((link) => link.id === "upper").path, "go-upper");
  assert.equal(links.find((link) => link.id === "good").destination.includes("example"), true);
  const reasons = Object.fromEntries(skipped.map((item) => [item.id, item.reason]));
  assert.equal(reasons["invalid-id"], "bad-id");
  assert.equal(reasons.js, "bad-destination");
  assert.equal(reasons.data, "bad-destination");
  assert.equal(reasons.space, "bad-destination");
  assert.equal(reasons.quote, "bad-destination");
  assert.equal(reasons.long, "bad-destination");
  assert.equal(reasons.www, "bad-short-url");
  assert.equal(reasons.query, "bad-short-url");
  assert.equal(reasons.four, "bad-short-url");
  assert.equal(reasons.off, "inactive");
  assert.equal(reasons.offtext, "inactive");
  assert.equal(reasons.iddup, "duplicate-id");
  assert.equal(reasons.path1, "duplicate-path");
  assert.equal(reasons.path2, "duplicate-path");
  assert.equal(reasons.blog, "reserved");
  assert.equal(reasons.assets, "reserved");
  assert.equal(warnings.some((item) => item.reason === "uppercase" && item.id === "upper"), true);
  assert.equal(warnings.some((item) => item.reason === "inactive"), false);
  assert.equal(JSON.stringify(warnings).includes("apiKey="), false);
});

test("reserved paths cover every top-level file and directory", () => {
  const reserved = reservedFirstSegments(ROOT);
  fs.readdirSync(ROOT).forEach((name) => {
    assert.equal(reserved.has(name.toLowerCase()), true, name);
  });
  [".well-known", "cgi-bin", "wp-admin", "node_modules", "r", "tests", "scripts"].forEach((name) => {
    assert.equal(reserved.has(name), true, name);
  });
});

test("apiKey rows are skipped with a warning that names only the id", () => {
  const secret = "super-secret-value";
  const warnings = [];
  const rows = [
    row({
      id: "a3hb4931",
      short: "https://solon.agency/api",
      dest: "https://script.google.com/macros/s/example/exec",
    }),
    row({
      id: "hu43hb44",
      short: "https://solon.agency/api",
      dest: `https://script.google.com/macros/s/example/exec?apiKey=${secret}&sheet=Servicii`,
    }),
    row({
      id: "fdsk43244",
      short: "https://solon.agency/api/servicii",
      dest: `https://example.com/exec?APIKEY=${secret}`,
    }),
    row({
      id: "96t5n5434",
      short: "https://solon.agency/api/abonamente",
      dest: `https://example.com/exec?ApiKey=${secret}`,
    }),
    row({
      id: "9fdsjfd04n",
      short: "https://solon.agency/api/urls",
      dest: `https://example.com/exec?apikey=${secret}`,
    }),
    row({
      id: "notakey",
      short: "https://solon.agency/plain",
      dest: "https://example.com/search?q=apiKey",
    }),
  ];
  const { links } = classifyShortLinks(rows, {
    reserved: new Set(),
    warn(id, reason) {
      warnings.push(`${reason}:${id}`);
    },
  });
  assert.deepEqual(links.map((link) => link.id), ["a3hb4931", "notakey"]);
  assert.deepEqual(warnings, [
    "api-key:hu43hb44",
    "api-key:fdsk43244",
    "api-key:96t5n5434",
    "api-key:9fdsjfd04n",
  ]);
  const snapshot = snapshotDocument(rows);
  const serialised = JSON.stringify(snapshot);
  assert.equal(serialised.includes("apiKey="), false);
  assert.equal(serialised.includes(secret), false);
  assert.equal(serialised.includes("hu43hb44"), false);
  assert.equal(originalUrlHasApiKey("https://example.com/apiKey/path"), false);
  assert.equal(originalUrlHasApiKey(`https://example.com/?apiKey=${secret}`), true);
  const page = renderPage(links[0], "");
  const rules = renderInner(links);
  assert.equal(page.includes(secret), false);
  assert.equal(page.includes("apiKey="), false);
  assert.equal(rules.includes(secret), false);
  assert.equal(rules.includes("apiKey="), false);
});

test("redirect page counts with credentials omit and never sendBeacon", () => {
  const html = renderPage(
    { id: "abc", path: "go", destination: "https://example.com/a?b=1", status: 302 },
    "https://script.google.com/macros/s/example/exec"
  );
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(html.includes('<html lang="ro">'));
  assert.ok(html.includes("<title>Redirecționare | SOLON</title>"));
  assert.ok(html.includes('content="0;url=https://example.com/a?b=1"'));
  assert.ok(html.includes(">Continuă către pagina de destinație</a>"));
  assert.ok(html.includes(HIT_FETCH));
  assert.ok(html.includes("credentials:'omit'"));
  assert.equal(html.includes("sendBeacon"), false);
  assert.equal(html.includes("URLSearchParams"), false);
  assert.equal(html.includes("encodeURIComponent"), false);
  assert.equal(html.includes("<iframe"), false);
  assert.equal(html.includes("<img"), false);
  assert.ok(Buffer.byteLength(html) <= 2048, `page is ${Buffer.byteLength(html)} bytes`);
  ["googletagmanager", "google-analytics", "clarity", "facebook", "brevo", "metricool", "ahrefs", "counter.dev", "consent.min.js"].forEach((host) => {
    assert.equal(html.includes(host), false, host);
  });
  const ran = runPage(html, { search: "?language=en", hash: "#x" });
  assert.equal(ran.calls.length, 1);
  assert.equal(ran.calls[0].init.credentials, "omit");
  assert.equal(ran.calls[0].init.referrerPolicy, "no-referrer");
  assert.equal(ran.calls[0].init.mode, "no-cors");
  assert.equal(ran.calls[0].init.keepalive, true);
  assert.deepEqual(JSON.parse(ran.calls[0].body), { action: "hit", id: "abc" });
  assert.equal(ran.landed, "https://example.com/a?language=en&b=1#x");

  const skipped = renderPage(
    { id: "abc", path: "go", destination: "https://example.com/a?b=1", status: 302 },
    ""
  );
  assert.ok(skipped.includes(HIT_FETCH));
  assert.ok(skipped.includes("credentials:'omit'"));
  assert.equal(skipped.includes("sendBeacon"), false);
  const quiet = runPage(skipped, { search: "" });
  assert.equal(quiet.calls.length, 0);
  assert.equal(quiet.landed, "https://example.com/a?b=1");
});

test("committed short links match the snapshot and leave the rest of .htaccess unchanged", () => {
  const htaccess = fs.readFileSync(path.join(ROOT, ".htaccess"), "utf8");
  const stripped = stripBlock(htaccess);
  assert.equal(crypto.createHash("sha256").update(stripped).digest("hex"), HTACCESS_HASH);
  assert.ok(htaccess.indexOf("# SHORTLINKS:START") > htaccess.indexOf("RewriteRule ^blog/posts"));
  assert.ok(htaccess.indexOf("# SHORTLINKS:END") < htaccess.indexOf("# BEGIN issue #29"));
  assert.match(htaccess, /Header always set Cache-Control "no-store"/);
  assert.match(htaccess, /Header always set Vary "Accept"/);
  assert.match(htaccess, /RewriteCond %\{HTTP:Accept\} text\/html/);
  assert.match(htaccess, /\[R=302,L,NE\]/);
  assert.equal(htaccess.includes("sendBeacon"), false);

  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data/shortlinks.snapshot.json"), "utf8"));
  const serialised = JSON.stringify(snapshot);
  assert.equal(serialised.includes("apiKey="), false);
  assert.equal(serialised.includes("Total clicks"), false);
  const ids = snapshot.ShortLinks.map((item) => item.id);
  assert.deepEqual(ids, PUBLISHED_IDS);
  SKIPPED_KEY_IDS.forEach((id) => {
    assert.equal(ids.includes(id), false, id);
  });

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "data/shortlinks.config.json"), "utf8"));
  assert.equal(config.hitEndpoint, "");

  const tree = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else tree.push(fs.readFileSync(full, "utf8"));
    });
  };
  walk(path.join(ROOT, "r"));
  assert.ok(tree.length >= 9);
  tree.forEach((html) => {
    assert.ok(html.includes("credentials:'omit'"));
    assert.equal(html.includes("sendBeacon"), false);
    assert.equal(html.includes("apiKey="), false);
    assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
    assert.ok(Buffer.byteLength(html) <= 2048);
  });
  assert.equal(fs.existsSync(path.join(ROOT, "r/api/index.html")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "r/bronze/lunar/index.html")), true);

  const api = emulateRewrite(htaccess, {
    path: "/api",
    accept: "",
    query: "apiKey=k&sheet=Abonamente&page=2&limit=500",
  });
  assert.equal(api.status, 302);
  assert.match(api.location, /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec\?apiKey=k&sheet=Abonamente&page=2&limit=500$/u);
  const browser = emulateRewrite(htaccess, {
    path: "/bronze/lunar",
    accept: "text/html",
    query: "language=en&x=%C8%99",
  });
  assert.deepEqual(browser, { type: "rewrite", target: "/r/bronze/lunar/index.html" });
  const curl = emulateRewrite(htaccess, {
    path: "/bronze/lunar",
    accept: "*/*",
    query: "language=en&x=%C8%99",
  });
  assert.equal(curl.status, 302);
  assert.match(curl.location, /^https:\/\/mpy\.ro\/99mzfyjht\?language=en&x=%C8%99$/u);
});

test("offline build falls back to the snapshot, is idempotent, and --check catches drift", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-short-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!DOCTYPE html><title>x</title>\n");
  fs.writeFileSync(path.join(dir, ".htaccess"), "  RewriteRule ^blog/posts(?:/|$) - [F,L]\n</IfModule>\n");
  fs.writeFileSync(path.join(dir, "data/shortlinks.config.json"), "{\"hitEndpoint\":\"\"}\n");
  const rows = [
    row({ id: "one", short: "https://solon.agency/one", dest: "https://example.com/one" }),
    row({ id: "two", short: "https://solon.agency/two", dest: "https://example.com/two" }),
  ];
  fs.writeFileSync(path.join(dir, "data/shortlinks.snapshot.json"), `${JSON.stringify({ ShortLinks: rows }, null, 2)}\n`);
  const errors = [];
  const original = console.error;
  console.error = (line) => {
    errors.push(String(line));
  };
  try {
    const failed = await run({
      root: dir,
      offline: false,
      fetchImpl: async () => {
        throw new Error("down");
      },
    });
    assert.equal(failed, 0);
    assert.match(errors.join("\n"), /::error::build-shortlinks: endpoint failed/);
    assert.equal(fs.existsSync(path.join(dir, "r/one/index.html")), true);
    assert.equal(fs.existsSync(path.join(dir, "r/two/index.html")), true);

    fs.writeFileSync(
      path.join(dir, "data/shortlinks.snapshot.json"),
      `${JSON.stringify({ ShortLinks: [rows[0]] }, null, 2)}\n`
    );
    assert.equal(await run({ root: dir, offline: true }), 0);
    assert.equal(fs.existsSync(path.join(dir, "r/one/index.html")), true);
    assert.equal(fs.existsSync(path.join(dir, "r/two/index.html")), false);

    assert.equal(await run({ root: dir, offline: true, check: true }), 0);
    fs.writeFileSync(path.join(dir, "r/one/index.html"), "drift\n");
    assert.equal(await run({ root: dir, offline: true, check: true }), 1);
  } finally {
    console.error = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("robots, sitemap, and IndexNow exclude r/", () => {
  const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
  assert.match(robots, /^Disallow: \/r\/$/mu);
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  assert.equal(sitemap.includes("solon.agency/r/"), false);
  assert.equal(isExcludedFromSitemap("https://solon.agency/r/api/"), true);
  assert.equal(isExcludedFromSitemap("https://solon.agency/r"), true);
  assert.equal(isExcludedFromSitemap("https://solon.agency/red/"), false);
  assert.equal(isExcludedFromSitemap("https://solon.agency/privacy/"), false);
  const withRedirect = sitemap.replace(
    "</urlset>",
    "    <url>\n        <loc>https://solon.agency/r/api/</loc>\n        <lastmod>2026-10-18</lastmod>\n        <priority>0.50</priority>\n    </url>\n</urlset>"
  );
  const stripped = stripShortRedirectUrls(withRedirect);
  assert.equal(stripped.includes("solon.agency/r/"), false);
  assert.equal(stripped.includes("solon.agency/privacy/") || stripped.includes("<loc>https://solon.agency/"), true);
  assert.equal(indexnow.htmlFileToUrl("r/api/index.html"), "");
  assert.equal(indexnow.htmlFileToUrl("r/bronze/lunar/index.html"), "");
  const urls = indexnow.selectChangedUrls({
    changedFiles: ["r/api/index.html", "privacy/index.html"],
    sitemapChanged: true,
    previousSitemap: sitemap,
    currentSitemap: withRedirect,
  });
  assert.equal(urls.some((url) => url.includes("/r/")), false);
  assert.ok(urls.includes("https://solon.agency/privacy/"));
});

test("privacy and cookies name the short-link counter", () => {
  const privacy = fs.readFileSync(path.join(ROOT, "privacy/index.html"), "utf8");
  const cookies = fs.readFileSync(path.join(ROOT, "cookies/index.html"), "utf8");
  assert.ok(privacy.includes(PRIVACY_PARAGRAPH));
  assert.ok(cookies.includes(COOKIES_PARAGRAPH));
  assert.equal(PRIVACY_PARAGRAPH.includes(" site"), false);
  assert.equal(COOKIES_PARAGRAPH.includes(" site"), false);
  assert.match(privacy, /către Google Apps Script, pentru înregistrarea în Google Sheets/);
});

test("build script does not call sendBeacon or URLSearchParams", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts/build-shortlinks.js"), "utf8");
  assert.equal(source.includes("sendBeacon"), false);
  assert.equal(source.includes("URLSearchParams"), false);
  assert.equal(source.includes("encodeURIComponent"), false);
});

/**
 * @param {{ id: string, short: string, dest: string, activ?: unknown, tip?: unknown }} input
 * @returns {Record<string, unknown>}
 */
function row(input) {
  const record = {
    id: input.id,
    "Original URL": input.dest,
    "Short URL": input.short,
    "Total clicks": 4,
  };
  if (Object.prototype.hasOwnProperty.call(input, "activ")) record.Activ = input.activ;
  if (Object.prototype.hasOwnProperty.call(input, "tip")) record["Tip redirect"] = input.tip;
  return record;
}
