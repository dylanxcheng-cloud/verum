// @ts-check
'use strict';

const { useState, useEffect, memo } = React;

// Initialize page (date, footer, nav highlighting)
function setDate() {
  const el = document.getElementById('site-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function setFooterCopy() {
  const el = document.getElementById('footer-copy');
  if (el) el.textContent = `© ${new Date().getFullYear()} Verum. All rights reserved.`;
}

function highlightNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

function initPage(activePage) {
  setDate();
  setFooterCopy();
  highlightNav(activePage);
}

// ── IMAGE PROCESSING ─────────────────────────────────────────────────────────

/**
 * Generate a placeholder image URL using DiceBear API
 * Creates unique, deterministic placeholders based on story ID and title
 */
function generatePlaceholderImageUrl(storyId, title, _category) {
  const seed = encodeURIComponent(`verum-${storyId}-${title}`).substring(0, 50);
  return `https://api.dicebear.com/9.x/shapes/svg?seed=${seed}&backgroundColor=1a1a1a&scale=80`;
}

/**
 * Get category color for visual identification
 */
function getCategoryColor(category) {
  const colors = {
    technology: '#3B82F6',
    science: '#10B981',
    politics: '#EF4444',
    world: '#F59E0B',
    news: '#8B5CF6',
    business: '#06B6D4',
    sports: '#EC4899',
    health: '#14B8A6',
  };
  return colors[(category || '').toLowerCase()] || '#6B7280';
}

/**
 * Validate image URL or return fallback placeholder
 * Only accepts valid URLs (http://, https://) - file paths are rejected
 */
function getOptimizedImageUrl(url, fallback) {
  // If URL is empty, missing, or not a string, return fallback
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return fallback;
  }
  // Only accept valid HTTP/HTTPS URLs or data URIs
  const validUrl = url.toLowerCase().trim();
  if (validUrl.startsWith('http://') || validUrl.startsWith('https://') || validUrl.startsWith('data:')) {
    return url;
  }
  // Reject file paths like "images/hero.jpg" - use fallback placeholder
  return fallback;
}

/**
 * Process all stories to ensure valid image URLs
 * Generates placeholders for missing or invalid images
 */
function processStoriesImages(data) {
  if (!data.stories) return data;

  const processedStories = {};
  Object.entries(data.stories).forEach(([id, story]) => {
    const fallbackImage = generatePlaceholderImageUrl(id, story.title, story.category);
    processedStories[id] = {
      ...story,
      image: getOptimizedImageUrl(story.image, fallbackImage),
    };
  });

  // Process featured section if it exists
  if (data.featured) {
    const featured = { ...data.featured };
    
    if (featured.hero) {
      const fallback = generatePlaceholderImageUrl(
        featured.hero.id,
        featured.hero.title,
        featured.hero.category
      );
      featured.hero = {
        ...featured.hero,
        image: getOptimizedImageUrl(featured.hero.image, fallback),
      };
    }

    ['stack', 'latest', 'world'].forEach(section => {
      if (featured[section]?.length > 0) {
        featured[section] = featured[section].map((story) => ({
          ...story,
          image: getOptimizedImageUrl(
            story.image,
            generatePlaceholderImageUrl(story.id, story.title, story.category)
          ),
        }));
      }
    });

    return { ...data, stories: processedStories, featured };
  }

  return { ...data, stories: processedStories };
}

// ── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) { const m = Math.floor(diff / 60); return `${m} minute${m > 1 ? 's' : ''} ago`; }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h} hour${h > 1 ? 's' : ''} ago`; }
  if (diff < 604800) { const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? 's' : ''} ago`; }
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

async function loadStories() {
  const res = await fetch('stories.json');
  if (!res.ok) throw new Error(`Failed to load stories.json: HTTP ${res.status}`);
  const data = await res.json();
  
  // Process images to ensure valid URLs with fallback placeholders
  const processedData = processStoriesImages(data);
  if (processedData.stories && processedData.featured) return processedData;
  
  // Legacy structure — normalize on the fly
  const stories = {};
  const featured = { hero: null, stack: [], latest: [], world: [] };

  function addStory(s, slot) {
    if (!s || !s.id) return;
    if (!s.author && s.source) s.author = s.source;
    stories[s.id] = s;
    if (slot === 'hero') featured.hero = s;
    else if (slot) featured[slot].push(s);
  }

  if (data.hero) addStory(data.hero, 'hero');
  (data.stack || []).forEach(s => addStory(s, 'stack'));
  (data.latest || []).forEach(s => addStory(s, 'latest'));
  (data.world || []).forEach(s => addStory(s, 'world'));

  const normalized = { stories, featured };
  return processStoriesImages(normalized);
}

// Make functions globally accessible for JSX components
window.timeAgo = timeAgo;
window.getParam = getParam;
window.loadStories = loadStories;
window.initPage = initPage;

initPage(null);

// ── READING PROGRESS BAR ──────────────────────────────────────────────────────

function ReadingProgressBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById('article-body-wrap');
      if (!el) return;
      const total    = el.offsetHeight - window.innerHeight;
      const scrolled = Math.max(0, -el.getBoundingClientRect().top);
      setProgress(total > 0 ? Math.min(100, Math.round((scrolled / total) * 100)) : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label="Reading progress"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: `${progress}%` }}
    />
  );
}

// ── ARTICLE BODY ──────────────────────────────────────────────────────────────

// Splits a paragraph on [n] footnote markers and renders each marker as a
// superscript anchor linking to the matching reference at the bottom.
function renderWithFootnotes(text, validRefs) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m && validRefs.has(Number(m[1]))) {
      const n = m[1];
      return (
        <sup key={i} className="footnote-ref">
          <a href={`#ref-${n}`} id={`cite-${n}`} aria-label={`Source ${n}`}>[{n}]</a>
        </sup>
      );
    }
    return part;
  });
}

const ArticleBody = memo(function ArticleBody({ content, sources }) {
  const paragraphs = content
    .split('\n')
    .filter(p => p.trim().length > 0);

  const refs = Array.isArray(sources) ? sources : [];
  const validRefs = new Set(refs.map(r => Number(r.n)));

  return (
    <div className="article-body" role="main">
      {paragraphs.map((p, i) => (
        <p key={i}>{renderWithFootnotes(p.trim(), validRefs)}</p>
      ))}
      {refs.length > 0 && <References sources={refs} />}
    </div>
  );
});

function References({ sources }) {
  return (
    <section className="article-references" aria-label="Sources">
      <h2 className="references-title">Sources</h2>
      <ol className="references-list">
        {sources.map(s => (
          <li key={s.n} id={`ref-${s.n}`} className="reference-item">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
            ) : (
              <span>{s.label}</span>
            )}
            {' '}
            <a href={`#cite-${s.n}`} className="reference-backlink" aria-label="Back to citation">↩</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── ARTICLE HERO IMAGE ────────────────────────────────────────────────────────

function ArticleHeroImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      className="article-hero-img"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// ── ARTICLE META ──────────────────────────────────────────────────────────────

function ArticleMeta({ story }) {
  return (
    <div className="article-meta">
      <time className="article-time" dateTime={story.time}>
        {timeAgo(story.time)}
      </time>
      {story.read && (
        <>
          <span className="meta-dot" aria-hidden="true">·</span>
          <span className="article-read">{story.read}</span>
        </>
      )}
    </div>
  );
}

// ── ARTICLE PAGE ──────────────────────────────────────────────────────────────

function ArticlePage({ storyId }) {
  const [story,   setStory]   = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storyId) {
      setError('No story ID provided.');
      setLoading(false);
      return;
    }

    loadStories()
      .then(data => {
        const found = data.stories[storyId];
        if (!found) throw new Error(`Story not found`);
        setStory(found);
        document.title = `${found.title} — Verum`;
      })
      .catch(err => {
        console.error('[Verum] article load error:', err);
        setError('This article could not be found or loaded.');
      })
      .finally(() => setLoading(false));
  }, [storyId]);

  if (loading) {
    return (
      <div className="loading" role="status" aria-live="polite">
        <div className="loading-spinner" aria-hidden="true" />
        Loading article...
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state" role="alert">
        <div className="error-icon">⚠</div>
        <div className="error-title">Article not found</div>
        <div className="error-msg">{error}</div>
        <a href="index.html" className="error-link">← Back to home</a>
      </div>
    );
  }

  const cat = story.category || story.region || '';

  return (
    <div id="article-body-wrap">
      <a className="back-btn" href="index.html">Back to home</a>

      <span className="article-cat">{cat}</span>

      <h1 className="article-title">{story.title}</h1>

      <ArticleMeta story={story} />

      <ArticleHeroImage src={story.image} alt={story.title} />

      <ArticleBody content={story.content} sources={story.sources} />
    </div>
  );
}

// ── MOUNT ─────────────────────────────────────────────────────────────────────

// Progress bar — mounted at top of body, outside main content
const progressRoot = document.createElement('div');
document.body.prepend(progressRoot);
ReactDOM.createRoot(progressRoot).render(<ReadingProgressBar />);

// Article content
const storyId = getParam('id');
ReactDOM.createRoot(document.getElementById('article-content'))
  .render(<ArticlePage storyId={storyId} />);
