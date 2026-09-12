/**
 * recur.js — recurrence engine for events.
 *
 * An event has:
 *   date:   'YYYY-MM-DD'  first occurrence
 *   time:   'HH:MM' | null (null = all day)
 *   repeat: { type: 'none'|'daily'|'weekly'|'monthly'|'yearly',
 *             interval: 1, weekdays: [0..6], until: 'YYYY-MM-DD'|null }
 *   skipped: { 'YYYY-MM-DD': true }   occurrences the user removed
 */
import { addDays, daysInMonth, diffDays, fromKey, weekday, atTime } from './dates.js';

export const REPEAT_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export function normalizeRepeat(repeat) {
  const r = repeat || {};
  return {
    type: REPEAT_TYPES.includes(r.type) ? r.type : 'none',
    interval: Math.max(1, Number(r.interval) || 1),
    weekdays: Array.isArray(r.weekdays) ? [...new Set(r.weekdays.map(Number))].sort() : [],
    until: r.until || null,
  };
}

/** Sunday-based start of week for a key. */
function weekStart(key) {
  return addDays(key, -weekday(key));
}

/** Does the event's rule (ignoring skips) land on `key`? */
export function ruleMatches(event, key) {
  const start = event.date;
  if (!start || key < start) return false;
  const r = normalizeRepeat(event.repeat);
  if (r.until && key > r.until) return false;

  switch (r.type) {
    case 'none':
      return key === start;

    case 'daily':
      return diffDays(start, key) % r.interval === 0;

    case 'weekly': {
      const days = r.weekdays.length ? r.weekdays : [weekday(start)];
      if (!days.includes(weekday(key))) return false;
      const weeks = diffDays(weekStart(start), weekStart(key)) / 7;
      return weeks % r.interval === 0;
    }

    case 'monthly': {
      const s = fromKey(start);
      const k = fromKey(key);
      const months = (k.getFullYear() - s.getFullYear()) * 12 + (k.getMonth() - s.getMonth());
      if (months % r.interval !== 0) return false;
      // Clamp e.g. the 31st to the last day of shorter months.
      const wanted = Math.min(s.getDate(), daysInMonth(k.getFullYear(), k.getMonth()));
      return k.getDate() === wanted;
    }

    case 'yearly': {
      const s = fromKey(start);
      const k = fromKey(key);
      if ((k.getFullYear() - s.getFullYear()) % r.interval !== 0) return false;
      if (k.getMonth() !== s.getMonth()) return false;
      const wanted = Math.min(s.getDate(), daysInMonth(k.getFullYear(), k.getMonth()));
      return k.getDate() === wanted;
    }
    default:
      return false;
  }
}

/** Rule match minus user-skipped occurrences. */
export function occursOn(event, key) {
  if (event.skipped && event.skipped[key]) return false;
  return ruleMatches(event, key);
}

/** All occurrence keys in [fromKey, toKey] inclusive. */
export function occurrencesBetween(event, from, to) {
  const out = [];
  if (to < from) return out;
  const r = normalizeRepeat(event.repeat);
  if (r.type === 'none') {
    if (event.date >= from && event.date <= to && occursOn(event, event.date)) out.push(event.date);
    return out;
  }
  let k = from < event.date ? event.date : from;
  const end = r.until && r.until < to ? r.until : to;
  while (k <= end) {
    if (occursOn(event, k)) out.push(k);
    k = addDays(k, 1);
  }
  return out;
}

/** First occurrence on or after `from`, searching up to `horizonDays`. */
export function nextOccurrence(event, from, horizonDays = 366 * 2) {
  const r = normalizeRepeat(event.repeat);
  if (r.type === 'none') return occursOn(event, event.date) && event.date >= from ? event.date : null;
  let k = from < event.date ? event.date : from;
  for (let i = 0; i < horizonDays; i++) {
    if (r.until && k > r.until) return null;
    if (occursOn(event, k)) return k;
    k = addDays(k, 1);
  }
  return null;
}

/** Date object for an occurrence; all-day events use `defaultTime` ('HH:MM'). */
export function occurrenceDateTime(event, key, defaultTime = '09:00') {
  return atTime(key, event.time || defaultTime);
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeRepeat(repeat, startKey) {
  const r = normalizeRepeat(repeat);
  const n = r.interval;
  let s;
  switch (r.type) {
    case 'none':
      return 'One time';
    case 'daily':
      s = n === 1 ? 'Every day' : `Every ${n} days`;
      break;
    case 'weekly': {
      const days = r.weekdays.length ? r.weekdays : startKey ? [weekday(startKey)] : [];
      const key = days.join(',');
      const list = key === '1,2,3,4,5' ? 'weekdays' : key === '0,6' ? 'weekends' : key === '0,1,2,3,4,5,6' ? 'every day' : days.map((d) => WD[d]).join(', ');
      if (n === 1) s = key === '1,2,3,4,5' ? 'Every weekday' : key === '0,1,2,3,4,5,6' ? 'Every day' : `Weekly on ${list}`;
      else s = `Every ${n} weeks on ${list}`;
      break;
    }
    case 'monthly':
      s = n === 1 ? 'Monthly' : `Every ${n} months`;
      break;
    case 'yearly':
      s = n === 1 ? 'Yearly' : `Every ${n} years`;
      break;
    default:
      s = '';
  }
  if (r.until) s += ` until ${r.until}`;
  return s;
}
