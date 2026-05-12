/**
 * article.js — Verum article page React component
 * Requires: React 18, ReactDOM 18, Babel standalone (loaded in article.html)
 * Requires: shared.js loaded first
 */

/* global React, ReactDOM, timeAgo, loadStories, getParam, initPage */

'use strict';

initPage(null);

// ── READING PROGRESS BAR ──────────────────────────────────────────────────────

function ReadingProgressBar() {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    function onScroll() {
      const el    = document.getElementById('article-body-wrap');
      if (!el) return;
      const total    = el.offsetHeight - window.innerHeight;
      const scrolled = Math.max(0, -el.getBoundingClientRect().top);
      const pct      = total > 0 ? Math.min(100, (scrolled / total) * 100) : 0;
      setProgress(Math.round(pct));
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return React.createElement('div', {
    className: 'progress-bar',
    role: 'progressbar',
    'aria-label': 'Reading progress',
    'aria-valuenow': progress,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    style: { width: `${progress}%` },
  });
}

// ── ARTICLE COMPONENT ─────────────────────────────────────────────────────────

function ArticlePage({ storyId }) {
  const [story, setStory] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (!storyId) {
      setError('No story ID provided.');
      return;
    }
    loadStories()
      .then(data => {
        const found = data.stories[storyId];
        if (!found) throw new Error(`Story '${storyId}' not found`);
        setStory(found);
        document.title = `${found.title} — Verum`;
      })
      .catch(err => {
        console.error('Article load error:', err);
        setError('This article could not be found or loaded.');
      });
  }, [storyId]);

  if (error) {
    return React.createElement(
      'div', { className: 'error-state' },
      React.createElement('div', { className: 'error-icon' }, '⚠'),
      React.createElement('div', { className: 'error-title' }, 'Article not found'),
      React.createElement('div', { className: 'error-msg' }, error),
      React.createElement('a', { href: 'index.html', className: 'error-link' }, '← Back to home')
    );
  }

  if (!story) {
    return React.createElement(
      'div', { className: 'loading', role: 'status', 'aria-live': 'polite' },
      'Loading article...'
    );
  }

  const cat        = story.category || story.region || '';
  const paragraphs = story.content
    .split('\n')
    .filter(p => p.trim().length > 0)
    .map((p, i) => React.createElement('p', { key: i }, p.trim()));

  return React.createElement(
    'div', { id: 'article-body-wrap' },

    React.createElement('a', { className: 'back-btn', href: 'index.html' }, 'Back to home'),

    React.createElement('span', { className: 'article-cat' }, cat),

    React.createElement('h1', { className: 'article-title' }, story.title),

    React.createElement(
      'div', { className: 'article-meta' },
      React.createElement('span', { className: 'article-author' }, `By ${story.author || story.source || 'Staff'}`),
      React.createElement('span', { className: 'meta-dot', 'aria-hidden': 'true' }, '·'),
      React.createElement('time', { className: 'article-time', dateTime: story.time }, timeAgo(story.time)),
      story.read && React.createElement(React.Fragment, null,
        React.createElement('span', { className: 'meta-dot', 'aria-hidden': 'true' }, '·'),
        React.createElement('span', { className: 'article-read' }, story.read)
      )
    ),

    story.image && React.createElement('img', {
      className: 'article-hero-img',
      src: story.image,
      alt: story.title,
      loading: 'lazy',
      onError: e => { e.target.style.display = 'none'; },
    }),

    React.createElement(
      'div', { className: 'article-body', role: 'main' },
      paragraphs
    )
  );
}

// ── MOUNT ─────────────────────────────────────────────────────────────────────

const storyId = getParam('id');

// Inject progress bar directly into body (outside React root)
const progressContainer = document.createElement('div');
document.body.prepend(progressContainer);
ReactDOM.createRoot(progressContainer).render(React.createElement(ReadingProgressBar));

// Mount article
ReactDOM.createRoot(document.getElementById('article-content'))
  .render(React.createElement(ArticlePage, { storyId }));
