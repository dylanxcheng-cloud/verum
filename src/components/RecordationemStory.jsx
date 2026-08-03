/**
 * src/components/RecordationemStory.jsx
 * Recordationem story detail page.
 *
 * Sections (per spec):
 *   • Why This Is Still Important  (AI-generated + editor-reviewed)
 *   • What Happened               (historical overview)
 *   • What Is Happening Now       (current state)
 *   • What Changed Since The Headlines
 *   • Recent Verified Updates     (continuously refreshed timeline)
 *   • Coverage Decay Analysis     (peak vs current + source-diversity trend)
 *   • Watch Next                  (upcoming milestones)
 */
import React, { useState, useEffect, memo } from 'react';
import { timeAgo } from '../utils/shared';
import {
  loadRecordationem,
  findTopic,
  importanceClass,
  statusClass,
  formatDecline,
} from '../utils/recordationem';

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ── Coverage Decay Analysis chart (pure SVG, no chart lib) ──────────────────────

const CoverageDecayChart = memo(function CoverageDecayChart({ history, diversity }) {
  if (!history || history.length < 2) {
    return <p className="rec-chart-empty">Not enough history yet to plot coverage decay.</p>;
  }

  const W = 640;
  const H = 200;
  const P = 28; // padding
  const scores = history.map((p) => p.score);
  const maxScore = Math.max(...scores, 1);
  const peakIdx = scores.indexOf(Math.max(...scores));

  const x = (i) => P + (i * (W - 2 * P)) / (history.length - 1);
  const y = (v) => H - P - (v / maxScore) * (H - 2 * P);

  const linePath = history.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.score)}`).join(' ');
  const areaPath = `${linePath} L ${x(history.length - 1)} ${H - P} L ${x(0)} ${H - P} Z`;

  // Source-diversity trend (normalised to same canvas, drawn as a faint line).
  const divCounts = (diversity || []).map((p) => p.sourceCount);
  const maxDiv = Math.max(...divCounts, 1);
  const divPath =
    diversity && diversity.length === history.length
      ? diversity
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${H - P - (p.sourceCount / maxDiv) * (H - 2 * P)}`)
          .join(' ')
      : null;

  return (
    <div className="rec-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="rec-chart-svg" role="img"
           aria-label="Coverage over time: peak versus current attention">
        <defs>
          <linearGradient id="recArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--yellow)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--yellow)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#recArea)" />
        <path d={linePath} fill="none" stroke="var(--yellow)" strokeWidth="2.5" />
        {divPath && (
          <path d={divPath} fill="none" stroke="#5aa9ff" strokeWidth="1.5"
                strokeDasharray="4 4" opacity="0.8" />
        )}
        {/* Peak marker */}
        <circle cx={x(peakIdx)} cy={y(scores[peakIdx])} r="4" fill="var(--yellow)" />
        <text x={x(peakIdx)} y={y(scores[peakIdx]) - 8} className="rec-chart-peak-label"
              textAnchor="middle">Peak</text>
        {/* Current marker */}
        <circle cx={x(history.length - 1)} cy={y(scores[scores.length - 1])} r="4"
                fill="var(--red)" />
        <text x={x(history.length - 1)} y={y(scores[scores.length - 1]) - 8}
              className="rec-chart-now-label" textAnchor="end">Now</text>
      </svg>
      <div className="rec-chart-legend">
        <span><i className="rec-legend-swatch rec-legend-coverage" /> Coverage volume</span>
        {divPath && <span><i className="rec-legend-swatch rec-legend-diversity" /> Source diversity</span>}
        <span className="rec-chart-axis">{history[0].period} → {history[history.length - 1].period}</span>
      </div>
    </div>
  );
});

// ── Sections ────────────────────────────────────────────────────────────────────

function Section({ title, children, className = '' }) {
  return (
    <section className={`rec-section ${className}`}>
      <h2 className="rec-section-title">{title}</h2>
      {children}
    </section>
  );
}

const UpdateRow = memo(function UpdateRow({ u }) {
  const inner = (
    <>
      <div className="rec-update-date">{timeAgo(u.date)}</div>
      <div className="rec-update-body">
        <div className="rec-update-title">{u.title}</div>
        <div className="rec-update-source">{u.source}</div>
      </div>
    </>
  );
  return u.storyId ? (
    <a className="rec-update" href={`/article.html?id=${encodeURIComponent(u.storyId)}`}>{inner}</a>
  ) : (
    <div className="rec-update">{inner}</div>
  );
});

export default function RecordationemStory() {
  const [state, setState] = useState({ topic: null, data: null, error: null, loading: true });

  useEffect(() => {
    const id = getParam('id');
    loadRecordationem()
      .then((data) => {
        const topic = findTopic(data, id);
        if (!topic) {
          setState({ topic: null, data, error: 'Topic not found', loading: false });
        } else {
          document.title = `${topic.title} — Recordationem · Verum`;
          setState({ topic, data, error: null, loading: false });
        }
      })
      .catch((err) => setState({ topic: null, data: null, error: err.message, loading: false }));
  }, []);

  const { topic, error, loading } = state;

  if (loading) {
    return (
      <div className="loading" role="status" aria-live="polite">
        <div className="loading-spinner" aria-hidden="true" />
        Loading recovered story…
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="error-state" role="alert">
        <div className="error-icon">⚠</div>
        <div className="error-title">Story not found</div>
        <div className="error-msg">This Recordationem topic is no longer available.</div>
        <a href="/recordationem.html" className="error-link">← All recovered stories</a>
      </div>
    );
  }

  const m = topic.metrics;

  return (
    <article className="rec-detail">
      <a href="/recordationem.html" className="rec-back">← Recordationem</a>

      <div className="rec-detail-head">
        <div className="rec-card-top">
          <span className={`rec-importance ${importanceClass(topic.importance)}`}>{topic.importance}</span>
          <span className={`rec-status ${statusClass(topic.status)}`}>{topic.status}</span>
          <span className="rec-detail-cat">{topic.category}</span>
        </div>
        <h1 className="rec-detail-title">{topic.title}</h1>
        <div className="rec-detail-meta">
          <span>Coverage decline <strong className="rec-decline">{formatDecline(topic.coverageDeclinePct)}</strong></span>
          <span>·</span>
          <span>Last verified update <strong>{timeAgo(topic.lastVerifiedUpdate)}</strong></span>
          <span>·</span>
          <span>Recordationem score <strong>{topic.recordationemScore}</strong></span>
        </div>
        {topic.entities && topic.entities.length > 0 && (
          <div className="rec-entities">
            {topic.entities.slice(0, 8).map((e) => (
              <span className="rec-entity" key={e}>{e}</span>
            ))}
          </div>
        )}
      </div>

      <Section title="Why This Is Still Important" className="rec-section--why">
        <p>{topic.whyStillImportant}</p>
        <div className="rec-byline">
          {topic.narrativeSource === 'ai' ? 'AI-generated · editor-reviewed' : 'Extractive summary · editor-reviewed'}
        </div>
      </Section>

      <Section title="What Happened">
        <p>{topic.whatHappened}</p>
      </Section>

      <Section title="What Is Happening Now">
        <p>{topic.whatIsHappeningNow}</p>
      </Section>

      <Section title="What Changed Since The Headlines">
        <p>{topic.whatChanged}</p>
      </Section>

      <Section title="Coverage Decay Analysis">
        <div className="rec-decay-metrics">
          <div className="rec-metric">
            <span className="rec-metric-val">{m.peakCoverageScore}</span>
            <span className="rec-metric-label">Peak coverage</span>
          </div>
          <div className="rec-metric">
            <span className="rec-metric-val">{m.currentCoverageScore}</span>
            <span className="rec-metric-label">Current coverage</span>
          </div>
          <div className="rec-metric">
            <span className="rec-metric-val">{Math.round(m.attentionDecayRate * 100)}%</span>
            <span className="rec-metric-label">Attention decay</span>
          </div>
          <div className="rec-metric">
            <span className="rec-metric-val">{m.relevanceScore}</span>
            <span className="rec-metric-label">Relevance</span>
          </div>
          <div className="rec-metric">
            <span className="rec-metric-val">{m.significanceScore}</span>
            <span className="rec-metric-label">Significance</span>
          </div>
        </div>
        <CoverageDecayChart history={topic.coverageHistory} diversity={topic.sourceDiversity} />
      </Section>

      <Section title="Recent Verified Updates">
        <div className="rec-updates">
          {topic.updates.map((u, i) => (
            <UpdateRow key={i} u={u} />
          ))}
        </div>
      </Section>

      <Section title="Watch Next">
        <div className="rec-watch">
          {topic.watchNext.map((w, i) => (
            <div className="rec-watch-item" key={i}>
              <span className="rec-watch-type">{w.type}</span>
              <span className="rec-watch-title">{w.title}</span>
            </div>
          ))}
        </div>
      </Section>

      {topic.editorial && topic.editorial.notes && topic.editorial.notes.length > 0 && (
        <Section title="Editor's Notes" className="rec-section--notes">
          {topic.editorial.notes.map((n, i) => (
            <p key={i} className="rec-editor-note">{n}</p>
          ))}
        </Section>
      )}
    </article>
  );
}
