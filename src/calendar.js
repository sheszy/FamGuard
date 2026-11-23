function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && !field) {
      quoted = true;
    } else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('The CSV has an unfinished quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseContactDate(value, defaultYear) {
  const input = value.trim();
  let year;
  let month;
  let day;
  let match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    [, year, month, day] = match;
  } else {
    match = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (!match) return null;
    [, month, day] = match;
    year = match[3] || String(defaultYear);
  }

  year = Number(year);
  month = Number(month);
  day = Number(day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const HEADER_ALIASES = {
  name: ['name', 'contact', 'full name', 'contact name'],
  birthday: ['birthday', 'birth date', 'birthdate', 'date of birth', 'dob'],
  anniversary: ['anniversary', 'anniversary date', 'wedding anniversary']
};

function findHeader(headers, aliases) {
  return headers.findIndex(header => aliases.includes(header.toLowerCase().replace(/[_-]+/g, ' ').trim()));
}

export function parseKeyDatesCsv(text, defaultYear = new Date().getFullYear()) {
  if (typeof text !== 'string' || text.length > 1_000_000) {
    throw new Error('Choose a CSV file smaller than 1 MB.');
  }

  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one contact.');

  const headers = rows[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, '') : header);
  const nameColumn = findHeader(headers, HEADER_ALIASES.name);
  const birthdayColumn = findHeader(headers, HEADER_ALIASES.birthday);
  const anniversaryColumn = findHeader(headers, HEADER_ALIASES.anniversary);
  if (nameColumn === -1 || (birthdayColumn === -1 && anniversaryColumn === -1)) {
    throw new Error('Use columns named Name, Birthday, and/or Anniversary.');
  }

  const events = [];
  const seen = new Set();
  let skippedRows = 0;

  for (const row of rows.slice(1)) {
    const personName = row[nameColumn]?.trim();
    if (!personName) {
      skippedRows += 1;
      continue;
    }

    let imported = 0;
    for (const [type, column] of [['birthday', birthdayColumn], ['anniversary', anniversaryColumn]]) {
      const value = column === -1 ? '' : row[column] || '';
      if (!value.trim()) continue;
      const date = parseContactDate(value, defaultYear);
      if (!date) continue;

      const eventKey = `${personName.toLocaleLowerCase()}|${type}|${date.slice(5)}`;
      if (!seen.has(eventKey)) {
        seen.add(eventKey);
        events.push({
          title: type === 'birthday' ? `${personName}'s birthday` : `${personName}'s anniversary`,
          date,
          type,
          recurring: true,
          personName
        });
      }
      imported += 1;
    }
    if (!imported) skippedRows += 1;
  }

  if (!events.length) throw new Error('No valid birthday or anniversary dates were found.');
  return { events, skippedRows };
}

function toDateKey(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function rescheduleDate(value, amount, unit) {
  const dateKey = toDateKey(value);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error('Choose a valid calendar date before rescheduling.');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('Choose a valid calendar date before rescheduling.');
  }
  if (!Number.isInteger(amount) || amount < 1 || !['week', 'month'].includes(unit)) {
    throw new Error('Choose a valid reschedule interval.');
  }

  if (unit === 'week') {
    date.setDate(date.getDate() + amount * 7);
  } else {
    const targetMonth = date.getMonth() + amount;
    const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
    date.setDate(1);
    date.setMonth(targetMonth);
    date.setDate(Math.min(day, lastDay));
  }
  return toDateKey(date);
}

export function findVacantDate(events, tasks, startDate = new Date(), horizonDays = 90, excludeTaskId = null) {
  const firstDay = toDateKey(startDate);
  if (!firstDay || !Number.isInteger(horizonDays) || horizonDays < 1) return null;
  const [year, month, day] = firstDay.split('-').map(Number);
  const start = Date.UTC(year, month - 1, day);

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = new Date(start + offset * 86_400_000);
    const candidate = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const isBusy = events.some(event => {
      const eventDate = toDateKey(event.date);
      return eventDate && (event.recurring ? eventDate.slice(5) === candidate.slice(5) : eventDate === candidate);
    }) || tasks.some(task => task.id !== excludeTaskId && !task.done && toDateKey(task.scheduledFor) === candidate);

    if (!isBusy) return candidate;
  }

  return null;
}
