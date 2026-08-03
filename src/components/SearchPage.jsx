/**
 * src/components/SearchPage.jsx
 * Site search with Recordationem integration.
 *
 * For any query, results are split into three bands so a reader immediately
 * sees whether a topic has ongoing significance despite limited current
 * coverage:
 *
 *   • Current Coverage     — recent matching articles (stories.json)
 *   • Recordationem Updates — matching recovered topics (recordationem.json)
 *   • Historical Context    — older matching articles (stories.json)
 */
import React, { useState, useEffect, useMemo, memo } from 'react';
import { loadStories, timeAgo } from '../utils/shared';
import {
  loadRecordationem,
  searchTopics,
  importanceClass,
  formatDecline,
  RECORDATIONEM_STORY_URL,
} from '../utils/recordationem';

const RECENT_DAYS = 21; // articles newer than this are "current coverage"

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function matchStory(s, terms) {
  const hay = `${s.title} ${s.content || ''} ${s.category || ''} ${s.source || ''}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

const ArticleRow = memo(function ArticleRow({ s }) {
  return (
    <a className="search-result" href={`/article.html?id=${encodeURIComponent(s.id)}`}>
      <div className="search-result-cat">{s.category}</div>
      <div className="search-result-title">{s.title}</div>
      <div className="search-result-meta">
        {timeAgo(s.time)} · {s.source || s.author || 'Verum'}
      </div>
    </a>
  );
});

const RecRow = memo(function RecRow({ t }) {
  return (
    <a className="search-rec-result" href={RECORDATIONEM_STORY_URL(t.slug || t.id)}>
      <div className="search-rec-top">
        <span className={`rec-importance ${importanceClass(t.importance)}`}>{t.importance}</span>
        <span className="search-rec-decline">Coverage {formatDecline(t.coverageDeclinePct)}</span>
        <span className="search-rec-status">{t.status}</span>
      </div>
      <div className="search-rec-title">{t.title}</div>
      <div className="search-rec-why">{t.whyStillImportant}</div>
      <div className="search-result-meta">Last verified update {timeAgo(t.lastVerifiedUpdate)}</div>
    </a>
  );
});

function Band({ label, count, children }) {
  return (
    <section className="search-band">
      <div className="section-header">
        <span className="section-header-label">{label}</span>
        {count != null && <span className="search-band-count">{count}</span>}
        <div className="section-header-line" />
      </div>
      {children}
    </section>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState(getParam('q') || '');
  const [submitted, setSubmitted] = useState(getParam('q') || '');
  const [stories, setStories] = useState([]);
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([loadStories(), loadRecordationem()]).then(([s, r]) => {
      if (s.status === 'fulfilled') setStories(Object.values(s.value.stories || {}));
      if (r.status === 'fulfilled') setRec(r.value);
      setLoading(false);
    });
  }, []);

  const { current, historical, recordationem } = useMemo(() => {
    const q = submitted.toLowerCase().trim();
    if (!q) return { current: [], historical: [], recordationem: [] };
    const terms = q.split(/\s+/).filter(Boolean);
    const matched = stories.filter((s) => matchStory(s, terms));
    const cutoff = Date.now() - RECENT_DAYS * 86400 * 1000;
    const current = [];
    const historical = [];
    for (const s of matched) {
      const t = new Date(s.time).getTime();
      (t >= cutoff ? current : historical).push(s);
    }
    current.sort((a, b) => new Date(b.time) - new Date(a.time));
    historical.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recordationem = rec ? searchTopics(rec.stories, q) : [];
    return { current: current.slice(0, 12), historical: historical.slice(0, 12), recordationem };
  }, [submitted, stories, rec]);

  const onSubmit = (e) => {
    e.preventDefault();
    setSubmitted(query);
    const url = new URL(window.location.href);
    url.searchParams.set('q', query);
    window.history.replaceState({}, '', url);
  };

  return (
    <div className="search-page">
      <form className="search-form" onSubmit={onSubmit} role="search">
        <input
          type="text"
          className="search-input"
          placeholder="Search Verum — try a conflict, policy, or investigation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search"
          autoFocus
        />
        <button type="submit" className="search-submit">Search</button>
      </form>

      {loading && (
        <div className="loading" role="status"><div className="loading-spinner" aria-hidden="true" />Searching…</div>
      )}

      {!loading && submitted && (
        <>
          <Band label="Current Coverage" count={current.length}>
            {current.length ? (
              <div className="search-results">{current.map((s) => <ArticleRow key={s.id} s={s} />)}</div>
            ) : (
              <p className="search-empty">No current coverage for “{submitted}”.</p>
            )}
          </Band>

          <Band label="Recordationem Updates" count={recordationem.length}>
            {recordationem.length ? (
              <div className="search-rec-results">{recordationem.map((t) => <RecRow key={t.id} t={t} />)}</div>
            ) : (
              <p className="search-empty">No recovered stories match “{submitted}” yet.</p>
            )}
          </Band>

          <Band label="Historical Context" count={historical.length}>
            {historical.length ? (
              <div className="search-results">{historical.map((s) => <ArticleRow key={s.id} s={s} />)}</div>
            ) : (
              <p className="search-empty">No earlier coverage found.</p>
            )}
          </Band>
        </>
      )}

      {!loading && !submitted && (
        <p className="search-hint">
          Enter a topic to see current coverage, ongoing Recordationem updates, and historical context side by side.
        </p>
      )}
    </div>
  );
}
