/**
 * habits.js — habit scheduling, streaks and completion stats.
 */
import { addDays, weekday } from './dates.js';

/** Is the habit scheduled on this day of the week? */
export function isScheduled(habit, key) {
  if (habit.archived) return false;
  if (habit.createdAt && key < habit.createdAt.slice(0, 10)) return false;
  const days = habit.days && habit.days.length ? habit.days : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(weekday(key));
}

export function isDone(log, habitId, key) {
  return Boolean(log[key] && log[key][habitId]);
}

/**
 * Current streak in scheduled days. If today is scheduled but not done yet,
 * the streak counts from yesterday so it doesn't drop to zero mid-day.
 */
export function streak(habit, log, today) {
  let k = today;
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    if (isScheduled(habit, k)) {
      if (isDone(log, habit.id, k)) count++;
      else if (k !== today) break; // a miss on a past scheduled day ends the streak
    }
    if (habit.createdAt && k <= habit.createdAt.slice(0, 10)) break;
    k = addDays(k, -1);
  }
  return count;
}

/** { done, scheduled, rate } over the last N days ending today. */
export function completion(habit, log, today, days = 30) {
  let done = 0;
  let scheduled = 0;
  for (let i = 0; i < days; i++) {
    const k = addDays(today, -i);
    if (!isScheduled(habit, k)) continue;
    scheduled++;
    if (isDone(log, habit.id, k)) done++;
  }
  return { done, scheduled, rate: scheduled ? done / scheduled : 0 };
}

export function habitsForDay(habits, key) {
  return habits.filter((h) => isScheduled(h, key));
}

export function dayProgress(habits, log, key) {
  const list = habitsForDay(habits, key);
  const done = list.filter((h) => isDone(log, h.id, key)).length;
  return { done, total: list.length, ratio: list.length ? done / list.length : 0 };
}
