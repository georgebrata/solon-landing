"use strict";
/**
 * Build-time pricing: fetch "SOLON Data | Machine-readable" (tabs Abonamente +
 * Servicii) from the Apps Script endpoint, render active RON packages into
 * index.html between PRICING markers.
 *
 * Fail-safe: if the endpoint is down or returns invalid data, the committed
 * snapshot data/abonamente.snapshot.json is used and an ::error:: line is
 * logged (the build still succeeds so the site keeps the last good prices).
 * On success the snapshot is refreshed.
 *
 * Usage: node scripts/build-pricing.js [--offline] [--check]
 *   --offline  use the snapshot only (tests / no network)
 *   --check    exit 1 if index.html would change (CI drift check)
 */
(() => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const ENDPOINT =
    process.env.SOLON_DATA_URL ||
    "https://script.google.com/macros/s/AKfycbyH3CjUOWBxTKpjzHrjMkFbn_YBqFZ6MXLjH3WE4mDU9wNBPTViBMsC0wClML_S15yS/exec";
  const SNAPSHOT = path.join(root, "data", "abonamente.snapshot.json");
  const INDEX = path.join(root, "index.html");

  /** Public packages on solon.agency/#pricing (Bronze, Silver, Gold, Platinum). */
  const REQUIRED_ACTIVE_PACKAGES = 4;
  const ALLOWED_ACTIVE_PACKAGE_NAMES = Object.freeze(["Bronze", "Silver", "Gold", "Platinum"]);

  /** @param {Record<string, unknown>} row */
  function packageDisplayName(row) {
    return String(row["Nume abonament"] || "").trim();
  }

  /** @param {string} name */
  function canonicalPackageName(name) {
    return ALLOWED_ACTIVE_PACKAGE_NAMES.find((allowed) => allowed.toLowerCase() === name.toLowerCase()) ?? null;
  }

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
    const rules = [
      [/^(\d+)\s+website updates?\s*\/\s*month$/iu, (_match, count) => (count === "1" ? "1 modificare pe website / lună" : `${count} modificări pe website / lună`)],
      [/^(\d+)\s+social media posts?\s*\/\s*month$/iu, (_match, count) => (count === "1" ? "1 postare social media / lună" : `${count} postări social media / lună`)],
      [/^sync up to (\d+) social media profiles?$/iu, (_match, count) => `Sincronizare până la ${count} profile social media`],
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
   * @param {{ Abonamente?: unknown, Servicii?: unknown }} data
   */
  function validate(data) {
    if (!data || !Array.isArray(data.Abonamente) || !Array.isArray(data.Servicii)) {
      throw new Error("payload has no Abonamente/Servicii arrays");
    }
    const active = data.Abonamente.filter((row) => row && row.Activ === true && packageDisplayName(row));
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
      if (!toNumber(row["Pret lunar (RON)"]) && !toNumber(row["Pret anual (RON)"])) {
        throw new Error(`active package "${displayName}" has no price`);
      }
    }
    return data;
  }

  /** @returns {Promise<ReturnType<typeof validate>>} */
  async function fetchData() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(ENDPOINT, { redirect: "follow", signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return validate(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {ReturnType<typeof validate>} data
   */
  function model(data) {
    const plans = data.Abonamente.filter((row) => row.Activ === true && String(row["Nume abonament"] || "").trim()).map((row) => {
      const name = String(row["Nume abonament"]).trim();
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
    const addons = data.Servicii.filter((row) => row && row.Activ === true && row.Service).map((row) => ({
      name: String(row.Service).trim(),
      price: String(row["Pret (RON)"] || "")
        .split(/\n|;/)
        .map((part) => part.replace(/^[\s\-•]+/u, "").trim())
        .filter(Boolean)
        .join(" · "),
    }));
    return { plans, addons };
  }

  /**
   * @param {number | null} amount
   * @param {string} unit
   */
  function priceHtml(amount, unit) {
    return amount ? `${fmt(amount)} <small>lei/${unit}</small>` : "<small>preț la cerere</small>";
  }

  /** @param {{ plans: ReturnType<typeof model>["plans"], addons: ReturnType<typeof model>["addons"] }} view */
  function renderPricing({ plans, addons }) {
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
    const addonList = addons
      .map((addon) => `            <li><span class="addon-name">${esc(addon.name)}</span>${addon.price ? ` <span class="addon-price">${esc(addon.price)}</span>` : ""}</li>`)
      .join("\n");
    return `<!-- PRICING:START (generated by scripts/build-pricing.js from sheet "SOLON Data | Machine-readable" / Abonamente; do not edit by hand) -->
        <div class="row" style="padding: 0;">
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

        <div class="pricing-notes text-center mt-4">
          <p>Prețurile sunt în lei. SOLON SRL nu este plătitoare de TVA. Abonamentul lunar acoperă mentenanța, nu construirea unui website nou.</p>
          <p><b>O modificare</b> înseamnă o singură schimbare pe website, pe care o poți descrie într-o propoziție și care durează sub o oră. <b>Sincronizarea social media</b> înseamnă auditul profilurilor tale și publicarea aceluiași conținut pe mai multe profiluri.</p>
          <p>Ai deja un abonament mai vechi, în euro? Rămâi pe planul tău actual, la același preț.</p>
        </div>

        <div class="pricing-addons mt-4">
          <h3 class="text-center">Servicii suplimentare (add-on)</h3>
          <p class="text-center">Poți adăuga oricând la abonament oricare dintre serviciile de mai jos, la prețul lor standard:</p>
          <ul class="addon-list">
${addonList}
          </ul>
        </div>
        <!-- PRICING:END -->`;
  }

  /** @param {{ plans: ReturnType<typeof model>["plans"] }} view */
  function renderFaq({ plans }) {
    const names = plans.map((plan) => `<b>${esc(plan.name)}</b>`);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} și ${names[names.length - 1]}` : names[0];
    return `<!-- PRICING-FAQ:START (generated by scripts/build-pricing.js) -->
                    <p>
                      Oferta SOLON cuprinde ${plans.length} abonamente în lei: ${list}. Le poți plăti lunar sau anual, iar la abonamentul anual plătești mai puțin decât 12 luni separate. Fiecare abonament include un număr de modificări pe website pe lună. O modificare este o singură schimbare, pe care o poți descrie într-o propoziție și care durează sub o oră. Serviciile individuale rămân disponibile și ca add-on.</p>
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
  }

  /** CLI entry: fetch sheet (optional), render pricing blocks into index.html. */
  async function main() {
    const offline = process.argv.includes("--offline");
    const check = process.argv.includes("--check");
    let data = null;
    if (!offline) {
      try {
        data = await fetchData();
        const snapshotBody = `${JSON.stringify({ Abonamente: data.Abonamente, Servicii: data.Servicii }, null, 2)}\n`;
        fs.writeFileSync(SNAPSHOT, snapshotBody);
        console.log(`build-pricing: fetched ${data.Abonamente.length} Abonamente rows from endpoint`);
      } catch (err) {
        console.error(`::error::build-pricing: endpoint failed (${err.message}); using committed snapshot ${path.relative(root, SNAPSHOT)}`);
      }
    }
    if (!data) data = validate(JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")));
    const before = fs.readFileSync(INDEX, "utf8");
    const viewModel = model(data);
    const after = render(before, viewModel);
    if (check) {
      if (before !== after) {
        console.error("::error::build-pricing: index.html is out of date; run node scripts/build-pricing.js --offline");
        throw new Error("index.html is out of date");
      }
      return;
    }
    if (after !== before) fs.writeFileSync(INDEX, after);
    console.log(`build-pricing: rendered ${viewModel.plans.map((plan) => plan.name).join(", ")}; ${viewModel.addons.length} add-ons`);
  }

  if (require.main === module) {
    main().catch((err) => {
      console.error(`::error::build-pricing: ${err.message}`);
      process.exitCode = 1;
    });
  }

  module.exports = {
    isNetopiaLink,
    roInclusion,
    model,
    render,
    validate,
    REQUIRED_ACTIVE_PACKAGES,
    ALLOWED_ACTIVE_PACKAGE_NAMES,
  };
})();
