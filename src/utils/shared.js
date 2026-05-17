/**
 * src/utils/shared.js — Verum shared utilities
 * Exported functions used across multiple pages
 */

export function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60)     return 'Just now';
  if (diff < 3600)   { const m = Math.floor(diff / 60);    return `${m} minute${m > 1 ? 's' : ''} ago`; }
  if (diff < 86400)  { const h = Math.floor(diff / 3600);  return `${h} hour${h > 1 ? 's' : ''} ago`; }
  if (diff < 604800) { const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? 's' : ''} ago`; }
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function setDate() {
  const el = document.getElementById('site-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

export function setFooterCopy() {
  const el = document.getElementById('footer-copy');
  if (el) el.textContent = `© ${new Date().getFullYear()} Verum. All rights reserved.`;
}

export function highlightNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

export function initPage(activePage) {
  setDate();
  setFooterCopy();
  highlightNav(activePage);
}

export async function loadStories() {
  const res = await fetch('/stories.json');
  if (!res.ok) throw new Error(`Failed to load stories.json: HTTP ${res.status}`);
  const data = await res.json();

  if (data.stories && data.featured) return data;

  // Legacy structure — normalize on the fly
  const stories = {};
  const featured = { hero: null, stack: [], latest: [], world: [] };
  const catIndex = { News: [], World: [], Politics: [], Sports: [], Health: [], Science: [] };

  // Migrate old format if needed
  if (data.hero) {
    data.hero.id = data.hero.id || 'hero';
    stories[data.hero.id] = data.hero;
    featured.hero = data.hero.id;
  }

  for (const s of data.stack || []) {
    s.id = s.id || `stack_${Math.random().toString(36).slice(2, 9)}`;
    stories[s.id] = s;
    featured.stack.push(s.id);
  }

  for (const s of data.latest || []) {
    s.id = s.id || `latest_${Math.random().toString(36).slice(2, 9)}`;
    stories[s.id] = s;
    featured.latest.push(s.id);
  }

  for (const s of data.world || []) {
    s.id = s.id || `world_${Math.random().toString(36).slice(2, 9)}`;
    stories[s.id] = s;
    featured.world.push(s.id);
  }

  for (const [cat, catStories] of Object.entries(data.categories || {})) {
    for (const s of catStories) {
      s.id = s.id || `cat_${Math.random().toString(36).slice(2, 9)}`;
      stories[s.id] = s;
      if (!catIndex[cat]) catIndex[cat] = [];
      catIndex[cat].push(s.id);
    }
  }

  return {
    stories,
    featured,
    categoryIndex: catIndex,
    breaking: data.breaking || '',
    events: data.events || [],
    mostRead: data.mostRead || [],
  };
}

export function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

export function showError(msg) {
  console.error('[Verum]', msg);
}
