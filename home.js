/* global React, ReactDOM, timeAgo, loadStories, initPage */
// @ts-check

'use strict';

const { useState, useEffect, useCallback, useRef, memo } = React;

initPage('home');

const REFRESH_MS    = 5 * 60 * 1000;
const STORY_URL     = id => `article.html?id=${encodeURIComponent(id)}`;
const CAT_URL       = cat => `category.html?cat=${encodeURIComponent(cat)}`;

// ── CUSTOM HOOKS ──────────────────────────────────────────────────────────────

/** Fetches and refreshes stories.json on an interval */
function useStories(refreshMs = REFRESH_MS) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null });

  const fetch_ = useCallback(() => {
    loadStories()
      .then(data => setState({
        data,
        error: null,
        loading: false,
        updatedAt: new Date().toLocaleTimeString(),
      }))
      .catch(err => {
        console.error('[Verum] stories load error:', err);
        setState(prev => ({ ...prev, error: err.message, loading: false }));
      });
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, refreshMs);
    return () => clearInterval(id);
  }, [fetch_, refreshMs]);

  return { ...state, refresh: fetch_ };
}

/** Tracks scroll-based reading progress for an element */
function useReadingProgress(elementId) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById(elementId);
      if (!el) return;
      const total    = el.offsetHeight - window.innerHeight;
      const scrolled = Math.max(0, -el.getBoundingClientRect().top);
      setProgress(total > 0 ? Math.min(100, Math.round((scrolled / total) * 100)) : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [elementId]);
  return progress;
}

// ── SHARED UI COMPONENTS ──────────────────────────────────────────────────────

/** Image with graceful fallback placeholder */
const StoryImage = memo(function StoryImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="img-placeholder" aria-hidden="true">
        <span className="img-placeholder-icon">📷</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
});

/** Category badge pill */
const CategoryBadge = memo(function CategoryBadge({ cat, linked = false }) {
  if (linked) {
    return <a href={CAT_URL(cat)} className="hero-cat category-link">{cat}</a>;
  }
  return <span className="hero-cat">{cat}</span>;
});

/** Standard section header with yellow label and divider line */
function SectionHeader({ label, seeAllCat }) {
  return (
    <div className="section-header">
      <span className="section-header-label">{label}</span>
      {seeAllCat && (
        <a href={CAT_URL(seeAllCat)} className="see-all-link">See all →</a>
      )}
      <div className="section-header-line" />
    </div>
  );
}

/** Loading spinner / skeleton */
function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      {message}
    </div>
  );
}

/** Standardized error state */
function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <div className="error-icon">⚠</div>
      <div className="error-title">Something went wrong</div>
      <div className="error-msg">{message}</div>
      {onRetry && (
        <button className="retry-btn" onClick={onRetry}>Try again</button>
      )}
      <a href="index.html" className="error-link">← Back to home</a>
    </div>
  );
}

// ── HOMEPAGE COMPONENTS ───────────────────────────────────────────────────────

/** Hero — main featured story */
const HeroSection = memo(function HeroSection({ story }) {
  return (
    <div className="hero-main">
      <StoryImage src={story.image} alt={story.title} />
      <div className="hero-overlay">
        <CategoryBadge cat={story.category} linked />
        <h2 className="hero-title">{story.title}</h2>
        <div className="hero-meta">
          <strong>By {story.author}</strong>
          &nbsp;·&nbsp;
          <time dateTime={story.time}>{timeAgo(story.time)}</time>
          &nbsp;·&nbsp;{story.read || '3 min read'}
        </div>
      </div>
      <a
        href={STORY_URL(story.id)}
        className="card-link"
        aria-label={`Read: ${story.title}`}
      />
    </div>
  );
});

/** Stack item — sidebar story next to hero */
const StackItem = memo(function StackItem({ story }) {
  return (
    <div className="hero-stack-item" role="listitem">
      <div className="stack-thumb">
        <StoryImage src={story.image} alt={story.title} />
      </div>
      <div className="stack-body">
        <div className="stack-cat">{story.category}</div>
        <div className="stack-title">{story.title}</div>
        <div className="stack-meta">
          <time dateTime={story.time}>{timeAgo(story.time)}</time>
          {' · '}{story.author}
        </div>
      </div>
      <a
        href={STORY_URL(story.id)}
        className="card-link"
        aria-label={`Read: ${story.title}`}
      />
    </div>
  );
});

/** Standard story card for the latest news grid */
const StoryCard = memo(function StoryCard({ story }) {
  return (
    <article className="story-card" role="listitem">
      <div className="story-thumb">
        <StoryImage src={story.image} alt={story.title} />
      </div>
      <div className="story-body">
        <div className="story-cat">{story.category}</div>
        <h3 className="story-title">{story.title}</h3>
        <div className="story-meta">
          <time dateTime={story.time}>{timeAgo(story.time)}</time>
          {' · '}{story.author}
        </div>
      </div>
      <a
        href={STORY_URL(story.id)}
        className="card-link"
        aria-label={`Read: ${story.title}`}
      />
    </article>
  );
});

/** World news item with flag */
const WorldItem = memo(function WorldItem({ story }) {
  return (
    <div className="world-item" role="listitem">
      <span className="world-flag" aria-hidden="true">{story.flag || '🌍'}</span>
      <div>
        <div className="world-region">{story.region || story.category}</div>
        <div className="world-title">{story.title}</div>
        <div className="world-meta">
          <time dateTime={story.time}>{timeAgo(story.time)}</time>
          {' · '}{story.author || story.source}
        </div>
      </div>
      <a
        href={STORY_URL(story.id)}
        className="card-link"
        aria-label={`Read: ${story.title}`}
      />
    </div>
  );
});

/** Sidebar — hottest + events */
function Sidebar({ mostRead, events }) {
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-widget">
        <div className="widget-header">
          <span className="widget-title">Hottest</span>
        </div>
        <div className="widget-body">
          {mostRead.map((title, i) => (
            <div key={i} className="most-read-item">
              <span className="most-read-num" aria-hidden="true">{i + 1}</span>
              <span className="most-read-title">{title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-widget">
        <div className="widget-header">
          <span className="widget-title">Upcoming Events</span>
        </div>
        <div className="widget-body">
          {events.map((e, i) => (
            <div key={i} className="event-item">
              <div className="event-date">{e.date}</div>
              <div className="event-title">{e.title}</div>
              <div className="event-loc">{e.location}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** Last updated timestamp */
function LastUpdated({ time, onRefresh }) {
  return (
    <div className="last-updated">
      <span>Last updated: {time}</span>
      <button
        className="refresh-btn"
        onClick={onRefresh}
        aria-label="Refresh stories"
        title="Refresh now"
      >↺</button>
    </div>
  );
}

// ── HOMEPAGE ROOT ─────────────────────────────────────────────────────────────

function HomePage() {
  const { data, error, loading, updatedAt, refresh } = useStories();

  // Push breaking news to ticker
  useEffect(() => {
    if (data?.breaking) {
      const el = document.getElementById('breaking-text');
      if (el) el.textContent = data.breaking;
    }
  }, [data?.breaking]);

  if (loading) return <LoadingState message="Loading stories..." />;
  if (error)   return <ErrorState message={error} onRetry={refresh} />;

  const { stories, featured, mostRead, events } = data;

  const heroStory    = stories[featured.hero];
  const stackStories = (featured.stack  || []).map(id => stories[id]).filter(Boolean);
  const latestStories= (featured.latest || []).map(id => stories[id]).filter(Boolean);
  const worldStories = (featured.world  || []).map(id => stories[id]).filter(Boolean);

  if (!heroStory) return <ErrorState message="No stories available yet." onRetry={refresh} />;

  return (
    <>
      {/* Hero + stack */}
      <div className="hero" role="main">
        <HeroSection story={heroStory} />
        <div className="hero-stack" role="list">
          {stackStories.map(s => <StackItem key={s.id} story={s} />)}
        </div>
      </div>

      {/* Latest news */}
      <SectionHeader label="Latest News" seeAllCat="News" />
      <div className="story-grid" role="list">
        {latestStories.map(s => <StoryCard key={s.id} story={s} />)}
      </div>

      {/* World + sidebar */}
      <div className="content-row">
        <section aria-label="World news">
          <SectionHeader label="World" seeAllCat="World" />
          <div className="world-list" role="list">
            {worldStories.map(s => <WorldItem key={s.id} story={s} />)}
          </div>
        </section>
        <Sidebar mostRead={mostRead} events={events} />
      </div>

      {updatedAt && <LastUpdated time={updatedAt} onRefresh={refresh} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('main-content'))
  .render(<HomePage />);
