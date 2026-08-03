/**
 * src/utils/recordationem.js — Recordationem client helpers
 *
 * Loads recordationem.json (produced by the Python discovery engine) and
 * exposes formatting/search helpers shared by the homepage module, landing
 * page, story detail page, and site search. Mirrors how shared.js loads
 * stories.json so it plugs into the existing caching/refresh layer.
 */

const RECORDATIONEM_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_RECORDATIONEM_URL) ||
  '/recordationem.json';

/** Load the Recordationem payload. Throws on network/parse error. */
export async function loadRecordationem() {
  const res = await fetch(RECORDATIONEM_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load recordationem.json: HTTP ${res.status}`);
  const data = await res.json();
  // Defensive defaults so the UI never crashes on a partial payload.
  return {
    mission: data.mission || '',
    subtitle: data.subtitle || 'Recovering stories that still matter.',
    generatedAt: data.generatedAt || null,
    threshold: data.threshold ?? null,
    formula: data.formula || '',
    categories: Array.isArray(data.categories) ? data.categories : [],
    stories: Array.isArray(data.stories) ? data.stories : [],
    sources: Array.isArray(data.sources) ? data.sources : [],
    stats: data.stats || { corpusSize: 0, topicsExamined: 0, topicsSurfaced: 0 },
  };
}

/** Find a single topic by id or slug. */
export function findTopic(data, idOrSlug) {
  if (!data || !idOrSlug) return null;
  return (
    data.stories.find((s) => s.id === idOrSlug || s.slug === idOrSlug) || null
  );
}

/** CSS modifier class for an importance band. */
export function importanceClass(importance) {
  const key = (importance || '').toLowerCase().replace(/\s+/g, '-');
  return `rec-importance-${key || 'notable'}`;
}

/** CSS modifier class for an ongoing-status label. */
export function statusClass(status) {
  return `rec-status-${(status || '').toLowerCase().replace(/\s+/g, '-') || 'dormant'}`;
}

/** Human-readable coverage decline, e.g. -87 → "-87%". */
export function formatDecline(pct) {
  if (pct == null) return '—';
  return `${pct}%`;
}

/** Client-side search across Recordationem topics (AND over terms). */
export function searchTopics(stories, query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  return stories.filter((s) => {
    const hay = [
      s.title,
      s.category,
      ...(s.entities || []),
      ...(s.keywords || []),
      s.whyStillImportant || '',
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Group topics by their dynamically-generated category. */
export function groupByCategory(stories) {
  const groups = {};
  for (const s of stories) {
    (groups[s.category] = groups[s.category] || []).push(s);
  }
  return groups;
}

export const RECORDATIONEM_STORY_URL = (idOrSlug) =>
  `/recordationem-story.html?id=${encodeURIComponent(idOrSlug)}`;

export const RECORDATIONEM_URL_PATH = '/recordationem.html';
