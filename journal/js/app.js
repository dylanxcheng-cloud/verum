/**
 * app.js — Daybook UI. Schedule view for events, checklist for habits, a paper card for the journal.
 */
import { getState, update, subscribe, exportJSON, importJSON, resetAll, uid } from './store.js';
import { todayKey, addDays, formatTime, relativeLabel, weekday, WEEKDAYS_SHORT, WEEKDAYS_MIN, fromKey } from './dates.js';
import { occurrencesBetween, nextOccurrence, describeRepeat, normalizeRepeat } from './recur.js';
import { habitsForDay, isDone, isScheduled, streak, completion, dayProgress } from './habits.js';
import * as reminders from './reminders.js';
import { downloadICS } from './ics.js';
import * as wallpaper from './wallpaper.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';
// Google Calendar palette
const COLORS = ['#039be5', '#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e', '#616161'];
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const VIEWS = ['today', 'habits', 'events', 'reminders'];
const TITLES = { habits: 'Habits', events: 'Schedule', reminders: 'Reminders' };

const ui = { view: 'today', viewDate: todayKey(), seg: 'upcoming', editingHabitId: null, editingEventId: null, installPrompt: null, saveTimer: null };

let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200); }

function applyTheme() {
  const t = getState().settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

function occurrences(state, from, to) {
  const items = [];
  for (const ev of state.events) for (const key of occurrencesBetween(ev, from, to)) items.push({ ev, key, done: Boolean(ev.completed && ev.completed[key]) });
  return items.sort((a, b) => (a.key + (a.ev.time || '00:00')).localeCompare(b.key + (b.ev.time || '00:00')));
}

/* ── Schedule pieces ── */
function dayCol(key) {
  const d = fromKey(key);
  const today = key === todayKey();
  return `<div class="day-col ${today ? 'today' : ''}"><div class="wd">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</div><div class="num">${d.getDate()}</div>${today ? '' : `<div class="rel">${esc(d.toLocaleDateString(undefined, { month: 'short' }))}</div>`}</div>`;
}
function chip({ ev, key, done }) {
  const r = normalizeRepeat(ev.repeat);
  return `<div class="chip ${done ? 'done' : ''}" style="--c:${esc(ev.color || COLORS[0])}" data-action="edit-event" data-id="${esc(ev.id)}">
    <span class="tick" role="checkbox" aria-checked="${done}" data-action="toggle-occurrence" data-id="${esc(ev.id)}" data-key="${key}">${CHECK}</span>
    <span class="t">${esc(ev.title)}${ev.from ? ` <small>· ${esc(ev.from)}</small>` : ''}</span>
    ${r.type !== 'none' && !done ? `<button class="more" data-action="skip-occurrence" data-id="${esc(ev.id)}" data-key="${key}" title="Skip just this one">skip</button>` : ''}
    <span class="time">${esc(ev.time ? formatTime(ev.time) : 'All day')}</span>
  </div>`;
}
function schedule(items, { emptyText = 'Nothing scheduled', showEmptyToday = false } = {}) {
  if (!items.length && !showEmptyToday) return `<div class="empty">${emptyText}</div>`;
  const byDay = new Map();
  if (showEmptyToday) byDay.set(todayKey(), []);
  for (const it of items) { if (!byDay.has(it.key)) byDay.set(it.key, []); byDay.get(it.key).push(it); }
  return `<div class="schedule">${[...byDay.entries()].map(([key, list]) => `<div class="day-row">${dayCol(key)}<div class="chips">${list.length ? list.map(chip).join('') : `<div class="none">${emptyText}</div>`}</div></div>`).join('')}</div>`;
}

/* ── Today ── */
function renderToday(state) {
  const key = ui.viewDate, today = todayKey();
  const habits = habitsForDay(state.habits, key);
  const prog = dayProgress(state.habits, state.habitLog, key);
  const entry = state.journal[key] || {};
  const dayItems = occurrences(state, key, key);
  const upcoming = key === today ? occurrences(state, addDays(today, 1), addDays(today, 7)).filter((x) => !x.done) : [];
  const overdue = key === today ? occurrences(state, addDays(today, -14), addDays(today, -1)).filter((x) => !x.done) : [];

  $('[data-view="today"]').innerHTML = `
    ${schedule(dayItems, { emptyText: 'No events', showEmptyToday: key === today })}
    ${key !== today && !dayItems.length ? '' : ''}
    ${overdue.length ? `<div class="sec"><h2>Still open</h2></div>${schedule(overdue)}` : ''}

    <div class="note">
      <h2>Habits <span class="meta">${prog.total ? `${prog.done} of ${prog.total}` : ''}</span></h2>
      ${habits.length ? `<ul class="checklist">${habits.map((h) => {
        const done = isDone(state.habitLog, h.id, key); const s = streak(h, state.habitLog, today);
        return `<li class="ck ${done ? 'done' : ''}" style="--c:${esc(h.color || COLORS[2])}"><span class="box" role="checkbox" aria-checked="${done}" data-action="toggle-habit" data-id="${esc(h.id)}" data-key="${key}">${CHECK}</span>
          <div class="body"><div class="name">${esc(h.name)}</div></div>${s ? `<span class="side streak">${s} day${s > 1 ? 's' : ''}</span>` : ''}</li>`; }).join('')}</ul>`
        : `<div class="empty">${state.habits.length ? 'Nothing scheduled for this day.' : 'No habits yet. '}<a data-action="new-habit">Add a habit</a></div>`}
    </div>

    <div class="note paper">
      <div class="stamp">${esc(fromKey(key).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }))}${entry.updatedAt ? ' at ' + esc(new Date(entry.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) : ''}</div>
      <div class="moods">${MOODS.map((m, i) => `<button class="mood ${entry.mood === i ? 'selected' : ''}" data-action="set-mood" data-mood="${i}" data-key="${key}" aria-label="Mood ${i + 1}">${m}</button>`).join('')}</div>
      <textarea class="journal" id="journal-text" data-key="${key}" placeholder="${key === today ? 'Write about today…' : 'Notes for this day…'}">${esc(entry.text || '')}</textarea>
      <div class="save-state" id="journal-save"></div>
    </div>

    ${key === today ? `<div class="sec"><h2>Next 7 days</h2></div>${schedule(upcoming, { emptyText: 'Nothing this week' })}` : ''}
  `;
}

/* ── Habits ── */
function renderHabits(state) {
  const today = todayKey();
  const active = state.habits.filter((h) => !h.archived), archived = state.habits.filter((h) => h.archived);
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const row = (h) => {
    const s = streak(h, state.habitLog, today), c = completion(h, state.habitLog, today, 30);
    return `<li class="ck" style="--c:${esc(h.color || COLORS[2])}"><span class="color" style="background:${esc(h.color || COLORS[2])}"></span>
      <div class="body" data-action="edit-habit" data-id="${esc(h.id)}" style="cursor:pointer"><div class="name">${esc(h.name)}</div>
        <div class="sub">${s ? `<span class="streak">${s} day streak</span> · ` : ''}${c.scheduled ? `${Math.round(c.rate * 100)}% this month` : 'Just started'}${h.days && h.days.length && h.days.length < 7 ? ' · ' + h.days.map((d) => WEEKDAYS_SHORT[d]).join(' ') : ''}</div></div>
      ${h.archived ? `<button class="btn text" data-action="archive-habit" data-id="${esc(h.id)}">Restore</button>` : `<div class="dots">${days7.map((k) => { const on = isScheduled(h, k), done = isDone(state.habitLog, h.id, k);
        return `<span class="dot ${done ? 'done' : ''} ${on ? '' : 'off'} ${k === today ? 'today' : ''}" title="${k}" ${on ? `data-action="toggle-habit" data-id="${esc(h.id)}" data-key="${k}"` : ''}></span>`; }).join('')}</div>`}
    </li>`;
  };
  $('[data-view="habits"]').innerHTML = `
    <div class="sec"><h2>Every day</h2><span class="small muted">Last 7 days</span></div>
    ${active.length ? `<ul class="checklist">${active.map(row).join('')}</ul>` : `<div class="empty">Things you want to do on repeat. <a data-action="new-habit">Add your first habit</a>.</div>`}
    ${archived.length ? `<div class="sec"><h2>Archived</h2></div><ul class="checklist">${archived.map(row).join('')}</ul>` : ''}
  `;
}

/* ── Events ── */
function renderEvents(state) {
  const today = todayKey();
  let body;
  if (ui.seg === 'upcoming') body = schedule(occurrences(state, today, addDays(today, 30)).filter((x) => !x.done), { emptyText: 'Nothing in the next 30 days', showEmptyToday: true });
  else if (ui.seg === 'past') body = schedule(occurrences(state, addDays(today, -60), addDays(today, -1)).reverse(), { emptyText: 'Nothing in the last 60 days' });
  else {
    const evs = [...state.events].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    body = evs.length ? `<ul class="checklist">${evs.map((ev) => { const next = nextOccurrence(ev, today);
      return `<li class="ck"><span class="color" style="background:${esc(ev.color || COLORS[0])}"></span>
        <div class="body" data-action="edit-event" data-id="${esc(ev.id)}" style="cursor:pointer"><div class="name">${esc(ev.title)}${ev.from ? ` <span class="muted">· ${esc(ev.from)}</span>` : ''}</div>
          <div class="sub">${esc(describeRepeat(ev.repeat, ev.date))} · ${esc(formatTime(ev.time))}${next ? ` · next ${esc(relativeLabel(next))}` : ' · no upcoming'}</div></div>
        <button class="btn text" title="Add to phone calendar" data-action="ics" data-id="${esc(ev.id)}">.ics</button></li>`; }).join('')}</ul>` : '<div class="empty">No events yet.</div>';
  }
  $('[data-view="events"]').innerHTML = `
    <div class="tabs">${['upcoming', 'all', 'past'].map((s) => `<button class="${ui.seg === s ? 'active' : ''}" data-action="seg" data-seg="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
    ${body}`;
}

/* ── Reminders ── */
function renderReminders(state) {
  const perm = reminders.permissionState();
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const wp = state.settings.wallpaper, hr = state.settings.habitReminder;
  const widgetUrl = new URL('widget.html', location.href).href;
  let banner;
  if (perm === 'granted') banner = `<div class="banner">🔔 Notifications are on. They fire while Daybook is open (tab or installed app). For alerts when it's closed, use <b>.ics</b> on an event to put it in your phone's calendar.</div>`;
  else if (perm === 'denied') banner = `<div class="banner warn">Notifications are blocked for this site. Allow them in browser settings, then reload.</div>`;
  else if (perm === 'unsupported') banner = `<div class="banner warn">This browser can't show notifications.${isIOS ? ' On iPhone: Share → Add to Home Screen, then open Daybook from there.' : ''}</div>`;
  else banner = `<div class="banner warn">Turn on notifications to get an alert before events.${isIOS && !standalone ? ' iPhone: add to Home Screen first.' : ''}</div>`;

  $('[data-view="reminders"]').innerHTML = `
    <div class="sec"><h2>Notifications</h2></div>
    ${banner}
    <div class="row" style="margin:10px 0">${perm === 'default' ? '<button class="btn primary" data-action="enable-notifications">Turn on</button>' : ''}${perm === 'granted' ? '<button class="btn" data-action="test-notification">Send a test</button>' : ''}</div>
    <div class="setting"><div><div class="l">Daily habit reminder</div><div class="s">One nudge listing what's left</div></div><div class="row"><input type="time" value="${esc(hr.time)}" data-change="habit-time"><input type="checkbox" ${hr.enabled ? 'checked' : ''} data-change="habit-toggle"></div></div>
    <div class="setting"><div><div class="l">All-day events remind at</div></div><input type="time" value="${esc(state.settings.allDayReminderTime)}" data-change="allday-time"></div>

    <div class="sec"><h2>Wallpaper</h2></div>
    <p class="small muted" style="margin:0 0 10px">Today's habits and upcoming events as a lock-screen image. Download, set as wallpaper, regenerate whenever.</p>
    <div class="wp-grid">
      <div>
        <div class="setting"><div class="l">Phone</div><select data-change="wp-preset">${wallpaper.PRESETS.map((p) => `<option value="${p.id}" ${wp.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="setting"><div class="l">Style</div><select data-change="wp-theme">${wallpaper.THEME_IDS.map((t) => `<option value="${t}" ${wp.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
        <div class="setting"><div class="l">Show events for</div><select data-change="wp-days">${[1, 3, 7, 14].map((d) => `<option value="${d}" ${Number(wp.days) === d ? 'selected' : ''}>${d === 1 ? 'today' : d + ' days'}</option>`).join('')}</select></div>
        <button class="btn primary block" style="margin-top:12px" data-action="wp-download">Download wallpaper</button>
        <ol class="steps"><li><b>iPhone:</b> Photos → Share → Use as Wallpaper → Lock Screen.</li><li><b>Android:</b> open image → ⋮ → Use as → Lock screen.</li></ol>
      </div>
      <div class="wp-preview"><canvas id="wp-canvas" aria-label="Wallpaper preview"></canvas></div>
    </div>

    <div class="sec"><h2>Widget</h2></div>
    <p class="small muted" style="margin:0 0 10px">A live, one-glance page. Add it to your home screen as its own icon; ticking a habit there updates the app.</p>
    <iframe class="widget-frame" src="${esc(widgetUrl)}" title="Widget preview"></iframe>
    <div class="row" style="margin-top:10px"><a class="btn" href="${esc(widgetUrl)}" target="_blank" rel="noopener">Open widget</a></div>
    <ol class="steps"><li>Open the widget page, then <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Add to Home screen</b> (Android).</li></ol>

    <div class="sec"><h2>App</h2></div>
    <div class="setting"><div class="l">Theme</div><select data-change="theme">${['system', 'light', 'dark'].map((t) => `<option value="${t}" ${state.settings.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
    <div class="setting"><div><div class="l">Install</div><div class="s">${standalone ? 'Installed' : ui.installPrompt ? 'Works offline, opens like an app' : 'iPhone: Share → Add to Home Screen. Android/desktop: Install from the browser menu.'}</div></div>${ui.installPrompt ? '<button class="btn" data-action="install">Install</button>' : ''}</div>
    <div class="setting"><div><div class="l">Your data</div><div class="s">Stored on this device only. ${state.habits.length} habits · ${state.events.length} events · ${Object.values(state.journal).filter((j) => j.text).length} journal entries</div></div>
      <div class="row"><button class="btn" data-action="export">Export</button><label class="btn">Import<input type="file" accept=".json,application/json" hidden data-change="import"></label></div></div>
    <div class="setting"><div class="l">Erase everything</div><button class="btn danger" data-action="reset">Erase</button></div>
  `;
  const canvas = $('#wp-canvas');
  if (canvas) wallpaper.render(canvas, state, wp);
}

/* ── Orchestration ── */
function renderTop() {
  const t = $('#top-title'), a = $('#top-actions');
  if (ui.view === 'today') {
    const d = fromKey(ui.viewDate);
    t.innerHTML = `${esc(d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))}<small>${esc(d.toLocaleDateString(undefined, { weekday: 'long' }))}</small>`;
    a.innerHTML = `<button class="outline-btn" data-action="day-today" ${ui.viewDate === todayKey() ? 'disabled style="opacity:.5"' : ''}>Today</button>
      <button class="icon-btn" data-action="day-shift" data-n="-1" aria-label="Previous day"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button>
      <button class="icon-btn" data-action="day-shift" data-n="1" aria-label="Next day"><svg viewBox="0 0 24 24"><path d="M10 6 8.6 7.4l4.6 4.6-4.6 4.6L10 18l6-6z"/></svg></button>`;
  } else { t.textContent = TITLES[ui.view]; a.innerHTML = ''; }
  $('#fab').hidden = ui.view === 'reminders';
}
function renderAll() {
  const state = getState();
  applyTheme();
  if (document.activeElement && document.activeElement.id === 'journal-text' && ui.view === 'today') return; // don't clobber typing
  ({ today: renderToday, habits: renderHabits, events: renderEvents, reminders: renderReminders })[ui.view](state);
  renderTop();
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === ui.view));
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === ui.view));
}
function setView(view) {
  ui.view = VIEWS.includes(view) ? view : 'today';
  if (location.hash.replace(/^#/, '').split('?')[0] !== ui.view) history.replaceState(null, '', `#${ui.view}`);
  renderAll(); window.scrollTo({ top: 0 });
}

/* ── Habit dialog ── */
function swatches(id, current) { return COLORS.map((c) => `<label style="background:${c}"><input type="radio" name="color" value="${c}" ${c === current ? 'checked' : ''}></label>`).join(''); }
function weekdayBoxes(name, selected) { return WEEKDAYS_MIN.map((d, i) => `<label title="${WEEKDAYS_SHORT[i]}"><input type="checkbox" name="${name}" value="${i}" ${selected.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join(''); }
function openHabitDialog(id = null) {
  const state = getState(); const h = id ? state.habits.find((x) => x.id === id) : null;
  ui.editingHabitId = id;
  $('#habit-name').value = h ? h.name : '';
  $('#habit-days').innerHTML = weekdayBoxes('days', h && h.days && h.days.length ? h.days : [0, 1, 2, 3, 4, 5, 6]);
  $('#habit-colors').innerHTML = swatches('color', h ? h.color || COLORS[2] : COLORS[(state.habits.length + 2) % COLORS.length]);
  $('#habit-delete').hidden = !h;
  $('#habit-dialog').showModal(); $('#habit-name').focus();
}
function saveHabit(form) {
  const d = new FormData(form); const name = String(d.get('name') || '').trim(); if (!name) return;
  const days = d.getAll('days').map(Number); const color = String(d.get('color') || COLORS[2]);
  update((s) => {
    if (ui.editingHabitId) { const h = s.habits.find((x) => x.id === ui.editingHabitId); if (h) Object.assign(h, { name, color, days: days.length === 7 ? [] : days }); }
    else s.habits.push({ id: uid(), name, color, days: days.length === 7 ? [] : days, createdAt: new Date().toISOString(), archived: false });
  });
  $('#habit-dialog').close(); toast(ui.editingHabitId ? 'Habit updated' : 'Habit added');
}

/* ── Event dialog ── */
function syncEventForm() {
  $('#ev-time').hidden = $('#ev-allday').checked;
  $('#ev-weekdays').hidden = $('#ev-repeat').value !== 'weekly';
  $('#ev-lead').hidden = !$('#ev-push').checked;
}
function nextRoundHour() { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return `${String(d.getHours()).padStart(2, '0')}:00`; }
function openEventDialog(id = null, presetDate = null) {
  const state = getState(); const ev = id ? state.events.find((x) => x.id === id) : null;
  ui.editingEventId = id;
  $('#ev-title').value = ev ? ev.title : '';
  $('#ev-from').value = ev ? ev.from || '' : '';
  $('#ev-date').value = ev ? ev.date : presetDate || ui.viewDate;
  $('#ev-allday').checked = ev ? !ev.time : false;
  $('#ev-time').value = ev && ev.time ? ev.time : nextRoundHour();
  const r = normalizeRepeat(ev ? ev.repeat : null);
  $('#ev-repeat').value = r.type;
  $('#ev-weekdays').innerHTML = weekdayBoxes('weekdays', r.weekdays.length ? r.weekdays : [weekday($('#ev-date').value)]);
  $('#ev-notes').value = ev ? ev.notes || '' : '';
  const rem = (ev && ev.reminders) || {};
  $('#ev-push').checked = rem.push ? Boolean(rem.push.enabled) : reminders.permissionState() === 'granted';
  $('#ev-lead').innerHTML = reminders.LEAD_OPTIONS.map((o) => `<option value="${o.minutes}">${o.label}</option>`).join('');
  $('#ev-lead').value = String(rem.push && rem.push.leadMinutes != null ? rem.push.leadMinutes : state.settings.defaultLeadMinutes);
  $('#event-form [name=wallpaper]').checked = rem.wallpaper ? Boolean(rem.wallpaper.enabled) : true;
  $('#event-form [name=widget]').checked = rem.widget ? Boolean(rem.widget.enabled) : true;
  $('#ev-colors').innerHTML = swatches('color', ev ? ev.color || COLORS[0] : COLORS[0]);
  $('#event-delete').hidden = !ev;
  syncEventForm(); $('#event-dialog').showModal(); $('#ev-title').focus();
}
function saveEvent(form) {
  const d = new FormData(form);
  const title = String(d.get('title') || '').trim(), date = String(d.get('date') || ''); if (!title || !date) return;
  const time = d.get('allday') === 'on' ? null : String(d.get('time') || '') || null;
  const repeat = normalizeRepeat({ type: d.get('repeat'), weekdays: d.getAll('weekdays').map(Number) });
  if (repeat.type !== 'weekly') repeat.weekdays = [];
  const rem = { push: { enabled: d.get('push') === 'on', leadMinutes: Number(d.get('lead') || 0) }, wallpaper: { enabled: d.get('wallpaper') === 'on' }, widget: { enabled: d.get('widget') === 'on' } };
  const fields = { title, from: String(d.get('from') || '').trim(), notes: String(d.get('notes') || '').trim(), date, time, repeat, reminders: rem, color: String(d.get('color') || COLORS[0]) };
  update((s) => {
    if (ui.editingEventId) {
      const ev = s.events.find((x) => x.id === ui.editingEventId);
      if (ev) { const moved = ev.date !== date || ev.time !== time || JSON.stringify(normalizeRepeat(ev.repeat)) !== JSON.stringify(repeat);
        Object.assign(ev, fields, { updatedAt: new Date().toISOString() });
        if (moved) for (const k of Object.keys(s.notified)) if (k.startsWith(ev.id + '|')) delete s.notified[k]; }
    } else s.events.push({ id: uid(), ...fields, completed: {}, skipped: {}, createdAt: new Date().toISOString() });
    s.settings.defaultLeadMinutes = rem.push.leadMinutes;
  });
  if (rem.push.enabled && reminders.permissionState() === 'default') reminders.requestPermission().then(renderAll);
  $('#event-dialog').close(); toast(ui.editingEventId ? 'Event updated' : 'Event added');
}

/* ── Actions ── */
const actions = {
  fab: () => (ui.view === 'habits' ? openHabitDialog() : openEventDialog()),
  'day-shift': (el) => { ui.viewDate = addDays(ui.viewDate, Number(el.dataset.n)); renderAll(); },
  'day-today': () => { ui.viewDate = todayKey(); renderAll(); },
  'toggle-habit': (el) => update((s) => { const k = el.dataset.key; s.habitLog[k] = s.habitLog[k] || {}; if (s.habitLog[k][el.dataset.id]) delete s.habitLog[k][el.dataset.id]; else s.habitLog[k][el.dataset.id] = true; if (!Object.keys(s.habitLog[k]).length) delete s.habitLog[k]; }),
  'toggle-occurrence': (el) => update((s) => { const ev = s.events.find((x) => x.id === el.dataset.id); if (!ev) return; ev.completed = ev.completed || {}; if (ev.completed[el.dataset.key]) delete ev.completed[el.dataset.key]; else ev.completed[el.dataset.key] = true; }),
  'skip-occurrence': (el) => { update((s) => { const ev = s.events.find((x) => x.id === el.dataset.id); if (ev) { ev.skipped = ev.skipped || {}; ev.skipped[el.dataset.key] = true; } }); toast('Skipped'); },
  'set-mood': (el) => update((s) => { const j = (s.journal[el.dataset.key] = s.journal[el.dataset.key] || { text: '' }); j.mood = j.mood === Number(el.dataset.mood) ? null : Number(el.dataset.mood); j.updatedAt = new Date().toISOString(); }),
  'new-habit': () => openHabitDialog(),
  'edit-habit': (el) => openHabitDialog(el.dataset.id),
  'archive-habit': (el) => update((s) => { const h = s.habits.find((x) => x.id === el.dataset.id); if (h) h.archived = !h.archived; }),
  'habit-delete': () => { if (!ui.editingHabitId) return; const h = getState().habits.find((x) => x.id === ui.editingHabitId);
    if (h && !h.archived) { update((s) => { const x = s.habits.find((y) => y.id === ui.editingHabitId); if (x) x.archived = true; }); toast('Habit archived (history kept)'); }
    else if (confirm('Delete this habit and its history?')) { update((s) => { s.habits = s.habits.filter((x) => x.id !== ui.editingHabitId); for (const k of Object.keys(s.habitLog)) delete s.habitLog[k][ui.editingHabitId]; }); toast('Habit deleted'); }
    $('#habit-dialog').close(); },
  'new-event': (el) => openEventDialog(null, el.dataset.date || null),
  'edit-event': (el) => openEventDialog(el.dataset.id),
  'event-delete': () => { if (!ui.editingEventId || !confirm('Delete this event?')) return; update((s) => { s.events = s.events.filter((x) => x.id !== ui.editingEventId); }); $('#event-dialog').close(); toast('Event deleted'); },
  seg: (el) => { ui.seg = el.dataset.seg; renderAll(); },
  ics: (el) => { const ev = getState().events.find((x) => x.id === el.dataset.id); if (ev) { downloadICS(ev); toast('Calendar file downloaded'); } },
  'enable-notifications': async () => { const r = await reminders.requestPermission(); renderAll(); if (r === 'granted') { reminders.notify('Daybook', { body: 'Notifications are on.' }); } else toast('Not allowed'); },
  'test-notification': async () => toast((await reminders.notify('Test reminder', { body: 'This is what an event alert looks like.', tag: 'test' })) ? 'Sent' : 'Could not show'),
  'wp-download': () => { const c = $('#wp-canvas'); if (c) { wallpaper.render(c, getState(), getState().settings.wallpaper); wallpaper.download(c); toast('Downloaded'); } },
  install: async () => { if (!ui.installPrompt) return; ui.installPrompt.prompt(); await ui.installPrompt.userChoice.catch(() => {}); ui.installPrompt = null; renderAll(); },
  export: () => { const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' })); const a = Object.assign(document.createElement('a'), { href: url, download: `daybook-${todayKey()}.json` }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); },
  reset: () => { if (confirm('Erase all habits, events and journal entries on this device?')) { resetAll(); toast('Erased'); } },
  'close-dialog': (el) => el.closest('dialog').close(),
};
const changes = {
  'habit-time': (el) => update((s) => { s.settings.habitReminder.time = el.value || '08:00'; }),
  'habit-toggle': async (el) => { if (el.checked && reminders.permissionState() === 'default') await reminders.requestPermission(); update((s) => { s.settings.habitReminder.enabled = el.checked; }); },
  'allday-time': (el) => update((s) => { s.settings.allDayReminderTime = el.value || '09:00'; }),
  'wp-preset': (el) => update((s) => { s.settings.wallpaper.preset = el.value; }),
  'wp-theme': (el) => update((s) => { s.settings.wallpaper.theme = el.value; }),
  'wp-days': (el) => update((s) => { s.settings.wallpaper.days = Number(el.value); }),
  theme: (el) => update((s) => { s.settings.theme = el.value; }),
  import: async (el) => { const f = el.files && el.files[0]; if (!f) return; try { importJSON(await f.text()); toast('Imported'); } catch (e) { alert('Could not import: ' + e.message); } el.value = ''; },
};

function saveJournal(ta) {
  const key = ta.dataset.key, text = ta.value;
  update((s) => { const j = (s.journal[key] = s.journal[key] || {}); j.text = text; j.updatedAt = new Date().toISOString(); if (!text && j.mood == null) delete s.journal[key]; });
  const st = $('#journal-save'); if (st) st.textContent = 'Saved';
}

function init() {
  applyTheme();
  const applyHash = () => {
    const [view, qs] = location.hash.replace(/^#/, '').split('?');
    ui.view = VIEWS.includes(view) ? view : 'today'; renderAll();
    if (qs && new URLSearchParams(qs).get('new') === '1') { history.replaceState(null, '', `#${ui.view}`); actions.fab(); }
  };
  window.addEventListener('hashchange', applyHash); applyHash();
  $$('.nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.nav)));
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    const fn = actions[el.dataset.action]; if (fn) { e.preventDefault(); e.stopPropagation(); fn(el); }
  });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el && changes[el.dataset.change]) changes[el.dataset.change](el); });
  document.addEventListener('input', (e) => { if (e.target.id === 'journal-text') { const st = $('#journal-save'); if (st) st.textContent = 'Saving…'; clearTimeout(ui.saveTimer); ui.saveTimer = setTimeout(() => saveJournal(e.target), 600); } });
  document.addEventListener('focusout', (e) => { if (e.target.id === 'journal-text') { clearTimeout(ui.saveTimer); saveJournal(e.target); renderAll(); } });
  $('#habit-form').addEventListener('submit', (e) => { e.preventDefault(); saveHabit(e.target); });
  $('#event-form').addEventListener('submit', (e) => { e.preventDefault(); saveEvent(e.target); });
  ['#ev-allday', '#ev-repeat', '#ev-push'].forEach((s) => $(s).addEventListener('change', syncEventForm));
  $('#ev-date').addEventListener('change', () => { if (!$$('#ev-weekdays input:checked').length) { const b = $(`#ev-weekdays input[value="${weekday($('#ev-date').value || todayKey())}"]`); if (b) b.checked = true; } });
  subscribe(renderAll);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installPrompt = e; if (ui.view === 'reminders') renderAll(); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  reminders.startScheduler({
    getState, markNotified: (rk) => update((s) => { s.notified[rk] = Date.now(); }),
    buildHabitBody: (s) => { const t = todayKey(); const left = habitsForDay(s.habits, t).filter((h) => !isDone(s.habitLog, h.id, t)); return left.length ? `${left.length} left today: ${left.map((h) => h.name).join(', ')}` : 'All habits done today'; },
  });
  let lastToday = todayKey();
  setInterval(() => { const now = todayKey(); if (now !== lastToday) { if (ui.viewDate === lastToday) ui.viewDate = now; lastToday = now; renderAll(); } }, 60000);
  update((s) => { const cutoff = Date.now() - 30 * 86400000; for (const [k, v] of Object.entries(s.notified)) if (typeof v === 'number' && v < cutoff) delete s.notified[k]; });
}
init();
