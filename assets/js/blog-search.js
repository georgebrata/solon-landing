/**
 * Client-side search and filtering for the blog listing page.
 */
document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('blog-search-input');
  const postsContainer = document.getElementById('blog-posts-container');
  const filterButtons = Array.from(document.querySelectorAll('#portfolio-flters li[data-tag]'));

  if (searchInput && postsContainer) {
    const postCards = Array.from(postsContainer.getElementsByClassName('post-card'));
    let activeTag = 'all';
    let isHydratingState = false;

    const applyFilters = (query) => {
      postCards.forEach(card => {
        const title = card.getAttribute('data-title') || '';
        const tags = card.getAttribute('data-tags') || '';
        const matchesQuery = title.includes(query) || tags.includes(query);
        const matchesTag = activeTag === 'all' || tags.split(',').includes(activeTag);

        if (matchesQuery && matchesTag) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    };

    const updateUrlParams = () => {
      if (isHydratingState) return;
      const url = new URL(window.location.href);
      const query = searchInput.value.toLowerCase().trim();

      if (query) {
        url.searchParams.set('q', query);
      } else {
        url.searchParams.delete('q');
      }

      if (activeTag !== 'all') {
        url.searchParams.set('tag', activeTag);
      } else {
        url.searchParams.delete('tag');
      }

      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl !== currentUrl) {
        window.history.replaceState({}, '', nextUrl);
      }
    };

    const setActiveTag = (selectedTag) => {
      activeTag = selectedTag;
      filterButtons.forEach(item => {
        const itemTag = (item.getAttribute('data-tag') || 'all').toLowerCase();
        item.classList.toggle('filter-active', itemTag === selectedTag);
      });
    };

    searchInput.addEventListener('input', function(e) {
      const query = e.target.value.toLowerCase().trim();
      applyFilters(query);
      updateUrlParams();
    });

    if (filterButtons.length) {
      filterButtons.forEach(button => {
        button.addEventListener('click', function() {
          const selected = (button.getAttribute('data-tag') || 'all').toLowerCase();
          setActiveTag(selected);
          const query = searchInput.value.toLowerCase().trim();
          applyFilters(query);
          updateUrlParams();
        });
      });
    }

    const findRequestedTagFromUrl = (queryParams, hashTag) => {
      const explicitTag = (queryParams.get('tag') || '').toLowerCase().trim();
      if (explicitTag) return explicitTag;
      if (hashTag) return hashTag;

      const availableTags = new Set(
        filterButtons
          .map(button => (button.getAttribute('data-tag') || '').toLowerCase().trim())
          .filter(Boolean)
      );

      for (const [key, value] of queryParams.entries()) {
        const normalizedKey = key.toLowerCase().trim();
        const normalizedValue = String(value || '').toLowerCase().trim();

        if (availableTags.has(normalizedKey)) {
          return normalizedKey;
        }

        if (normalizedValue && availableTags.has(normalizedValue)) {
          return normalizedValue;
        }
      }

      return '';
    };

    const hydrateStateFromUrl = () => {
      isHydratingState = true;
      const queryParams = new URLSearchParams(window.location.search);
      const q = (queryParams.get('q') || '').toLowerCase().trim();
      const hashTag = window.location.hash.substring(1).toLowerCase().trim();
      const requestedTag = findRequestedTagFromUrl(queryParams, hashTag);

      setActiveTag('all');

      if (q) {
        searchInput.value = q;
      } else {
        searchInput.value = '';
      }

      if (requestedTag) {
        const hasMatchingTag = filterButtons.some(button => {
          const buttonTag = (button.getAttribute('data-tag') || '').toLowerCase();
          return buttonTag === requestedTag;
        });

        if (hasMatchingTag) {
          setActiveTag(requestedTag);
        } else if (!q) {
          searchInput.value = requestedTag;
        }
      }

      applyFilters(searchInput.value.toLowerCase().trim());
      isHydratingState = false;
      updateUrlParams();
    };

    window.addEventListener('popstate', hydrateStateFromUrl);
    window.addEventListener('hashchange', hydrateStateFromUrl);
    hydrateStateFromUrl();
  }
});
