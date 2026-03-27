const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const yaml = require('js-yaml');

const POSTS_DIR = path.join(__dirname, '../blog/posts');
const OUTPUT_DIR = path.join(__dirname, '../blog');
const TEMPLATES_DIR = path.join(__dirname, '../templates');

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
    return `<li><a href="../${slug}/">${title}</a> ${formatRecentDate(date)}</li>`;
  }).join('\n');
}

function generatePostHTML(post, posts) {
  const { frontmatter, content } = post;
  const htmlContent = marked.parse(content)
    // Keep only one document H1 (the template's .entry-title).
    .replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '');
  const recentPostsHtml = generateRecentPostsHTML(posts, frontmatter.slug);

  const tagsHtml = frontmatter.tags.map(tag => `<li><a href="../?tag=${tag}">${tag}</a></li>`).join('');

  let postHtml = postTemplate
    .replace(/{{title}}/g, frontmatter.title)
    .replace(/{{date}}/g, frontmatter.date)
    .replace(/{{read_time}}/g, frontmatter.read_time)
    .replace(/{{tags_html}}/g, tagsHtml)
    .replace(/{{recent_posts_html}}/g, recentPostsHtml)
    .replace(/{{content}}/g, htmlContent);

  return layoutTemplate
    .replace(/{{title}}/g, frontmatter.title)
    .replace(/{{description}}/g, frontmatter.description)
    .replace(/{{slug}}/g, frontmatter.slug)
    .replace(/{{body}}/g, postHtml)
    .replace(/{{scripts}}/g, '<script src="../../assets/js/blog-sidebar.js"></script>');
}

function generateListHTML(posts) {
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
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ro'));
  const filtersHtml = [
    `<li data-tag="all" class="filter-active">Toate <span class="blog-filter-count">(${totalPosts})</span></li>`,
    ...sortedTags.map(([tag, count]) => `<li data-tag="${tag}">${tag} <span class="blog-filter-count">(${count})</span></li>`)
  ].join('\n');

  const postsHtml = posts.map(post => {
    const { frontmatter } = post;
    const normalizedTags = (Array.isArray(frontmatter.tags) ? frontmatter.tags : [])
      .map(tag => String(tag).trim().toLowerCase())
      .filter(Boolean);
    const tagsHtml = frontmatter.tags.map(tag => `<span class="badge rounded-pill bg-light text-dark me-1">#${tag}</span>`).join('');
    return `
      <div class="col-lg-4 mb-4 post-card" data-tags="${normalizedTags.join(',')}" data-title="${frontmatter.title.toLowerCase()}">
        <div class="card h-100 shadow-sm">
          <div class="card-body">
            <h5 class="card-title"><a href="${frontmatter.slug}/">${frontmatter.title}</a></h5>
            <p class="card-text text-muted small mb-2">${frontmatter.date} • ${frontmatter.read_time} min</p>
            <p class="card-text">${frontmatter.description}</p>
            <div class="mt-2">${tagsHtml}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

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

  const listBody = indexRedirectScript + listTemplate
    .replace(/{{filters_html}}/g, filtersHtml)
    .replace(/{{posts_html}}/g, postsHtml);

  return layoutTemplate
    .replace(/{{title}}/g, 'Blog')
    .replace(/{{description}}/g, 'SOLON Blog - Noutăți din domeniul LegalTech și Digitalizare Juridică')
    .replace(/{{slug}}/g, '')
    .replace(/{{body}}/g, listBody)
    .replace(/{{scripts}}/g, '<script src="../assets/js/blog-search.js"></script>');
}

function build() {
  console.log('Building blog...');

  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const posts = files.map(file => parseMarkdown(path.join(POSTS_DIR, file)));

  // Sort posts by date descending
  posts.sort((a, b) => new Date(b.frontmatter.date) - new Date(a.frontmatter.date));

  // Generate individual posts
  posts.forEach(post => {
    const postDir = path.join(OUTPUT_DIR, post.frontmatter.slug);
    if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });

    const html = generatePostHTML(post, posts);
    fs.writeFileSync(path.join(postDir, 'index.html'), html);
    console.log(`Generated: /blog/${post.frontmatter.slug}/index.html`);
  });

  // Generate list page
  const listHtml = generateListHTML(posts);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), listHtml);
  console.log('Generated: /blog/index.html');

  // Generate posts.json for client-side use
  const postsJson = posts.map(p => ({
    ...p.frontmatter,
    url: `${p.frontmatter.slug}/`
  }));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'posts.json'), JSON.stringify(postsJson, null, 2));
  console.log('Generated: /blog/posts.json');

  console.log('Build complete!');
}

build();
