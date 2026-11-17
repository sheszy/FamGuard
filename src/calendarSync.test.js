import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarIcs, googleCalendarUrl } from './calendarSync.js';

test('exports all-day recurring events with escaped text and a one-day exclusive end', () => {
  const ics = buildCalendarIcs([{
    id: 'birthday-1',
    title: 'Jane, Doe; birthday',
    date: '2026-06-12',
    type: 'birthday',
    personName: 'Jane Doe',
    recurring: true,
    description: 'Cake, candles; family',
    location: 'Home'
  }], new Date('2026-01-02T03:04:05.000Z'));

  assert.match(ics, /DTSTART;VALUE=DATE:20260612/);
  assert.match(ics, /DTEND;VALUE=DATE:20260613/);
  assert.match(ics, /SUMMARY:Jane\\, Doe\\; birthday/);
  assert.match(ics, /DESCRIPTION:Cake\\, candles\\; family/);
  assert.match(ics, /RRULE:FREQ=YEARLY/);
});

test('exports timed events with an explicit end and safe Google Calendar fields', () => {
  const event = {
    id: 'dinner',
    title: 'Dinner & plans',
    date: '2026-11-18',
    time: '18:30',
    endTime: '20:00',
    description: 'Bring dessert',
    location: 'Family home'
  };
  const ics = buildCalendarIcs([event]);
  const googleUrl = new URL(googleCalendarUrl(event));

  assert.match(ics, /DTSTART:20261118T183000/);
  assert.match(ics, /DTEND:20261118T200000/);
  assert.equal(googleUrl.searchParams.get('dates'), '20261118T183000/20261118T200000');
  assert.equal(googleUrl.searchParams.get('location'), 'Family home');
});

test('rejects invalid event dates instead of producing malformed calendar files', () => {
  assert.throws(() => buildCalendarIcs([{ title: 'Broken', date: '2026-02-30' }]), /invalid date/i);
});
