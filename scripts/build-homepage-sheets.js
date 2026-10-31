"use strict";
/**
 * Build-time homepage FAQ + testimonials from SOLON API (FAQ + Testimonials tabs).
 * When SHEETS_API_KEY is not set, falls back to data/homepage-sheets.snapshot.json.
 *
 * The committed snapshot is never rewritten during deploy/CI; refresh locally with
 * --write-snapshot after verifying live API output.
 *
 * Usage: node scripts/build-homepage-sheets.js [--offline] [--check] [--write-snapshot]
 */
(() => {
  const fs = require("fs");
  const path = require("path");
  const { fetchTab } = require("./build-pricing");
  const { buildJsonLdTag } = require("./json-ld");

  const root = path.join(__dirname, "..");
  const SNAPSHOT = path.join(root, "data", "homepage-sheets.snapshot.json");
  const INDEX = path.join(root, "index.html");
  const API_TABS = Object.freeze(["FAQ", "Testimonials"]);
  /** @param {string} text */
  const esc = (text) =>
    String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  /** @param {string} text */
  const decodeHtmlEntities = (text) =>
    String(text)
      .replace(/&amp;/giu, "&")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;/giu, "'")
      .replace(/&#x27;/giu, "'");

  const HTTPS_ANCHOR_ON_ESCAPED =
    /&lt;a href=&quot;(https:\/\/(?:[^&]|&amp;)*?)&quot;&gt;((?:(?!&lt;|&gt;|&quot;).)*?)&lt;\/a&gt;/giu;

  /**
   * Escape all markup, then re-allow only &lt;br&gt; and exact https anchors with plain link text.
   * @param {string} raw
   */
  const sanitizeRichText = (raw) => {
    const stripped = decodeHtmlEntities(String(raw)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "");
    let text = esc(stripped);
    text = text.replace(/&lt;br\s*\/?&gt;/giu, "<br>");
    text = text.replace(HTTPS_ANCHOR_ON_ESCAPED, (match, escapedHref, linkText) => {
      const href = decodeHtmlEntities(escapedHref);
      if (!/^https:\/\//iu.test(href) || /[\s<>"']/u.test(href)) return match;
      if (/^(javascript|data|vbscript):/iu.test(href)) return match;
      if (/&lt;|&gt;|&quot;|&#39;/u.test(linkText)) return match;
      if (/\bon\w+\s*=/iu.test(match)) return match;
      return `<a href="${esc(href)}" rel="noopener">${linkText}</a>`;
    });
    return text;
  };

  const sanitizeFaqAnswer = sanitizeRichText;

  /**
   * @param {string} html
   * @param {string} name
   * @param {string} block
   */
  const replaceBlock = (html, name, block) => {
    const re = new RegExp(`<!-- ${name}:START[^>]*>[\\s\\S]*?<!-- ${name}:END -->`, "u");
    if (!re.test(html)) throw new Error(`build-homepage-sheets: ${name} markers missing in index.html`);
    return html.replace(re, () => block);
  };

  /** @param {unknown} value */
  const isExplicitVisible = (value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value.trim() === "") return false;
    if (value === false || value === "FALSE" || value === "false" || value === 0 || value === "0") return false;
    if (value === true || value === "TRUE" || value === "true" || value === 1 || value === "1") return true;
    return false;
  };

  /** @param {unknown} row */
  const truthyVisible = (row) => {
    if (!row || typeof row !== "object") return false;
    const keys = ["Visible", "visible", "Activ", "activ"];
    let sawKey = false;
    for (const key of keys) {
      if (!(key in row)) continue;
      sawKey = true;
      if (isExplicitVisible(row[key])) return true;
    }
    return sawKey ? false : false;
  };

  /**
   * @param {Record<string, unknown>} row
   * @returns {Record<string, unknown> | null}
   */
  const normalizeFaqRow = (row) => {
    if (!row || typeof row !== "object") return null;
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
    if (!row || typeof row !== "object") return null;
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
   * @param {ReturnType<typeof validateSnapshot>["FAQ"]} items
   */
  const visibleFaqItems = (items) => items.filter((item) => item.Visible);

  /** @param {string} raw */
  const faqAnswerPlainText = (raw) =>
    decodeHtmlEntities(String(raw))
      .replace(/<br\s*\/?>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();

  /**
   * @param {unknown} apiRows
   * @param {ReturnType<typeof validateSnapshot>["FAQ"]} committedFaq
   * @param {{ snapshotFallback?: boolean, label?: string }} [options]
   */
  const pickFaqRows = (apiRows, committedFaq, options = {}) => {
    const { snapshotFallback = false, label = "FAQ" } = options;
    if (!Array.isArray(apiRows)) {
      console.warn(`::warning::build-homepage-sheets: ${label} tab missing or not an array; using committed snapshot`);
      return committedFaq;
    }
    const normalized = [];
    for (const row of apiRows) {
      const next = normalizeFaqRow(row);
      if (!next) {
        console.warn(`::warning::build-homepage-sheets: skipped malformed ${label} row`);
        continue;
      }
      normalized.push(next);
    }
    if (snapshotFallback && visibleFaqItems(normalized).length === 0) {
      console.warn(
        `::warning::build-homepage-sheets: ${label} tab empty or no visible rows; using committed snapshot`,
      );
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
    const normalized = [];
    for (const row of apiRows) {
      const next = normalizeTestimonialRow(row);
      if (!next) {
        console.warn("::warning::build-homepage-sheets: skipped malformed Testimonials row");
        continue;
      }
      normalized.push(next);
    }
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
    if (visible.length === 0) return items.map((item) => ({ ...item, Active: false }));
    let activeId = visible.find((item) => item.Active)?.id;
    if (!activeId) activeId = visible[0].id;
    return items.map((item) => ({
      ...item,
      Active: Boolean(item.Visible && item.id === activeId),
    }));
  };

  /**
   * @param {{ faqRows?: unknown, testimonialRows?: unknown, committed: ReturnType<typeof validateSnapshot> }} input
   */
  /**
   * @param {unknown} faqRows
   * @param {ReturnType<typeof validateSnapshot>["FAQ"]} committedFaq
   */
  const resolveFaqRows = (faqRows, committedFaq) => {
    if (faqRows === undefined) {
      return { FAQ: committedFaq, source: /** @type {const} */ ("snapshot") };
    }
    if (!Array.isArray(faqRows)) {
      return { FAQ: pickFaqRows(faqRows, committedFaq), source: "snapshot" };
    }
    return {
      FAQ: pickFaqRows(faqRows, committedFaq, { snapshotFallback: false }),
      source: "api",
    };
  };

  const buildRenderData = (input) => {
    const faqResolved = resolveFaqRows(input.faqRows, input.committed.FAQ);
    const testimonialPicked =
      input.testimonialRows === undefined
        ? input.committed.Testimonials
        : pickTestimonialRows(input.testimonialRows, input.committed.Testimonials);
    const testimonials = ensureCarouselActive(testimonialPicked);
    const sources = {
      FAQ: faqResolved.source,
      Testimonials:
        input.testimonialRows === undefined || testimonialPicked === input.committed.Testimonials
          ? "snapshot"
          : "api",
    };
    return { FAQ: faqResolved.FAQ, Testimonials: testimonials, sources };
  };

  /**
   * @param {{ offline?: boolean, fetchImpl?: typeof fetch }} [options]
   */
  /** @param {{ FAQ: "api" | "snapshot", Testimonials: "api" | "snapshot" }} sources */
  const aggregateSource = (sources) => {
    if (sources.FAQ === "api" && sources.Testimonials === "api") return "api";
    if (sources.FAQ === "snapshot" && sources.Testimonials === "snapshot") return "snapshot";
    return "mixed";
  };

  const resolveData = async (options = {}) => {
    const offline = Boolean(options.offline);
    const fetchImpl = options.fetchImpl || fetch;
    const committed = readCommittedSnapshot();
    /** @type {{ FAQ: "api" | "snapshot", Testimonials: "api" | "snapshot" }} */
    let sources = { FAQ: "snapshot", Testimonials: "snapshot" };
    let built = buildRenderData({ committed });
    let data = { FAQ: built.FAQ, Testimonials: built.Testimonials };
    sources = built.sources;
    let source = aggregateSource(sources);

    if (offline) {
      return { data, source, sources, committed };
    }

    if (process.env.SHEETS_API_KEY) {
      /** @type {unknown} */
      let faqRows;
      /** @type {unknown} */
      let testimonialRows;
      try {
        faqRows = await fetchTab("FAQ", { fetchImpl });
      } catch (error) {
        console.error(
          `::error::build-homepage-sheets: FAQ tab failed (${error.message}); using committed snapshot for FAQ`,
        );
      }
      try {
        testimonialRows = await fetchTab("Testimonials", { fetchImpl });
      } catch (error) {
        console.error(
          `::error::build-homepage-sheets: Testimonials tab failed (${error.message}); using committed snapshot for Testimonials`,
        );
      }
      built = buildRenderData({ faqRows, testimonialRows, committed });
      data = { FAQ: built.FAQ, Testimonials: built.Testimonials };
      sources = built.sources;
      source = aggregateSource(sources);
    }

    return { data, source, sources, committed };
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
                ${sanitizeFaqAnswer(item.Raspuns)}
            </p>
            </div>
        </li>`;
  };

  /** @param {ReturnType<typeof validateSnapshot>["FAQ"]} items */
  const renderFaqBlock = (items) => {
    const visible = visibleFaqItems(items);
    const rows = visible.map((item, index) => renderFaqItem(item, index)).join("\n\n");
    return `<!-- HOME-FAQ:START (generated by scripts/build-homepage-sheets.js; do not edit by hand) -->
${rows}
          <!-- HOME-FAQ:END -->`;
  };

  /** @param {string} name @param {string} inner */
  const markerBlock = (name, inner) =>
    `<!-- ${name}:START (generated by scripts/build-homepage-sheets.js; do not edit by hand) -->${inner}<!-- ${name}:END -->`;

  /** @param {ReturnType<typeof validateSnapshot>["FAQ"]} items */
  const renderHomeFaqNav = (items) => {
    if (visibleFaqItems(items).length === 0) return markerBlock("HOME-FAQ-NAV", "");
    return markerBlock(
      "HOME-FAQ-NAV",
      `
          <li><a class="nav-link scrollto" href="#faq">Întrebări frecvente</a></li>
          `,
    );
  };

  /** @param {ReturnType<typeof validateSnapshot>["FAQ"]} items */
  const renderHomeFaqJsonLd = (items) => {
    const visible = visibleFaqItems(items);
    if (visible.length === 0) return markerBlock("HOME-FAQ-JSONLD", "");
    const payload = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": "https://solon.agency/#faq",
      mainEntity: visible.map((item) => ({
        "@type": "Question",
        name: item.Intrebare,
        acceptedAnswer: {
          "@type": "Answer",
          text: faqAnswerPlainText(item.Raspuns),
        },
      })),
    };
    const tag = buildJsonLdTag(payload, "https://solon.agency/");
    return markerBlock("HOME-FAQ-JSONLD", `
  ${tag}
  `);
  };

  /** @param {ReturnType<typeof validateSnapshot>["FAQ"]} items */
  const renderHomeFaqSection = (items) => {
    if (visibleFaqItems(items).length === 0) return markerBlock("HOME-FAQ-SECTION", "");
    return markerBlock(
      "HOME-FAQ-SECTION",
      `
    <!-- ======= Frequently Asked Questions Section ======= -->
    <section id="faq" class="faq section-bg">
      <div class="container" data-aos="fade-up">

        <div class="section-title">
          <h2>Intrebări frecvente</h2>
          <p>Ajutorul nostru e mereu la îndemână. </p>
          <p>Mai jos găseşti răspunsuri la cele mai frecvente întrebari ale clienților noştri.</p>
        </div>

        <div class="faq-list">
          <ul id="faq-list">
          ${renderFaqBlock(items)}
          </ul>
          <div id="loading" class="lds-ripple">
            <div></div>
            <div></div>
          </div>
        </div>

      </div>
    </section>
    <!-- End Frequently Asked Questions Section -->
    `,
    );
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
                            <i class="bi bi-chat-right-quote-fill"></i> ${sanitizeRichText(item.Citat)}
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
    const slides = ensureCarouselActive(items.filter((item) => item.Visible))
      .map((item) => renderTestimonialSlide(item))
      .join("\n");
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
    let out = replaceBlock(html, "HOME-FAQ-SECTION", renderHomeFaqSection(prepared.FAQ));
    out = replaceBlock(out, "HOME-FAQ-NAV", renderHomeFaqNav(prepared.FAQ));
    out = replaceBlock(out, "HOME-FAQ-JSONLD", renderHomeFaqJsonLd(prepared.FAQ));
    out = replaceBlock(out, "TESTIMONIALS", renderTestimonialsBlock(prepared.Testimonials));
    return out;
  };

  const main = async () => {
    const offline = process.argv.includes("--offline");
    const check = process.argv.includes("--check");
    const writeSnapshot = process.argv.includes("--write-snapshot");
    const { data, source, sources } = await resolveData({ offline });
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
      `build-homepage-sheets: rendered ${data.FAQ.filter((r) => r.Visible).length} FAQ, ${data.Testimonials.filter((r) => r.Visible).length} testimonials (FAQ: ${sources.FAQ}, Testimonials: ${sources.Testimonials})`,
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
    sanitizeRichText,
    sanitizeFaqAnswer,
    validateSnapshot,
    render,
    renderFaqBlock,
    renderHomeFaqSection,
    renderHomeFaqNav,
    renderHomeFaqJsonLd,
    visibleFaqItems,
    faqAnswerPlainText,
    resolveFaqRows,
    renderTestimonialsBlock,
    resolveData,
    replaceBlock,
    readCommittedSnapshot,
    buildRenderData,
    aggregateSource,
    pickFaqRows,
    pickTestimonialRows,
    ensureCarouselActive,
    normalizeFaqRow,
    normalizeTestimonialRow,
    truthyVisible,
    API_TABS,
  };
})();
