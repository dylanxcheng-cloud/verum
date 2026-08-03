/**
 * src/components/RecordationemModule.jsx
 * Homepage module: "Recordationem — Recovering stories that still matter."
 *
 * Surfaces the top discovered topics with importance score, coverage decline,
 * last meaningful update, and ongoing status. Self-contained: fetches its own
 * data so it degrades silently (renders nothing) if recordationem.json is
 * absent, never breaking the homepage.
 */
import React, { useState, useEffect, memo } from 'react';
import { timeAgo } from '../utils/shared';
import {
  loadRecordationem,
  importanceClass,
  statusClass,
  formatDecline,
  RECORDATIONEM_STORY_URL,
  RECORDATIONEM_URL_PATH,
} from '../utils/recordationem';

const MAX_CARDS = 4;

const RecCard = memo(function RecCard({ topic }) {
  return (
    <article className="rec-card" role="listitem">
      <div className="rec-card-top">
        <span className={`rec-importance ${importanceClass(topic.importance)}`}>
          {topic.importance}
        </span>
        <span className={`rec-status ${statusClass(topic.status)}`}>{topic.status}</span>
      </div>
      <h3 className="rec-card-title">{topic.title}</h3>
      <div className="rec-card-cat">{topic.category}</div>
      <div className="rec-card-stats">
        <div className="rec-stat">
          <span className="rec-stat-label">Importance</span>
          <span className="rec-stat-value">{topic.importance}</span>
        </div>
        <div className="rec-stat">
          <span className="rec-stat-label">Coverage decline</span>
          <span className="rec-stat-value rec-decline">{formatDecline(topic.coverageDeclinePct)}</span>
        </div>
        <div className="rec-stat">
          <span className="rec-stat-label">Last verified update</span>
          <span className="rec-stat-value">{timeAgo(topic.lastVerifiedUpdate)}</span>
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

export default function RecordationemModule() {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let alive = true;
    loadRecordationem()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((err) => {
        console.warn('[Verum] Recordationem module unavailable:', err.message);
        alive && setState({ data: null, error: err.message, loading: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const { data, loading } = state;

  // Fail silent — never block the homepage if the feature has no data yet.
  if (loading || !data || !data.stories.length) return null;

  const cards = data.stories.slice(0, MAX_CARDS);

  return (
    <section className="rec-module" aria-label="Recordationem">
      <div className="section-header">
        <span className="section-header-label rec-module-label">Recordationem</span>
        <a href={RECORDATIONEM_URL_PATH} className="see-all-link">
          Explore all →
        </a>
        <div className="section-header-line" />
      </div>

      <p className="rec-module-subtitle">{data.subtitle}</p>
      <p className="rec-mission-note rec-mission-note--compact">{data.mission}</p>

      <div className="rec-card-grid" role="list">
        {cards.map((t) => (
          <RecCard key={t.id} topic={t} />
        ))}
      </div>
    </section>
  );
}
