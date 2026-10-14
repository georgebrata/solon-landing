"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "assets/js/brevo-tracker.js");
const source = fs.readFileSync(sourcePath, "utf8");
const SDK_SRC = "https://cdn.brevo.com/js/sdk-loader.js";

/**
 * @param {string} code
 * @param {{marketing?: boolean, title?: string}} [options]
 * @returns {{context: object, scripts: object[]}}
 */
const loadTracker = function loadTracker(code, options = {}) {
  const scripts = [];
  let cookieStr = "";
  const head = {
    appendChild(node) {
      node.parentNode = head;
      scripts.push(node);
      return node;
    },
    removeChild(node) {
      node.removed = true;
    },
  };
  const document = {
    title: options.title || "Pagina test",
    referrer: "https://example.com/din-alta-parte",
    head,
    documentElement: head,
    getElementById(id) {
      return scripts.find((node) => node.id === id && !node.removed) || null;
    },
    createElement() {
      return {
        id: "",
        async: false,
        src: "",
        removed: false,
        parentNode: null,
      };
    },
  };
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get() {
      return cookieStr;
    },
    set(value) {
      cookieStr = cookieStr ? `${cookieStr}; ${value}` : String(value);
    },
  });
  const context = {
    document,
    location: {
      href: "https://solon.agency/blog/exemplu/",
      pathname: "/blog/exemplu/",
      hostname: "solon.agency",
    },
    SolonConsent: {
      hasConsent(category) {
        return category === "marketing" && options.marketing === true;
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(code, context, { filename: "brevo-tracker.js" });
  return { context, scripts, cookie: () => cookieStr };
};

const CLIENT_KEY = "mwgotrl8mb9d4jf2rit2omjt";
const withBlankKey = source.replace(
  `const BREVO_TRACKER_CLIENT_KEY = "${CLIENT_KEY}";`,
  'const BREVO_TRACKER_CLIENT_KEY = "";'
);

test("client key lives in one config spot and the old init file is gone", () => {
  const matches = source.match(/const BREVO_TRACKER_CLIENT_KEY = "[^"]+";/g);
  assert.deepEqual(matches, [`const BREVO_TRACKER_CLIENT_KEY = "${CLIENT_KEY}";`]);
  assert.equal(fs.existsSync(path.join(root, "assets/js/brevo-init.js")), false);
  assert.equal(source.includes("REPLACE_WITH_BREVO_CLIENT_KEY"), false);
  const jsDir = path.join(root, "assets/js");
  const keyFiles = fs
    .readdirSync(jsDir)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".min.js") && fs.readFileSync(path.join(jsDir, name), "utf8").includes("BREVO_TRACKER_CLIENT_KEY"));
  assert.deepEqual(keyFiles, ["brevo-tracker.js"]);
});

test("a blank key still does not load the SDK", () => {
  const { context, scripts } = loadTracker(withBlankKey, { marketing: true });
  assert.equal(context.SolonBrevo.isConfigured(), false);
  assert.equal(context.SolonBrevo.start(), false);
  assert.equal(scripts.length, 0);
  assert.equal(typeof context.Brevo, "undefined");
  assert.equal(context.SolonBrevo.identify("ada@example.com", { SOURCE: "Contact" }), false);
});

test("without marketing consent the tracker does not load or identify", () => {
  const { context, scripts } = loadTracker(source, { marketing: false });
  assert.equal(context.SolonBrevo.isConfigured(), true);
  assert.equal(context.SolonBrevo.start(), false);
  assert.equal(scripts.length, 0);
  assert.equal(typeof context.Brevo, "undefined");
  assert.equal(context.SolonBrevo.identify("ada@example.com", { SOURCE: "Newsletter" }), false);
});

test("marketing consent queues the v2 init, one page view, and loads the SDK", () => {
  const { context, scripts } = loadTracker(source, { marketing: true, title: "Articol de test" });
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.equal(scripts[0].src, SDK_SRC);
  assert.equal(
    JSON.stringify(context.Brevo[0]),
    JSON.stringify(["init", { client_key: CLIENT_KEY, do_not_track_page: true }])
  );
  assert.equal(
    JSON.stringify(context.Brevo[1]),
    JSON.stringify([
      "page",
      "Articol de test",
      {
        ma_title: "Articol de test",
        ma_url: "https://solon.agency/blog/exemplu/",
        ma_path: "/blog/exemplu/",
        ma_referrer: "https://example.com/din-alta-parte",
      },
    ])
  );
  assert.equal(context.Brevo.length, 2);
  assert.equal(context.SolonBrevo.identify("", { SOURCE: "Contact" }), false);
  assert.equal(context.SolonBrevo.identify("nu-e-email", { SOURCE: "Contact" }), false);
  assert.equal(
    context.SolonBrevo.identify("ada@example.com", {
      FIRSTNAME: "Ada",
      SOURCE: "Contact",
      PAGE_URL: "https://solon.agency/",
    }),
    true
  );
  assert.equal(
    JSON.stringify(context.Brevo[2]),
    JSON.stringify([
      "identify",
      {
        identifiers: { email_id: "ada@example.com" },
        attributes: {
          FIRSTNAME: "Ada",
          SOURCE: "Contact",
          PAGE_URL: "https://solon.agency/",
        },
      },
    ])
  );
});

test("withdrawal stops later page and identify calls and can start again", () => {
  const { context, scripts } = loadTracker(source, { marketing: true });
  context.SolonBrevo.stop();
  assert.equal(scripts[0].removed, true);
  assert.equal(context.SolonBrevo.identify("ada@example.com", { SOURCE: "Newsletter" }), false);
  const queued = context.Brevo.filter((item) => Array.isArray(item) && item[0] === "page");
  assert.equal(queued.length, 0);
  context.SolonConsent = {
    hasConsent(category) {
      return category === "marketing";
    },
  };
  assert.equal(context.SolonBrevo.start(), true);
  const pages = context.Brevo.filter((item) => Array.isArray(item) && item[0] === "page");
  assert.equal(pages.length, 1);
  assert.equal(scripts.filter((node) => node.src === SDK_SRC && !node.removed).length, 1);
});

test("every content page gates the tracker and error pages omit it", () => {
  const skip = new Set([
    path.join(root, "100/index.html"),
    path.join(root, "1000/index.html"),
    path.join(root, "templates/list.html"),
    path.join(root, "templates/post.html"),
    path.join(root, "403.html"),
    path.join(root, "404.html"),
    path.join(root, "500.html"),
  ]);
  const missing = [];
  const live = [];
  const files = [];
  const skipDirs = new Set([".git", "node_modules", "assets", "scripts", "tests", "docs"]);
  /**
   * @param {string} dir
   */
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skipDirs.has(name)) continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith(".html")) files.push(full);
    }
  }
  walk(root);
  for (const file of files) {
    if (skip.has(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    if (!html.includes("clarity-init.min.js") && !html.includes("id=\"footer\"")) continue;
    if (!html.includes('data-consent-category="marketing"') || !html.includes("/assets/js/brevo-tracker.min.js")) {
      missing.push(rel);
    }
    const re = /<script\b([^>]*)>/gi;
    let match = re.exec(html);
    while (match) {
      const attrs = match[1] || "";
      if (/brevo-tracker|cdn\.brevo\.com|sdk-loader/.test(attrs)) {
        const inert = /type\s*=\s*["']text\/plain["']/i.test(attrs);
        const marketing = /data-consent-category\s*=\s*["']marketing["']/i.test(attrs);
        if (!inert || !marketing) live.push(rel);
      }
      match = re.exec(html);
    }
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(live, []);
  for (const file of ["403.html", "404.html", "500.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(html.includes("brevo-tracker"), false, file);
    assert.equal(html.includes("cdn.brevo.com"), false, file);
  }
});

test("report-only CSP allows the Brevo iframe host", () => {
  const htaccess = fs.readFileSync(path.join(root, ".htaccess"), "utf8");
  const cspLine = htaccess.split("\n").find((line) => line.includes("Content-Security-Policy-Report-Only"));
  assert.ok(cspLine);
  assert.match(cspLine, /script-src[^"]*https:\/\/cdn\.brevo\.com/);
  assert.match(cspLine, /script-src[^"]*https:\/\/sibautomation\.com/);
  assert.match(cspLine, /connect-src[^"]*https:\/\/in-automate\.brevo\.com/);
  assert.match(cspLine, /frame-src[^"]*https:\/\/sibautomation\.com/);
  assert.match(cspLine, /worker-src[^"]*https:\/\/sibautomation\.com/);
  const cookies = fs.readFileSync(path.join(root, "cookies/index.html"), "utf8");
  assert.match(cookies, /sib_cuid/);
  assert.match(cookies, /visitor_id/);
  assert.equal(cookies.includes("mwgotrl8"), false);
});
