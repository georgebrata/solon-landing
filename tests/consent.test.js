"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/consent.js"), "utf8");

/**
 * @param {string} category
 * @param {Record<string, string>} [attrs]
 * @returns {object}
 */
function createInertScript(category, attrs) {
  const attributeList = [
    { name: "type", value: "text/plain" },
    { name: "data-consent-category", value: category },
  ];
  const extra = attrs || {};
  for (const name of Object.keys(extra)) {
    attributeList.push({ name, value: extra[name] });
  }
  const el = {
    attributes: attributeList,
    textContent: extra.body || "",
    parentNode: {
      inserted: null,
      insertBefore(next) {
        this.inserted = next;
      },
      removeChild(child) {
        child.removed = true;
      },
    },
    getAttribute(name) {
      if (name === "data-consent-activated") return this.activated || null;
      const found = attributeList.find((item) => item.name === name);
      if (!found) {
        return null;
      }
      return found.value;
    },
    setAttribute(name, value) {
      if (name === "data-consent-activated") this.activated = value;
    },
  };
  return el;
}

/**
 * @param {{store?: object, inertScripts?: object[], cookie?: string}} [options]
 * @returns {{api: object, context: object, store: object, created: object[], inertScripts: object[], listeners: object}}
 */
function loadConsent(options = {}) {
  const store = options.store || {};
  const inertScripts = options.inertScripts || [];
  const created = [];
  let cookieStr = options.cookie || "";
  const listeners = {};

  const document = {
    readyState: "loading",
    cookie: "",
    body: { appendChild() {} },
    head: { appendChild() {} },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (String(selector).includes("data-consent-category")) {
        return inertScripts.filter((el) => !el.removed);
      }
      return [];
    },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        attributes: [],
        text: "",
        setAttribute(name, value) {
          this.attributes.push({ name, value });
          this[name] = value;
        },
        getAttribute(name) {
          const found = this.attributes.find((item) => item.name === name);
          if (!found) {
            return null;
          }
          return found.value;
        },
      };
      created.push(el);
      return el;
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get() {
      return cookieStr;
    },
    set(value) {
      if (cookieStr) {
        cookieStr = `${cookieStr}; ${value}`;
      } else {
        cookieStr = String(value);
      }
    },
  });

  const context = {
    console,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Error,
    document,
    localStorage: {
      getItem(key) {
        if (Object.prototype.hasOwnProperty.call(store, key)) {
          return store[key];
        }
        return null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
    },
    location: {
      pathname: "/",
      protocol: "https:",
      hostname: "solon.agency",
      href: "https://solon.agency/",
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.SolonConsent, context, store, created, inertScripts, listeners };
}

test("default state denies analytics and marketing", () => {
  const { api, context } = loadConsent();
  assert.equal(api.hasConsent("necessary"), true);
  assert.equal(api.hasConsent("analytics"), false);
  assert.equal(api.hasConsent("marketing"), false);
  const defaults = context.dataLayer[0];
  assert.equal(defaults[0], "consent");
  assert.equal(defaults[1], "default");
  assert.equal(defaults[2].analytics_storage, "denied");
  assert.equal(defaults[2].ad_storage, "denied");
  assert.equal(defaults[2].ad_user_data, "denied");
  assert.equal(defaults[2].ad_personalization, "denied");
});

test("accept all persists version, timestamp, and both categories", () => {
  const { api, store } = loadConsent();
  const saved = api.acceptAll();
  assert.equal(saved.analytics, true);
  assert.equal(saved.marketing, true);
  assert.equal(saved.version, api.CONSENT_VERSION);
  assert.ok(Date.parse(saved.timestamp));
  const parsed = JSON.parse(store[api.STORAGE_KEY]);
  assert.equal(parsed.analytics, true);
  assert.equal(parsed.marketing, true);
});

test("reject all persists denied optional categories", () => {
  const { api, store } = loadConsent();
  api.acceptAll();
  const saved = api.rejectAll();
  assert.equal(saved.analytics, false);
  assert.equal(saved.marketing, false);
  const parsed = JSON.parse(store[api.STORAGE_KEY]);
  assert.equal(parsed.analytics, false);
});

test("custom mix persists and rehydrates", () => {
  const first = loadConsent();
  first.api.saveCustom({ analytics: true, marketing: false });
  const second = loadConsent({ store: first.store });
  assert.equal(second.api.hasConsent("analytics"), true);
  assert.equal(second.api.hasConsent("marketing"), false);
  assert.equal(second.api.getConsent().version, first.api.CONSENT_VERSION);
});

test("version bump invalidates stored choice", () => {
  const { api } = loadConsent();
  const stale = JSON.stringify({
    version: 0,
    timestamp: new Date().toISOString(),
    necessary: true,
    analytics: true,
    marketing: true,
  });
  assert.equal(api.parseConsent(stale), null);
});

test("expired timestamp invalidates stored choice", () => {
  const { api } = loadConsent();
  const stale = JSON.stringify({
    version: api.CONSENT_VERSION,
    timestamp: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    necessary: true,
    analytics: true,
    marketing: true,
  });
  assert.equal(api.parseConsent(stale), null);
});

test("inert analytics scripts stay inert until analytics consent", () => {
  const analytics = createInertScript("analytics", {
    src: "https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX",
  });
  const marketing = createInertScript("marketing", {
    src: "https://example.com/meta-pixel.min.js",
  });
  const { api, created } = loadConsent({
    inertScripts: [analytics, marketing],
  });
  api.activateInertScripts(api.getConsent());
  assert.equal(created.length, 0);
  assert.equal(analytics.activated, undefined);

  api.saveCustom({ analytics: true, marketing: false });
  const activated = created.filter((el) => el.src);
  assert.equal(activated.length, 1);
  assert.equal(activated[0].src, "https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX");
  assert.equal(analytics.activated, "true");
  assert.equal(marketing.activated, undefined);
});

test("accept all activates analytics and marketing inert tags", () => {
  const analytics = createInertScript("analytics", {
    src: "https://analytics.ahrefs.com/analytics.js",
  });
  const marketing = createInertScript("marketing", {
    src: "https://cdn.brevo.com/js/sdk-loader.js",
  });
  const { api, created, context } = loadConsent({
    inertScripts: [analytics, marketing],
  });
  api.acceptAll();
  const srcs = created.map((el) => el.src).filter((src) => src);
  assert.ok(srcs.includes("https://analytics.ahrefs.com/analytics.js"));
  assert.ok(srcs.includes("https://cdn.brevo.com/js/sdk-loader.js"));
  const last = context.dataLayer[context.dataLayer.length - 1];
  assert.equal(last[0], "consent");
  assert.equal(last[1], "update");
  assert.equal(last[2].analytics_storage, "granted");
  assert.equal(last[2].ad_storage, "granted");
});

/**
 * @returns {string[]}
 */
function htmlFiles() {
  const files = [];
  const skipDirs = new Set([".git", "node_modules", "assets", "scripts", "tests", "docs"]);
  /**
   * @param {string} dir
   */
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (!skipDirs.has(name)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (name.endsWith(".html")) {
          files.push(full);
        }
      }
    }
  }
  walk(root);
  return files;
}

const SKIP_GATING = new Set([
  path.join(root, "100/index.html"),
  path.join(root, "1000/index.html"),
  path.join(root, "templates/list.html"),
  path.join(root, "templates/post.html"),
]);

/**
 * @param {string} html
 * @returns {boolean}
 */
function hasLiveTracker(html) {
  const re = /<script(\s[\s\S]*?)?>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const isInert = /type\s*=\s*["']text\/plain["']/i.test(attrs);
    const isConsent = /consent\.min\.js/.test(attrs);
    if (!isInert && !isConsent) {
      const haystack = `${attrs}\n${body}`;
      if (
        /googletagmanager\.com\/gtag|cdn\.counter\.dev|analytics\.ahrefs\.com|cdn\.brevo\.com|tracker\.metricool\.com|clarity\.ms\/tag|connect\.facebook\.net|meta-pixel|G-H41D7KCWHX|client_key:\s*"mwgotrl8|beTracker/.test(
          haystack
        )
      ) {
        return true;
      }
    }
    match = re.exec(html);
  }
  return /<noscript>[\s\S]*facebook\.com\/tr[\s\S]*<\/noscript>/i.test(html);
}

test("non-essential tracker tags are inert on source and generated pages", () => {
  const offenders = [];
  for (const file of htmlFiles()) {
    if (!SKIP_GATING.has(file)) {
      const html = fs.readFileSync(file, "utf8");
      if (hasLiveTracker(html)) {
        offenders.push(path.relative(root, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("pages with trackers or site footer include the consent manager", () => {
  const missing = [];
  for (const file of htmlFiles()) {
    if (!SKIP_GATING.has(file)) {
      const rel = path.relative(root, file);
      const html = fs.readFileSync(file, "utf8");
      const hasTrackers =
        html.includes("data-consent-category") ||
        html.includes("clarity.ms") ||
        html.includes("analytics.ahrefs");
      const hasFooter = html.includes('id="footer"');
      if (hasTrackers || hasFooter) {
        if (!html.includes("/assets/js/consent.min.js")) {
          missing.push(`${rel} (consent.js)`);
        }
        if (hasFooter && !html.includes("data-solon-consent-open")) {
          missing.push(`${rel} (Setări cookie)`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("cookies policy describes the banner, categories, and all trackers", () => {
  const html = fs.readFileSync(path.join(root, "cookies/index.html"), "utf8");
  const needles = [
    "Setări cookie",
    "Acceptă toate",
    "Respinge toate",
    "Personalizează",
    "Necesare",
    "Analiză",
    "Marketing",
    "Google Analytics",
    "Microsoft Clarity",
    "Ahrefs",
    "Metricool",
    "counter.dev",
    "Meta Pixel",
    "Brevo",
    "Consent Mode",
  ];
  for (const needle of needles) {
    assert.ok(html.includes(needle), `policy missing “${needle}”`);
  }
  assert.equal(html.includes("Nu desfășurăm activități de tip publicitate personalizată"), false);
});
