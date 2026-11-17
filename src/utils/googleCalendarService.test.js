import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleCalendarPayload,
  syncEventToGoogleCalendar
} from './googleCalendarService.js';

test('builds a timed calendar event and defaults a missing end time to one hour', () => {
  const payload = buildGoogleCalendarPayload({
    title: 'Family dinner',
    date: '2026-06-12',
    time: '18:30',
    description: 'Bring dessert',
    location: 'Home'
  }, 'Asia/Manila');

  assert.deepEqual(payload.start, {
    dateTime: '2026-06-12T18:30:00',
    timeZone: 'Asia/Manila'
  });
  assert.deepEqual(payload.end, {
    dateTime: '2026-06-12T19:30:00',
    timeZone: 'Asia/Manila'
  });
  assert.equal(payload.summary, 'Family dinner');
  assert.equal(payload.description, 'Bring dessert');
  assert.equal(payload.location, 'Home');
});

test('supports all-day and overnight events using database field names', () => {
  const allDay = buildGoogleCalendarPayload({
    title: 'Birthday',
    event_date: '2026-12-31',
    event_description: 'Celebrate together',
    event_location: 'Family home',
    recurring: true
  }, 'Asia/Manila');
  assert.deepEqual(allDay.start, { date: '2026-12-31' });
  assert.deepEqual(allDay.end, { date: '2027-01-01' });
  assert.deepEqual(allDay.recurrence, ['RRULE:FREQ=YEARLY']);

  const overnight = buildGoogleCalendarPayload({
    title: 'Late event',
    event_date: '2026-06-12',
    start_time: '23:30:00',
    end_time: '00:30:00'
  }, 'Asia/Manila');
  assert.deepEqual(overnight.end, {
    dateTime: '2026-06-13T00:30:00',
    timeZone: 'Asia/Manila'
  });
});

test('posts the event with the active Google provider token', async () => {
  let requestUrl;
  let requestOptions;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { provider_token: 'google-access-token' } },
        error: null
      })
    }
  };
  const result = await syncEventToGoogleCalendar({
    title: 'School pickup',
    date: '2026-06-12',
    time: '15:00'
  }, {
    client,
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ id: 'google-event-id' }), { status: 200 });
    }
  });

  assert.equal(requestUrl, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.headers.Authorization, 'Bearer google-access-token');
  assert.equal(JSON.parse(requestOptions.body).summary, 'School pickup');
  assert.deepEqual(result, { id: 'google-event-id' });
});

test('reports missing tokens and Google API errors', async () => {
  const missingTokenClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null })
    }
  };
  await assert.rejects(
    syncEventToGoogleCalendar({ title: 'Event', date: '2026-06-12' }, { client: missingTokenClient }),
    /sign in with Google/i
  );

  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { provider_token: 'google-access-token' } },
        error: null
      })
    }
  };
  await assert.rejects(
    syncEventToGoogleCalendar({ title: 'Event', date: '2026-06-12' }, {
      client,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Calendar access denied' } }), { status: 403 })
    }),
    /Calendar access denied/
  );
});
