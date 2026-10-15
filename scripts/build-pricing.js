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
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const ENDPOINT =
  process.env.SOLON_DATA_URL ||
  "https://script.google.com/macros/s/AKfycbyH3CjUOWBxTKpjzHrjMkFbn_YBqFZ6MXLjH3WE4mDU9wNBPTViBMsC0wClML_S15yS/exec";
const SNAPSHOT = path.join(root, "data", "abonamente.snapshot.json");
const INDEX = path.join(root, "index.html");

/** Only NETOPIA checkout hosts are accepted. Anything else (Stripe, placeholders) hides the button. */
const NETOPIA_HOSTS = [/^mpy\.ro$/, /(^|\.)mobilpay\.ro$/, /(^|\.)netopia-payments\.com$/];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function isNetopiaLink(url) {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:") return false;
    if (/stripe/i.test(u.hostname)) return false;
    return NETOPIA_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Sheet inclusion cells are partly English; normalise known phrases to Romanian (tu voice, no promises). */
function roInclusion(raw) {
  let s = raw.replace(/^[\s\-•*]+/, "").replace(/[\s,;.]+$/, "").trim();
  if (!s) return "";
  const rules = [
    [/^(\d+)\s+website updates?\s*\/\s*month$/i, (m, n) => (n === "1" ? "1 modificare pe website / lună" : `${n} modificări pe website / lună`)],
    [/^(\d+)\s+social media posts?\s*\/\s*month$/i, (m, n) => (n === "1" ? "1 postare social media / lună" : `${n} postări social media / lună`)],
    [/^sync up to (\d+) social media profiles?$/i, (m, n) => `Sincronizare până la ${n} profile social media`],
    [/^google\s*my\s*busines+\s+maintenance$/i, () => "Mentenanță Google My Business"],
    [/^\.ro domain included for annual subs?$/i, () => "Domeniu .ro inclus la abonamentul anual"],
    [/^domeniu \.ro inclus la abonament anual$/i, () => "Domeniu .ro inclus la abonamentul anual"],
    [/^(\d+) sesiune de consultanta 1:1$/i, (m, n) => `${n} sesiune de consultanță digitală 1:1`],
  ];
  for (const [re, fn] of rules) {
    const m = s.match(re);
    if (m) return fn(...m);
  }
  console.warn(`::warning::build-pricing: no Romanian mapping for inclusion "${s}" (rendered as-is)`);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Notes are internal English text; map known ones to a short Romanian audience line. */
const AUDIENCE = {
  bronze: "Pentru avocați care lucrează individual",
  silver: "Pentru avocați asociați sau societăți mici",
  gold: "Pentru societăți cu până la 10 angajați",
  platinum: "Pentru societăți cu peste 10 angajați și parteneri",
};

function validate(data) {
  if (!data || !Array.isArray(data.Abonamente) || !Array.isArray(data.Servicii)) {
    throw new Error("payload has no Abonamente/Servicii arrays");
  }
  const active = data.Abonamente.filter((r) => r && r.Activ === true && String(r["Nume abonament"] || "").trim());
  if (!active.length) throw new Error("no active rows in Abonamente");
  for (const r of active) {
    if (!toNumber(r["Pret lunar (RON)"]) && !toNumber(r["Pret anual (RON)"])) {
      throw new Error(`active package "${r["Nume abonament"]}" has no price`);
    }
  }
  return data;
}

async function fetchData() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(ENDPOINT, { redirect: "follow", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return validate(await res.json());
  } finally {
    clearTimeout(t);
  }
}

function model(data) {
  const plans = data.Abonamente.filter((r) => r.Activ === true && String(r["Nume abonament"] || "").trim()).map((r) => {
    const name = String(r["Nume abonament"]).trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const links = {};
    for (const [k, col] of [["monthly", "Netopia Payment Link Month"], ["annual", "Netopia Payment Link Year"]]) {
      const v = r[col];
      if (isNetopiaLink(v)) links[k] = v.trim();
      else if (v && String(v).trim() !== "-") console.warn(`::warning::build-pricing: ${name} ${k} link is not a NETOPIA checkout URL, button hidden (${v})`);
    }
    return {
      name,
      slug,
      monthly: toNumber(r["Pret lunar (RON)"]),
      annual: toNumber(r["Pret anual (RON)"]),
      inclusions: String(r.Servicii || "").split(/\n|;/).map(roInclusion).filter(Boolean),
      audience: AUDIENCE[slug] || "",
      links,
    };
  });
  const addons = data.Servicii.filter((s) => s && s.Activ === true && s.Service).map((s) => ({
    name: String(s.Service).trim(),
    price: String(s["Pret (RON)"] || "")
      .split(/\n|;/)
      .map((x) => x.replace(/^[\s\-•]+/, "").trim())
      .filter(Boolean)
      .join(" · "),
  }));
  return { plans, addons };
}

function priceHtml(n, unit) {
  return n ? `${fmt(n)} <small>lei/${unit}</small>` : `<small>preț la cerere</small>`;
}

function renderPricing({ plans, addons }) {
  const cols = plans.length >= 4 ? "col-lg-3 col-md-6" : "col-lg-4";
  const cards = plans
    .map((p, i) => {
      const btn = (period) => {
        const label = `Alege ${p.name} ${period === "monthly" ? "lunar" : "anual"}`;
        if (!p.links[period]) return `<!-- PAYMENT-LINK ${p.slug}/${period}: no NETOPIA link in sheet yet -->`;
        return `<a href="${esc(p.links[period])}" target="_blank" rel="noopener" class="buy-btn" data-plan="${esc(p.slug)}" data-billing="${period}">${esc(label)}</a>`;
      };
      return `          <div class="${cols} mt-4" data-aos="fade-up" data-aos-delay="${100 * (i + 1)}">
            <div class="box featured ${esc(p.slug)} text-center">
              <h3>${esc(p.name.toUpperCase())}</h3>
              <h4>
                <span class="price-monthly">${priceHtml(p.monthly, "lună")}</span>
                <span class="price-annual" hidden>${priceHtml(p.annual, "an")}</span>
                ${p.audience ? `<span class="details">${esc(p.audience)}</span>` : ""}
              </h4>
              <ul>
${p.inclusions.map((x) => `                <li><i class="bi bi-check"></i> ${esc(x)}</li>`).join("\n")}
              </ul>
              <div class="price-monthly">${btn("monthly")}</div>
              <div class="price-annual" hidden>${btn("annual")}</div>
            </div>
          </div>`;
    })
    .join("\n\n");
  const addonList = addons
    .map((a) => `            <li><span class="addon-name">${esc(a.name)}</span>${a.price ? ` <span class="addon-price">${esc(a.price)}</span>` : ""}</li>`)
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

function renderFaq({ plans }) {
  const names = plans.map((p) => `<b>${esc(p.name)}</b>`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} și ${names[names.length - 1]}` : names[0];
  return `<!-- PRICING-FAQ:START (generated by scripts/build-pricing.js) -->
                    <p>
                      Oferta SOLON cuprinde ${plans.length} abonamente în lei: ${list}. Le poți plăti lunar sau anual, iar la abonamentul anual plătești mai puțin decât 12 luni separate. Fiecare abonament include un număr de modificări pe website pe lună. O modificare este o singură schimbare, pe care o poți descrie într-o propoziție și care durează sub o oră. Serviciile individuale rămân disponibile și ca add-on.</p>
                    <!-- PRICING-FAQ:END -->`;
}

function renderJsonLd({ plans }) {
  const offers = [];
  for (const p of plans) {
    for (const [k, unit, label] of [["monthly", "MON", "lunar"], ["annual", "ANN", "anual"]]) {
      if (!p[k]) continue;
      offers.push({
        "@type": "Offer",
        name: `Abonament ${p.name} (${label})`,
        price: String(p[k]),
        priceCurrency: "RON",
        priceSpecification: { "@type": "UnitPriceSpecification", price: String(p[k]), priceCurrency: "RON", unitCode: unit },
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

function replaceBlock(html, name, content) {
  const re = new RegExp(`<!-- ${name}:START[\\s\\S]*?<!-- ${name}:END -->`);
  if (!re.test(html)) throw new Error(`marker ${name} not found in index.html`);
  return html.replace(re, () => content);
}

function render(html, m) {
  let out = replaceBlock(html, "PRICING", renderPricing(m));
  out = replaceBlock(out, "PRICING-FAQ", renderFaq(m));
  out = replaceBlock(out, "PRICING-JSONLD", renderJsonLd(m));
  return out;
}

async function main() {
  const offline = process.argv.includes("--offline");
  const check = process.argv.includes("--check");
  let data;
  if (!offline) {
    try {
      data = await fetchData();
      fs.writeFileSync(SNAPSHOT, JSON.stringify({ Abonamente: data.Abonamente, Servicii: data.Servicii }, null, 2) + "\n");
      console.log(`build-pricing: fetched ${data.Abonamente.length} Abonamente rows from endpoint`);
    } catch (err) {
      console.error(`::error::build-pricing: endpoint failed (${err.message}); using committed snapshot ${path.relative(root, SNAPSHOT)}`);
    }
  }
  if (!data) data = validate(JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")));
  const before = fs.readFileSync(INDEX, "utf8");
  const m = model(data);
  const after = render(before, m);
  if (check) {
    if (before !== after) {
      console.error("::error::build-pricing: index.html is out of date; run node scripts/build-pricing.js --offline");
      process.exit(1);
    }
    return;
  }
  if (after !== before) fs.writeFileSync(INDEX, after);
  console.log(`build-pricing: rendered ${m.plans.map((p) => p.name).join(", ")}; ${m.addons.length} add-ons`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`::error::build-pricing: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { isNetopiaLink, roInclusion, model, render, validate };
