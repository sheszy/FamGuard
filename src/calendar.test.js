import test from 'node:test';
import assert from 'node:assert/strict';
import { findVacantDate, parseKeyDatesCsv } from './calendar.js';

test('imports recurring dates from quoted contact names and common date formats', () => {
  const result = parseKeyDatesCsv(
    'Name,Birthday,Anniversary\r\n"Doe, Jane",1990-05-04,6/12\r\nAlex,,11/2/2024',
    2026
  );

  assert.deepEqual(result.events.map(event => [event.title, event.date, event.type]), [
    ["Doe, Jane's birthday", '1990-05-04', 'birthday'],
    ["Doe, Jane's anniversary", '2026-06-12', 'anniversary'],
    ["Alex's anniversary", '2024-11-02', 'anniversary']
  ]);
  assert.equal(result.events.every(event => event.recurring), true);
  assert.equal(result.skippedRows, 0);
});

test('rejects invalid CSV headers and malformed dates instead of inventing events', () => {
  assert.throws(() => parseKeyDatesCsv('Person,Phone\nAlex,123'), /Use columns named/);
  assert.throws(() => parseKeyDatesCsv('Name,Birthday\nAlex,2/30/2026'), /No valid/);
  assert.throws(() => parseKeyDatesCsv('Name,Birthday\n"Alex,2/3'), /unfinished quoted/);
});

test('finds the first day without a recurring event or another scheduled task', () => {
  const result = findVacantDate(
    [{ date: '1990-05-04', recurring: true }],
    [{ id: 'existing', scheduledFor: '2026-05-05', done: false }],
    '2026-05-04',
    4
  );

  assert.equal(result, '2026-05-06');
});

test('ignores the task being rescheduled and returns null when every date is busy', () => {
  assert.equal(
    findVacantDate([], [{ id: 'move-me', scheduledFor: '2026-05-04', done: false }], '2026-05-04', 1, 'move-me'),
    '2026-05-04'
  );
  assert.equal(
    findVacantDate([], [{ id: 'stay', scheduledFor: '2026-05-04', done: false }], '2026-05-04', 1, 'move-me'),
    null
  );
});
