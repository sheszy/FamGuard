import { supabase } from '../supabaseClient.js';

const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function normalizeDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) throw new Error('The calendar event has an invalid date.');
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('The calendar event has an invalid date.');
  return value;
}

function normalizeTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value || '');
  if (!match) throw new Error('The calendar event has an invalid start or end time.');
  return `${match[1]}:${match[2]}:${match[3] || '00'}`;
}

function nextDate(value) {
  const next = new Date(`${normalizeDate(value)}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function dateTimeFields(date, time, timeZone) {
  const normalizedDate = normalizeDate(date);
  const normalizedTime = normalizeTime(time);
  const local = new Date(`${normalizedDate}T${normalizedTime}`);
  if (!Number.isFinite(local.getTime())
    || local.getFullYear() !== Number(normalizedDate.slice(0, 4))
    || local.getMonth() + 1 !== Number(normalizedDate.slice(5, 7))
    || local.getDate() !== Number(normalizedDate.slice(8, 10))
    || local.getHours() !== Number(normalizedTime.slice(0, 2))
    || local.getMinutes() !== Number(normalizedTime.slice(3, 5))) {
    throw new Error('The calendar event has an invalid local start or end time.');
  }
  return {
    dateTime: `${normalizedDate}T${normalizedTime}`,
    local,
    timeZone
  };
}

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function instantDateTime(value) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error('The calendar event has an invalid start or end time.');
  return { dateTime: instant.toISOString(), instant };
}

export function buildGoogleCalendarPayload(event, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  const date = normalizeDate(event.date || event.event_date);
  const startValue = event.start_time || event.startTime || event.time || event.event_time;
  const endValue = event.end_time || event.endTime || event.event_end_time;
  const payload = {
    summary: event.title || 'Family event',
    description: event.description || event.event_description || '',
    location: event.location || event.event_location || ''
  };
  if (event.recurring) payload.recurrence = ['RRULE:FREQ=YEARLY'];

  if (!startValue) {
    payload.start = { date };
    payload.end = { date: nextDate(date) };
    return payload;
  }

  const start = startValue.includes('T')
    ? instantDateTime(startValue)
    : dateTimeFields(date, startValue, timeZone);
  payload.start = start.timeZone
    ? { dateTime: start.dateTime, timeZone: start.timeZone }
    : { dateTime: start.dateTime };

  if (!endValue) {
    if (start.local) {
      const end = new Date(start.local.getTime() + 60 * 60 * 1000);
      payload.end = { dateTime: formatLocalDateTime(end), timeZone };
    } else {
      payload.end = { dateTime: new Date(start.instant.getTime() + 60 * 60 * 1000).toISOString() };
    }
    return payload;
  }

  const end = endValue.includes('T')
    ? instantDateTime(endValue)
    : dateTimeFields(date, endValue, timeZone);
  if (start.local && end.local && end.local <= start.local) end.local.setDate(end.local.getDate() + 1);
  if (start.instant && end.instant && end.instant <= start.instant) {
    end.instant.setTime(end.instant.getTime() + 24 * 60 * 60 * 1000);
  }
  payload.end = end.local
    ? { dateTime: formatLocalDateTime(end.local), timeZone }
    : { dateTime: end.instant.toISOString() };
  return payload;
}

export async function syncEventToGoogleCalendar(event, { client = supabase, fetchImpl = fetch } = {}) {
  if (!client) throw new Error('Google Calendar sync requires FamGuard Supabase configuration.');
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`Could not read the active Supabase session: ${error.message}`);

  const providerToken = data.session?.provider_token;
  if (!providerToken) {
    throw new Error('No Google Calendar access token is available. Sign out and sign in with Google again to grant Calendar access.');
  }

  const response = await fetchImpl(CALENDAR_EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildGoogleCalendarPayload(event))
  });
  let result;
  const responseText = await response.text();
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      result = null;
    }
  }
  if (!response.ok) {
    const message = result?.error?.message || result?.error_description || responseText || `Google Calendar returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return result;
}
