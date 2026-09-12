import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toICS, rruleFor } from '../js/ics.js';

test('rrule generation', () => {
  assert.equal(rruleFor({ repeat: { type: 'none' } }), null);
  assert.equal(rruleFor({ repeat: { type: 'weekly', interval: 2, weekdays: [1, 3], until: '2026-12-31' } }), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T235959');
});

test('ics contains alarm and escaped text', () => {
  const ics = toICS({
    id: 'abc', title: 'Send report; final, v2', from: 'Maria', date: '2026-09-12', time: '10:00',
    repeat: { type: 'none' }, reminders: { push: { enabled: true, leadMinutes: 30 } }, skipped: {},
  });
  assert.match(ics, /DTSTART:20260912T100000/);
  assert.match(ics, /DTEND:20260912T103000/);
  assert.match(ics, /SUMMARY:Send report\; final\\, v2/);
  assert.match(ics, /TRIGGER:-PT30M/);
  assert.match(ics, /Asked by: Maria/);
});

test('all-day event uses DATE values', () => {
  const ics = toICS({ id: 'x', title: 'Rent', date: '2026-10-01', time: null, repeat: { type: 'monthly' }, skipped: { '2026-11-01': true } });
  assert.match(ics, /DTSTART;VALUE=DATE:20261001/);
  assert.match(ics, /RRULE:FREQ=MONTHLY/);
  assert.match(ics, /EXDATE;VALUE=DATE:20261101/);
});
