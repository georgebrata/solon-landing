const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const POSTS_DIR = path.join(__dirname, "../blog/posts");
const INDEX_PATH = path.join(__dirname, "../index.html");
const START_MARKER = "<!-- BLOG_CAROUSEL_ITEMS_START -->";
const END_MARKER = "<!-- BLOG_CAROUSEL_ITEMS_END -->";
const POSTS_PER_SLIDE = 2;
const MAX_POSTS = 6;
const BLOG_BASE_URL = "https://solon.agency/blog/";

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeDate = (dateValue) => {
  const date = new Date(String(dateValue || ""));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

const makeExcerpt = (description, maxLength = 155) => {
  const normalized = String(description || "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
};

/** Matches scripts/build.js / blog listing: tags as array, or comma-separated string in YAML */
const normalizeTags = (raw) => {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
};

const parseMarkdownFrontmatter = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n?/);
  if (!match) return null;

  const frontmatter = yaml.load(match[1]) || {};
  if (!frontmatter.slug || !frontmatter.title || !frontmatter.date) return null;

  return {
    slug: String(frontmatter.slug).trim(),
    title: String(frontmatter.title).trim(),
    description: makeExcerpt(frontmatter.description || ""),
    date: normalizeDate(frontmatter.date),
    tags: normalizeTags(frontmatter.tags),
  };
};

/**
 * Renders tag chips; links use the same `tag` query param as assets/js/blog-search.js.
 */
const renderTagsBlock = (tags) => {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "";
  }

  const links = tags
    .map((rawTag) => {
      const labelText = String(rawTag).trim();
      if (!labelText) return "";
      const tagParam = labelText.toLowerCase();
      const href = `/blog/?tag=${encodeURIComponent(tagParam)}`;
      const label = escapeHtml(labelText);
      return `                      <a href="${href}" class="badge badge-tag me-1">${label}</a>`;
    })
    .filter(Boolean)
    .join("\n");

  if (!links) {
    return "";
  }

  return `                    <div class="blog-tags mt-2 mb-2" aria-label="Taguri articol">
${links}
                    </div>`;
};

const renderCard = (post, delay) => {
  const title = escapeHtml(post.title);
  const description = escapeHtml(post.description);
  const articleUrl = `${BLOG_BASE_URL}/${encodeURI(post.slug)}/`;
  const tagsHtml = renderTagsBlock(post.tags);

  const boxInner = [
    `                    <h3 class="blog-carousel-title"><a href="${articleUrl}" target="_blank" rel="noopener noreferrer">${title}</a></h3>`,
    `                    <p>${description}</p>`,
    tagsHtml,
  ]
    .filter(Boolean)
    .join("\n");

  return `                <div class="col-lg-6 text-center mt-4" data-aos="fade-up" data-aos-delay="${delay}" data-aos="zoom-in">
                  <div class="box featured">
${boxInner}
                  </div>
                </div>`;
};

const renderSlides = (posts) => {
  const slides = [];

  for (let i = 0; i < posts.length; i += POSTS_PER_SLIDE) {
    const pair = posts.slice(i, i + POSTS_PER_SLIDE);
    const isActive = i === 0 ? " active" : "";
    const cards = pair.map((post, idx) => renderCard(post, idx === 0 ? 100 : 200)).join("\n");
    slides.push(
      [
        `            <div class="carousel-item${isActive}">`,
        "              <div class=\"row\">",
        cards,
        "              </div>",
        "            </div>",
      ].join("\n")
    );
  }

  return slides.join("\n");
};

const updateHomepageCarousel = () => {
  const files = fs.readdirSync(POSTS_DIR).filter((file) => file.endsWith(".md"));
  const posts = files
    .map((file) => parseMarkdownFrontmatter(path.join(POSTS_DIR, file)))
    .filter(Boolean)
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX_POSTS);

  if (posts.length === 0) {
    throw new Error("No valid markdown posts found in blog/posts.");
  }

  const indexHtml = fs.readFileSync(INDEX_PATH, "utf8");
  const startIdx = indexHtml.indexOf(START_MARKER);
  const endIdx = indexHtml.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error("Blog carousel markers not found in index.html.");
  }

  const before = indexHtml.slice(0, startIdx + START_MARKER.length);
  const after = indexHtml.slice(endIdx);
  const generated = `\n${renderSlides(posts)}\n          `;
  const updated = `${before}${generated}${after}`;

  fs.writeFileSync(INDEX_PATH, updated, "utf8");
  console.log(`✅ Updated homepage blog carousel with ${posts.length} latest posts.`);
};

updateHomepageCarousel();
