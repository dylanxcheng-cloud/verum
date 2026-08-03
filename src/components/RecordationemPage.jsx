/**
 * src/components/RecordationemPage.jsx
 * Recordationem landing page.
 *
 * Displays the mission statement prominently at the top (required on all
 * Recordationem landing pages), dynamically generated category filters, and the
 * full set of discovered topics as cards. Categories and topics are read from
 * recordationem.json — nothing here is hardcoded.
 */
import React, { useState, useEffect, useMemo, memo } from 'react';
import { timeAgo } from '../utils/shared';
import {
  loadRecordationem,
  importanceClass,
  statusClass,
  formatDecline,
  RECORDATIONEM_STORY_URL,
} from '../utils/recordationem';

const TopicCard = memo(function TopicCard({ topic }) {
  return (
    <article className="rec-card rec-card--full" role="listitem">
      <div className="rec-card-top">
        <span className={`rec-importance ${importanceClass(topic.importance)}`}>
          {topic.importance}
        </span>
        <span className={`rec-status ${statusClass(topic.status)}`}>{topic.status}</span>
      </div>
      <h3 className="rec-card-title">{topic.title}</h3>
      <div className="rec-card-cat">
        {topic.category}
        {topic.categoryEmergent && <span className="rec-emergent-badge" title="Category emerged automatically from clustering">auto</span>}
      </div>
      <p className="rec-card-why">{topic.whyStillImportant}</p>
      <div className="rec-card-stats">
        <div className="rec-stat">
          <span className="rec-stat-label">Coverage decline</span>
          <span className="rec-stat-value rec-decline">{formatDecline(topic.coverageDeclinePct)}</span>
        </div>
        <div className="rec-stat">
          <span className="rec-stat-label">Last verified update</span>
          <span className="rec-stat-value">{timeAgo(topic.lastVerifiedUpdate)}</span>
        </div>
        <div className="rec-stat">
          <span className="rec-stat-label">Tracked sources</span>
          <span className="rec-stat-value">{topic.articleCount}</span>
        </div>
      </div>
      <a
        href={RECORDATIONEM_STORY_URL(topic.slug || topic.id)}
        className="card-link"
        aria-label={`Read Recordationem: ${topic.title}`}
      />
    </article>
  );
});

export function MissionBanner({ subtitle, mission, formula, threshold }) {
  return (
    <div className="rec-hero">
      <div className="rec-hero-kicker">Verum · Recordationem</div>
      <h1 className="rec-hero-title">Recordationem</h1>
      <div className="rec-hero-subtitle">{subtitle}</div>
      <p className="rec-mission-note">{mission}</p>
      {formula && (
        <div className="rec-formula" title="Discovery formula">
          <code>{formula}</code>
          {threshold != null && <span className="rec-formula-threshold">threshold ≥ {threshold}</span>}
        </div>
      )}
    </div>
  );
}

export default function RecordationemPage() {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [active, setActive] = useState('All');

  useEffect(() => {
    loadRecordationem()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err) => setState({ data: null, error: err.message, loading: false }));
  }, []);

  const { data, error, loading } = state;

  const filtered = useMemo(() => {
    if (!data) return [];
    if (active === 'All') return data.stories;
    return data.stories.filter((s) => s.category === active);
  }, [data, active]);

  if (loading) {
    return (
      <div className="loading" role="status" aria-live="polite">
        <div className="loading-spinner" aria-hidden="true" />
        Discovering forgotten stories…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="error-state" role="alert">
        <div className="error-icon">⚠</div>
        <div className="error-title">Recordationem is warming up</div>
        <div className="error-msg">
          The discovery engine has not published results yet. Run{' '}
          <code>python recordationem.py</code> to generate them.
        </div>
        <a href="/" className="error-link">
          ← Back to home
        </a>
      </div>
    );
  }

  return (
    <>
      <MissionBanner
        subtitle={data.subtitle}
        mission={data.mission}
        formula={data.formula}
        threshold={data.threshold}
      />

      {data.stats && (
        <div className="rec-stats-bar">
          <span><strong>{data.stats.corpusSize}</strong> stories scanned</span>
          <span><strong>{data.stats.topicsExamined}</strong> topics examined</span>
          <span><strong>{data.stats.topicsSurfaced}</strong> recovered</span>
          {data.generatedAt && <span>Updated {timeAgo(data.generatedAt)}</span>}
        </div>
      )}

      {/* Dynamically generated category filters */}
      <div className="rec-cat-filters" role="tablist" aria-label="Recordationem categories">
        <button
          className={`rec-cat-chip ${active === 'All' ? 'active' : ''}`}
          onClick={() => setActive('All')}
          role="tab"
          aria-selected={active === 'All'}
        >
          All <span className="rec-cat-count">{data.stories.length}</span>
        </button>
        {data.categories.map((c) => (
          <button
            key={c.name}
            className={`rec-cat-chip ${active === c.name ? 'active' : ''}`}
            onClick={() => setActive(c.name)}
            role="tab"
            aria-selected={active === c.name}
          >
            {c.name} <span className="rec-cat-count">{c.count}</span>
            {c.emergent && <span className="rec-emergent-dot" title="Emerged automatically" />}
          </button>
        ))}
      </div>

      <div className="rec-card-grid rec-card-grid--full" role="list">
        {filtered.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
      </div>

      {!filtered.length && (
        <p className="rec-empty">No recovered stories in this category yet.</p>
      )}
    </>
  );
}
