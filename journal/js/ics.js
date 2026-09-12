/**
 * ics.js — export an event (with its recurrence and alarm) as an iCalendar
 * file. Importing this into the phone's calendar gives real, background
 * reminders today, before native push exists.
 */
import { normalizeRepeat } from './recur.js';

const pad = (n) => String(n).padStart(2, '0');
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function escapeText(s = '') {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dtLocal(key, hhmm) {
  const [h, m] = (hhmm || '00:00').split(':');
  return key.replace(/-/g, '') + 'T' + pad(h) + pad(m) + '00';
}

function dtStamp() {
  const d = new Date();
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

export function rruleFor(event) {
  const r = normalizeRepeat(event.repeat);
  if (r.type === 'none') return null;
  const parts = [];
  const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[r.type];
  parts.push(`FREQ=${freq}`);
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.type === 'weekly' && r.weekdays.length) parts.push(`BYDAY=${r.weekdays.map((d) => BYDAY[d]).join(',')}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959`);
  return parts.join(';');
}

export function toICS(event, settings = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daybook//Journal//EN', 'BEGIN:VEVENT'];
  lines.push(`UID:${event.id}@daybook`);
  lines.push(`DTSTAMP:${dtStamp()}`);
  if (event.time) {
    lines.push(`DTSTART:${dtLocal(event.date, event.time)}`);
    const [h, m] = event.time.split(':').map(Number);
    const end = new Date(2000, 0, 1, h, m + 30);
    lines.push(`DTEND:${dtLocal(event.date, `${pad(end.getHours())}:${pad(end.getMinutes())}`)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`);
  }
  const rrule = rruleFor(event);
  if (rrule) lines.push(`RRULE:${rrule}`);
  const skipped = Object.keys(event.skipped || {});
  if (skipped.length) {
    const ex = skipped.map((k) => (event.time ? dtLocal(k, event.time) : k.replace(/-/g, ''))).join(',');
    lines.push(event.time ? `EXDATE:${ex}` : `EXDATE;VALUE=DATE:${ex}`);
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  const desc = [event.from ? `Asked by: ${event.from}` : '', event.notes || ''].filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
  const push = event.reminders && event.reminders.push;
  if (push && push.enabled) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.title)}`);
    lines.push(`TRIGGER:-PT${Number(push.leadMinutes) || 0}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  void settings;
  return lines.join('\r\n') + '\r\n';
}

export function downloadICS(event, settings) {
  const blob = new Blob([toICS(event, settings)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(event.title || 'event').replace(/[^\w\- ]+/g, '').trim() || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
