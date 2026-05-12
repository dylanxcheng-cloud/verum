/**
 * home.js — Verum homepage React components
 * Requires: React 18, ReactDOM 18, Babel standalone (loaded in index.html)
 * Requires: shared.js loaded first
 */

/* global React, ReactDOM, timeAgo, loadStories, showError, initPage */

'use strict';

initPage('home');

// ── REFRESH INTERVAL ─────────────────────────────────────────────────────────
const REFRESH_MS = 5 * 60 * 1000; // re-check stories.json every 5 minutes

// ── COMPONENTS ───────────────────────────────────────────────────────────────

function ImgWithFallback({ src, alt, className }) {
  const [failed, setFailed] = React.useState(false);
  return failed
    ? React.createElement('div', { className: 'img-placeholder', 'aria-hidden': 'true' })
    : React.createElement('img', {
        src, alt,
        className,
        loading: 'lazy',
        onError: () => setFailed(true),
      });
}

function StoryCard({ story }) {
  const url = `article.html?id=${encodeURIComponent(story.id)}`;
  return React.createElement(
    'article', { className: 'story-card', role: 'listitem' },
    React.createElement(
      'div', { className: 'story-thumb' },
      React.createElement(ImgWithFallback, { src: story.image, alt: story.title })
    ),
    React.createElement(
      'div', { className: 'story-body' },
      React.createElement('div', { className: 'story-cat' }, story.category),
      React.createElement('div', { className: 'story-title' }, story.title),
      React.createElement('div', { className: 'story-meta' },
        `${timeAgo(story.time)} · ${story.author}`
      )
    ),
    React.createElement('a', {
      href: url,
      className: 'card-link',
      'aria-label': story.title,
    })
  );
}

function HeroSection({ story }) {
  const url = `article.html?id=${encodeURIComponent(story.id)}`;
  return React.createElement(
    'div', { className: 'hero-main' },
    React.createElement(ImgWithFallback, { src: story.image, alt: story.title }),
    React.createElement(
      'div', { className: 'hero-overlay' },
      React.createElement('span', { className: 'hero-cat' }, story.category),
      React.createElement('div', { className: 'hero-title' }, story.title),
      React.createElement('div', { className: 'hero-meta' },
        React.createElement('strong', null, `By ${story.author}`),
        ` · ${timeAgo(story.time)} · ${story.read || '3 min read'}`
      )
    ),
    React.createElement('a', {
      href: url,
      className: 'card-link',
      'aria-label': story.title,
    })
  );
}

function StackItem({ story }) {
  const url = `article.html?id=${encodeURIComponent(story.id)}`;
  return React.createElement(
    'div', { className: 'hero-stack-item', role: 'listitem' },
    React.createElement(
      'div', { className: 'stack-thumb' },
      React.createElement(ImgWithFallback, { src: story.image, alt: story.title })
    ),
    React.createElement(
      'div', { className: 'stack-body' },
      React.createElement('div', { className: 'stack-cat' }, story.category),
      React.createElement('div', { className: 'stack-title' }, story.title),
      React.createElement('div', { className: 'stack-meta' },
        `${timeAgo(story.time)} · ${story.author}`
      )
    ),
    React.createElement('a', {
      href: url,
      className: 'card-link',
      'aria-label': story.title,
    })
  );
}

function WorldItem({ story }) {
  const url = `article.html?id=${encodeURIComponent(story.id)}`;
  return React.createElement(
    'div', { className: 'world-item', role: 'listitem' },
    React.createElement('span', { className: 'world-flag', 'aria-hidden': 'true' },
      story.flag || '🌍'
    ),
    React.createElement(
      'div', null,
      React.createElement('div', { className: 'world-region' }, story.region || story.category),
      React.createElement('div', { className: 'world-title' }, story.title),
      React.createElement('div', { className: 'world-meta' },
        `${timeAgo(story.time)} · ${story.author || story.source}`
      )
    ),
    React.createElement('a', {
      href: url,
      className: 'card-link',
      'aria-label': story.title,
    })
  );
}

function MostReadItem({ title, index }) {
  return React.createElement(
    'div', { className: 'most-read-item' },
    React.createElement('span', { className: 'most-read-num', 'aria-hidden': 'true' }, index + 1),
    React.createElement('span', { className: 'most-read-title' }, title)
  );
}

function EventItem({ event }) {
  return React.createElement(
    'div', { className: 'event-item' },
    React.createElement('div', { className: 'event-date' }, event.date),
    React.createElement('div', { className: 'event-title' }, event.title),
    React.createElement('div', { className: 'event-loc' }, event.location)
  );
}

function SectionHeader({ label }) {
  return React.createElement(
    'div', { className: 'section-header' },
    React.createElement('span', { className: 'section-header-label' }, label),
    React.createElement('div', { className: 'section-header-line' })
  );
}

function Sidebar({ mostRead, events }) {
  return React.createElement(
    'aside', { className: 'sidebar', 'aria-label': 'Sidebar' },
    // Hottest
    React.createElement(
      'div', { className: 'sidebar-widget' },
      React.createElement('div', { className: 'widget-header' },
        React.createElement('span', { className: 'widget-title' }, 'Hottest')
      ),
      React.createElement('div', { className: 'widget-body' },
        mostRead.map((title, i) =>
          React.createElement(MostReadItem, { key: i, title, index: i })
        )
      )
    ),
    // Events
    React.createElement(
      'div', { className: 'sidebar-widget' },
      React.createElement('div', { className: 'widget-header' },
        React.createElement('span', { className: 'widget-title' }, 'Upcoming Events')
      ),
      React.createElement('div', { className: 'widget-body' },
        events.map((event, i) =>
          React.createElement(EventItem, { key: i, event })
        )
      )
    )
  );
}

// ── LAST UPDATED INDICATOR ────────────────────────────────────────────────────

function LastUpdated({ time }) {
  return React.createElement(
    'div', {
      style: {
        textAlign: 'right',
        fontSize: '11px',
        color: 'var(--gray)',
        fontFamily: "'Barlow Condensed', sans-serif",
        letterSpacing: '0.5px',
        padding: '8px 0 0',
      }
    },
    `Last updated: ${time}`
  );
}

// ── MAIN APP COMPONENT ────────────────────────────────────────────────────────

function HomePage() {
  const [data,      setData]      = React.useState(null);
  const [error,     setError]     = React.useState(null);
  const [updatedAt, setUpdatedAt] = React.useState(null);

  function fetchData() {
    // Bust cache so we always get fresh stories.json
    return loadStories()
      .then(d => {
        setData(d);
        setError(null);
        setUpdatedAt(new Date().toLocaleTimeString());
        document.getElementById('breaking-text').textContent = d.breaking;
      })
      .catch(err => {
        console.error('Homepage load error:', err);
        setError('Could not load stories. Please try refreshing the page.');
      });
  }

  // Initial load + polling every 5 minutes
  React.useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return React.createElement(
      'div', { className: 'error-state' },
      React.createElement('div', { className: 'error-icon' }, '⚠'),
      React.createElement('div', { className: 'error-title' }, 'Something went wrong'),
      React.createElement('div', { className: 'error-msg' }, error),
      React.createElement('a', { href: 'index.html', className: 'error-link' }, '← Refresh')
    );
  }

  if (!data) {
    return React.createElement(
      'div', { className: 'loading', role: 'status', 'aria-live': 'polite' },
      'Loading stories...'
    );
  }

  const { stories, featured, mostRead, events } = data;
  const heroStory   = stories[featured.hero];
  const stackStories = (featured.stack  || []).map(id => stories[id]).filter(Boolean);
  const latestStories = (featured.latest || []).map(id => stories[id]).filter(Boolean);
  const worldStories  = (featured.world  || []).map(id => stories[id]).filter(Boolean);

  if (!heroStory) {
    return React.createElement('div', { className: 'loading' }, 'No stories available yet.');
  }

  return React.createElement(
    React.Fragment, null,

    // Hero + stack
    React.createElement(
      'div', { className: 'hero', role: 'main' },
      React.createElement(HeroSection, { story: heroStory }),
      React.createElement(
        'div', { className: 'hero-stack', role: 'list' },
        stackStories.map(s => React.createElement(StackItem, { key: s.id, story: s }))
      )
    ),

    // Latest news
    React.createElement(SectionHeader, { label: 'Latest News' }),
    React.createElement(
      'div', { className: 'story-grid', role: 'list' },
      latestStories.map(s => React.createElement(StoryCard, { key: s.id, story: s }))
    ),

    // World + sidebar
    React.createElement(
      'div', { className: 'content-row' },
      React.createElement(
        'section', { 'aria-label': 'World news' },
        React.createElement(SectionHeader, { label: 'World' }),
        React.createElement(
          'div', { className: 'world-list', role: 'list' },
          worldStories.map(s => React.createElement(WorldItem, { key: s.id, story: s }))
        )
      ),
      React.createElement(Sidebar, { mostRead, events })
    ),

    // Last updated timestamp
    updatedAt && React.createElement(LastUpdated, { time: updatedAt })
  );
}

// ── MOUNT ─────────────────────────────────────────────────────────────────────

const root = ReactDOM.createRoot(document.getElementById('main-content'));
root.render(React.createElement(HomePage));
