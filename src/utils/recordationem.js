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

/** Map a source slug (as stored on each article) to a readable outlet name. */
export const SOURCE_LABELS = {
  bbc: 'BBC News',
  guardian: 'The Guardian',
  npr: 'NPR',
  googlenews: 'Google News',
  aljazeera: 'Al Jazeera',
  japantimes: 'The Japan Times',
  snopes: 'Snopes',
  nature: 'Nature',
  abcau: 'ABC News (Australia)',
  straitstimes: 'The Straits Times',
  berkeleyuniv: 'UC Berkeley News',
  conversation: 'The Conversation',
  ap: 'Associated Press',
  france24: 'France 24',
  smh: 'Sydney Morning Herald',
  reuters: 'Reuters',
  irishtimes: 'The Irish Times',
  cjr: 'Columbia Journalism Review',
  fullfact: 'Full Fact',
  bangkokpost: 'Bangkok Post',
  cna: 'CNA (Singapore)',
  nasa: 'NASA',
  economist: 'The Economist',
  dw: 'Deutsche Welle',
  pbs: 'PBS NewsHour',
  csmonitor: 'Christian Science Monitor',
  afp: 'AFP',
  marketwatch: 'MarketWatch',
  espn: 'ESPN',
  verum: 'Verum',
};

/** Readable outlet name for a source slug, falling back to a title-cased slug. */
export function sourceLabel(slug) {
  if (!slug) return 'Source';
  if (SOURCE_LABELS[slug]) return SOURCE_LABELS[slug];
  return String(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Collapse a topic's article list (its `updates`) into a per-outlet source
 * directory for "further research": one entry per outlet, each carrying every
 * article from that outlet with its outbound link. Sorted by article count,
 * then outlet name.
 */
export function sourcesByOutlet(updates) {
  const byOutlet = new Map();
  for (const u of updates || []) {
    const slug = u.source || 'source';
    if (!byOutlet.has(slug)) {
      byOutlet.set(slug, { slug, label: u.sourceLabel || sourceLabel(slug), articles: [] });
    }
    byOutlet.get(slug).articles.push(u);
  }
  const out = [...byOutlet.values()];
  for (const o of out) {
    o.count = o.articles.length;
    o.articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return out;
}
