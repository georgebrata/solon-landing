"use strict";

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { stampHtml } = require('./stamp-asset-refs');
const { applyPostJsonLd } = require('./json-ld');

/**
 * Substitute a {{token}} without expanding $&, $1, or other replacement patterns.
 * @param {string} template HTML template.
 * @param {string} token Placeholder name without braces.
 * @param {string} value Text to insert. Returned as-is, never parsed as a replacement.
 * @returns {string} Template with every occurrence of the token replaced.
 */
const replaceToken = (template, token, value) =>
  template.replace(new RegExp(`\\{\\{${token}\\}\\}`, "g"), () => String(value));

const POSTS_DIR = path.join(__dirname, '../blog/posts');
const OUTPUT_DIR = path.join(__dirname, '../blog');
const TEMPLATES_DIR = path.join(__dirname, '../templates');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Read templates
const layoutTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'layout.html'), 'utf8');
const postTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'post.html'), 'utf8');
const listTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'list.html'), 'utf8');

function calculateReadTime(content) {
  const wordsPerMinute = 200;
  const noOfWords = content.split(/\s+/).length;
  return Math.ceil(noOfWords / wordsPerMinute);
}

function parseMarkdown(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const match = fileContent.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    throw new Error(`Invalid frontmatter in ${filePath}`);
  }

  const frontmatter = yaml.load(match[1]);
  const content = match[2];

  if (!frontmatter.read_time) {
    frontmatter.read_time = calculateReadTime(content);
  }

  return { frontmatter, content };
}

function formatRecentDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('ro-RO', { month: 'long', day: 'numeric', year: 'numeric' });
}

function generateRecentPostsHTML(posts, currentSlug, limit = 5) {
  const ordered = posts
    .filter(post => post.frontmatter.slug !== currentSlug)
    .slice(0, limit);

  const recent = ordered.length ? ordered : posts.slice(0, limit);

  return recent.map(post => {
    const { title, date, slug } = post.frontmatter;
    return `<li><a href="../${slug}/">${title}</a>, ${formatRecentDate(date)}</li>`;
  }).join('\n');
}

/**
 * "Articole similare" for every other post in the same cluster.
 * Posts with no cluster, or a cluster of one, get an empty string.
 * @param {object[]} posts Parsed posts.
 * @param {string} currentSlug Slug of the post being rendered.
 * @param {string|undefined} cluster Cluster id from front-matter.
 * @returns {string} A section element, or "" when there is nothing to link.
 */
const generateRelatedPostsHTML = (posts, currentSlug, cluster) => {
  if (!cluster) return '';

  const peers = posts.filter(
    (post) => post.frontmatter.cluster === cluster && post.frontmatter.slug !== currentSlug
  );
  if (peers.length === 0) return '';

  const items = peers.map((post) => {
    const { title, slug } = post.frontmatter;
    return `          <li><a href="../${slug}/">${escapeHtml(title)}</a></li>`;
  }).join('\n');

  return `
<section class="blog-related-posts" aria-labelledby="related-posts-heading">
  <div class="container">
    <h2 id="related-posts-heading" class="blog-sidebar-title">Articole similare</h2>
    <ul class="blog-sidebar-list">
${items}
    </ul>
  </div>
</section>
`;
};

/**
 * Render one post page from the layout and post templates.
 * @param {object} post Parsed post (`frontmatter` and markdown `content`).
 * @param {object[]} posts All parsed posts, used for the sidebar and related links.
 * @param {{ parse: function(string): string }} marked Markdown parser.
 * @returns {string} HTML for blog/<slug>/index.html before asset stamping.
 */
const generatePostHTML = (post, posts, marked) => {
  const { frontmatter, content } = post;
  const parsed = marked.parse(content)
    // Keep only one document H1 (the template's .entry-title).
    .replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '');
  const pageUrl = `https://solon.agency/blog/${frontmatter.slug}/`;
  const { htmlContent, headJsonLd } = applyPostJsonLd(parsed, frontmatter, pageUrl);
  const recentPostsHtml = generateRecentPostsHTML(posts, frontmatter.slug);
  const relatedPostsHtml = generateRelatedPostsHTML(posts, frontmatter.slug, frontmatter.cluster);
  const tagsHtml = (frontmatter.tags || []).map(tag => `<li><a href="../?tag=${tag}">${tag}</a></li>`).join('');

  let postHtml = postTemplate;
  postHtml = replaceToken(postHtml, 'title', frontmatter.title);
  postHtml = replaceToken(postHtml, 'date', frontmatter.date);
  postHtml = replaceToken(postHtml, 'read_time', frontmatter.read_time);
  postHtml = replaceToken(postHtml, 'tags_html', tagsHtml);
  postHtml = replaceToken(postHtml, 'recent_posts_html', recentPostsHtml);
  postHtml = replaceToken(postHtml, 'related_posts_html', relatedPostsHtml);
  postHtml = replaceToken(postHtml, 'content', htmlContent);

  let page = layoutTemplate;
  page = replaceToken(page, 'title', frontmatter.title);
  page = replaceToken(page, 'description', frontmatter.description);
  page = replaceToken(page, 'slug', frontmatter.slug);
  page = replaceToken(page, 'slugWithTrailingSlash', `${frontmatter.slug}/`);
  page = replaceToken(page, 'json_ld', headJsonLd);
  page = replaceToken(page, 'body', postHtml);
  page = replaceToken(page, 'scripts', '<script src="../../assets/js/blog-sidebar.js"></script>\n  <script src="../../assets/js/forms.min.js"></script>');
  return page;
};

/**
 * Render the blog index from the list template.
 * @param {object[]} posts Parsed posts, newest first.
 * @returns {string} HTML for blog/index.html before asset stamping.
 */
const generateListHTML = (posts) => {
  const tagCounts = new Map();
  posts.forEach(post => {
    const tags = Array.isArray(post.frontmatter.tags) ? post.frontmatter.tags : [];
    tags.forEach(tag => {
      const normalized = String(tag).trim().toLowerCase();
      if (!normalized) return;
      tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
    });
  });

  const totalPosts = posts.length;
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], 'ro');
  });
  const filtersHtml = [
    `<li data-tag="all" class="filter-active">Toate <span class="blog-filter-count">(${totalPosts})</span></li>`,
    ...sortedTags.map(([tag, count]) => `<li data-tag="${tag}">${tag} <span class="blog-filter-count">(${count})</span></li>`)
  ].join('\n');

  const postsHtml = posts.map(post => {
    const { frontmatter } = post;
    const normalizedTags = (Array.isArray(frontmatter.tags) ? frontmatter.tags : [])
      .map(tag => String(tag).trim().toLowerCase())
      .filter(Boolean);
    const rawTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    const tagLinks = rawTags
      .map((tag) => {
        const label = String(tag).trim();
        if (!label) return '';
        const tagParam = label.toLowerCase();
        const href = `../blog/?tag=${encodeURIComponent(tagParam)}`;
        return `                      <a href="${href}" class="badge badge-tag me-1">${escapeHtml(label)}</a>`;
      })
      .filter(Boolean)
      .join('\n');
    const tagsBlock = tagLinks
      ? `                    <div class="blog-tags mt-2 mb-2" aria-label="Taguri articol">
${tagLinks}
                    </div>`
      : '';
    const titleLower = escapeAttr(frontmatter.title.toLowerCase());
    return `
      <div class="col-lg-4 text-center mt-4 mb-4 post-card" data-tags="${normalizedTags.join(',')}" data-title="${titleLower}">
        <div class="box featured">
          <h3><a href="${frontmatter.slug}/">${escapeHtml(frontmatter.title)}</a></h3>
          <p class="blog-card-meta">${escapeHtml(frontmatter.date)} • ${frontmatter.read_time} min</p>
          <p>${escapeHtml(frontmatter.description)}</p>
${tagsBlock}
        </div>
      </div>
    `;
  }).join('').replace(/[ \t]+$/gm, '');

  const indexRedirectScript = `
    <script>
      (function() {
        var path = window.location.pathname;
        if (path.endsWith('/index.html')) {
          var cleanPath = path.slice(0, -'index.html'.length);
          window.location.replace(cleanPath + window.location.search + window.location.hash);
        }
      })();
    </script>
  `;

  const listBody = indexRedirectScript
    + replaceToken(replaceToken(listTemplate, 'filters_html', filtersHtml), 'posts_html', postsHtml);

  const blogIndexTitle = 'Blog marketing și digitalizare pentru avocați | SOLON';
  let page = layoutTemplate;
  page = page.replaceAll('<title>{{title}} | SOLON Blog</title>', `<title>${blogIndexTitle}</title>`);
  page = page.replaceAll('content="{{title}} | SOLON Blog"', `content="${blogIndexTitle}"`);
  page = replaceToken(page, 'title', blogIndexTitle);
  page = replaceToken(page, 'description', 'SOLON Blog LegalTech - digitalizare juridică, unelte digitale și productivitate pentru practica avocaturii moderne');
  page = replaceToken(page, 'slug', '');
  page = replaceToken(page, 'slugWithTrailingSlash', '');
  page = replaceToken(page, 'json_ld', '');
  page = replaceToken(page, 'body', listBody);
  page = replaceToken(page, 'scripts', '<script src="../assets/js/blog-search.js"></script>\n  <script src="../assets/js/forms.min.js"></script>');
  return page;
};

/** Heavy front-matter that search, the sidebar, and the homepage carousel do not read. */
const POSTS_JSON_OMIT = new Set([
  'json_ld',
  'faq',
  'howto',
  'sources',
  'internal_links',
  'schema_types',
  'notes_for_publisher',
  'target_keywords',
  'target_prompts',
  'schema_extra',
  'publish_date',
  'meta_description',
]);

/** Compile markdown posts into static HTML under /blog/. */
const build = async () => {
  console.log('Building blog...');

  const { marked } = await import('marked');
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const posts = files.map(file => parseMarkdown(path.join(POSTS_DIR, file)));

  // Sort posts by date descending
  posts.sort((a, b) => new Date(b.frontmatter.date) - new Date(a.frontmatter.date));

  // Generate individual posts
  posts.forEach(post => {
    const postDir = path.join(OUTPUT_DIR, post.frontmatter.slug);
    if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });

    const outPath = path.join(postDir, 'index.html');
    const html = stampHtml(generatePostHTML(post, posts, marked), outPath);
    fs.writeFileSync(outPath, html);
    console.log(`Generated: /blog/${post.frontmatter.slug}/index.html`);
  });

  // Generate list page
  const listPath = path.join(OUTPUT_DIR, 'index.html');
  const listHtml = stampHtml(generateListHTML(posts), listPath);
  fs.writeFileSync(listPath, listHtml);
  console.log('Generated: /blog/index.html');

  // posts.json stays lean: url is last so existing entries do not churn.
  const postsJson = posts.map((p) => {
    const entry = {};
    for (const [key, value] of Object.entries(p.frontmatter)) {
      if (!POSTS_JSON_OMIT.has(key)) entry[key] = value;
    }
    entry.url = `${p.frontmatter.slug}/`;
    return entry;
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'posts.json'), JSON.stringify(postsJson, null, 2));
  console.log('Generated: /blog/posts.json');

  console.log('Build complete!');
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exitCode = 1;
});
