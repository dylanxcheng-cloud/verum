/**
 * store.js — single source of truth, persisted to localStorage.
 *
 * The whole app state is one JSON document so it can be exported, imported,
 * synced to a backend later, or read by the widget page (same origin).
 */

export const STORAGE_KEY = 'daybook.v1';
export const SCHEMA_VERSION = 1;

const listeners = new Set();
let state = null;

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      theme: 'system', // 'system' | 'light' | 'dark'
      allDayReminderTime: '09:00', // when all-day events "happen" for reminder math
      defaultLeadMinutes: 30,
      habitReminder: { enabled: false, time: '08:00' },
      wallpaper: {
        preset: 'iphone-6.1',
        theme: 'dark',
        accent: '#1a73e8',
        showHabits: true,
        showEvents: true,
        showJournalPrompt: true,
        topOffset: 30, // % of height kept clear for the lock-screen clock
        days: 7,
      },
    },
    habits: [], // { id, name, emoji, color, days:[0..6], createdAt, archived }
    habitLog: {}, // { 'YYYY-MM-DD': { habitId: true } }
    journal: {}, // { 'YYYY-MM-DD': { text, mood, updatedAt } }
    events: [], // see recur.js for shape + reminders/completed
    notified: {}, // { 'eventId|YYYY-MM-DD': timestamp }  fired reminders
  };
}

function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  s.settings.wallpaper = { ...base.settings.wallpaper, ...((raw.settings || {}).wallpaper || {}) };
  s.settings.habitReminder = {
    ...base.settings.habitReminder,
    ...((raw.settings || {}).habitReminder || {}),
  };
  s.habits = Array.isArray(raw.habits) ? raw.habits : [];
  s.events = Array.isArray(raw.events) ? raw.events : [];
  for (const k of ['habitLog', 'journal', 'notified']) {
    if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  }
  s.version = SCHEMA_VERSION;
  return s;
}

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = migrate(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('Could not read saved data, starting fresh.', err);
    state = defaultState();
  }
  return state;
}

export function getState() {
  return load();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Could not save data', err);
  }
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Mutate state inside `fn`, then persist and notify subscribers. */
export function update(fn) {
  load();
  fn(state);
  persist();
  emit();
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Pick up changes made in another tab (e.g. the widget page). */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    try {
      state = migrate(e.newValue ? JSON.parse(e.newValue) : null);
      emit();
    } catch {
      /* ignore malformed cross-tab writes */
    }
  });
}

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a valid backup file');
  state = migrate(parsed);
  persist();
  emit();
  return state;
}

export function resetAll() {
  state = defaultState();
  persist();
  emit();
}
