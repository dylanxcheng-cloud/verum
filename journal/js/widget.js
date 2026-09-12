/**
 * widget.js — reminder option 3: a glanceable widget view.
 *
 * On the web this page is what a "widget" can be: add it to the home screen
 * (it opens instantly, full-screen, no chrome), pin it in a browser sidebar,
 * or embed it in an iframe on a dashboard. It reads the same localStorage
 * document as the app, so ticking a habit here updates the app too.
 * Sizes: ?size=small|medium|large. Theme: ?theme=light|dark.
 */
import { getState, subscribe, update } from './store.js';
import { addDays, formatTime, relativeLabel, todayKey, fromKey } from './dates.js';
import { habitsForDay, isDone, dayProgress } from './habits.js';
import { occurrencesBetween } from './recur.js';

const params = new URLSearchParams(location.search);
const size = ['small', 'medium', 'large'].includes(params.get('size')) ? params.get('size') : 'medium';
document.body.classList.add(`size-${size}`);
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  document.body.classList.add('standalone');
}
const theme = params.get('theme') || getState().settings.theme;
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';

function ring(ratio, label) {
  const r = 22, c = 2 * Math.PI * r;
  return `<svg width="52" height="52" viewBox="0 0 52 52">
    <circle class="track" cx="26" cy="26" r="${r}" fill="none" stroke-width="5"/>
    <circle class="bar" cx="26" cy="26" r="${r}" fill="none" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${(c * ratio).toFixed(1)} ${c.toFixed(1)}"/>
  </svg><div class="label">${label}</div>`;
}

function render() {
  const state = getState();
  const today = todayKey();
  const habits = habitsForDay(state.habits, today);
  const prog = dayProgress(state.habits, state.habitLog, today);

  document.getElementById('date').innerHTML =
    `${esc(fromKey(today).toLocaleDateString(undefined, { weekday: 'long' }))}<small>${esc(
      fromKey(today).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
    )}</small>`;
  document.getElementById('ring').innerHTML = ring(prog.ratio, prog.total ? `${prog.done}/${prog.total}` : '–');

  const remaining = habits.filter((h) => !isDone(state.habitLog, h.id, today));
  const list = size === 'large' ? habits : remaining;
  document.getElementById('habits-title').textContent = size === 'large' ? 'Habits' : remaining.length ? 'Still to do' : 'Habits';
  document.getElementById('habits').innerHTML = list.length
    ? list
        .map((h) => {
          const done = isDone(state.habitLog, h.id, today);
          return `<li class="${done ? 'done' : ''}" data-habit="${esc(h.id)}">
            <span class="box" role="checkbox" aria-checked="${done}">${CHECK}</span>
            <span class="name">${h.emoji ? esc(h.emoji) + ' ' : ''}${esc(h.name)}</span></li>`;
        })
        .join('')
    : `<li class="empty">${habits.length ? 'All done for today 🎉' : 'No habits yet'}</li>`;

  const to = addDays(today, 13);
  const items = [];
  for (const ev of state.events) {
    const w = ev.reminders && ev.reminders.widget;
    if (!w || !w.enabled) continue;
    for (const key of occurrencesBetween(ev, today, to)) {
      if (ev.completed && ev.completed[key]) continue;
      items.push({ ev, key });
    }
  }
  items.sort((a, b) => (a.key + (a.ev.time || '')).localeCompare(b.key + (b.ev.time || '')));
  const max = size === 'large' ? 8 : 3;
  let html = '';
  let last = null;
  for (const { ev, key } of items.slice(0, max)) {
    if (key !== last) {
      html += `<div class="day">${esc(relativeLabel(key, today))}</div>`;
      last = key;
    }
    html += `<ul><li data-event="${esc(ev.id)}" data-key="${key}">
      <span class="box" role="checkbox" aria-checked="false">${CHECK}</span>
      <span class="name">${esc(ev.title)}${ev.from ? ` <span class="time">· ${esc(ev.from)}</span>` : ''}</span>
      <span class="time">${esc(formatTime(ev.time))}</span></li></ul>`;
  }
  document.getElementById('events').innerHTML = html || '<div class="empty">Nothing coming up</div>';
  document.getElementById('updated').textContent =
    'Updated ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

document.addEventListener('click', (e) => {
  const box = e.target.closest('.box');
  if (!box) return;
  const li = box.closest('li');
  const today = todayKey();
  if (li.dataset.habit) {
    update((s) => {
      s.habitLog[today] = s.habitLog[today] || {};
      if (s.habitLog[today][li.dataset.habit]) delete s.habitLog[today][li.dataset.habit];
      else s.habitLog[today][li.dataset.habit] = true;
    });
  } else if (li.dataset.event) {
    update((s) => {
      const ev = s.events.find((x) => x.id === li.dataset.event);
      if (!ev) return;
      ev.completed = ev.completed || {};
      ev.completed[li.dataset.key] = true;
    });
  }
});

subscribe(render);
render();
setInterval(render, 60000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && render());
