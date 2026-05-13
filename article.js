/* global React, ReactDOM, timeAgo, loadStories, getParam, initPage */
// @ts-check

'use strict';

const { useState, useEffect, memo } = React;

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

const ArticleBody = memo(function ArticleBody({ content }) {
  const paragraphs = content
    .split('\n')
    .filter(p => p.trim().length > 0);

  return (
    <div className="article-body" role="main">
      {paragraphs.map((p, i) => <p key={i}>{p.trim()}</p>)}
    </div>
  );
});

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
      <span className="article-author">
        By {story.author || story.source || 'Staff'}
      </span>
      <span className="meta-dot" aria-hidden="true">·</span>
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

      <ArticleBody content={story.content} />
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
