/**
 * Client-side search and filtering for the blog listing page.
 */
document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('blog-search-input');
  const postsContainer = document.getElementById('blog-posts-container');

  if (searchInput && postsContainer) {
    const postCards = Array.from(postsContainer.getElementsByClassName('post-card'));

    searchInput.addEventListener('input', function(e) {
      const query = e.target.value.toLowerCase().trim();

      postCards.forEach(card => {
        const title = card.getAttribute('data-title');
        const tags = card.getAttribute('data-tags');

        if (title.includes(query) || tags.includes(query)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });

    // Check for hash in URL for initial filtering (e.g., /blog/#tag)
    const handleHashChange = () => {
      const hash = window.location.hash.substring(1).toLowerCase();
      if (hash) {
        searchInput.value = hash;
        searchInput.dispatchEvent(new Event('input'));
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
  }
});
