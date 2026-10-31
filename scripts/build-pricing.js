"use strict";
/**
 * Build-time pricing: read "SOLON API" tabs Abonamente + Servicii through the
 * SOLON CRUD API (env SHEETS_API_URL, secret SHEETS_API_KEY), render active RON packages into
 * index.html between PRICING markers. The committed snapshot stores Abonamente only
 * (allowlisted fields); Servicii is validated on live fetch but not written to git.
 *
 * Fail-safe: if the API is down or returns invalid data, the committed
 * snapshot data/abonamente.snapshot.json is used and an ::error:: line is
 * logged (the build still succeeds so the site keeps the last good prices).
 * On success the snapshot is refreshed (sanitized).
 *
 * Usage: node scripts/build-pricing.js [--offline] [--check] [--sanitize-snapshot]
 *   --offline           use the snapshot only (tests / no network)
 *   --check             exit 1 if index.html would change (CI drift check)
 *   --sanitize-snapshot rewrite the snapshot from disk through the allowlist (no network)
 */
(() => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  /** SOLON CRUD API v1.0 (Drive doc "SOLON API Docs"). The URL is not a credential; the key is. */
  const DEFAULT_API_URL =
    "https://script.google.com/macros/s/AKfycbzJQOSxwXJGkSAmJnPeY2-cG5e2iCZ4cZr82cC8ft_Fxku1wfjKUHQGo09avC1eDyI3/exec";
  /** Tabs read for the homepage, in this order. */
  const PRICING_TABS = Object.freeze(["Abonamente", "Servicii"]);
  /** API maximum page size (doc 5.3: 1-500). */
  const PAGE_LIMIT = 500;
  /** Safety stop so a broken pagination response cannot loop forever. */
  const MAX_PAGES = 20;
  /** Per HTTP request (each paginated GET). */
  const REQUEST_TIMEOUT_MS = 30000;
  const ALLOWED_APPS_SCRIPT_REDIRECT_HOST = "script.googleusercontent.com";
  const SNAPSHOT = path.join(root, "data", "abonamente.snapshot.json");
  const INDEX = path.join(root, "index.html");

  /** Keys persisted in data/abonamente.snapshot.json (render/model fields only). */
  const ABONAMENTE_SNAPSHOT_KEYS = Object.freeze([
    "id",
    "Nume abonament",
    "Activ",
    "Pret lunar (RON)",
    "Pret anual (RON)",
    "Servicii",
    "Netopia Payment Link Month",
    "Netopia Payment Link Year",
  ]);

  /** Public packages on solon.agency/#pricing (Bronze, Silver, Gold, Platinum). */
  const REQUIRED_ACTIVE_PACKAGES = 4;
  const ALLOWED_ACTIVE_PACKAGE_NAMES = Object.freeze(["Bronze", "Silver", "Gold", "Platinum"]);

  /** @param {Record<string, unknown>} row */
  const packageDisplayName = (row) => String(row["Nume abonament"] || "").trim();

  /** @param {string} name */
  const canonicalPackageName = (name) =>
    ALLOWED_ACTIVE_PACKAGE_NAMES.find((allowed) => allowed.toLowerCase() === name.toLowerCase()) ?? null;

  /** Only NETOPIA checkout hosts are accepted. Anything else (Stripe, placeholders) hides the button. */
  const NETOPIA_HOSTS = [/^mpy\.ro$/u, /(^|\.)mobilpay\.ro$/u, /(^|\.)netopia-payments\.com$/u];

  /** @param {string} text */
  const esc = (text) =>
    String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  /**
   * @param {string} url
   * @returns {boolean}
   */
  function isNetopiaLink(url) {
    if (typeof url !== "string") return false;
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "https:") return false;
      if (/stripe/i.test(parsed.hostname)) return false;
      return NETOPIA_HOSTS.some((pattern) => pattern.test(parsed.hostname));
    } catch {
      return false;
    }
  }

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value === "string") {
      const numeric = Number(value.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
      return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    }
    return null;
  }

  /** @param {number} amount */
  const fmt = (amount) => String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  /** Sheet inclusion cells are partly English; normalise known phrases to Romanian (tu voice, no promises). */
  /**
   * @param {string} raw
   * @returns {string}
   */
  function roInclusion(raw) {
    const text = raw.replace(/^[\s\-•*]+/u, "").replace(/[\s,;.]+$/u, "").trim();
    if (!text) return "";
    const plural = (count, one, many) => (count === "1" ? `1 ${one}` : `${count} ${many}`);
    const rules = [
      // Current sheet wording (George, 31.10.2026): no "/ lună" in any bullet; the card label already says the period.
      [/^website implementation$/iu, () => "Implementare website"],
      [/^(\d+)\s+website updates?(?:\s*\/\s*month)?$/iu, (_match, count) => plural(count, "modificare pe website", "modificări pe website")],
      [/^unlimited website updates?(?:\s*\/\s*month)?$/iu, () => "Modificări nelimitate pe website"],
      [/^(\d+)\s+social media posts?(?:\s*\/\s*month)?$/iu, (_match, count) => plural(count, "postare social media", "postări social media")],
      [/^unlimited social media posts?(?:\s*\/\s*month)?$/iu, () => "Postări social media nelimitate"],
      [/^google\s*(?:my\s*)?bus+i?nes+(?:\s*profile)?\s+management$/iu, () => "Management Google Business Profile"],
      [/^social media management$/iu, () => "Management social media"],
      [/^(\d+)\s+technical consulting sessions?$/iu, (_match, count) => plural(count, "sesiune de consultanță tehnică", "sesiuni de consultanță tehnică")],
      [/^sync up to (\d+) social media profiles?$/iu, (_match, count) => `Sincronizare până la ${count} profile social media`],
      // Older sheet wording, kept for back-compat with earlier snapshots.
      [/^google\s*my\s*busines+\s+maintenance$/iu, () => "Mentenanță Google My Business"],
      [/^\.ro domain included for annual subs?$/iu, () => "Domeniu .ro inclus la abonamentul anual"],
      [/^domeniu \.ro inclus la abonament anual$/iu, () => "Domeniu .ro inclus la abonamentul anual"],
      [/^(\d+) sesiune de consultanta 1:1$/iu, (_match, count) => `${count} sesiune de consultanță digitală 1:1`],
    ];
    for (const [pattern, format] of rules) {
      const match = text.match(pattern);
      if (match) return format(...match);
    }
    console.warn(`::warning::build-pricing: no Romanian mapping for inclusion "${text}" (rendered as-is)`);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Notes are internal English text; map known ones to a short Romanian audience line. */
  const AUDIENCE = {
    bronze: "Pentru avocați care lucrează individual",
    silver: "Pentru avocați asociați sau societăți mici",
    gold: "Pentru societăți cu până la 10 angajați",
    platinum: "Pentru societăți cu peste 10 angajați și parteneri",
  };

  /**
   * @param {Record<string, unknown>} row
   * @returns {Record<string, unknown>}
   */
  const sanitizeAbonamenteRow = (row) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of ABONAMENTE_SNAPSHOT_KEYS) {
      if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) {
        out[key] = row[key];
      }
    }
    return out;
  };

  /**
   * @param {{ Abonamente?: unknown }} data
   * @returns {{ Abonamente: Record<string, unknown>[] }}
   */
  const sanitizeSnapshotPayload = (data) => ({
    Abonamente: Array.isArray(data?.Abonamente) ? data.Abonamente.map((row) => sanitizeAbonamenteRow(row)) : [],
  });

  /**
   * @param {unknown} rows
   */
  const validateServiciiTab = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Servicii tab is empty");
    }
    for (const row of rows) {
      const rowId = row && typeof row.id === "string" ? row.id.trim() : "";
      if (!rowId) throw new Error("Servicii row missing id");
    }
  };

  /**
   * @param {Record<string, unknown>[]} abonamente
   */
  const validateAbonamentePackages = (abonamente) => {
    if (!Array.isArray(abonamente)) {
      throw new Error("payload has no Abonamente array");
    }
    const active = abonamente.filter((row) => row && row.Activ === true && packageDisplayName(row));
    if (active.length !== REQUIRED_ACTIVE_PACKAGES) {
      throw new Error(
        `expected exactly ${REQUIRED_ACTIVE_PACKAGES} active packages (${ALLOWED_ACTIVE_PACKAGE_NAMES.join(", ")}), got ${active.length}`,
      );
    }
    const seen = new Set();
    for (const row of active) {
      const displayName = packageDisplayName(row);
      const canonical = canonicalPackageName(displayName);
      if (!canonical) {
        throw new Error(`unknown active package name: ${displayName}`);
      }
      if (seen.has(canonical)) {
        throw new Error(`duplicate active package: ${canonical}`);
      }
      seen.add(canonical);
      if (!toNumber(row["Pret lunar (RON)"])) {
        throw new Error(`active package "${canonical}" missing monthly price`);
      }
      if (!toNumber(row["Pret anual (RON)"])) {
        throw new Error(`active package "${canonical}" missing annual price`);
      }
    }
    for (const required of ALLOWED_ACTIVE_PACKAGE_NAMES) {
      const match = abonamente.find(
        (row) => row && row.Activ === true && canonicalPackageName(packageDisplayName(row)) === required,
      );
      if (!match) {
        throw new Error(`required active package missing: ${required}`);
      }
    }
  };

  /**
   * Validate committed snapshot (Abonamente only).
   * @param {{ Abonamente?: unknown }} data
   * @returns {{ Abonamente: Record<string, unknown>[] }}
   */
  const validateSnapshot = (data) => {
    const sanitized = sanitizeSnapshotPayload(data);
    validateAbonamentePackages(sanitized.Abonamente);
    return sanitized;
  };

  /**
   * Validate a live API payload before sanitizing for git.
   * @param {{ Abonamente?: unknown, Servicii?: unknown }} data
   * @returns {{ Abonamente: Record<string, unknown>[] }}
   */
  const validateLivePayload = (data) => {
    validateServiciiTab(data?.Servicii);
    const sanitized = sanitizeSnapshotPayload(data);
    validateAbonamentePackages(sanitized.Abonamente);
    return sanitized;
  };

  /** @deprecated alias for snapshot validation in tests */
  const validate = validateSnapshot;

  /**
   * Apps Script /exec may 302 once to googleusercontent.com. Never forward apiKey to the redirect URL.
   * @param {typeof fetch} fetchImpl
   * @param {URL | string} requestUrl
   * @param {RequestInit} init
   * @param {string} sheet for error codes only
   */
  const fetchWithSafeRedirect = async (fetchImpl, requestUrl, init, sheet) => {
    let response = await fetchImpl(requestUrl, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`${sheet}: API error REDIRECT_NO_LOCATION`);
      const nextUrl = new URL(location, requestUrl);
      if (nextUrl.protocol !== "https:" || nextUrl.hostname !== ALLOWED_APPS_SCRIPT_REDIRECT_HOST) {
        throw new Error(`${sheet}: API error REDIRECT_HOST`);
      }
      if (nextUrl.searchParams.has("apiKey")) {
        throw new Error(`${sheet}: API error REDIRECT_KEY`);
      }
      response = await fetchImpl(nextUrl, { ...init, redirect: "manual" });
    }
    return response;
  };

  /**
   * Read every record of one tab through the SOLON API (GET, apiKey query param,
   * paginated). Errors never include the request URL, because it carries the key.
   * @param {string} sheet exact tab name
   * @param {{ fetchImpl?: typeof fetch, baseUrl?: string, apiKey?: string }} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  const fetchTab = async (sheet, options = {}) => {
    const fetchImpl = options.fetchImpl || fetch;
    const baseUrl = options.baseUrl || process.env.SHEETS_API_URL || DEFAULT_API_URL;
    const apiKey = options.apiKey ?? process.env.SHEETS_API_KEY ?? "";
    if (!apiKey) throw new Error("SHEETS_API_KEY is not set");
    const rows = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const requestUrl = new URL(baseUrl);
      requestUrl.searchParams.set("apiKey", apiKey);
      requestUrl.searchParams.set("sheet", sheet);
      requestUrl.searchParams.set("limit", String(PAGE_LIMIT));
      requestUrl.searchParams.set("offset", String(offset));

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let response = null;
      try {
        response = await fetchWithSafeRedirect(fetchImpl, requestUrl, { signal: ctrl.signal }, sheet);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) throw new Error(`${sheet}: HTTP ${response.status}`);
      let body = null;
      try {
        body = await response.json();
      } catch {
        throw new Error(`${sheet}: response is not JSON`);
      }
      if (!body || body.success !== true) {
        const code = typeof body?.error?.code === "string" ? body.error.code : "UNKNOWN";
        throw new Error(`${sheet}: API error ${code}`);
      }
      if (!Array.isArray(body.data)) throw new Error(`${sheet}: data is not an array`);
      rows.push(...body.data);
      if (!body.pagination || body.pagination.hasMore !== true) return rows;
      if (body.data.length === 0) throw new Error(`${sheet}: pagination reports more rows but returned none`);
      offset += body.data.length;
    }
    throw new Error(`${sheet}: more than ${MAX_PAGES} pages`);
  };

  /**
   * @param {{ fetchImpl?: typeof fetch, baseUrl?: string, apiKey?: string }} [options]
   * @returns {Promise<ReturnType<typeof validateSnapshot>>}
   */
  const fetchData = async (options = {}) => {
    /** @type {Record<string, Record<string, unknown>[]>} */
    const raw = {};
    for (const tab of PRICING_TABS) raw[tab] = await fetchTab(tab, options);
    return validateLivePayload(raw);
  };

  /**
   * @param {ReturnType<typeof validateSnapshot>} data
   */
  function model(data) {
    const plans = data.Abonamente.filter((row) => row.Activ === true && packageDisplayName(row)).map((row) => {
      const displayName = packageDisplayName(row);
      const name = canonicalPackageName(displayName) ?? displayName;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const links = {};
      for (const [periodKey, column] of [["monthly", "Netopia Payment Link Month"], ["annual", "Netopia Payment Link Year"]]) {
        const linkCell = row[column];
        if (isNetopiaLink(linkCell)) links[periodKey] = linkCell.trim();
        else if (linkCell && String(linkCell).trim() !== "-") {
          console.warn(`::warning::build-pricing: ${name} ${periodKey} link is not a NETOPIA checkout URL, button hidden (${linkCell})`);
        }
      }
      return {
        name,
        slug,
        monthly: toNumber(row["Pret lunar (RON)"]),
        annual: toNumber(row["Pret anual (RON)"]),
        inclusions: String(row.Servicii || "").split(/\n|;/).map(roInclusion).filter(Boolean),
        audience: AUDIENCE[slug] || "",
        links,
      };
    });
    return { plans };
  }

  /**
   * @param {number | null} amount
   * @param {string} unit
   */
  function priceHtml(amount, unit) {
    return amount ? `${fmt(amount)} <small>lei/${unit}</small>` : "<small>preț la cerere</small>";
  }

  /** @param {{ plans: ReturnType<typeof model>["plans"] }} view */
  function renderPricing({ plans }) {
    const cols = plans.length >= 4 ? "col-lg-3 col-md-6" : "col-lg-4";
    const cards = plans
      .map((plan, index) => {
        /** @param {"monthly" | "annual"} period */
        const renderBuyButton = (period) => {
          const label = `Alege ${plan.name} ${period === "monthly" ? "lunar" : "anual"}`;
          if (!plan.links[period]) return `<!-- PAYMENT-LINK ${plan.slug}/${period}: no NETOPIA link in sheet yet -->`;
          return `<a href="${esc(plan.links[period])}" target="_blank" rel="noopener" class="buy-btn" data-plan="${esc(plan.slug)}" data-billing="${period}">${esc(label)}</a>`;
        };
        return `          <div class="${cols} mt-4" data-aos="fade-up" data-aos-delay="${100 * (index + 1)}">
            <div class="box featured ${esc(plan.slug)} text-center">
              <h3>${esc(plan.name.toUpperCase())}</h3>
              <h4>
                <span class="price-monthly">${priceHtml(plan.monthly, "lună")}</span>
                <span class="price-annual" hidden>${priceHtml(plan.annual, "an")}</span>
                ${plan.audience ? `<span class="details">${esc(plan.audience)}</span>` : ""}
              </h4>
              <ul>
${plan.inclusions.map((line) => `                <li><i class="bi bi-check"></i> ${esc(line)}</li>`).join("\n")}
              </ul>
              <div class="price-monthly">${renderBuyButton("monthly")}</div>
              <div class="price-annual" hidden>${renderBuyButton("annual")}</div>
            </div>
          </div>`;
      })
      .join("\n\n");
    return `<!-- PRICING:START (generated by scripts/build-pricing.js from sheet "SOLON API" / Abonamente; do not edit by hand) -->
        <div class="row pricing-row-flush">
          <div class="col-12 d-flex justify-content-center">
            <div class="toggle-container pricing-billing-toggle" role="radiogroup" aria-label="Perioada de facturare">
              <div class="switch-toggle well">
                <input id="monthly" name="term" type="radio" value="monthly" checked>
                <label id="montly-btn" for="monthly">Lunar</label>
                <input id="yearly" name="term" type="radio" value="yearly">
                <label id="anual-btn" for="yearly">Anual</label>
                <a class="btn btn-toggle" aria-hidden="true"></a>
              </div>
            </div>
          </div>
        </div>
        <div class="row">
${cards}
        </div>
        <!-- PRICING:END -->`;
  }

  /** @param {{ plans: ReturnType<typeof model>["plans"] }} view */
  function renderFaq({ plans }) {
    const names = plans.map((plan) => `<b>${esc(plan.name)}</b>`);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} și ${names[names.length - 1]}` : names[0];
    /** @param {string[]} items */
    const join = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} și ${items[items.length - 1]}` : items[0]);
    const isUnlimited = (plan) => plan.inclusions.includes("Modificări nelimitate pe website");
    const unlimited = plans.filter(isUnlimited).map((plan) => `<b>${esc(plan.name)}</b>`);
    const limited = plans.filter((plan) => !isUnlimited(plan)).map((plan) => `<b>${esc(plan.name)}</b>`);
    const updatesSentence =
      unlimited.length === 0
        ? "Fiecare abonament include un număr fix de modificări pe website în fiecare lună."
        : limited.length === 0
          ? "Fiecare abonament include modificări nelimitate pe website."
          : `Abonamentele ${join(limited)} includ un număr fix de modificări pe website în fiecare lună, iar ${join(unlimited)} include modificări nelimitate pe website.`;
    return `<!-- PRICING-FAQ:START (generated by scripts/build-pricing.js) -->
                    <p>
                      Oferta SOLON cuprinde ${plans.length} abonamente în lei: ${list}. Le poți plăti lunar sau anual, iar la abonamentul anual plătești mai puțin decât 12 luni separate. ${updatesSentence} O modificare este o singură schimbare, pe care o poți descrie într-o propoziție și care durează sub o oră. Serviciile individuale rămân disponibile și ca add-on.</p>
                    <!-- PRICING-FAQ:END -->`;
  }

  /** @param {{ plans: ReturnType<typeof model>["plans"] }} view */
  function renderJsonLd({ plans }) {
    const offers = [];
    for (const plan of plans) {
      for (const [periodKey, unit, label] of [["monthly", "MON", "lunar"], ["annual", "ANN", "anual"]]) {
        if (!plan[periodKey]) continue;
        offers.push({
          "@type": "Offer",
          name: `Abonament ${plan.name} (${label})`,
          price: String(plan[periodKey]),
          priceCurrency: "RON",
          priceSpecification: { "@type": "UnitPriceSpecification", price: String(plan[periodKey]), priceCurrency: "RON", unitCode: unit },
          seller: { "@id": "https://solon.agency/#organization" },
          url: "https://solon.agency/#pricing",
        });
      }
    }
    const doc = { "@context": "https://schema.org", "@type": "OfferCatalog", name: "Abonamente SOLON", url: "https://solon.agency/#pricing", itemListElement: offers };
    return `<!-- PRICING-JSONLD:START -->
  <script type="application/ld+json">
${JSON.stringify(doc, null, 2).replace(/</g, "\\u003c").replace(/^/gm, "  ")}
  </script>
  <!-- PRICING-JSONLD:END -->`;
  }

  /**
   * @param {string} html
   * @param {string} name
   * @param {string} content
   */
  function replaceBlock(html, name, content) {
    const re = new RegExp(`<!-- ${name}:START[\\s\\S]*?<!-- ${name}:END -->`);
    if (!re.test(html)) throw new Error(`marker ${name} not found in index.html`);
    return html.replace(re, () => content);
  }

  /**
   * @param {string} html
   * @param {ReturnType<typeof model>} viewModel
   */
  function render(html, viewModel) {
    let out = replaceBlock(html, "PRICING", renderPricing(viewModel));
    out = replaceBlock(out, "PRICING-FAQ", renderFaq(viewModel));
    out = replaceBlock(out, "PRICING-JSONLD", renderJsonLd(viewModel));
    return out;
  };

  /** @param {ReturnType<typeof validateSnapshot>} data */
  const writeSnapshotFile = (data) => {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(data, null, 2)}\n`);
  };

  /** @returns {ReturnType<typeof validateSnapshot>} */
  const readSnapshotFile = () => {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    return validateSnapshot({ Abonamente: parsed.Abonamente });
  };

  /**
   * @param {{ offline?: boolean, fetchImpl?: typeof fetch, baseUrl?: string, apiKey?: string }} [options]
   * @returns {Promise<{ data: ReturnType<typeof validateSnapshot>, source: "api" | "snapshot", errorMessage?: string }>}
   */
  const resolvePricingData = async (options = {}) => {
    const offline = options.offline === true;
    if (!offline) {
      try {
        const data = await fetchData(options);
        return { data, source: "api" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { data: readSnapshotFile(), source: "snapshot", errorMessage: message };
      }
    }
    return { data: readSnapshotFile(), source: "snapshot" };
  };

  /** CLI entry: fetch sheet (optional), render pricing blocks into index.html. */
  const main = async () => {
    const offline = process.argv.includes("--offline");
    const check = process.argv.includes("--check");
    const sanitizeOnly = process.argv.includes("--sanitize-snapshot");

    if (sanitizeOnly) {
      const raw = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
      const data = validateSnapshot({ Abonamente: raw.Abonamente });
      writeSnapshotFile(data);
      console.log(`build-pricing: sanitized snapshot (${data.Abonamente.length} Abonamente rows)`);
      return;
    }

    const resolved = await resolvePricingData({ offline });
    if (resolved.errorMessage) {
      console.error(
        `::error::build-pricing: SOLON API failed (${resolved.errorMessage}); using committed snapshot ${path.relative(root, SNAPSHOT)}`,
      );
    }
    if (resolved.source === "api") {
      writeSnapshotFile(resolved.data);
      console.log(`build-pricing: fetched ${resolved.data.Abonamente.length} Abonamente rows from SOLON API`);
    }

    const before = fs.readFileSync(INDEX, "utf8");
    const viewModel = model(resolved.data);
    const after = render(before, viewModel);
    if (check) {
      if (before !== after) {
        console.error("::error::build-pricing: index.html is out of date; run node scripts/build-pricing.js --offline");
        throw new Error("index.html is out of date");
      }
      return;
    }
    if (after !== before) fs.writeFileSync(INDEX, after);
    console.log(`build-pricing: rendered ${viewModel.plans.map((plan) => plan.name).join(", ")}`);
  };

  if (require.main === module) {
    main().catch((err) => {
      console.error(`::error::build-pricing: ${err.message}`);
      process.exitCode = 1;
    });
  }

  module.exports = {
    isNetopiaLink,
    roInclusion,
    fetchTab,
    fetchData,
    fetchWithSafeRedirect,
    model,
    render,
    validate,
    validateSnapshot,
    validateLivePayload,
    sanitizeSnapshotPayload,
    sanitizeAbonamenteRow,
    resolvePricingData,
    ABONAMENTE_SNAPSHOT_KEYS,
    REQUEST_TIMEOUT_MS,
    REQUIRED_ACTIVE_PACKAGES,
    ALLOWED_ACTIVE_PACKAGE_NAMES,
  };
})();
