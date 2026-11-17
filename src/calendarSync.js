function normalizeDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) throw new Error('Calendar event has an invalid date.');
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('Calendar event has an invalid date.');
  return value;
}

function nextDate(value) {
  const date = new Date(`${normalizeDate(value)}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function formatLocalDateTime(date, time) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw new Error('Calendar event has an invalid start time.');
  return `${normalizeDate(date).replaceAll('-', '')}T${time.replace(':', '')}00`;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line) {
  let folded = '';
  let byteLength = 0;
  for (const character of line) {
    const characterLength = new TextEncoder().encode(character).length;
    if (byteLength + characterLength > 75) {
      folded += '\r\n ';
      byteLength = 1;
    }
    folded += character;
    byteLength += characterLength;
  }
  return folded;
}

function timedEnd(date, startTime, endTime) {
  const start = new Date(`${normalizeDate(date)}T${startTime}:00`);
  if (!Number.isFinite(start.getTime())) throw new Error('Calendar event has an invalid start time.');
  let end;
  if (endTime) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error('Calendar event has an invalid end time.');
    end = new Date(`${normalizeDate(date)}T${endTime}:00`);
    if (end <= start) end.setDate(end.getDate() + 1);
  } else {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  const endDate = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`;
  const endClock = `${String(end.getHours()).padStart(2, '0')}${String(end.getMinutes()).padStart(2, '0')}00`;
  return `${endDate}T${endClock}`;
}

function eventDateLines(event) {
  const date = normalizeDate(event.date);
  if (!event.time) {
    return [
      `DTSTART;VALUE=DATE:${date.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${nextDate(date)}`
    ];
  }
  return [
    `DTSTART:${formatLocalDateTime(date, event.time)}`,
    `DTEND:${timedEnd(date, event.time, event.endTime)}`
  ];
}

export function buildCalendarIcs(events, now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamGuard//Family Calendar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:FamGuard'
  ];

  events.forEach((event, index) => {
    const uid = `${event.id || `famguard-${index}-${normalizeDate(event.date)}`}@famguard.app`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(uid)}`,
      `DTSTAMP:${timestamp}`,
      ...eventDateLines(event),
      `SUMMARY:${escapeIcsText(event.title || 'Family event')}`,
      `DESCRIPTION:${escapeIcsText(event.description || (event.personName ? `${event.personName} · ${event.type || 'family event'}` : ''))}`,
      `LOCATION:${escapeIcsText(event.location || '')}`
    );
    if (event.recurring) lines.push('RRULE:FREQ=YEARLY');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function googleCalendarUrl(event) {
  const date = normalizeDate(event.date);
  const start = event.time
    ? formatLocalDateTime(date, event.time)
    : date.replaceAll('-', '');
  const end = event.time
    ? timedEnd(date, event.time, event.endTime)
    : nextDate(date);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Family event',
    dates: `${start}/${end}`,
    details: event.description || (event.personName ? `${event.personName} · ${event.type || 'family event'}` : ''),
    location: event.location || ''
  });
  if (event.recurring) params.set('recur', 'RRULE:FREQ=YEARLY');
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function downloadCalendarIcs(events, filename = 'famguard-calendar.ics') {
  const blob = new Blob([buildCalendarIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
