/**
 * CSV in and out.
 *
 * Everyone's pipeline starts in a spreadsheet, so this is the migration
 * path: a tolerant parser (quotes, embedded newlines, comma / semicolon /
 * tab files, a stray BOM), column specs shared by export and import, and
 * loose coercion for the way humans actually type money and dates.
 *
 * Pure string and object work - the store owns the merge.
 */

import { todayISO, isValidISODate } from './util.js';
import { CONTACT_STATUSES, activityTypeInfo } from './statuses.js';
import { STAGES } from './forecast.js';
import { repeatLabel } from './repeat.js';
import {
  BILLING_MODES, billingLabel, contractValue, isRecurring, mrrOf, normalizeTerm,
} from './recurring.js';
import { coerceFieldValue, fieldValue, formatFieldValue, isBlankValue } from './fields.js';

/* ---------- parse / serialize ---------- */

/**
 * Pick the delimiter the header row actually uses.
 *
 * Only separators outside quotes count. A header like `"Last, First";Email`
 * is one comma and one semicolon to a quote-blind tally, and the tie went
 * to the comma - so a European semicolon file parsed as a single column and
 * the mapping step was handed one nonsense header instead of a table.
 * Scanning by quote state also means a header cell may span lines.
 */
export function detectDelimiter(text) {
  const input = String(text ?? '').replace(/^﻿/, '');
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      started = true;
      if (quoted && input[i + 1] === '"') i++;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === '\n' || c === '\r') {
      if (started) break;                      // the header row ends here
      continue;                                // blank lines before it don't
    }
    started = true;
    if (counts[c] !== undefined) counts[c]++;
  }
  return [',', ';', '\t'].reduce((best, ch) => (counts[ch] > counts[best] ? ch : best), ',');
}

/**
 * CSV text → array of string rows. Handles quoted fields with embedded
 * delimiters, newlines, and doubled quotes; drops entirely blank lines.
 */
export function parseCSV(text, delimiter = null) {
  const input = String(text ?? '').replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(input);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;

  const endField = () => { row.push(field); field = ''; started = true; };
  const endRow = () => {
    endField();
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') { quoted = true; started = true; continue; }
    if (c === sep) { endField(); continue; }
    if (c === '\n') { endRow(); continue; }
    // A CR is half of a CRLF pair - unless nothing follows it, which is how
    // classic-Mac and some legacy exporters end a row. Dropping those made
    // every row of such a file fuse into one: the last cell of each row
    // ran into the first cell of the next, and the header came out as junk.
    if (c === '\r') {
      if (input[i + 1] !== '\n') endRow();
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length || started) endRow();
  return rows;
}

const needsQuotes = (value, sep) =>
  value.includes(sep) || value.includes('"') || /[\n\r]/.test(value) || value !== value.trim();

/** Array of rows → CSV text, quoting only what needs it. */
export function toCSV(rows, sep = ',') {
  return rows
    .map((row) => row
      .map((cell) => {
        const value = cell === null || cell === undefined ? '' : String(cell);
        return needsQuotes(value, sep) ? `"${value.replace(/"/g, '""')}"` : value;
      })
      .join(sep))
    .join('\r\n');
}

/* ---------- spreadsheet formula guard ----------
   To Excel, Sheets, and LibreOffice a cell starting with = + - @ (or a tab
   or carriage return) is a formula, and the DDE flavour of that runs
   commands on whatever machine opens the file. Imported rows are not our
   data - a bought lead list can carry one in a Notes column - so an export
   would hand the payload straight back with a spreadsheet icon on it.

   Prefix on the way out, strip the same prefix on the way back in, so a
   round trip through this app stays lossless. Plain numbers are left alone
   or every negative amount would export as text. */

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

/** Neutralize a cell that a spreadsheet would read as a formula. */
export function guardFormula(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/** Undo guardFormula; leaves an apostrophe that isn't guarding anything. */
export function unguardFormula(text) {
  return text.startsWith("'") && FORMULA_LEAD.test(text.slice(1)) ? text.slice(1) : text;
}

/* ---------- value coercion ---------- */

/** "$12,500.50" / "12 500" / "(1,200)" → a number. */
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  // Accounting exports put the sign where they like: "(1,200)", "-$1,200",
  // "$-1,200.00" (QuickBooks, Excel's currency formats), "1.200,00-" (SAP).
  // Only a leading minus used to count, so the symbol in front of one hid
  // it and a credit imported as a positive deal - the opposite of its value.
  const negative = /^\(.*\)$/.test(raw) || /^[^\d]*-/.test(raw) || raw.endsWith('-');
  const digits = raw.replace(/[^\d.,]/g, '');
  // A trailing comma group of one or two digits is a decimal comma
  // (1.234,50); anything else makes commas thousands separators.
  const decimalComma = digits.lastIndexOf(',') > digits.lastIndexOf('.') && /,\d{1,2}$/.test(digits);
  // A second dot settles the ambiguity on its own: a number carries one
  // decimal point at most, so the dots in "1.234.567" are grouping and the
  // value is a million. (A single "12.500" stays genuinely ambiguous, and
  // keeps its established reading as twelve and a half.)
  const dotGrouping = (digits.match(/\./g) || []).length > 1;
  const normalized = decimalComma || dotGrouping
    ? digits.replace(/\./g, '').replace(',', '.')
    : digits.replace(/,/g, '');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/* Russian month names by their first three letters, in every case a date
   is written in: "12 авг 2026", "12 августа 2026", "май 2026" / "мая". */
const MONTHS_RU = {
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6,
  июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};
const monthNumber = (name) => {
  const key = name.toLowerCase().slice(0, 3);
  return MONTHS.indexOf(key) + 1 || MONTHS_RU[key] || 0;
};
const pad = (n) => String(n).padStart(2, '0');

/** Assemble YYYY-MM-DD, but only if the parts name a day that exists. */
function toISO(year, month, day) {
  const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isValidISODate(iso) ? iso : null;
}

/**
 * Dates as spreadsheets emit them: ISO, US M/D/YYYY, and "12 Aug 2026".
 * Returns YYYY-MM-DD, or null when it can't tell - a wrong date is worse
 * than a missing one, and an impossible one ("2026-02-30") is worse still:
 * it survives every shape check downstream and then prints as nonsense.
 */
export function parseDateLoose(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return toISO(iso[1], iso[2], iso[3]);

  const slash = raw.match(/^(\d{1,2})([/.])(\d{1,2})\2(\d{2}|\d{4})$/);
  if (slash) {
    const [, a, sep, b, y] = slash;
    const year = y.length === 2 ? `20${y}` : y;
    // Slashes read month-first (the US convention that popularized them);
    // dots are how Germany and its neighbours write dates, and there the
    // order is day-first - "05.03." is the 5th of March, not May 3rd.
    // Either way, a first number that can't fit the leading position, or a
    // reading that names no real date, flips to the other order before
    // giving up.
    const monthFirst = sep === '/' ? Number(a) <= 12 : Number(b) > 12;
    return toISO(year, ...(monthFirst ? [a, b] : [b, a]))
      ?? toISO(year, ...(monthFirst ? [b, a] : [a, b]));
  }

  // A Russian date may carry a trailing "г." ("12 августа 2026 г.").
  const plain = raw.replace(/\s*г\.?$/i, '');
  const named = plain.match(/^(\d{1,2})[\s-]*([a-zа-яё]{3,})\.?[\s-]*(\d{4})$/i)
    || plain.match(/^([a-zа-яё]{3,})\.?[\s-]*(\d{1,2}),?[\s-]*(\d{4})$/i);
  if (named) {
    const isDayFirst = /^\d/.test(plain);
    const day = isDayFirst ? named[1] : named[2];
    const month = monthNumber(isDayFirst ? named[2] : named[1]);
    if (month) return toISO(named[3], month, day);
  }
  return null;
}

export function parseBool(value) {
  return /^(y|yes|true|1|done|complete[d]?|x|да|д|истина|готово|сделано|выполнено|выполнена)$/i
    .test(String(value ?? '').trim());
}

/* ---------- column specs ---------- */

/* Headers and values compare letters and digits only, Latin or Cyrillic:
   "E-Mail" is "email", "Эл. почта" is "элпочта", and ё reads as е. */
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]+/g, '');

/**
 * Fields each entity accepts on import. `aliases` are the spreadsheet
 * headers seen in the wild; `required` rows are skipped when empty.
 */
export const IMPORT_FIELDS = {
  contacts: [
    { key: 'name', label: 'Имя', required: true, aliases: ['фио', 'контакт', 'имя контакта', 'полное имя', 'name', 'full name', 'contact', 'lead', 'person', 'contact name'] },
    { key: 'email', label: 'Эл. почта', aliases: ['почта', 'электронная почта', 'адрес почты', 'e-mail', 'email address', 'work email'] },
    { key: 'phone', label: 'Телефон', aliases: ['мобильный', 'номер телефона', 'phone', 'telephone', 'mobile', 'phone number'] },
    { key: 'title', label: 'Должность', aliases: ['позиция', 'роль', 'job title', 'role', 'position', 'job'] },
    { key: 'company', label: 'Компания', aliases: ['организация', 'работодатель', 'company', 'organisation', 'organization', 'account', 'employer'] },
    { key: 'source', label: 'Источник', aliases: ['канал', 'источник лида', 'source', 'lead source', 'channel'] },
    { key: 'status', label: 'Статус', aliases: ['этап', 'status', 'stage', 'lifecycle'] },
    { key: 'tags', label: 'Метки', aliases: ['метка', 'теги', 'tags', 'tag', 'labels', 'label'] },
    { key: 'notes', label: 'Заметки', aliases: ['примечание', 'примечания', 'комментарии', 'описание', 'notes', 'comments', 'description'] },
  ],
  companies: [
    { key: 'name', label: 'Название', required: true, aliases: ['компания', 'название компании', 'организация', 'name', 'company', 'company name', 'account', 'organisation', 'organization'] },
    { key: 'industry', label: 'Отрасль', aliases: ['сфера', 'индустрия', 'сектор', 'industry', 'sector', 'vertical'] },
    { key: 'website', label: 'Сайт', aliases: ['веб-сайт', 'домен', 'website', 'url', 'domain', 'site'] },
    { key: 'size', label: 'Сотрудники', aliases: ['размер', 'размер компании', 'численность', 'штат', 'company size', 'employees', 'headcount', 'size'] },
    { key: 'tags', label: 'Метки', aliases: ['метка', 'теги', 'tags', 'tag', 'labels', 'label'] },
    { key: 'notes', label: 'Заметки', aliases: ['примечание', 'примечания', 'комментарии', 'описание', 'notes', 'comments', 'description'] },
  ],
  deals: [
    { key: 'name', label: 'Название', required: true, aliases: ['сделка', 'название сделки', 'name', 'deal name', 'deal', 'opportunity', 'title'] },
    { key: 'value', label: 'Сумма', aliases: ['стоимость', 'цена', 'бюджет', 'сумма сделки', 'выручка', 'value', 'amount', 'price', 'revenue', 'deal value', 'mrr', 'arr'] },
    { key: 'billing', label: 'Оплата', aliases: ['тип оплаты', 'периодичность', 'периодичность оплаты', 'billing', 'billing cycle', 'billing period', 'recurrence', 'frequency', 'billing frequency', 'plan'] },
    { key: 'term', label: 'Срок (мес.)', aliases: ['срок договора', 'срок, мес', 'месяцев', 'term', 'contract term', 'term months', 'term (months)', 'contract length', 'months'] },
    { key: 'stage', label: 'Этап', aliases: ['статус', 'стадия', 'этап воронки', 'stage', 'status', 'pipeline stage'] },
    { key: 'company', label: 'Компания', aliases: ['организация', 'клиент', 'company', 'account', 'organisation', 'organization'] },
    { key: 'contact', label: 'Контакт', aliases: ['контактное лицо', 'имя контакта', 'contact', 'lead', 'person', 'contact name'] },
    { key: 'expectedClose', label: 'Дата закрытия', aliases: ['ожидаемая дата закрытия', 'срок закрытия', 'закрытие', 'expected close', 'close date', 'expected close date', 'closing'] },
    { key: 'tags', label: 'Метки', aliases: ['метка', 'теги', 'tags', 'tag', 'labels', 'label'] },
    { key: 'notes', label: 'Заметки', aliases: ['примечание', 'примечания', 'комментарии', 'описание', 'notes', 'comments', 'description'] },
  ],
};

/* ---------- custom fields in a spreadsheet ----------
   A custom field is a column like any other: it exports under its own
   name and imports by matching that name. Mapped cells arrive under a
   prefixed key so nothing can collide with a built-in field. */

export const CUSTOM_PREFIX = 'custom:';

/** The import fields for a record type, with the user's own fields appended. */
export function importFieldsFor(key, fields = []) {
  return [
    ...(IMPORT_FIELDS[key] || []),
    ...fields.map((field) => ({
      key: `${CUSTOM_PREFIX}${field.id}`,
      label: field.name,
      custom: field,
      aliases: [],
    })),
  ];
}

/**
 * One spreadsheet cell as a field value: the value, or undefined when the
 * cell can't be read as that type (and is left alone rather than guessed
 * at). Spreadsheet-shaped slack lives here rather than in fields.js -
 * "$1,200" in a number column and "9/30/2026" in a date one are things
 * only a CSV does.
 */
export function coerceCustomCell(field, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const direct = coerceFieldValue(field, text);
  if (direct !== undefined) return direct;
  if (field.type === 'number' && /\d/.test(text)) return parseMoney(text);
  if (field.type === 'date') return parseDateLoose(text) ?? undefined;
  // "x" in a yes/no column is a tick; anything else is left unread rather
  // than filed as a No the row never said.
  if (field.type === 'checkbox' && parseBool(text)) return true;
  return undefined;
}

/** Every mapped custom cell of a row, as a `custom` patch. */
export function customCellValues(fields, row) {
  const out = {};
  for (const field of fields || []) {
    const raw = row?.[`${CUSTOM_PREFIX}${field.id}`];
    if (raw === undefined) continue;
    const value = coerceCustomCell(field, raw);
    if (value === undefined || value === null) continue;
    out[field.id] = value;
  }
  return out;
}

/** A field's value for a CSV cell: dates and numbers stay machine-readable. */
export function customCellText(field, record) {
  const value = fieldValue(record, field);
  if (isBlankValue(value)) return '';
  if (field.type === 'number') return value;
  return formatFieldValue(field, value);
}

/* The words the wizard speaks in about each kind, already in the case
   each sentence needs - Russian can't build "an existing company" from
   the label the way English trimmed an "s" off it. `matchOn` follows
   "по", `existing` follows "совпадает", `many` follows a verb
   ("Добавлено контактов"). `matchKey` is the field the merge matches on,
   so the wizard can tell whether the file actually offers it. */
export const IMPORT_KINDS = [
  {
    key: 'contacts', label: 'Контакты', icon: 'users', matchOn: 'эл. почте', matchKey: 'email',
    title: 'Импорт контактов', existing: 'с существующим контактом', newOne: 'новый контакт',
    many: 'контактов', noName: 'без имени',
  },
  {
    key: 'companies', label: 'Компании', icon: 'company', matchOn: 'названию', matchKey: 'name',
    title: 'Импорт компаний', existing: 'с существующей компанией', newOne: 'новая компания',
    many: 'компаний', noName: 'без названия',
  },
  {
    key: 'deals', label: 'Сделки', icon: 'deal', matchOn: 'названию', matchKey: 'name',
    title: 'Импорт сделок', existing: 'с существующей сделкой', newOne: 'новая сделка',
    many: 'сделок', noName: 'без названия',
  },
];

/**
 * Guess which CSV column feeds each field: exact header, then alias, then
 * a containment match. Every column is claimed at most once.
 */
export function autoMap(headers, fields) {
  const normalized = headers.map(norm);
  const taken = new Set();
  const mapping = {};
  const claim = (key, index) => {
    if (index < 0 || taken.has(index)) return false;
    taken.add(index);
    mapping[key] = index;
    return true;
  };

  for (const field of fields) {
    const names = [field.label, field.key, ...(field.aliases || [])].map(norm);
    let index = normalized.findIndex((h) => names.includes(h));
    if (index < 0) {
      index = normalized.findIndex((h) => h && names.some((n) => h.includes(n) || n.includes(h)));
    }
    if (!claim(field.key, index)) mapping[field.key] ??= -1;
  }
  return mapping;
}

/** Apply a mapping to parsed rows: [headerRow, ...dataRows] → objects. */
export function mapRows(rows, mapping) {
  const [, ...data] = rows;
  return data.map((row) => {
    const record = {};
    for (const [key, index] of Object.entries(mapping)) {
      if (index >= 0) record[key] = unguardFormula(String(row[index] ?? '').trim());
    }
    return record;
  });
}

/* The names statuses went by before the interface spoke Russian, so a
   file exported back then (or kept in English) still reads. */
const LEGACY_STATUS_LABELS = {
  lead: ['Lead'],
  active: ['In conversation', 'Active', 'Активный'],
  customer: ['Customer', 'Client'],
  lost: ['Lost touch', 'Lost'],
};

/** Match a free-text status against the app's list; unknown falls to `fallback`. */
export function matchStatus(value, fallback = 'lead') {
  const wanted = norm(value);
  if (!wanted) return fallback;
  const hit = CONTACT_STATUSES.find((s) => norm(s.value) === wanted || norm(s.label) === wanted
    || (LEGACY_STATUS_LABELS[s.value] || []).some((l) => norm(l) === wanted));
  return hit ? hit.value : fallback;
}

/**
 * Match a free-text billing cell against the app's modes. Spreadsheets
 * say this every way there is - "Monthly", "per month", "MRR", "recurring
 * monthly", "yearly", "one off" - so ids, labels, and the words around
 * them all count. Unrecognized falls to `fallback`, which the merge uses
 * to mean "this cell said nothing, keep what the deal already has".
 */
export function matchBilling(value, fallback = 'one-time') {
  const wanted = norm(value);
  if (!wanted) return fallback;
  const hit = BILLING_MODES.find((m) => norm(m.value) === wanted || norm(m.label) === wanted);
  if (hit) return hit.value;
  if (/^(month|monthly|permonth|mo|mrr|recurringmonthly|monthlyrecurring|subscriptionmonthly)$/.test(wanted)) return 'monthly';
  if (/^(вмесяц|месяц|мес|ежемесячно|ежемесячная|ежемесячный|помесячно|помесячная|ежемесячнаяподписка)$/.test(wanted)) return 'monthly';
  if (/^(year|yearly|annual|annually|peryear|yr|arr|recurringannual|annualrecurring|subscriptionannual)$/.test(wanted)) return 'annual';
  if (/^(вгод|год|ежегодно|ежегодная|ежегодный|годовая|годовой|погодно|ежегоднаяподписка)$/.test(wanted)) return 'annual';
  if (/^(onetime|onceoff|oneoff|once|single|nonrecurring|flat|fixed|upfront)$/.test(wanted)) return 'one-time';
  if (/^(разово|разовая|разовый|единоразово|единовременно|однократно|разоваяоплата|предоплата)$/.test(wanted)) return 'one-time';
  return fallback;
}

/** A term cell as whole months, or '' when the cell says nothing usable. */
export function parseTerm(value) {
  const raw = String(value ?? '').trim();
  if (!/\d/.test(raw)) return '';
  const n = Number.parseFloat(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  // "1 year" / "2 yrs" / "2 года" / "5 лет" are terms too, and they are
  // years, not months.
  return /y(ea)?rs?\b|год|лет/i.test(raw) ? normalizeTerm(n * 12) : normalizeTerm(n);
}

/* Names the built-in stages answer to beyond their current label: the
   English ones files were exported under before, and the everyday
   spellings of a closed deal. Used only for stages the funnel still has. */
const STAGE_ALIASES = {
  new: ['New'],
  qualified: ['Qualified', 'Qualification'],
  proposal: ['Proposal', 'КП', 'Коммерческое предложение'],
  negotiation: ['Negotiation'],
  won: ['Won', 'Closed won', 'Выиграно', 'Выигран', 'Успешно'],
  lost: ['Lost', 'Closed lost', 'Проиграно', 'Проигран', 'Отказ'],
};

/**
 * Match a stage by id or label against the configured funnel, then by
 * the default funnel's names (Russian and the old English ones), so
 * "Proposal" and "Предложение" both land on a funnel that still has it.
 */
export function matchStage(value, stages, fallback) {
  const wanted = norm(value);
  if (!wanted) return fallback;
  const hit = stages.find((s) => norm(s.id) === wanted || norm(s.label) === wanted);
  if (hit) return hit.id;
  const known = STAGES.find((s) => norm(s.label) === wanted
    || (STAGE_ALIASES[s.id] || []).some((a) => norm(a) === wanted));
  return known && stages.some((s) => s.id === known.id) ? known.id : fallback;
}

/* ---------- export ---------- */

/**
 * Column sets for export. Getters take the record plus a lookup context so
 * ids come out as the names a spreadsheet reader expects.
 */
export const EXPORT_SETS = {
  contacts: {
    label: 'Контакты',
    icon: 'users',
    columns: [
      ['Имя', (c) => c.name],
      ['Должность', (c) => c.title],
      ['Эл. почта', (c) => c.email],
      ['Телефон', (c) => c.phone],
      ['Компания', (c, ctx) => ctx.companyName(c.companyId)],
      ['Источник', (c) => c.source],
      ['Статус', (c) => CONTACT_STATUSES.find((s) => s.value === c.status)?.label || c.status],
      ['Метки', (c) => (c.tags || []).join(', ')],
      ['Последний контакт', (c, ctx) => ctx.lastContacted(c.id) || ''],
      ['Заметки', (c) => c.notes],
      ['Создан', (c) => isoDay(c.createdAt)],
    ],
    rows: (store) => [...store.contacts].sort((a, b) => a.name.localeCompare(b.name)),
  },
  companies: {
    label: 'Компании',
    icon: 'company',
    columns: [
      ['Название', (c) => c.name],
      ['Отрасль', (c) => c.industry],
      ['Сайт', (c) => c.website],
      ['Сотрудники', (c) => c.size],
      ['Метки', (c) => (c.tags || []).join(', ')],
      ['Заметки', (c) => c.notes],
      ['Создана', (c) => isoDay(c.createdAt)],
    ],
    rows: (store) => [...store.companies].sort((a, b) => a.name.localeCompare(b.name)),
  },
  deals: {
    label: 'Сделки',
    icon: 'deal',
    columns: [
      ['Название', (d) => d.name],
      ['Сумма', (d) => d.value],
      // Billing and term make the Value column readable: $2,000 means one
      // thing on a one-time deal and another on a monthly one. Contract
      // value and MRR are derived, exported so a spreadsheet can total a
      // book of subscriptions without re-deriving them, and ignored on the
      // way back in - Value plus Billing plus Term is the whole truth.
      ['Оплата', (d) => billingLabel(d)],
      ['Срок (мес.)', (d) => (isRecurring(d) ? d.term : '')],
      ['Сумма договора', (d) => contractValue(d)],
      ['Платёж в месяц', (d) => (isRecurring(d) ? mrrOf(d) : '')],
      ['Этап', (d, ctx) => ctx.stageLabel(d.stage)],
      ['Компания', (d, ctx) => ctx.companyName(d.companyId)],
      ['Контакт', (d, ctx) => ctx.contactName(d.contactId)],
      ['Дата закрытия', (d) => d.expectedClose || ''],
      ['Метки', (d) => (d.tags || []).join(', ')],
      ['Причина', (d) => d.closeReason],
      ['Комментарий к причине', (d) => d.closeReasonNote],
      ['Заметки', (d) => d.notes],
      ['Создана', (d) => isoDay(d.createdAt)],
      ['Обновлена', (d) => isoDay(d.updatedAt)],
      ['Закрыта', (d) => (d.closedAt ? isoDay(d.closedAt) : '')],
    ],
    rows: (store) => [...store.deals].sort((a, b) => b.updatedAt - a.updatedAt),
  },
  activities: {
    label: 'История',
    icon: 'video',
    columns: [
      ['Дата', (a) => a.date],
      ['Тип', (a) => (a.type ? activityTypeInfo(a.type).label : '')],
      ['Тема', (a) => a.summary],
      ['Заметки', (a) => a.notes],
      ['Контакт', (a, ctx) => ctx.contactName(a.contactId)],
      ['Компания', (a, ctx) => ctx.companyName(a.companyId)],
      ['Сделка', (a, ctx) => ctx.dealName(a.dealId)],
    ],
    rows: (store) => store.recentActivities(Infinity),
  },
  tasks: {
    label: 'Задачи',
    icon: 'followups',
    columns: [
      ['Задача', (t) => t.title],
      ['Срок', (t) => t.due],
      ['Время', (t) => t.dueTime],
      ['Повтор', (t) => repeatLabel(t.repeat)],
      ['Выполнена', (t) => (t.done ? 'Да' : 'Нет')],
      ['Контакт', (t, ctx) => ctx.contactName(t.contactId)],
      ['Сделка', (t, ctx) => ctx.dealName(t.dealId)],
    ],
    rows: (store) => [...store.tasks].sort((a, b) => a.due.localeCompare(b.due)),
  },
};

function isoDay(ts) {
  return Number.isFinite(ts) ? todayISO(new Date(ts)) : '';
}

/**
 * Every column an entity exports: its built-ins, then one per custom
 * field. `ctx.customFields(key)` supplies the definitions, so this module
 * stays clear of the store.
 */
function columnsFor(key, ctx) {
  const set = EXPORT_SETS[key];
  const custom = ctx?.customFields?.(key) || [];
  return [
    ...set.columns,
    ...custom.map((field) => [field.name, (record) => customCellText(field, record)]),
  ];
}

/** Render specific records of one entity as CSV text (bulk selections). */
export function exportRecords(key, records, ctx) {
  const set = EXPORT_SETS[key];
  if (!set) return '';
  const columns = columnsFor(key, ctx);
  // The header goes through the guard like every other cell: the built-in
  // labels are ours, but a custom field's name is whatever was typed into
  // Settings - or carried in by an imported export, which is not our data
  // at all. Import strips the prefix back off, so a round trip is exact.
  const rows = [columns.map(([label]) => guardFormula(label))];
  for (const record of records) {
    rows.push(columns.map(([, get]) => guardFormula(get(record, ctx))));
  }
  return toCSV(rows);
}

/** Render one whole entity as CSV text. */
export function exportSet(key, store, ctx) {
  const set = EXPORT_SETS[key];
  if (!set) return '';
  return exportRecords(key, set.rows(store), ctx);
}
