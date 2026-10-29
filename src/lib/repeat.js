/**
 * Follow-up recurrence rules. Repeat-on-completion, not calendar RRULEs:
 * the next occurrence exists only once the current one is checked off,
 * due = completion day plus the interval. That matches keep-in-touch
 * cadences ("every 30 days" means 30 days of quiet, not the 30th of the
 * month) and keeps the model one field.
 *
 * Kept apart from the store - like statuses.js - so the CSV layer can
 * label a rule without importing the data layer it feeds.
 */

import { addDays, addMonthsClamped, plural } from './util.js';

export const REPEAT_UNITS = ['day', 'week', 'month'];

const toCount = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  if (typeof v !== 'string' || !v.trim()) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** A well-formed repeat rule or null - never a half-shaped object. */
export function normalizeRepeat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!REPEAT_UNITS.includes(raw.unit)) return null;
  const every = toCount(raw.every);
  if (every < 1 || every > 365) return null;
  return { every, unit: raw.unit };
}

/** Next due date for a repeat rule, counted from `fromISO` (completion day). */
export function nextRepeatDue(fromISO, repeat) {
  const rule = normalizeRepeat(repeat);
  if (!rule) return fromISO;
  if (rule.unit === 'day') return addDays(fromISO, rule.every);
  if (rule.unit === 'week') return addDays(fromISO, rule.every * 7);
  return addMonthsClamped(fromISO, rule.every);
}

/* Each unit as "каждый/каждую" + its three plural forms (accusative). */
const UNIT_WORDS = {
  day: { each: 'Каждый', forms: ['день', 'дня', 'дней'] },
  week: { each: 'Каждую', forms: ['неделю', 'недели', 'недель'] },
  month: { each: 'Каждый', forms: ['месяц', 'месяца', 'месяцев'] },
};

/**
 * "Каждый день" / "Каждые 2 недели" / "Каждые 3 месяца", or '' for no rule.
 * A count ending in 1 takes the singular: "Каждый 21 день".
 */
export function repeatLabel(repeat) {
  const rule = normalizeRepeat(repeat);
  if (!rule) return '';
  const { each, forms } = UNIT_WORDS[rule.unit];
  if (rule.every === 1) return `${each} ${forms[0]}`;
  const word = plural(rule.every, forms);
  return `${word === forms[0] ? each : 'Каждые'} ${rule.every} ${word}`;
}
