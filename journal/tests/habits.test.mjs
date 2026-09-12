import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streak, completion, isScheduled, dayProgress } from '../js/habits.js';

const habit = { id: 'h1', name: 'Read', days: [], createdAt: '2026-08-01T00:00:00.000Z' };
const log = (keys) => Object.fromEntries(keys.map((k) => [k, { h1: true }]));

test('streak counts back from today, today may be pending', () => {
  const l = log(['2026-09-09', '2026-09-10', '2026-09-11']);
  assert.equal(streak(habit, l, '2026-09-12'), 3); // today not done yet
  l['2026-09-12'] = { h1: true };
  assert.equal(streak(habit, l, '2026-09-12'), 4);
});

test('a missed past day breaks the streak', () => {
  const l = log(['2026-09-08', '2026-09-09', '2026-09-11']);
  assert.equal(streak(habit, l, '2026-09-12'), 1);
});

test('unscheduled days do not break the streak', () => {
  const weekdaysOnly = { ...habit, days: [1, 2, 3, 4, 5] };
  // Fri 11th and Thu 10th done; Sat 12th and Sun 13th not scheduled; Mon 14th is today (pending)
  const l = log(['2026-09-10', '2026-09-11']);
  assert.equal(isScheduled(weekdaysOnly, '2026-09-12'), false);
  assert.equal(streak(weekdaysOnly, l, '2026-09-14'), 2);
});

test('completion rate and day progress', () => {
  const l = log(['2026-09-10', '2026-09-11', '2026-09-12']);
  const c = completion(habit, l, '2026-09-12', 6);
  assert.equal(c.scheduled, 6);
  assert.equal(c.done, 3);
  const p = dayProgress([habit, { id: 'h2', name: 'Run', days: [] }], l, '2026-09-12');
  assert.deepEqual(p, { done: 1, total: 2, ratio: 0.5 });
});

test('habit is not scheduled before it was created', () => {
  assert.equal(isScheduled(habit, '2026-07-31'), false);
  assert.equal(isScheduled(habit, '2026-08-01'), true);
});
