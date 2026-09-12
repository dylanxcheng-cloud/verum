import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occursOn, occurrencesBetween, nextOccurrence, describeRepeat } from '../js/recur.js';
import { diffDays, addDays, addMonths, weekday } from '../js/dates.js';

const ev = (over) => ({ id: 'e', title: 't', date: '2026-09-12', time: '10:00', repeat: { type: 'none' }, ...over });

test('dates helpers', () => {
  assert.equal(diffDays('2026-09-12', '2026-09-15'), 3);
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(weekday('2026-09-12'), 6); // Saturday
});

test('one-time event occurs once', () => {
  const e = ev();
  assert.equal(occursOn(e, '2026-09-12'), true);
  assert.equal(occursOn(e, '2026-09-13'), false);
  assert.deepEqual(occurrencesBetween(e, '2026-09-01', '2026-09-30'), ['2026-09-12']);
  assert.equal(nextOccurrence(e, '2026-09-13'), null);
});

test('daily with interval', () => {
  const e = ev({ repeat: { type: 'daily', interval: 3 } });
  assert.deepEqual(occurrencesBetween(e, '2026-09-10', '2026-09-20'), ['2026-09-12', '2026-09-15', '2026-09-18']);
});

test('weekly on chosen weekdays, biweekly', () => {
  const e = ev({ repeat: { type: 'weekly', interval: 2, weekdays: [1, 3] } }); // Mon, Wed
  // Start is Sat 2026-09-12 (week of Sep 6). Next week's Mon/Wed are 1 week away → skipped; week after → included.
  assert.deepEqual(occurrencesBetween(e, '2026-09-12', '2026-10-01'), ['2026-09-21', '2026-09-23']);
});

test('weekly defaults to start weekday', () => {
  const e = ev({ repeat: { type: 'weekly' } });
  assert.deepEqual(occurrencesBetween(e, '2026-09-12', '2026-09-27'), ['2026-09-12', '2026-09-19', '2026-09-26']);
  assert.equal(describeRepeat(e.repeat, e.date), 'Weekly on Sat');
  assert.equal(describeRepeat({ type: 'weekly', weekdays: [1, 2, 3, 4, 5] }), 'Every weekday');
  assert.equal(describeRepeat({ type: 'weekly', interval: 2, weekdays: [0, 6] }), 'Every 2 weeks on weekends');
});

test('monthly clamps to short months', () => {
  const e = ev({ date: '2026-01-31', repeat: { type: 'monthly' } });
  assert.equal(occursOn(e, '2026-02-28'), true);
  assert.equal(occursOn(e, '2026-03-31'), true);
  assert.equal(occursOn(e, '2026-03-30'), false);
  assert.equal(occursOn(e, '2026-04-30'), true);
});

test('yearly and until', () => {
  const e = ev({ date: '2024-02-29', repeat: { type: 'yearly', until: '2028-12-31' } });
  assert.equal(occursOn(e, '2025-02-28'), true);
  assert.equal(occursOn(e, '2028-02-29'), true);
  assert.equal(occursOn(e, '2029-02-28'), false);
  assert.equal(describeRepeat(e.repeat), 'Yearly until 2028-12-31');
});

test('skipped occurrences are excluded and nextOccurrence skips them', () => {
  const e = ev({ repeat: { type: 'daily' }, skipped: { '2026-09-13': true } });
  assert.deepEqual(occurrencesBetween(e, '2026-09-12', '2026-09-14'), ['2026-09-12', '2026-09-14']);
  assert.equal(nextOccurrence(e, '2026-09-13'), '2026-09-14');
});

test('occurrences never precede the start date', () => {
  const e = ev({ repeat: { type: 'daily' } });
  assert.deepEqual(occurrencesBetween(e, '2026-09-01', '2026-09-12'), ['2026-09-12']);
});
