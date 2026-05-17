/**
 * src/components/HomePage.jsx
 * Home page with hero, latest news, world section, and sidebar
 */
import React, { useState, useEffect, useCallback, memo } from 'react';
import { loadStories, timeAgo } from '../utils/shared';

const REFRESH_MS = 5 * 60 * 1000;
const STORY_URL = (id) => `/article.html?id=${encodeURIComponent(id)}`;
const CAT_URL = (cat) => `/category.html?cat=${encodeURIComponent(cat)}`;

// ── HOOKS ──────────────────────────────────────────────────────────────────────

function useStories(refreshMs = REFRESH_MS) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
    updatedAt: null,
  });

  const fetch_ = useCallback(() => {
    loadStories()
      .then((data) => {
        setState({
          data,
          error: null,
          loading: false,
          updatedAt: new Date().toLocaleTimeString(),
        });
        if (data.breaking) {
          const el = document.getElementById('breaking-text');
          if (el) el.textContent = data.breaking;
        }
      })
      .catch((err) => {
        console.error('[Verum] HomePage load error:', err);
        setState((prev) => ({
          ...prev,
          error: err.message,
          loading: false,
        }));
      });
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, refreshMs);
    return () => clearInterval(id);
  }, [fetch_, refreshMs]);

  return { ...state, refresh: fetch_ };
}

// ── COMPONENTS ─────────────────────────────────────────────────────────────────

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

const CategoryBadge = memo(function CategoryBadge({ cat, linked = false }) {
  if (linked) {
    return <a href={CAT_URL(cat)} className="hero-cat category-link">{cat}</a>;
  }
  return <span className="hero-cat">{cat}</span>;
});

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

function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      {message}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <div className="error-icon">⚠</div>
      <div className="error-title">Something went wrong</div>
      <div className="error-msg">{message}</div>
      {onRetry && (
        <button className="retry-btn" onClick={onRetry}>Try again</button>
      )}
      <a href="/" className="error-link">← Back to home</a>
    </div>
  );
}

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
          {timeAgo(story.time)} · {story.author}
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

const StoryCard = memo(function StoryCard({ story }) {
  return (
    <article className="story-card" role="listitem">
      <div className="story-thumb">
        <StoryImage src={story.image} alt={story.title} />
      </div>
      <div className="story-body">
        <div className="story-cat">{story.category}</div>
        <div className="story-title">{story.title}</div>
        <div className="story-meta">
          {timeAgo(story.time)} · {story.author}
        </div>
      </div>
      <a
        href={STORY_URL(story.id)}
        className="card-link"
        aria-label={story.title}
      />
    </article>
  );
});

const WorldItem = memo(function WorldItem({ story }) {
  return (
    <div className="world-item" role="listitem">
      <span className="world-flag" aria-hidden="true">
        {story.flag || '🌍'}
      </span>
      <div>
        <div className="world-region">{story.region || story.category}</div>
        <div className="world-title">{story.title}</div>
        <div className="world-meta">
          {timeAgo(story.time)} · {story.author || story.source}
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

const MostReadItem = memo(function MostReadItem({ title, index }) {
  return (
    <div className="most-read-item">
      <span className="most-read-num" aria-hidden="true">{index + 1}</span>
      <span className="most-read-title">{title}</span>
    </div>
  );
});

const EventItem = memo(function EventItem({ event }) {
  return (
    <div className="event-item">
      <div className="event-date">{event.date}</div>
      <div className="event-title">{event.title}</div>
      <div className="event-loc">{event.location}</div>
    </div>
  );
});

const Sidebar = memo(function Sidebar({ mostRead, events }) {
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-widget">
        <div className="widget-header">
          <span className="widget-title">Hottest</span>
        </div>
        <div className="widget-body">
          {mostRead.map((title, i) => (
            <MostReadItem key={i} title={title} index={i} />
          ))}
        </div>
      </div>

      <div className="sidebar-widget">
        <div className="widget-header">
          <span className="widget-title">Upcoming Events</span>
        </div>
        <div className="widget-body">
          {events.map((event, i) => (
            <EventItem key={i} event={event} />
          ))}
        </div>
      </div>
    </aside>
  );
});

function LastUpdated({ time }) {
  return (
    <div
      style={{
        textAlign: 'right',
        fontSize: '11px',
        color: 'var(--gray)',
        fontFamily: "'Barlow Condensed', sans-serif",
        letterSpacing: '0.5px',
        padding: '8px 0 0',
      }}
    >
      Last updated: {time}
    </div>
  );
}

// ── MAIN PAGE COMPONENT ────────────────────────────────────────────────────────

export default function HomePage() {
  const { data, error, loading, updatedAt, refresh } = useStories();

  if (error) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  if (loading || !data) {
    return <LoadingState />;
  }

  const { stories, featured, mostRead, events } = data;
  const heroStory = stories[featured.hero];
  const stackStories = (featured.stack || [])
    .map((id) => stories[id])
    .filter(Boolean);
  const latestStories = (featured.latest || [])
    .map((id) => stories[id])
    .filter(Boolean);
  const worldStories = (featured.world || [])
    .map((id) => stories[id])
    .filter(Boolean);

  if (!heroStory) {
    return <LoadingState message="No stories available yet." />;
  }

  return (
    <>
      {/* Hero + Stack */}
      <div className="hero" role="main">
        <HeroSection story={heroStory} />
        <div className="hero-stack" role="list">
          {stackStories.map((s) => (
            <StackItem key={s.id} story={s} />
          ))}
        </div>
      </div>

      {/* Latest News */}
      <SectionHeader label="Latest News" seeAllCat="News" />
      <div className="story-grid" role="list">
        {latestStories.map((s) => (
          <StoryCard key={s.id} story={s} />
        ))}
      </div>

      {/* World + Sidebar */}
      <div className="content-row">
        <section aria-label="World news">
          <SectionHeader label="World" seeAllCat="World" />
          <div className="world-list" role="list">
            {worldStories.map((s) => (
              <WorldItem key={s.id} story={s} />
            ))}
          </div>
        </section>
        <Sidebar mostRead={mostRead} events={events} />
      </div>

      {/* Last Updated */}
      {updatedAt && <LastUpdated time={updatedAt} />}
    </>
  );
}
