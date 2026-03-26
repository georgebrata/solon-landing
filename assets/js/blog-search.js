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

    searchInput.addEventListener('input', function(e) {
      const query = e.target.value.toLowerCase().trim();
      applyFilters(query);
    });

    if (filterButtons.length) {
      filterButtons.forEach(button => {
        button.addEventListener('click', function() {
          const selected = (button.getAttribute('data-tag') || 'all').toLowerCase();
          activeTag = selected;
          filterButtons.forEach(item => item.classList.remove('filter-active'));
          button.classList.add('filter-active');
          const query = searchInput.value.toLowerCase().trim();
          applyFilters(query);
        });
      });
    }

    // Check for hash in URL for initial filtering (e.g., /blog/#tag)
    const handleHashChange = () => {
      const hash = window.location.hash.substring(1).toLowerCase();
      if (hash) {
        const tagMatch = filterButtons.find(button => (button.getAttribute('data-tag') || '').toLowerCase() === hash);
        if (tagMatch) {
          tagMatch.click();
        } else {
          searchInput.value = hash;
          searchInput.dispatchEvent(new Event('input'));
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    searchInput.dispatchEvent(new Event('input'));
    handleHashChange();
  }
});
