/** Small, dependency-free helpers shared by the data layer and the UI. */

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD (never UTC - a follow-up due "today" must mean the user's today). */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYY-MM month key of an ISO date string or Date. */
export function monthKey(date = new Date()) {
  if (typeof date === 'string') return date.slice(0, 7);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** Month key shifted by `n` months (n may be negative). */
export function shiftMonthKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** ISO date shifted by `n` days. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}

/**
 * ISO date shifted by `n` calendar months, clamped to the target month's
 * last day - "monthly from Jan 31" must mean Feb 28, not March 3.
 */
export function addMonthsClamped(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + n;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(Math.min(d, daysInMonth(year, month)))}`;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days in a 1-indexed month of a given year. */
export function daysInMonth(year, month) {
  if (month < 1 || month > 12) return 0;
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

/**
 * Is this a YYYY-MM-DD string naming a real calendar day? The shape alone
 * isn't enough: "2026-02-30" and "2020-45-13" both pass a regex and then
 * poison every month bucket and date label they reach.
 */
export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return d >= 1 && d <= daysInMonth(y, m);
}

/** Whole-day difference b - a (positive when b is after a). */
export function daysBetween(a, b) {
  const parse = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

/**
 * Russian plural form: plural(5, ['сделка', 'сделки', 'сделок']) → "сделок".
 * The three forms are for 1, 2-4 and 5+ (21 takes the first, 11-14 the last).
 */
export function plural(n, [one, few, many]) {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "5 сделок": the number followed by its plural form. */
export function countLabel(n, forms) {
  return `${n} ${plural(n, forms)}`;
}

/* Month names: genitive for a date ("12 авг"), nominative for a month on its own ("Авг 2026"). */
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_ALONE = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

/** "12 авг" or "12 авг 2025" when the year differs from today's. */
export function formatDate(iso, { year = 'auto' } = {}) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  // Anything we can't name is shown as it was stored - "13 undefined 2020"
  // helps nobody.
  if (!MONTHS_SHORT[m - 1] || !Number.isFinite(d)) return String(iso);
  const showYear = year === 'always' || (year === 'auto' && y !== new Date().getFullYear());
  return `${d} ${MONTHS_SHORT[m - 1]}${showYear ? ` ${y}` : ''}`;
}

/** "14:30" → "14:30", "9:05" → "9:05": 24-hour clock. */
export function formatClock(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${h}:${pad2(m)}`;
}

/**
 * "Авг 2026" for a YYYY-MM key. `year: 'auto'` drops the year inside the
 * current one, the way formatDate does - for labels sitting next to a
 * month that is already named.
 */
export function formatMonth(key, { year = 'always' } = {}) {
  const [y, m] = key.split('-').map(Number);
  const showYear = year === 'always' || (year === 'auto' && y !== new Date().getFullYear());
  return `${MONTHS_ALONE[m - 1]}${showYear ? ` ${y}` : ''}`;
}

/**
 * Human framing of a due date relative to today:
 * "просрочено на 3 дн." / "Сегодня" / "Завтра" / "Через 5 дн." / "24 авг".
 * Also reports the status so the UI can color it without re-deriving.
 */
export function dueLabel(iso, today = todayISO()) {
  const diff = daysBetween(today, iso);
  if (diff < 0) return { text: `просрочено на ${-diff} дн.`, status: 'overdue' };
  if (diff === 0) return { text: 'Сегодня', status: 'today' };
  if (diff === 1) return { text: 'Завтра', status: 'soon' };
  if (diff <= 7) return { text: `Через ${diff} дн.`, status: 'soon' };
  return { text: formatDate(iso), status: 'later' };
}

/**
 * How long ago a dated record happened, in the coarse units people use for
 * "when did we last talk": "сегодня" / "вчера" / "5 дн. назад" /
 * "3 нед. назад" / "4 мес. назад". Future dates read as today.
 */
export function sinceLabel(iso, today = todayISO()) {
  const days = Math.max(0, daysBetween(iso, today));
  if (days === 0) return { text: 'сегодня', days };
  if (days === 1) return { text: 'вчера', days };
  if (days < 14) return { text: `${days} дн. назад`, days };
  if (days < 60) return { text: `${Math.round(days / 7)} нед. назад`, days };
  return { text: `${Math.round(days / 30)} мес. назад`, days };
}

/** "только что" / "5 мин назад" / "3 ч назад" / "12 авг" for a timestamp. */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} дн. назад`;
  return formatDate(todayISO(new Date(ts)));
}

/* Money is pinned to ru-RU formatting so symbols and separators are the
   same on every device: "12 500 ₽". */
const MONEY_LOCALE = 'ru-RU';

/**
 * Full currency amount: formatMoney(12500, 'RUB') → "12 500 ₽".
 * Round numbers lose the ",00"; anything with kopecks keeps both digits.
 */
export function formatMoney(amount, currency = 'RUB') {
  const n = Number(amount) || 0;
  const digits = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency', currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString(MONEY_LOCALE, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    })}`;
  }
}

/** Compact currency for stat tiles and chart labels: "4,2 млн ₽", "18,5 тыс. ₽", "950 ₽". */
export function compactMoney(amount, currency = 'RUB') {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sym = symbolOf(currency);
  const sign = n < 0 ? '-' : '';
  // Each range starts where the one below it would round to "1000" of its
  // own unit. The ladder has to reach a billion: a currency that trades at
  // a hundred or more to the dollar puts an ordinary book of business past
  // it, and the pipeline total read "¥1234.6M" instead of "¥1.2B".
  if (abs >= 999_950_000) return `${sign}${trim1(abs / 1e9)} млрд ${sym}`;
  if (abs >= 999_950) return `${sign}${trim1(abs / 1e6)} млн ${sym}`;
  if (abs >= 10000) return `${sign}${trim1(abs / 1000)} тыс. ${sym}`;
  return `${sign}${abs.toLocaleString(MONEY_LOCALE, { maximumFractionDigits: 0 })} ${sym}`;
}

const trim1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

function symbolOf(currency) {
  try {
    const parts = new Intl.NumberFormat(MONEY_LOCALE, { style: 'currency', currency }).formatToParts(1);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** "Ada Lovelace" → "AL"; single names and empty strings degrade gracefully. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Case- and accent-folded text, the basis of every search in the app. */
export function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Case/accent-insensitive substring test for search boxes. */
export function fuzzyIncludes(haystack, needle) {
  return normalizeText(haystack).includes(normalizeText(needle));
}

/**
 * How well `text` matches a query, for ranking mixed result lists:
 * -1 no match, 30 mid-word, 60 at a word start, 100ish from the first
 * character (shorter matches score higher - "Mei" beats "Meital").
 */
export function matchScore(text, query) {
  const hay = normalizeText(text);
  const needle = normalizeText(query);
  if (!needle) return 0;
  const at = hay.indexOf(needle);
  if (at < 0) return -1;
  if (at === 0) return 100 - Math.min(40, hay.length - needle.length);
  return /[\s\-_/.,(]/.test(hay[at - 1]) ? 60 : 30;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
