/* global React, ReactDOM, timeAgo, loadStories, getParam, initPage */
// @ts-check

'use strict';

const { useState, useEffect, useMemo, memo } = React;

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
