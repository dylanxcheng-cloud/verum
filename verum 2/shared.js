/**
 * shared.js — Verum shared utilities
 * Only helpers used across multiple pages. No page-specific rendering.
 */

'use strict';

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60)     return 'Just now';
  if (diff < 3600)   { const m = Math.floor(diff / 60);    return `${m} minute${m > 1 ? 's' : ''} ago`; }
  if (diff < 86400)  { const h = Math.floor(diff / 3600);  return `${h} hour${h > 1 ? 's' : ''} ago`; }
  if (diff < 604800) { const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? 's' : ''} ago`; }
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function setDate() {
  const el = document.getElementById('site-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function setFooterCopy() {
  const el = document.getElementById('footer-copy');
  if (el) el.textContent = `© ${new Date().getFullYear()} Verum. All rights reserved.`;
}

function highlightNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

function initPage(activePage) {
  setDate();
  setFooterCopy();
  highlightNav(activePage);
}

async function loadStories() {
  const res = await fetch('stories.json');
  if (!res.ok) throw new Error(`Failed to load stories.json: HTTP ${res.status}`);
  const data = await res.json();

  if (data.stories && data.featured) return data;

  // Legacy structure — normalize on the fly
  const stories = {};
  const featured = { hero: null, stack: [], latest: [], world: [] };
  const categoryIndex = {};

  function addStory(s, slot) {
    if (!s || !s.id) return;
    if (!s.author && s.source) s.author = s.source;
    stories[s.id] = s;
    if (slot === 'hero') featured.hero = s.id;
    else if (slot) featured[slot].push(s.id);
  }

  if (data.hero) addStory(data.hero, 'hero');
  (data.stack  || []).forEach(s => addStory(s, 'stack'));
  (data.latest || []).forEach(s => addStory(s, 'latest'));
  (data.world  || []).forEach(s => addStory(s, 'world'));

  Object.entries(data.categories || {}).forEach(([cat, catStories]) => {
    categoryIndex[cat] = [];
    catStories.forEach(s => {
      if (!s.id) return;
      stories[s.id] = s;
      categoryIndex[cat].push(s.id);
    });
  });

  return {
    stories, featured, categoryIndex,
    breaking: data.breaking || '',
    events:   data.events   || [],
    mostRead: data.mostRead || [],
  };
}

function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="error-state">
      <div class="error-icon">⚠</div>
      <div class="error-title">Something went wrong</div>
      <div class="error-msg">${message}</div>
      <a href="index.html" class="error-link">← Back to home</a>
    </div>`;
}

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}
