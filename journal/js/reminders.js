/**
 * reminders.js — reminder option 1: notifications.
 *
 * Browser reality check: without a push server, a web page can only show a
 * notification while it is open (foreground tab, or an installed PWA that is
 * running). This module schedules those in-page notifications, and is
 * structured so that a Web Push / native (Capacitor) backend can plug in
 * later by replacing `notify()` and moving `dueReminders()` server-side.
 */
import { addDays, todayKey } from './dates.js';
import { occurrencesBetween, occurrenceDateTime } from './recur.js';

export const LEAD_OPTIONS = [
  { minutes: 0, label: 'At time of event' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 60 * 24, label: '1 day before' },
  { minutes: 60 * 48, label: '2 days before' },
  { minutes: 60 * 24 * 7, label: '1 week before' },
];

export function leadLabel(minutes) {
  const o = LEAD_OPTIONS.find((x) => x.minutes === Number(minutes));
  return o ? o.label : `${minutes} minutes before`;
}

export function supported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState() {
  if (!supported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    // Safari's callback-style API
    return new Promise((resolve) => Notification.requestPermission(resolve));
  }
}

/** Show a notification through the service worker when possible. */
export async function notify(title, options = {}) {
  if (permissionState() !== 'granted') return false;
  const opts = { icon: './icons/icon-192.png', badge: './icons/icon-192.png', ...options };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, opts);
        return true;
      }
    }
    new Notification(title, opts);
    return true;
  } catch (err) {
    console.warn('Notification failed', err);
    return false;
  }
}

/** When should the reminder for this occurrence fire? */
export function fireTime(event, key, settings) {
  const when = occurrenceDateTime(event, key, settings.allDayReminderTime || '09:00');
  const lead = Number((event.reminders && event.reminders.push && event.reminders.push.leadMinutes) ?? 0);
  return new Date(when.getTime() - lead * 60000);
}

export function reminderKey(eventId, key) {
  return `${eventId}|${key}`;
}

/**
 * Reminders whose fire time has passed but that haven't fired yet.
 * We ignore anything more than `staleHours` old so reopening the app after
 * a week doesn't produce a flood of stale alerts.
 */
export function dueReminders(state, now = new Date(), staleHours = 12) {
  const out = [];
  const today = todayKey(now);
  const from = addDays(today, -8); // covers "1 week before" leads that were set late
  const to = addDays(today, 8);
  for (const ev of state.events) {
    const push = ev.reminders && ev.reminders.push;
    if (!push || !push.enabled) continue;
    for (const key of occurrencesBetween(ev, from, to)) {
      if (ev.completed && ev.completed[key]) continue;
      const rk = reminderKey(ev.id, key);
      if (state.notified[rk]) continue;
      const at = fireTime(ev, key, state.settings);
      const ageMs = now - at;
      if (ageMs >= 0 && ageMs <= staleHours * 3600000) out.push({ event: ev, key, at, rk });
    }
  }
  return out;
}

/** Daily habit nudge, once per day at settings.habitReminder.time. */
export function habitReminderDue(state, now = new Date()) {
  const hr = state.settings.habitReminder;
  if (!hr || !hr.enabled) return null;
  const today = todayKey(now);
  const rk = `habits|${today}`;
  if (state.notified[rk]) return null;
  const [h, m] = (hr.time || '08:00').split(':').map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  const age = now - at;
  if (age < 0 || age > 12 * 3600000) return null;
  return { rk, at };
}

/**
 * Start polling. `getState` returns current state; `markNotified(rk)` persists
 * that a reminder fired; `buildHabitBody()` returns text for the habit nudge.
 */
export function startScheduler({ getState, markNotified, buildHabitBody, intervalMs = 30000 }) {
  let timer = null;
  const tick = async () => {
    const state = getState();
    if (permissionState() !== 'granted') return;
    for (const due of dueReminders(state)) {
      const ev = due.event;
      const time = ev.time ? ` at ${formatClock(ev.time)}` : '';
      const who = ev.from ? ` · for ${ev.from}` : '';
      const ok = await notify(ev.title, {
        body: `${due.key === todayKey() ? 'Today' : due.key}${time}${who}`,
        tag: due.rk,
        data: { url: './index.html#events', eventId: ev.id, key: due.key },
      });
      if (ok) markNotified(due.rk);
    }
    const hd = habitReminderDue(state);
    if (hd) {
      const ok = await notify('Daily habits', {
        body: buildHabitBody ? buildHabitBody(state) : 'Time to check in on your habits.',
        tag: hd.rk,
        data: { url: './index.html#today' },
      });
      if (ok) markNotified(hd.rk);
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  return () => clearInterval(timer);
}

function formatClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
