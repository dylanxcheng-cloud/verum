/**
 * category.js — Verum category page React component
 * Requires: React 18, ReactDOM 18, Babel standalone (loaded in category.html)
 * Requires: shared.js loaded first
 */

/* global React, ReactDOM, timeAgo, loadStories, getParam, initPage */

'use strict';

const cat     = getParam('cat') || 'News';
const pageKey = cat.toLowerCase();

document.title = `${cat} — Verum`;
initPage(pageKey);

// ── STORY CARD ────────────────────────────────────────────────────────────────

function CategoryCard({ story }) {
  const url = `article.html?id=${encodeURIComponent(story.id)}`;
  const [imgFailed, setImgFailed] = React.useState(false);

  return React.createElement(
    'article', { className: 'story-card', role: 'listitem' },
    React.createElement(
      'div', { className: 'story-thumb' },
      imgFailed
        ? React.createElement('div', { className: 'img-placeholder', 'aria-hidden': 'true' })
        : React.createElement('img', {
            src: story.image,
            alt: story.title,
            loading: 'lazy',
            onError: () => setImgFailed(true),
          })
    ),
    React.createElement(
      'div', { className: 'story-body' },
      React.createElement('div', { className: 'story-cat' }, story.category || story.region),
      React.createElement('div', { className: 'story-title' }, story.title),
      React.createElement('div', { className: 'story-meta' },
        `${timeAgo(story.time)} · ${story.author || story.source || 'Staff'}`
      )
    ),
    React.createElement('a', {
      href: url,
      className: 'card-link',
      'aria-label': story.title,
    })
  );
}

// ── CATEGORY PAGE COMPONENT ───────────────────────────────────────────────────

function CategoryPage() {
  const [stories,  setStories]  = React.useState([]);
  const [loading,  setLoading]  = React.useState(true);
  const [error,    setError]    = React.useState(null);

  React.useEffect(() => {
    loadStories()
      .then(data => {
        const { stories: allStories, featured, categoryIndex } = data;

        // Gather matching stories — homepage slots first, then category bank
        const seen = new Set();
        const ids  = [];

        // From homepage slots
        const homepageIds = [
          featured.hero,
          ...(featured.stack  || []),
          ...(featured.latest || []),
          ...(featured.world  || []),
        ].filter(Boolean);

        for (const id of homepageIds) {
          const s = allStories[id];
          if (!s) continue;
          const sCat = (s.category || s.region || '').toLowerCase();
          if (sCat === cat.toLowerCase() && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }

        // From category bank
        for (const id of (categoryIndex[cat] || [])) {
          if (!seen.has(id) && allStories[id]) {
            seen.add(id);
            ids.push(id);
          }
        }

        setStories(ids.slice(0, 10).map(id => allStories[id]));
        setLoading(false);
      })
      .catch(err => {
        console.error('Category load error:', err);
        setError('Could not load stories for this category.');
        setLoading(false);
      });
  }, []);

  // Update header count reactively
  React.useEffect(() => {
    const header = document.getElementById('cat-header');
    if (!header || loading) return;
    header.innerHTML = `
      <div class="cat-label">Category</div>
      <h1 class="cat-title">${cat}</h1>
      <div class="cat-count">${stories.length} ${stories.length === 1 ? 'story' : 'stories'}</div>`;
  }, [stories, loading]);

  if (loading) {
    return React.createElement(
      'div', { className: 'loading', role: 'status', 'aria-live': 'polite' },
      'Loading...'
    );
  }

  if (error) {
    return React.createElement(
      'div', { className: 'error-state' },
      React.createElement('div', { className: 'error-icon' }, '⚠'),
      React.createElement('div', { className: 'error-title' }, 'Something went wrong'),
      React.createElement('div', { className: 'error-msg' }, error),
      React.createElement('a', { href: 'index.html', className: 'error-link' }, '← Back to home')
    );
  }

  if (stories.length === 0) {
    return React.createElement(
      'div', { className: 'error-state' },
      React.createElement('div', { className: 'error-icon' }, '📭'),
      React.createElement('div', { className: 'error-title' }, 'No stories yet'),
      React.createElement('div', { className: 'error-msg' }, `Nothing filed under ${cat} yet.`),
      React.createElement('a', { href: 'index.html', className: 'error-link' }, '← Back to home')
    );
  }

  return React.createElement(
    'div', { className: 'story-grid', role: 'list' },
    stories.map(s => React.createElement(CategoryCard, { key: s.id, story: s }))
  );
}

// ── MOUNT ─────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('cat-content'))
  .render(React.createElement(CategoryPage));
