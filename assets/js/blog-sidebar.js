/**
 * Dynamic sidebar for blog post pages.
 * Visible from tablet and desktop only via CSS.
 */
document.addEventListener('DOMContentLoaded', function() {
  const sidebar = document.querySelector('[data-blog-sidebar]');
  if (!sidebar) return;

  const recentList = sidebar.querySelector('[data-blog-sidebar-recent]');
  const tagsList = sidebar.querySelector('[data-blog-sidebar-tags]');
  const searchForm = sidebar.querySelector('[data-blog-sidebar-search]');
  const searchInput = document.getElementById('blog-sidebar-search-input');

  if (!(recentList instanceof HTMLElement) || !(tagsList instanceof HTMLElement)) {
    return;
  }

  const currentPath = window.location.pathname.replace(/\/+$/, '');
  const currentSlug = currentPath.split('/').filter(Boolean).pop() || '';

  const fetchPosts = async () => {
    const response = await fetch('../posts.json', { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error('Nu am putut încărca posts.json');
    }
    return response.json();
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  const createListItem = (href, text, suffix) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    item.appendChild(link);
    if (suffix) {
      const meta = document.createElement('span');
      meta.className = 'blog-sidebar-list-meta';
      meta.textContent = suffix;
      item.appendChild(meta);
    }
    return item;
  };

  const renderSidebar = (posts) => {
    if (!Array.isArray(posts)) return;

    const recentPosts = posts
      .filter((post) => post && post.slug !== currentSlug)
      .slice(0, 5);

    recentList.innerHTML = '';
    recentPosts.forEach((post) => {
      recentList.appendChild(
        createListItem(`../${post.slug}/`, post.title, formatDate(post.date))
      );
    });

    const tagCounts = new Map();
    posts.forEach((post) => {
      const tags = Array.isArray(post?.tags) ? post.tags : [];
      tags.forEach((tag) => {
        const normalized = String(tag).trim().toLowerCase();
        if (!normalized) return;
        tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
      });
    });

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ro'))
      .slice(0, 8);

    tagsList.innerHTML = '';
    topTags.forEach(([tag, count]) => {
      tagsList.appendChild(
        createListItem(`../#${encodeURIComponent(tag)}`, `#${tag}`, `${count} articole`)
      );
    });
  };

  fetchPosts()
    .then(renderSidebar)
    .catch(() => {
      recentList.innerHTML = '<li>Momentan nu există articole disponibile.</li>';
      tagsList.innerHTML = '<li>Momentan nu există taguri disponibile.</li>';
    });

  if (searchForm instanceof HTMLFormElement && searchInput instanceof HTMLInputElement) {
    searchForm.addEventListener('submit', function(event) {
      event.preventDefault();
      const query = searchInput.value.trim();
      const destination = query ? `../?q=${encodeURIComponent(query)}` : '../';
      window.location.href = destination;
    });
  }
});
