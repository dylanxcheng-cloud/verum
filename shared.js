/* shared.js - common utilities used across all pages */

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) { const m = Math.floor(diff/60); return m + ' minute' + (m>1?'s':'') + ' ago'; }
  if (diff < 86400) { const h = Math.floor(diff/3600); return h + ' hour' + (h>1?'s':'') + ' ago'; }
  if (diff < 604800) { const d = Math.floor(diff/86400); return d + ' day' + (d>1?'s':'') + ' ago'; }
  return new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function setDate() {
  const el = document.getElementById('site-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
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
