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
  sourceLabel,
  sourcesByOutlet,
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
  const external = u.url && /^https?:\/\//.test(u.url);
  const inner = (
    <>
      <div className="rec-update-date">{timeAgo(u.date)}</div>
      <div className="rec-update-body">
        <div className="rec-update-title">{u.title}</div>
        <div className="rec-update-source">
          {u.sourceLabel || u.source}
          {external && <span className="rec-ext"> · read at source ↗</span>}
        </div>
      </div>
    </>
  );
  // Prefer the original source article (opens in a new tab); fall back to the
  // internal Verum article, then to a non-link row.
  if (external) {
    return (
      <a className="rec-update" href={u.url} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return u.storyId ? (
    <a className="rec-update" href={`/article.html?id=${encodeURIComponent(u.storyId)}`}>{inner}</a>
  ) : (
    <div className="rec-update">{inner}</div>
  );
});

// A single source article link inside the outlet directory.
const SourceLink = memo(function SourceLink({ a }) {
  const external = a.url && /^https?:\/\//.test(a.url);
  const label = a.title || 'Untitled report';
  const meta = (
    <span className="rec-srclink-meta">
      {a.date ? timeAgo(a.date) : ''}
      {external ? ' · read at source ↗' : a.storyId ? ' · read on Verum' : ''}
    </span>
  );
  if (external) {
    return (
      <a className="rec-srclink" href={a.url} target="_blank" rel="noopener noreferrer">
        <span className="rec-srclink-title">{label}</span>
        {meta}
      </a>
    );
  }
  return a.storyId ? (
    <a className="rec-srclink" href={`/article.html?id=${encodeURIComponent(a.storyId)}`}>
      <span className="rec-srclink-title">{label}</span>
      {meta}
    </a>
  ) : (
    <div className="rec-srclink rec-srclink--plain">
      <span className="rec-srclink-title">{label}</span>
      {meta}
    </div>
  );
});

/**
 * "Sources & Further Reading" — a directory of every outlet that reported the
 * topic, each expandable to its individual articles with outbound links. Built
 * entirely from the topic's tracked articles, so a reader can follow any source
 * to the original reporting for deeper research.
 */
const SourcesSection = memo(function SourcesSection({ outlets, totalArticles }) {
  if (!outlets.length) return null;
  return (
    <Section title="Sources & Further Reading" className="rec-section--sources">
      <p className="rec-sources-intro">
        This recovered story is assembled from <strong>{totalArticles}</strong>{' '}
        {totalArticles === 1 ? 'report' : 'reports'} across{' '}
        <strong>{outlets.length}</strong> {outlets.length === 1 ? 'outlet' : 'outlets'}.
        Follow any source below for the original article and deeper context.
      </p>
      <div className="rec-source-outlets">
        {outlets.map((o) => (
          <details className="rec-outlet" key={o.slug} open={outlets.length <= 3}>
            <summary className="rec-outlet-head">
              <span className="rec-outlet-name">{o.label}</span>
              <span className="rec-outlet-count">
                {o.count} {o.count === 1 ? 'report' : 'reports'}
              </span>
            </summary>
            <div className="rec-outlet-links">
              {o.articles.map((a, i) => (
                <SourceLink key={i} a={a} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </Section>
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

  // Derive the source directory and summary figures from the topic's tracked
  // articles, so these render from the data that always exists (`updates`) even
  // when the pipeline hasn't emitted the richer sourceBreakdown/byTheNumbers.
  const updates = topic.updates || [];
  const outlets = sourcesByOutlet(updates);
  const byNumbers = topic.byTheNumbers || {
    reportsTracked: updates.length || topic.articleCount || 0,
    distinctSources: outlets.length,
    timespanDays: (() => {
      const times = updates.map((u) => new Date(u.date).getTime()).filter((n) => !isNaN(n));
      if (times.length < 2) return 0;
      return Math.round((Math.max(...times) - Math.min(...times)) / 86400000);
    })(),
  };
  const srcBreakdown =
    topic.sourceBreakdown && topic.sourceBreakdown.length > 0
      ? topic.sourceBreakdown
      : outlets.map((o) => ({
          source: o.slug,
          label: o.label,
          count: o.count,
          share: updates.length ? Math.round((o.count / updates.length) * 100) : 0,
        }));

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

      {byNumbers && (
        <div className="rec-bynumbers" aria-label="Key figures">
          <div className="rec-bn">
            <span className="rec-bn-val">{byNumbers.reportsTracked}</span>
            <span className="rec-bn-lbl">Reports tracked</span>
          </div>
          <div className="rec-bn">
            <span className="rec-bn-val">{byNumbers.distinctSources}</span>
            <span className="rec-bn-lbl">Distinct sources</span>
          </div>
          <div className="rec-bn">
            <span className="rec-bn-val">{byNumbers.timespanDays}d</span>
            <span className="rec-bn-lbl">Coverage span</span>
          </div>
          <div className="rec-bn">
            <span className="rec-bn-val">{topic.daysSinceUpdate}d</span>
            <span className="rec-bn-lbl">Since last update</span>
          </div>
          <div className="rec-bn">
            <span className="rec-bn-val">{topic.recordationemScore}</span>
            <span className="rec-bn-lbl">Recordationem score</span>
          </div>
        </div>
      )}

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

        {srcBreakdown && srcBreakdown.length > 0 && (
          <div className="rec-srcbreak">
            <div className="rec-srcbreak-h">Coverage by source</div>
            {srcBreakdown.slice(0, 10).map((s) => (
              <div className="rec-srcrow" key={s.source}>
                <span className="rec-srcname">{s.label || sourceLabel(s.source)}</span>
                <span className="rec-srcbar" aria-hidden="true">
                  <span className="rec-srcbar-fill" style={{ width: `${Math.max(6, s.share)}%` }} />
                </span>
                <span className="rec-srccount">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <SourcesSection outlets={outlets} totalArticles={updates.length} />

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
