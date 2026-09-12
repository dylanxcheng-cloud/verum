/**
 * app.js — Daybook UI. Plain DOM rendering from a single state object.
 * Views: Today · Habits · Events · Reminders · Settings
 */
import { getState, update, subscribe, exportJSON, importJSON, resetAll, uid } from './store.js';
import {
  todayKey, addDays, formatLong, formatTime, relativeLabel, weekday, WEEKDAYS_SHORT, WEEKDAYS_MIN, fromKey, formatShort,
} from './dates.js';
import { occurrencesBetween, nextOccurrence, describeRepeat, normalizeRepeat } from './recur.js';
import { habitsForDay, isDone, isScheduled, streak, completion, dayProgress } from './habits.js';
import * as reminders from './reminders.js';
import { downloadICS } from './ics.js';
import * as wallpaper from './wallpaper.js';

/* ───────────────────────── helpers ───────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';
const HABIT_COLORS = ['#7c5cff', '#2fa66a', '#e8722a', '#d9534f', '#1f9bd7', '#c2409a', '#e0a100', '#5a6b7a'];
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const VIEWS = ['today', 'habits', 'events', 'reminders', 'settings'];

const ui = {
  view: 'today',
  viewDate: todayKey(),
  eventsSegment: 'upcoming',
  widgetSize: 'medium',
  editingHabitId: null,
  editingEventId: null,
  installPrompt: null,
  saveTimer: null,
};

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function ring(ratio, label, size = 64) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"/>
    <circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${(c * ratio).toFixed(1)} ${c.toFixed(1)}"/></svg><div class="label">${label}</div></div>`;
}

function applyTheme() {
  const t = getState().settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/** Occurrences for all events in a range, sorted, with event ref. */
function occurrencesInRange(state, from, to, filter = () => true) {
  const items = [];
  for (const ev of state.events) {
    if (!filter(ev)) continue;
    for (const key of occurrencesBetween(ev, from, to)) items.push({ ev, key, done: Boolean(ev.completed && ev.completed[key]) });
  }
  items.sort((a, b) => (a.key + (a.ev.time || '00:00')).localeCompare(b.key + (b.ev.time || '00:00')));
  return items;
}

function reminderIcons(ev) {
  const r = ev.reminders || {};
  const out = [];
  if (r.push && r.push.enabled) out.push(`<span class="pill" title="${esc(reminders.leadLabel(r.push.leadMinutes))}">🔔 ${esc(shortLead(r.push.leadMinutes))}</span>`);
  if (r.wallpaper && r.wallpaper.enabled) out.push('<span class="pill" title="On wallpaper">🖼️</span>');
  if (r.widget && r.widget.enabled) out.push('<span class="pill" title="In widget">▦</span>');
  return out.join(' ');
}
function shortLead(min) {
  min = Number(min) || 0;
  if (min === 0) return 'at time';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${min / 60}h`;
  if (min < 10080) return `${min / 1440}d`;
  return `${min / 10080}w`;
}

function occurrenceItem({ ev, key, done }, { showDate = false } = {}) {
  const r = normalizeRepeat(ev.repeat);
  return `<li class="check-item ${done ? 'done' : ''}">
    <span class="box" role="checkbox" aria-checked="${done}" data-action="toggle-occurrence" data-id="${esc(ev.id)}" data-key="${key}">${CHECK}</span>
    <div class="body">
      <div class="name">${esc(ev.title)}</div>
      <div class="sub">
        ${showDate ? `<span>${esc(relativeLabel(key))}</span>` : ''}
        <span>${esc(formatTime(ev.time))}</span>
        ${ev.from ? `<span>· asked by ${esc(ev.from)}</span>` : ''}
        ${r.type !== 'none' ? `<span class="pill">↻ ${esc(describeRepeat(ev.repeat, ev.date))}</span>` : ''}
        ${reminderIcons(ev)}
      </div>
    </div>
    <div class="actions">
      ${r.type !== 'none' ? `<button class="btn ghost small" title="Skip this occurrence" data-action="skip-occurrence" data-id="${esc(ev.id)}" data-key="${key}">Skip</button>` : ''}
      <button class="btn ghost small" title="Edit" data-action="edit-event" data-id="${esc(ev.id)}">✎</button>
    </div>
  </li>`;
}

/* ───────────────────────── Today ───────────────────────── */
function renderToday(state) {
  const key = ui.viewDate;
  const today = todayKey();
  const habits = habitsForDay(state.habits, key);
  const prog = dayProgress(state.habits, state.habitLog, key);
  const entry = state.journal[key] || {};
  const dayItems = occurrencesInRange(state, key, key);
  const upcoming = key === today ? occurrencesInRange(state, addDays(today, 1), addDays(today, 7)).filter((x) => !x.done) : [];
  const overdue = key === today
    ? occurrencesInRange(state, addDays(today, -14), addDays(today, -1)).filter((x) => !x.done)
    : [];

  $('#view-today').innerHTML = `
    <div class="daynav">
      <button class="btn ghost" data-action="day-shift" data-n="-1" aria-label="Previous day">‹</button>
      <div class="title">${esc(formatLong(key))}<span class="rel">${key === today ? 'Today' : `${esc(relativeLabel(key))} · <a data-action="day-today" style="cursor:pointer">back to today</a>`}</span></div>
      <button class="btn ghost" data-action="day-shift" data-n="1" aria-label="Next day">›</button>
    </div>

    ${overdue.length ? `<div class="card"><h2>Still open <span class="meta">${overdue.length} from earlier</span></h2>
      <ul class="check-list">${overdue.map((o) => occurrenceItem(o, { showDate: true })).join('')}</ul></div>` : ''}

    <div class="card">
      <h2>Habits <span class="meta">${prog.total ? `${prog.done} of ${prog.total}` : ''}</span></h2>
      ${habits.length ? `<div class="row" style="gap:16px;align-items:flex-start">
        ${ring(prog.ratio, prog.total ? `${Math.round(prog.ratio * 100)}%` : '–')}
        <ul class="check-list" style="flex:1;min-width:200px">
          ${habits.map((h) => {
            const done = isDone(state.habitLog, h.id, key);
            const s = streak(h, state.habitLog, today);
            return `<li class="check-item ${done ? 'done' : ''}">
              <span class="box" role="checkbox" aria-checked="${done}" data-action="toggle-habit" data-id="${esc(h.id)}" data-key="${key}" style="${done ? `background:${esc(h.color || '#2fa66a')};border-color:${esc(h.color || '#2fa66a')}` : ''}">${CHECK}</span>
              <div class="body"><div class="name">${h.emoji ? esc(h.emoji) + ' ' : ''}${esc(h.name)}</div>
              <div class="sub">${s ? `<span class="streak">🔥 ${s} day streak</span>` : '<span>No streak yet</span>'}</div></div>
            </li>`;
          }).join('')}
        </ul></div>`
        : `<div class="empty">${state.habits.length ? 'No habits scheduled for this day.' : 'No habits yet. '}<a data-action="new-habit">Add a habit</a></div>`}
    </div>

    <div class="card">
      <h2>Events <span class="meta">${dayItems.length ? `${dayItems.filter((x) => x.done).length} of ${dayItems.length} done` : ''}</span></h2>
      ${dayItems.length ? `<ul class="check-list">${dayItems.map((o) => occurrenceItem(o)).join('')}</ul>` : `<div class="empty">Nothing on this day. <a data-action="new-event" data-date="${key}">Add an event</a></div>`}
    </div>

    <div class="card">
      <h2>Journal <span class="meta">${entry.updatedAt ? 'saved ' + new Date(entry.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</span></h2>
      <div class="moods">${MOODS.map((m, i) => `<button class="mood ${entry.mood === i ? 'selected' : ''}" data-action="set-mood" data-mood="${i}" data-key="${key}" aria-label="Mood ${i + 1}">${m}</button>`).join('')}</div>
      <textarea class="journal" id="journal-text" data-key="${key}" placeholder="${key === today ? 'How is today going? What did people ask of you?' : 'Notes for this day…'}">${esc(entry.text || '')}</textarea>
      <div class="save-state" id="journal-save"></div>
    </div>

    ${key === today ? `<div class="card"><h2>Next 7 days <span class="meta">${upcoming.length} coming up</span></h2>
      ${upcoming.length ? renderGrouped(upcoming) : '<div class="empty">Nothing scheduled this week.</div>'}</div>` : ''}
  `;
}

function renderGrouped(items) {
  let html = '';
  let last = null;
  for (const it of items) {
    if (it.key !== last) {
      if (last !== null) html += '</ul></div>';
      const rel = relativeLabel(it.key);
      const short = formatShort(it.key);
      html += `<div class="day-group"><div class="day-head">${esc(rel)}${rel !== short ? ' · ' + esc(short) : ''}</div><ul class="check-list">`;
      last = it.key;
    }
    html += occurrenceItem(it);
  }
  if (last !== null) html += '</ul></div>';
  return html;
}

/* ───────────────────────── Habits ───────────────────────── */
function renderHabits(state) {
  const today = todayKey();
  const active = state.habits.filter((h) => !h.archived);
  const archived = state.habits.filter((h) => h.archived);
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  const habitRow = (h) => {
    const s = streak(h, state.habitLog, today);
    const c = completion(h, state.habitLog, today, 30);
    return `<li class="check-item" style="flex-wrap:wrap">
      <div class="body" style="flex-basis:100%">
        <div class="row between">
          <div class="name" style="display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${esc(h.color || '#7c5cff')};display:inline-block"></span>
            ${h.emoji ? esc(h.emoji) + ' ' : ''}${esc(h.name)}
          </div>
          <div class="actions">
            <button class="btn ghost small" data-action="edit-habit" data-id="${esc(h.id)}">✎ Edit</button>
            <button class="btn ghost small" data-action="archive-habit" data-id="${esc(h.id)}">${h.archived ? 'Restore' : 'Archive'}</button>
          </div>
        </div>
        <div class="row between" style="margin-top:6px">
          <div class="sub">
            ${s ? `<span class="streak">🔥 ${s}</span>` : '<span>–</span>'}
            <span>${c.scheduled ? `${Math.round(c.rate * 100)}% last 30 days` : 'Just started'}</span>
            <span>${(h.days && h.days.length && h.days.length < 7) ? h.days.map((d) => WEEKDAYS_SHORT[d]).join(' ') : 'Every day'}</span>
          </div>
          ${h.archived ? '' : `<div class="dots">${days7.map((k) => {
            const on = isScheduled(h, k);
            const done = isDone(state.habitLog, h.id, k);
            return `<span class="dot ${done ? 'done' : ''} ${on ? '' : 'off'} ${k === today ? 'today' : ''}" title="${k}"
              ${on ? `data-action="toggle-habit" data-id="${esc(h.id)}" data-key="${k}"` : ''}>${WEEKDAYS_MIN[weekday(k)]}</span>`;
          }).join('')}</div>`}
        </div>
      </div>
    </li>`;
  };

  $('#view-habits').innerHTML = `
    <div class="section-title"><h2>Daily habits</h2><button class="btn primary small" data-action="new-habit">+ New habit</button></div>
    <div class="card">
      ${active.length ? `<ul class="check-list">${active.map(habitRow).join('')}</ul>`
        : `<div class="empty">Habits are the things you want to do on repeat: a walk, reading, water, stretching. <a data-action="new-habit">Add your first habit</a>.</div>`}
    </div>
    ${archived.length ? `<details class="card"><summary class="muted">Archived (${archived.length})</summary><ul class="check-list">${archived.map(habitRow).join('')}</ul></details>` : ''}
  `;
}

/* ───────────────────────── Events ───────────────────────── */
function renderEvents(state) {
  const today = todayKey();
  let body = '';
  if (ui.eventsSegment === 'upcoming') {
    const items = occurrencesInRange(state, today, addDays(today, 30)).filter((x) => !x.done);
    body = items.length ? renderGrouped(items) : `<div class="empty">Nothing in the next 30 days. <a data-action="new-event">Add an event</a>.</div>`;
  } else if (ui.eventsSegment === 'all') {
    const evs = [...state.events].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    body = evs.length ? `<ul class="check-list">${evs.map((ev) => {
      const next = nextOccurrence(ev, today);
      const r = normalizeRepeat(ev.repeat);
      return `<li class="check-item">
        <div class="body">
          <div class="name">${esc(ev.title)}</div>
          <div class="sub">
            <span>${esc(describeRepeat(ev.repeat, ev.date))}</span>
            <span>· ${next ? `next ${esc(relativeLabel(next))}` : r.type === 'none' && ev.completed && ev.completed[ev.date] ? 'done' : 'no upcoming'}</span>
            <span>· ${esc(formatTime(ev.time))}</span>
            ${ev.from ? `<span>· ${esc(ev.from)}</span>` : ''}
            ${reminderIcons(ev)}
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost small" title="Add to phone calendar (.ics)" data-action="ics" data-id="${esc(ev.id)}">📅</button>
          <button class="btn ghost small" data-action="edit-event" data-id="${esc(ev.id)}">✎</button>
        </div>
      </li>`;
    }).join('')}</ul>` : '<div class="empty">No events yet.</div>';
  } else {
    const items = occurrencesInRange(state, addDays(today, -60), addDays(today, -1)).reverse();
    body = items.length ? renderGrouped(items) : '<div class="empty">Nothing in the last 60 days.</div>';
  }

  $('#view-events').innerHTML = `
    <div class="section-title"><h2>Events</h2><button class="btn primary small" data-action="new-event">+ New event</button></div>
    <p class="muted small" style="margin:4px 0 10px">Things people ask you to do — once, or on a schedule. Each one can remind you by notification, wallpaper, or widget.</p>
    <div class="segments">
      ${['upcoming', 'all', 'past'].map((s) => `<button class="${ui.eventsSegment === s ? 'active' : ''}" data-action="events-segment" data-seg="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
    </div>
    <div class="card">${body}</div>
  `;
}

/* ───────────────────────── Reminders ───────────────────────── */
function renderReminders(state) {
  const perm = reminders.permissionState();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const pushCount = state.events.filter((e) => e.reminders && e.reminders.push && e.reminders.push.enabled).length;
  const wp = state.settings.wallpaper;
  const hr = state.settings.habitReminder;

  let status;
  if (perm === 'unsupported') status = `<div class="status bad">⚠️ <div>This browser doesn't support notifications.${isIOS ? ' On iPhone, add Daybook to your Home Screen first (Share → Add to Home Screen), then open it from there.' : ''}</div></div>`;
  else if (perm === 'granted') status = `<div class="status ok">✅ <div>Notifications are on. ${pushCount} event${pushCount === 1 ? '' : 's'} will alert you.<br><span class="muted small">While this page (or the installed app) is open, alerts fire at the chosen lead time. Closed-app alerts need the native app or a push server — see the roadmap in Settings.</span></div></div>`;
  else if (perm === 'denied') status = `<div class="status bad">🔕 <div>Notifications are blocked. Allow them for this site in your browser settings, then reload.</div></div>`;
  else status = `<div class="status warn">🔔 <div>Turn on notifications to get calendar-style alerts before events.${isIOS && !standalone ? '<br><span class="small">iPhone: install to the Home Screen first, otherwise Safari won\'t offer the permission.</span>' : ''}</div></div>`;

  const widgetUrl = new URL(`widget.html?size=${ui.widgetSize}`, location.href).href;

  $('#view-reminders').innerHTML = `
    <div class="section-title"><h2>Reminders</h2></div>
    <p class="muted small" style="margin:4px 0 10px">Three ways to be reminded. Pick any mix per event when you create it.</p>

    <div class="card">
      <h2>1 · Notifications <span class="meta">calendar-style</span></h2>
      ${status}
      <div class="row" style="margin-top:10px">
        ${perm === 'default' ? '<button class="btn primary" data-action="enable-notifications">Enable notifications</button>' : ''}
        ${perm === 'granted' ? '<button class="btn" data-action="test-notification">Send a test</button>' : ''}
      </div>
      <div class="toggle" style="margin-top:8px">
        <div><div class="t-label">Daily habit nudge</div><div class="t-sub">One notification a day listing what's left</div></div>
        <div class="row" style="flex-wrap:nowrap">
          <input type="time" value="${esc(hr.time)}" data-action-change="habit-reminder-time" style="border:1px solid var(--border);border-radius:8px;padding:6px;background:var(--surface-2)">
          <label class="switch"><input type="checkbox" ${hr.enabled ? 'checked' : ''} data-action-change="habit-reminder-toggle"><span></span></label>
        </div>
      </div>
      <div class="toggle">
        <div><div class="t-label">All-day events remind at</div><div class="t-sub">Used when an event has no time</div></div>
        <input type="time" value="${esc(state.settings.allDayReminderTime)}" data-action-change="allday-time" style="border:1px solid var(--border);border-radius:8px;padding:6px;background:var(--surface-2)">
      </div>
      <p class="small muted" style="margin:10px 0 0">Tip: every event also has an <b>Add to calendar</b> button (📅 in Events → All). That drops it into your phone's calendar with the same alert, so you get background reminders today.</p>
    </div>

    <div class="card">
      <h2>2 · Wallpaper <span class="meta">lock-screen image</span></h2>
      <p class="small muted" style="margin:0 0 10px">Renders today's habits and your upcoming events into an image sized for your phone. Download it and set it as your lock screen; regenerate whenever things change.</p>
      <div class="wp-layout">
        <div class="stack">
          <div class="field"><label>Phone</label>
            <select data-action-change="wp-preset">${wallpaper.PRESETS.map((p) => `<option value="${p.id}" ${wp.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Style</label>
            <select data-action-change="wp-theme">${wallpaper.THEME_IDS.map((t) => `<option value="${t}" ${wp.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
          <div class="field"><label>Accent</label><input type="color" value="${esc(wp.accent)}" data-action-change="wp-accent"></div>
          <div class="field"><label>Clock space (top)</label>
            <input type="range" min="15" max="50" value="${Number(wp.topOffset)}" data-action-change="wp-top"><div class="small muted">${Number(wp.topOffset)}% kept clear</div></div>
          <div class="field"><label>Events for next</label>
            <select data-action-change="wp-days">${[1, 3, 7, 14].map((d) => `<option value="${d}" ${Number(wp.days) === d ? 'selected' : ''}>${d === 1 ? 'today only' : d + ' days'}</option>`).join('')}</select></div>
          <label class="row small"><input type="checkbox" ${wp.showHabits ? 'checked' : ''} data-action-change="wp-habits"> Habits</label>
          <label class="row small"><input type="checkbox" ${wp.showEvents ? 'checked' : ''} data-action-change="wp-events"> Events</label>
          <label class="row small"><input type="checkbox" ${wp.showJournalPrompt ? 'checked' : ''} data-action-change="wp-prompt"> Journal line / prompt</label>
          <button class="btn primary block" data-action="wp-download">Download PNG</button>
          <div class="small muted" id="wp-summary"></div>
        </div>
        <div class="wp-preview"><canvas id="wp-canvas" aria-label="Wallpaper preview"></canvas></div>
      </div>
      <h3>How to set it</h3>
      <ol class="steps small muted">
        <li><b>iPhone:</b> open the PNG in Photos → Share → Use as Wallpaper → set as Lock Screen. Choose a plain clock style so text stays readable.</li>
        <li><b>Android:</b> open the PNG → ⋮ → Use as → Wallpaper → Lock screen.</li>
        <li>Regenerate after you check things off — or set a daily reminder to refresh it. Automatic daily wallpaper updates are a native-app feature (see roadmap).</li>
      </ol>
    </div>

    <div class="card">
      <h2>3 · Widget <span class="meta">glanceable view</span></h2>
      <p class="small muted" style="margin:0 0 10px">A stripped-down live view of today. Add it to your home screen as its own icon, keep it in a browser side panel, or embed it anywhere. Ticking a habit here updates the app.</p>
      <div class="segments" style="margin-bottom:10px">
        ${['small', 'medium', 'large'].map((s) => `<button class="${ui.widgetSize === s ? 'active' : ''}" data-action="widget-size" data-size="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
      </div>
      <iframe class="widget-frame" id="widget-frame" src="${esc(widgetUrl)}" title="Widget preview" style="height:${ui.widgetSize === 'small' ? 120 : ui.widgetSize === 'medium' ? 330 : 520}px"></iframe>
      <div class="row" style="margin-top:10px">
        <a class="btn" href="${esc(widgetUrl)}" target="_blank" rel="noopener">Open widget page</a>
        <button class="btn" data-action="copy-embed">Copy embed code</button>
      </div>
      <h3>Put it on your home screen</h3>
      <ol class="steps small muted">
        <li>Open the widget page, then <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Add to Home screen</b> (Android).</li>
        <li>It opens full-screen with no browser chrome — a one-tap glance at today.</li>
        <li>True home-screen widgets (WidgetKit / Android Glance) come with the native app — the data model and this view are already shaped for it.</li>
      </ol>
    </div>
  `;

  // Draw wallpaper preview after the DOM exists.
  const canvas = $('#wp-canvas');
  if (canvas) {
    const content = wallpaper.render(canvas, state, wp);
    $('#wp-summary').textContent = `${content.habits.length} habit${content.habits.length === 1 ? '' : 's'}, ${content.events.length} event${content.events.length === 1 ? '' : 's'} on the wallpaper`;
  }
}

/* ───────────────────────── Settings ───────────────────────── */
function renderSettings(state) {
  const counts = { habits: state.habits.length, events: state.events.length, entries: Object.values(state.journal).filter((j) => j.text).length };
  $('#view-settings').innerHTML = `
    <div class="section-title"><h2>Settings</h2></div>
    <div class="card">
      <h2>Appearance</h2>
      <div class="segments">${['system', 'light', 'dark'].map((t) => `<button class="${state.settings.theme === t ? 'active' : ''}" data-action="theme" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    </div>
    <div class="card">
      <h2>Install</h2>
      <p class="small muted" style="margin:0 0 10px">Daybook is a progressive web app: it works offline and can live on your home screen like a native app.</p>
      ${ui.installPrompt ? '<button class="btn primary" data-action="install">Install Daybook</button>'
        : `<div class="small muted">${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? '✅ Installed' : 'iPhone: Share → Add to Home Screen. Android/desktop: use the browser\'s Install option in the address bar or menu.'}</div>`}
    </div>
    <div class="card">
      <h2>Your data <span class="meta">${counts.habits} habits · ${counts.events} events · ${counts.entries} entries</span></h2>
      <p class="small muted" style="margin:0 0 10px">Everything is stored on this device only. Export a backup before switching browsers or devices.</p>
      <div class="row">
        <button class="btn" data-action="export">Export backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" hidden data-action-change="import"></label>
        <button class="btn danger" data-action="reset">Erase everything</button>
      </div>
    </div>
    <div class="card">
      <h2>About</h2>
      <p class="small muted" style="margin:0">Daybook v1 · a journal for daily habits and the things people ask of you. Web first; the native app roadmap (real push, live wallpaper, home-screen widgets, sync) is in <code>journal/README.md</code>.</p>
    </div>
  `;
}

/* ───────────────────────── Render orchestration ───────────────────────── */
function renderAll() {
  const state = getState();
  applyTheme();
  $('#topbar-sub').textContent = fromKey(todayKey()).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const active = document.activeElement;
  const keepJournal = active && active.id === 'journal-text' && ui.view === 'today';
  if (keepJournal) {
    // Don't clobber typing: update only the save-state, the rest re-renders on blur.
    return;
  }
  ({ today: renderToday, habits: renderHabits, events: renderEvents, reminders: renderReminders, settings: renderSettings })[ui.view](state);
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === ui.view));
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === ui.view));
}

function setView(view) {
  if (!VIEWS.includes(view)) view = 'today';
  ui.view = view;
  if (location.hash.replace(/^#/, '').split('?')[0] !== view) history.replaceState(null, '', `#${view}`);
  renderAll();
  window.scrollTo({ top: 0 });
}

/* ───────────────────────── Habit dialog ───────────────────────── */
function openHabitDialog(id = null) {
  const state = getState();
  const h = id ? state.habits.find((x) => x.id === id) : null;
  ui.editingHabitId = id;
  $('#habit-dialog-title').textContent = h ? 'Edit habit' : 'New habit';
  $('#habit-name').value = h ? h.name : '';
  $('#habit-emoji').value = h ? h.emoji || '' : '';
  const color = h ? h.color || HABIT_COLORS[0] : HABIT_COLORS[state.habits.length % HABIT_COLORS.length];
  $('#habit-colors').innerHTML = HABIT_COLORS.map((c) => `<label style="background:${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}></label>`).join('');
  const days = h && h.days && h.days.length ? h.days : [0, 1, 2, 3, 4, 5, 6];
  $('#habit-days').innerHTML = WEEKDAYS_MIN.map((d, i) => `<label title="${WEEKDAYS_SHORT[i]}"><input type="checkbox" name="days" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('');
  $('#habit-delete').hidden = !h;
  $('#habit-dialog').showModal();
  $('#habit-name').focus();
}

function saveHabit(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  if (!name) return;
  const days = data.getAll('days').map(Number);
  const emoji = String(data.get('emoji') || '').trim();
  const color = String(data.get('color') || HABIT_COLORS[0]);
  update((s) => {
    if (ui.editingHabitId) {
      const h = s.habits.find((x) => x.id === ui.editingHabitId);
      if (h) Object.assign(h, { name, emoji, color, days: days.length === 7 ? [] : days });
    } else {
      s.habits.push({ id: uid(), name, emoji, color, days: days.length === 7 ? [] : days, createdAt: new Date().toISOString(), archived: false });
    }
  });
  toast(ui.editingHabitId ? 'Habit updated' : 'Habit added');
  $('#habit-dialog').close();
}

/* ───────────────────────── Event dialog ───────────────────────── */
function syncEventFormVisibility() {
  const allday = $('#ev-allday').checked;
  $('#ev-time-field').hidden = allday;
  const type = $('#ev-repeat').value;
  $('#ev-interval-field').hidden = type === 'none';
  $('#ev-weekdays-field').hidden = type !== 'weekly';
  $('#ev-until-field').hidden = type === 'none';
  $('#ev-interval-unit').textContent = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[type] || '';
  $('#ev-lead-field').hidden = !$('#ev-push').checked;
}

function openEventDialog(id = null, presetDate = null) {
  const state = getState();
  const ev = id ? state.events.find((x) => x.id === id) : null;
  ui.editingEventId = id;
  $('#event-dialog-title').textContent = ev ? 'Edit event' : 'New event';
  $('#ev-title').value = ev ? ev.title : '';
  $('#ev-from').value = ev ? ev.from || '' : '';
  $('#ev-date').value = ev ? ev.date : presetDate || todayKey();
  $('#ev-allday').checked = ev ? !ev.time : false;
  $('#ev-time').value = ev && ev.time ? ev.time : nextRoundHour();
  const r = normalizeRepeat(ev ? ev.repeat : null);
  $('#ev-repeat').value = r.type;
  $('#ev-interval').value = r.interval;
  $('#ev-until').value = r.until || '';
  const wd = r.weekdays.length ? r.weekdays : [weekday($('#ev-date').value)];
  $('#ev-weekdays').innerHTML = WEEKDAYS_MIN.map((d, i) => `<label title="${WEEKDAYS_SHORT[i]}"><input type="checkbox" name="weekdays" value="${i}" ${wd.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('');
  $('#ev-notes').value = ev ? ev.notes || '' : '';
  const rem = (ev && ev.reminders) || {};
  $('#ev-push').checked = rem.push ? Boolean(rem.push.enabled) : reminders.permissionState() === 'granted';
  $('#ev-lead').innerHTML = reminders.LEAD_OPTIONS.map((o) => `<option value="${o.minutes}">${o.label}</option>`).join('');
  $('#ev-lead').value = String(rem.push && rem.push.leadMinutes != null ? rem.push.leadMinutes : state.settings.defaultLeadMinutes);
  $('#ev-wallpaper').checked = rem.wallpaper ? Boolean(rem.wallpaper.enabled) : true;
  $('#ev-widget').checked = rem.widget ? Boolean(rem.widget.enabled) : true;
  $('#event-delete').hidden = !ev;
  syncEventFormVisibility();
  $('#event-dialog').showModal();
  $('#ev-title').focus();
}

function nextRoundHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

function saveEvent(form) {
  const data = new FormData(form);
  const title = String(data.get('title') || '').trim();
  const date = String(data.get('date') || '');
  if (!title || !date) return;
  const allday = data.get('allday') === 'on';
  const time = allday ? null : String(data.get('time') || '') || null;
  const repeat = normalizeRepeat({
    type: data.get('repeat'),
    interval: data.get('interval'),
    weekdays: data.getAll('weekdays').map(Number),
    until: data.get('until') || null,
  });
  if (repeat.type !== 'weekly') repeat.weekdays = [];
  const remindersCfg = {
    push: { enabled: data.get('push') === 'on', leadMinutes: Number(data.get('lead') || 0) },
    wallpaper: { enabled: data.get('wallpaper') === 'on' },
    widget: { enabled: data.get('widget') === 'on' },
  };
  const notes = String(data.get('notes') || '').trim();
  const from = String(data.get('from') || '').trim();

  update((s) => {
    if (ui.editingEventId) {
      const ev = s.events.find((x) => x.id === ui.editingEventId);
      if (ev) {
        const rescheduled = ev.date !== date || ev.time !== time || JSON.stringify(normalizeRepeat(ev.repeat)) !== JSON.stringify(repeat);
        Object.assign(ev, { title, from, notes, date, time, repeat, reminders: remindersCfg, updatedAt: new Date().toISOString() });
        if (rescheduled) {
          // Let reminders fire again for the new schedule.
          for (const k of Object.keys(s.notified)) if (k.startsWith(ev.id + '|')) delete s.notified[k];
        }
      }
    } else {
      s.events.push({
        id: uid(), title, from, notes, date, time, repeat, reminders: remindersCfg,
        completed: {}, skipped: {}, createdAt: new Date().toISOString(),
      });
    }
    s.settings.defaultLeadMinutes = remindersCfg.push.leadMinutes;
  });
  if (remindersCfg.push.enabled && reminders.permissionState() === 'default') {
    reminders.requestPermission().then(() => renderAll());
  }
  toast(ui.editingEventId ? 'Event updated' : 'Event added');
  $('#event-dialog').close();
}

/* ───────────────────────── Actions ───────────────────────── */
const actions = {
  'day-shift': (el) => { ui.viewDate = addDays(ui.viewDate, Number(el.dataset.n)); renderAll(); },
  'day-today': () => { ui.viewDate = todayKey(); renderAll(); },
  'toggle-habit': (el) => {
    update((s) => {
      const k = el.dataset.key;
      s.habitLog[k] = s.habitLog[k] || {};
      if (s.habitLog[k][el.dataset.id]) delete s.habitLog[k][el.dataset.id];
      else s.habitLog[k][el.dataset.id] = true;
      if (!Object.keys(s.habitLog[k]).length) delete s.habitLog[k];
    });
  },
  'toggle-occurrence': (el) => {
    update((s) => {
      const ev = s.events.find((x) => x.id === el.dataset.id);
      if (!ev) return;
      ev.completed = ev.completed || {};
      if (ev.completed[el.dataset.key]) delete ev.completed[el.dataset.key];
      else ev.completed[el.dataset.key] = true;
    });
  },
  'skip-occurrence': (el) => {
    update((s) => {
      const ev = s.events.find((x) => x.id === el.dataset.id);
      if (!ev) return;
      ev.skipped = ev.skipped || {};
      ev.skipped[el.dataset.key] = true;
    });
    toast('Skipped this occurrence');
  },
  'set-mood': (el) => {
    update((s) => {
      const k = el.dataset.key;
      const j = (s.journal[k] = s.journal[k] || { text: '' });
      j.mood = j.mood === Number(el.dataset.mood) ? null : Number(el.dataset.mood);
      j.updatedAt = new Date().toISOString();
    });
  },
  'new-habit': () => openHabitDialog(),
  'edit-habit': (el) => openHabitDialog(el.dataset.id),
  'archive-habit': (el) => {
    update((s) => { const h = s.habits.find((x) => x.id === el.dataset.id); if (h) h.archived = !h.archived; });
  },
  'habit-delete': () => {
    if (!ui.editingHabitId || !confirm('Delete this habit and its history?')) return;
    update((s) => {
      s.habits = s.habits.filter((x) => x.id !== ui.editingHabitId);
      for (const k of Object.keys(s.habitLog)) delete s.habitLog[k][ui.editingHabitId];
    });
    $('#habit-dialog').close();
    toast('Habit deleted');
  },
  'new-event': (el) => openEventDialog(null, el.dataset.date || null),
  'edit-event': (el) => openEventDialog(el.dataset.id),
  'event-delete': () => {
    if (!ui.editingEventId || !confirm('Delete this event?')) return;
    update((s) => { s.events = s.events.filter((x) => x.id !== ui.editingEventId); });
    $('#event-dialog').close();
    toast('Event deleted');
  },
  'events-segment': (el) => { ui.eventsSegment = el.dataset.seg; renderAll(); },
  ics: (el) => {
    const ev = getState().events.find((x) => x.id === el.dataset.id);
    if (ev) { downloadICS(ev, getState().settings); toast('Calendar file downloaded'); }
  },
  'enable-notifications': async () => {
    const res = await reminders.requestPermission();
    renderAll();
    if (res === 'granted') { reminders.notify('Daybook', { body: 'Notifications are on. You\'ll hear from us before events.' }); toast('Notifications enabled'); }
    else toast('Permission not granted');
  },
  'test-notification': async () => {
    const ok = await reminders.notify('Test reminder', { body: 'This is what an event alert looks like.', tag: 'test' });
    toast(ok ? 'Test sent' : 'Could not show notification');
  },
  'wp-download': () => {
    const canvas = $('#wp-canvas');
    if (canvas) { wallpaper.render(canvas, getState(), getState().settings.wallpaper); wallpaper.download(canvas); toast('Wallpaper downloaded'); }
  },
  'widget-size': (el) => { ui.widgetSize = el.dataset.size; renderAll(); },
  'copy-embed': async () => {
    const url = new URL(`widget.html?size=${ui.widgetSize}`, location.href).href;
    const code = `<iframe src="${url}" width="360" height="330" style="border:0;border-radius:16px" title="Daybook"></iframe>`;
    try { await navigator.clipboard.writeText(code); toast('Embed code copied'); } catch { prompt('Copy this embed code', code); }
  },
  theme: (el) => { update((s) => { s.settings.theme = el.dataset.theme; }); },
  install: async () => {
    if (!ui.installPrompt) return;
    ui.installPrompt.prompt();
    await ui.installPrompt.userChoice.catch(() => {});
    ui.installPrompt = null;
    $('#install-btn').hidden = true;
    renderAll();
  },
  export: () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `daybook-backup-${todayKey()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Backup exported');
  },
  reset: () => {
    if (!confirm('Erase all habits, events and journal entries on this device? This cannot be undone.')) return;
    resetAll();
    toast('All data erased');
  },
  'close-dialog': (el) => el.closest('dialog').close(),
};

const changeActions = {
  'habit-reminder-time': (el) => update((s) => { s.settings.habitReminder.time = el.value || '08:00'; }),
  'habit-reminder-toggle': async (el) => {
    if (el.checked && reminders.permissionState() === 'default') await reminders.requestPermission();
    update((s) => { s.settings.habitReminder.enabled = el.checked; });
  },
  'allday-time': (el) => update((s) => { s.settings.allDayReminderTime = el.value || '09:00'; }),
  'wp-preset': (el) => update((s) => { s.settings.wallpaper.preset = el.value; }),
  'wp-theme': (el) => update((s) => { s.settings.wallpaper.theme = el.value; }),
  'wp-accent': (el) => update((s) => { s.settings.wallpaper.accent = el.value; }),
  'wp-top': (el) => update((s) => { s.settings.wallpaper.topOffset = Number(el.value); }),
  'wp-days': (el) => update((s) => { s.settings.wallpaper.days = Number(el.value); }),
  'wp-habits': (el) => update((s) => { s.settings.wallpaper.showHabits = el.checked; }),
  'wp-events': (el) => update((s) => { s.settings.wallpaper.showEvents = el.checked; }),
  'wp-prompt': (el) => update((s) => { s.settings.wallpaper.showJournalPrompt = el.checked; }),
  import: async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    try {
      importJSON(await file.text());
      toast('Backup imported');
    } catch (err) {
      alert('Could not import: ' + err.message);
    }
    el.value = '';
  },
};

/* ───────────────────────── Wiring ───────────────────────── */
function saveJournal(textarea) {
  const key = textarea.dataset.key;
  const text = textarea.value;
  update((s) => {
    const j = (s.journal[key] = s.journal[key] || {});
    j.text = text;
    j.updatedAt = new Date().toISOString();
    if (!text && j.mood == null) delete s.journal[key];
  });
  const st = $('#journal-save');
  if (st) st.textContent = 'Saved';
}

function init() {
  applyTheme();

  // Routing: #view or #view?new=1
  const applyHash = () => {
    const [view, qs] = location.hash.replace(/^#/, '').split('?');
    ui.view = VIEWS.includes(view) ? view : 'today';
    renderAll();
    if (qs && new URLSearchParams(qs).get('new') === '1') {
      history.replaceState(null, '', `#${ui.view}`);
      if (ui.view === 'events') openEventDialog();
      if (ui.view === 'habits') openHabitDialog();
    }
  };
  window.addEventListener('hashchange', applyHash);
  applyHash();

  $$('.nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.nav)));

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action-change]');
    if (!el) return;
    const fn = changeActions[el.dataset.actionChange];
    if (fn) fn(el);
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'journal-text') {
      const st = $('#journal-save');
      if (st) st.textContent = 'Saving…';
      clearTimeout(ui.saveTimer);
      ui.saveTimer = setTimeout(() => saveJournal(e.target), 600);
    }
    if (e.target.dataset.actionChange === 'wp-top') {
      const label = e.target.nextElementSibling;
      if (label) label.textContent = `${e.target.value}% kept clear`;
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id === 'journal-text') { clearTimeout(ui.saveTimer); saveJournal(e.target); renderAll(); }
  });

  $('#habit-form').addEventListener('submit', (e) => { e.preventDefault(); saveHabit(e.target); });
  $('#event-form').addEventListener('submit', (e) => { e.preventDefault(); saveEvent(e.target); });
  ['#ev-allday', '#ev-repeat', '#ev-push'].forEach((sel) => $(sel).addEventListener('change', syncEventFormVisibility));
  $('#ev-date').addEventListener('change', () => {
    // Default the weekly weekday to the chosen date if the user hasn't picked any.
    if (!$$('#ev-weekdays input:checked').length) {
      const wd = weekday($('#ev-date').value || todayKey());
      const box = $(`#ev-weekdays input[value="${wd}"]`);
      if (box) box.checked = true;
    }
  });

  subscribe(renderAll);

  // Install prompt (Chromium)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ui.installPrompt = e;
    $('#install-btn').hidden = false;
    if (ui.view === 'settings') renderAll();
  });

  // Service worker
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  }

  // In-page reminder scheduler
  reminders.startScheduler({
    getState,
    markNotified: (rk) => update((s) => { s.notified[rk] = Date.now(); }),
    buildHabitBody: (s) => {
      const today = todayKey();
      const left = habitsForDay(s.habits, today).filter((h) => !isDone(s.habitLog, h.id, today));
      return left.length ? `${left.length} left today: ${left.map((h) => h.name).join(', ')}` : 'All habits done today 🎉';
    },
  });

  // Roll over at midnight
  let lastToday = todayKey();
  setInterval(() => {
    const now = todayKey();
    if (now !== lastToday) {
      if (ui.viewDate === lastToday) ui.viewDate = now;
      lastToday = now;
      renderAll();
    }
  }, 60000);

  // Prune old fired-reminder markers (keep 30 days)
  update((s) => {
    const cutoff = Date.now() - 30 * 86400000;
    for (const [k, v] of Object.entries(s.notified)) if (typeof v === 'number' && v < cutoff) delete s.notified[k];
  });
}

init();
