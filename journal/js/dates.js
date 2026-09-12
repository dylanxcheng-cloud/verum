/**
 * dates.js — small, dependency-free date helpers.
 * All "keys" are local calendar dates in YYYY-MM-DD form.
 */

const pad = (n) => String(n).padStart(2, '0');

/** Local date -> 'YYYY-MM-DD' */
export function toKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> local Date at midnight */
export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return toKey(new Date());
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function addMonths(key, n) {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return toKey(d);
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Whole days from a to b (b - a). */
export function diffDays(aKey, bKey) {
  const a = fromKey(aKey);
  const b = fromKey(bKey);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(key) {
  return fromKey(key).getDay();
}

/** Combine a date key and optional 'HH:MM' into a Date. */
export function atTime(key, hhmm) {
  const d = fromKey(key);
  if (hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function formatLong(key) {
  return fromKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShort(key) {
  return fromKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(hhmm) {
  if (!hhmm) return 'All day';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function relativeLabel(key, today = todayKey()) {
  const n = diffDays(today, key);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return fromKey(key).toLocaleDateString(undefined, { weekday: 'long' });
  return formatShort(key);
}

export function nowHHMM(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
