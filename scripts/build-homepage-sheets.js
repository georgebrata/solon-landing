"use strict";
/**
 * Build-time homepage FAQ + testimonials from SOLON API (FAQ + Testimonials tabs)
 * or committed data/homepage-sheets.snapshot.json. Legacy public FAQ JSON is used
 * only when the API key is missing and the snapshot FAQ array is empty.
 *
 * The committed snapshot is never rewritten during deploy/CI; refresh it locally with
 * --write-snapshot after verifying API output.
 *
 * Usage: node scripts/build-homepage-sheets.js [--offline] [--check] [--write-snapshot]
 */
(() => {
  const fs = require("fs");
  const path = require("path");
  const { fetchTab, fetchWithSafeRedirect } = require("./build-pricing");

  const root = path.join(__dirname, "..");
  const SNAPSHOT = path.join(root, "data", "homepage-sheets.snapshot.json");
  const INDEX = path.join(root, "index.html");
  const LEGACY_FAQ_URL =
    "https://script.google.com/macros/s/AKfycbyjMcA6j9Yz3_RGZn7jAL_rAPDDDgCPeIDUj5c50aXICq6jUFg1bzGqo9wxC-Dzh6w/exec?path=items";
  const API_TABS = Object.freeze(["FAQ", "Testimonials"]);
  const REQUEST_TIMEOUT_MS = 30000;

  /** @param {string} text */
  const esc = (text) =>
    String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  /**
   * @param {string} html
   * @param {string} name
   * @param {string} block
   */
  const replaceBlock = (html, name, block) => {
    const re = new RegExp(`<!-- ${name}:START[^>]*>[\\s\\S]*?<!-- ${name}:END -->`, "u");
    if (!re.test(html)) throw new Error(`build-homepage-sheets: ${name} markers missing in index.html`);
    return html.replace(re, block);
  };

  /** @param {unknown} row */
  const truthyVisible = (row) => {
    if (!row || typeof row !== "object") return false;
    const visible = row.Visible ?? row.visible ?? row.Activ ?? row.activ;
    if (visible === false || visible === "FALSE" || visible === "false" || visible === 0 || visible === "0") return false;
    return true;
  };

  /**
   * @param {Record<string, unknown>} row
   * @returns {Record<string, unknown> | null}
   */
  const normalizeFaqRow = (row) => {
    const intrebare = String(row.Intrebare ?? row.intrebare ?? row.Question ?? "").trim();
    const raspuns = String(row.Raspuns ?? row.raspuns ?? row.Answer ?? "").trim();
    if (!intrebare || !raspuns) return null;
    return { Intrebare: intrebare, Raspuns: raspuns, Visible: truthyVisible(row) };
  };

  /**
   * @param {Record<string, unknown>} row
   * @returns {Record<string, unknown> | null}
   */
  const normalizeTestimonialRow = (row) => {
    const nume = String(row.Nume ?? row.nume ?? row.Name ?? "").trim();
    const citat = String(row.Citat ?? row.citat ?? row.Quote ?? row.Text ?? "").trim();
    const imagine = String(row.Imagine ?? row.imagine ?? row.Image ?? "").trim();
    if (!nume || !citat || !imagine) return null;
    return {
      id: String(row.id ?? row.Id ?? nume).trim(),
      Nume: nume,
      Subtitlu: String(row.Subtitlu ?? row.subtitlu ?? row.Cabinet ?? row.Subtitle ?? "").trim(),
      Citat: citat,
      Imagine: imagine,
      Alt: String(row.Alt ?? row.alt ?? "").trim(),
      Width: String(row.Width ?? row.width ?? "432").trim(),
      Height: String(row.Height ?? row.height ?? "426").trim(),
      Visible: truthyVisible(row),
      Active: row.Active === true || row.active === true || row.Active === "TRUE",
      QuoteClass: String(row.QuoteClass ?? row.quoteClass ?? "").trim(),
    };
  };

  /**
   * @param {unknown} payload
   */
  const validateSnapshot = (payload) => {
    if (!payload || typeof payload !== "object") throw new Error("snapshot must be an object");
    const faq = Array.isArray(payload.FAQ) ? payload.FAQ.map(normalizeFaqRow).filter(Boolean) : [];
    const testimonials = Array.isArray(payload.Testimonials)
      ? payload.Testimonials.map(normalizeTestimonialRow).filter(Boolean)
      : [];
    return { FAQ: faq, Testimonials: testimonials };
  };

  const readCommittedSnapshot = () => validateSnapshot(JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")));

  /**
   * @param {unknown} apiRows
   * @param {ReturnType<typeof validateSnapshot>["FAQ"]} committedFaq
   */
  const pickFaqRows = (apiRows, committedFaq) => {
    if (!Array.isArray(apiRows)) {
      console.warn("::warning::build-homepage-sheets: FAQ tab missing or not an array; using committed snapshot");
      return committedFaq;
    }
    const normalized = apiRows.map(normalizeFaqRow).filter(Boolean);
    const visible = normalized.filter((row) => row.Visible);
    if (visible.length === 0) {
      console.warn("::warning::build-homepage-sheets: FAQ tab empty or no visible rows; using committed snapshot");
      return committedFaq;
    }
    return normalized;
  };

  /**
   * @param {unknown} apiRows
   * @param {ReturnType<typeof validateSnapshot>["Testimonials"]} committedTestimonials
   */
  const pickTestimonialRows = (apiRows, committedTestimonials) => {
    if (!Array.isArray(apiRows)) {
      console.warn(
        "::warning::build-homepage-sheets: Testimonials tab missing or not an array; using committed snapshot",
      );
      return committedTestimonials;
    }
    const normalized = apiRows.map(normalizeTestimonialRow).filter(Boolean);
    const visible = normalized.filter((row) => row.Visible);
    if (visible.length === 0) {
      console.warn(
        "::warning::build-homepage-sheets: Testimonials tab empty or missing required columns; using committed snapshot",
      );
      return committedTestimonials;
    }
    return normalized;
  };

  /**
   * @param {ReturnType<typeof validateSnapshot>["Testimonials"]} items
   */
  const ensureCarouselActive = (items) => {
    const visible = items.filter((item) => item.Visible);
    if (visible.length === 0) return items;
    if (visible.some((item) => item.Active)) return items;
    const firstVisibleId = visible[0].id;
    return items.map((item) => ({
      ...item,
      Active: item.Visible && item.id === firstVisibleId,
    }));
  };

  /**
   * @param {{ faqRows?: unknown, testimonialRows?: unknown, committed: ReturnType<typeof validateSnapshot> }} input
   */
  const buildRenderData = (input) => {
    const faq =
      input.faqRows === undefined
        ? input.committed.FAQ
        : pickFaqRows(input.faqRows, input.committed.FAQ);
    const testimonials = ensureCarouselActive(
      input.testimonialRows === undefined
        ? input.committed.Testimonials
        : pickTestimonialRows(input.testimonialRows, input.committed.Testimonials),
    );
    return { FAQ: faq, Testimonials: testimonials };
  };

  /** @param {typeof fetch} fetchImpl */
  const fetchLegacyFaq = async (fetchImpl) => {
    const requestUrl = new URL(LEGACY_FAQ_URL);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchWithSafeRedirect(fetchImpl, requestUrl, { signal: ctrl.signal }, "legacy-faq");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`legacy-faq: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error("legacy-faq: response is not an array");
    return body.map(normalizeFaqRow).filter(Boolean);
  };

  /**
   * @param {{ offline?: boolean, fetchImpl?: typeof fetch }} [options]
   */
  const resolveData = async (options = {}) => {
    const offline = Boolean(options.offline);
    const fetchImpl = options.fetchImpl || fetch;
    const committed = readCommittedSnapshot();
    let source = "snapshot";
    let data = buildRenderData({ committed });

    if (offline) {
      return { data, source, committed };
    }

    if (process.env.SHEETS_API_KEY) {
      try {
        const raw = {};
        for (const tab of API_TABS) raw[tab] = await fetchTab(tab, { fetchImpl });
        data = buildRenderData({
          faqRows: raw.FAQ,
          testimonialRows: raw.Testimonials,
          committed,
        });
        source = "api";
      } catch (error) {
        console.error(
          `::error::build-homepage-sheets: SOLON API failed (${error.message}); using committed snapshot ${path.relative(root, SNAPSHOT)}`,
        );
        data = buildRenderData({ committed });
      }
    } else if (!offline && data.FAQ.filter((row) => row.Visible).length === 0) {
      try {
        const legacy = await fetchLegacyFaq(fetchImpl);
        if (legacy.some((row) => row.Visible)) {
          data = buildRenderData({
            faqRows: legacy,
            testimonialRows: committed.Testimonials,
            committed,
          });
          source = "legacy-faq";
        }
      } catch (error) {
        console.error(`::error::build-homepage-sheets: legacy FAQ fetch failed (${error.message}); using snapshot FAQ`);
      }
    }

    return { data, source, committed };
  };

  /**
   * @param {ReturnType<typeof validateSnapshot>["FAQ"][number]} item
   * @param {number} index
   */
  const renderFaqItem = (item, index) => {
    return `            <li data-aos="fade-in" data-aos-delay="${index * 100}">
            <i class="bi bi-question-circle icon-help"></i>
            <button type="button" data-bs-toggle="collapse" class="collapse collapsed" data-bs-target="#faq-list-${index}" aria-expanded="false" aria-controls="faq-list-${index}">
                ${esc(item.Intrebare)}
            <i class="bi bi-chevron-down icon-show"></i><i class="bi bi-chevron-up icon-close"></i>
            </button>
            <div id="faq-list-${index}" class="collapse" data-bs-parent=".faq-list">
            <p>
                ${esc(item.Raspuns)}
            </p>
            </div>
        </li>`;
  };

  /** @param {ReturnType<typeof validateSnapshot>["FAQ"]} items */
  const renderFaqBlock = (items) => {
    const visible = items.filter((item) => item.Visible);
    const rows = visible.map((item, index) => renderFaqItem(item, index)).join("\n\n");
    return `<!-- HOME-FAQ:START (generated by scripts/build-homepage-sheets.js; do not edit by hand) -->
${rows}
          <!-- HOME-FAQ:END -->`;
  };

  /** @param {ReturnType<typeof validateSnapshot>["Testimonials"][number]} item */
  const renderTestimonialSlide = (item) => {
    const activeClass = item.Active ? " active" : "";
    const quoteClass = item.QuoteClass ? ` class="${esc(item.QuoteClass)}"` : "";
    return `              <div class="carousel-item${activeClass}">
                <div class="row">
                  <div class="col-md-12 offset-lg-2 col-lg-8 mb-3 mt-4">
                    <div class="member testimonial-member h-8 d-flex align-items-start">
                      <div class="pic">
                        <img src="${esc(item.Imagine)}" class="img-fluid" width="${esc(item.Width)}" height="${esc(item.Height)}"
                          alt="${esc(item.Alt)}"
                          loading="lazy" decoding="async" />
                      </div>
                      <div class="member-info">
                        <h3>${esc(item.Nume)}</h3>
                        <span>${esc(item.Subtitlu)}</span>
                        <blockquote class="blockquote mb-4">
                          <p${quoteClass}>
                            <i class="bi bi-chat-right-quote-fill"></i> ${esc(item.Citat)}
                          </p>
                        </blockquote>
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;
  };

  /** @param {ReturnType<typeof validateSnapshot>["Testimonials"]} items */
  const renderTestimonialsBlock = (items) => {
    const slides = ensureCarouselActive(items.filter((item) => item.Visible)).map((item) =>
      renderTestimonialSlide(item),
    ).join("\n");
    return `<!-- TESTIMONIALS:START (generated by scripts/build-homepage-sheets.js; do not edit by hand) -->
${slides}
              <!-- TESTIMONIALS:END -->`;
  };

  /**
   * @param {string} html
   * @param {ReturnType<typeof validateSnapshot>} data
   */
  const render = (html, data) => {
    const prepared = {
      FAQ: data.FAQ,
      Testimonials: ensureCarouselActive(data.Testimonials),
    };
    let out = replaceBlock(html, "HOME-FAQ", renderFaqBlock(prepared.FAQ));
    out = replaceBlock(out, "TESTIMONIALS", renderTestimonialsBlock(prepared.Testimonials));
    return out;
  };

  const main = async () => {
    const offline = process.argv.includes("--offline");
    const check = process.argv.includes("--check");
    const writeSnapshot = process.argv.includes("--write-snapshot");
    const { data, source } = await resolveData({ offline });
    if (writeSnapshot && !offline && source === "api") {
      fs.writeFileSync(SNAPSHOT, `${JSON.stringify(data, null, 2)}\n`);
      console.log(`build-homepage-sheets: wrote ${path.relative(root, SNAPSHOT)} from API render data`);
    }
    const before = fs.readFileSync(INDEX, "utf8");
    const after = render(before, data);
    if (check) {
      if (before !== after) {
        console.error("::error::build-homepage-sheets: index.html is out of date; run node scripts/build-homepage-sheets.js --offline");
        throw new Error("index.html is out of date");
      }
      return;
    }
    if (after !== before) fs.writeFileSync(INDEX, after);
    console.log(
      `build-homepage-sheets: rendered ${data.FAQ.filter((r) => r.Visible).length} FAQ, ${data.Testimonials.filter((r) => r.Visible).length} testimonials (source: ${source})`,
    );
  };

  if (require.main === module) {
    main().catch((err) => {
      console.error(`::error::build-homepage-sheets: ${err.message}`);
      process.exitCode = 1;
    });
  }

  module.exports = {
    esc,
    validateSnapshot,
    render,
    renderFaqBlock,
    renderTestimonialsBlock,
    resolveData,
    replaceBlock,
    readCommittedSnapshot,
    buildRenderData,
    pickTestimonialRows,
    ensureCarouselActive,
    LEGACY_FAQ_URL,
    API_TABS,
  };
})();
