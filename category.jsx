// @ts-check
'use strict';

const { useState, useEffect, useMemo, memo } = React;

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
 * Generate a self-contained placeholder image (SVG data URI, no external service)
 * Creates unique, deterministic placeholders based on story ID and title
 */
function generatePlaceholderImageUrl(storyId, title, _category) {
  const seed = `verum-${storyId}-${title}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  const cx = 120 + (h % 560);
  const cy = 80 + ((h >>> 3) % 290);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='#1a1a1a'/>` +
    `<stop offset='1' stop-color='hsl(${hue},45%,16%)'/></linearGradient></defs>` +
    `<rect width='800' height='450' fill='url(#g)'/>` +
    `<circle cx='${cx}' cy='${cy}' r='140' fill='hsl(${hue2},55%,45%)' opacity='0.18'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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

// Utility functions - expose to global scope
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

const cat     = getParam('cat') || 'News';
const pageKey = cat.toLowerCase();

document.title = `${cat} — Verum`;
initPage(pageKey);

// ── CUSTOM HOOK ───────────────────────────────────────────────────────────────

function useCategoryStories(categoryName) {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    loadStories()
      .then(data => {
        const { stories: allStories, featured, categoryIndex } = data;

        // Deduplicated ordered list of IDs for this category
        const seen = new Set();
        const ids  = [];

        // Homepage slots first — maintains editorial prominence
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
          if (sCat === categoryName.toLowerCase() && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }

        // Category bank
        for (const id of (categoryIndex[categoryName] || [])) {
          if (!seen.has(id) && allStories[id]) {
            seen.add(id);
            ids.push(id);
          }
        }

        setStories(ids.slice(0, 10).map(id => allStories[id]));
      })
      .catch(err => {
        console.error('[Verum] category load error:', err);
        setError('Could not load stories for this category.');
      })
      .finally(() => setLoading(false));
  }, [categoryName]);

  return { stories, loading, error };
}

// ── CATEGORY CARD ─────────────────────────────────────────────────────────────

const CategoryCard = memo(function CategoryCard({ story }) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = `article.html?id=${encodeURIComponent(story.id)}`;

  return (
    <article className="story-card" role="listitem">
      <div className="story-thumb">
        {imgFailed
          ? <div className="img-placeholder" aria-hidden="true">
              <span className="img-placeholder-icon">📷</span>
            </div>
          : <img
              src={story.image}
              alt={story.title}
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
            />
        }
      </div>
      <div className="story-body">
        <div className="story-cat">{story.category || story.region}</div>
        <h2 className="story-title">{story.title}</h2>
        <div className="story-meta">
          <time dateTime={story.time}>{timeAgo(story.time)}</time>
          {' · '}{story.author || story.source || 'Staff'}
        </div>
      </div>
      <a
        href={url}
        className="card-link"
        aria-label={`Read: ${story.title}`}
      />
    </article>
  );
});

// ── CATEGORY HEADER ───────────────────────────────────────────────────────────

function CategoryHeader({ cat, count, loading }) {
  return (
    <div className="cat-header">
      <div className="cat-label">Category</div>
      <h1 className="cat-title">{cat}</h1>
      {!loading && (
        <div className="cat-count">
          {count} {count === 1 ? 'story' : 'stories'}
        </div>
      )}
    </div>
  );
}

// ── CATEGORY PAGE ─────────────────────────────────────────────────────────────

function CategoryPage() {
  const { stories, loading, error } = useCategoryStories(cat);

  if (loading) {
    return (
      <>
        <CategoryHeader cat={cat} count={0} loading={true} />
        <div className="loading" role="status" aria-live="polite">
          <div className="loading-spinner" aria-hidden="true" />
          Loading {cat} stories...
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <CategoryHeader cat={cat} count={0} loading={false} />
        <div className="error-state" role="alert">
          <div className="error-icon">⚠</div>
          <div className="error-title">Something went wrong</div>
          <div className="error-msg">{error}</div>
          <a href="index.html" className="error-link">← Back to home</a>
        </div>
      </>
    );
  }

  if (stories.length === 0) {
    return (
      <>
        <CategoryHeader cat={cat} count={0} loading={false} />
        <div className="error-state">
          <div className="error-icon">📭</div>
          <div className="error-title">No stories yet</div>
          <div className="error-msg">Nothing filed under {cat} yet.</div>
          <a href="index.html" className="error-link">← Back to home</a>
        </div>
      </>
    );
  }

  return (
    <>
      <CategoryHeader cat={cat} count={stories.length} loading={false} />
      <div className="story-grid" role="list">
        {stories.map(s => <CategoryCard key={s.id} story={s} />)}
      </div>
    </>
  );
}

// ── MOUNT ─────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('cat-content'))
  .render(<CategoryPage />);
