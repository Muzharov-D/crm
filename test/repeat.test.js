import { describe, it, expect } from 'vitest';
import { normalizeRepeat, nextRepeatDue, repeatLabel } from '../src/lib/repeat.js';

describe('normalizeRepeat', () => {
  it('accepts a well-formed rule and rounds string counts', () => {
    expect(normalizeRepeat({ every: 2, unit: 'week' })).toEqual({ every: 2, unit: 'week' });
    expect(normalizeRepeat({ every: '3', unit: 'month' })).toEqual({ every: 3, unit: 'month' });
  });

  it('rejects anything half-shaped', () => {
    expect(normalizeRepeat(null)).toBeNull();
    expect(normalizeRepeat('weekly')).toBeNull();
    expect(normalizeRepeat({ every: 0, unit: 'day' })).toBeNull();
    expect(normalizeRepeat({ every: 400, unit: 'day' })).toBeNull();
    expect(normalizeRepeat({ every: 2, unit: 'fortnight' })).toBeNull();
    expect(normalizeRepeat({ every: NaN, unit: 'day' })).toBeNull();
  });
});

describe('nextRepeatDue', () => {
  it('adds days and weeks', () => {
    expect(nextRepeatDue('2026-08-05', { every: 3, unit: 'day' })).toBe('2026-08-08');
    expect(nextRepeatDue('2026-08-05', { every: 2, unit: 'week' })).toBe('2026-08-19');
    expect(nextRepeatDue('2026-12-25', { every: 2, unit: 'week' })).toBe('2027-01-08');
  });

  it('clamps monthly cadences to the end of shorter months', () => {
    expect(nextRepeatDue('2026-01-31', { every: 1, unit: 'month' })).toBe('2026-02-28');
    expect(nextRepeatDue('2024-01-31', { every: 1, unit: 'month' })).toBe('2024-02-29');
    expect(nextRepeatDue('2026-08-31', { every: 1, unit: 'month' })).toBe('2026-09-30');
    expect(nextRepeatDue('2026-11-30', { every: 3, unit: 'month' })).toBe('2027-02-28');
  });

  it('falls back to the input date on a junk rule', () => {
    expect(nextRepeatDue('2026-08-05', null)).toBe('2026-08-05');
    expect(nextRepeatDue('2026-08-05', { every: -1, unit: 'day' })).toBe('2026-08-05');
  });
});

describe('repeatLabel', () => {
  it('reads naturally for one and many', () => {
    expect(repeatLabel({ every: 1, unit: 'day' })).toBe('Каждый день');
    expect(repeatLabel({ every: 1, unit: 'week' })).toBe('Каждую неделю');
    expect(repeatLabel({ every: 1, unit: 'month' })).toBe('Каждый месяц');
    expect(repeatLabel({ every: 2, unit: 'week' })).toBe('Каждые 2 недели');
    expect(repeatLabel({ every: 3, unit: 'month' })).toBe('Каждые 3 месяца');
    expect(repeatLabel({ every: 5, unit: 'day' })).toBe('Каждые 5 дней');
    expect(repeatLabel({ every: 11, unit: 'week' })).toBe('Каждые 11 недель');
    expect(repeatLabel({ every: 21, unit: 'day' })).toBe('Каждый 21 день');
    expect(repeatLabel({ every: 21, unit: 'week' })).toBe('Каждую 21 неделю');
  });

  it('is empty for no rule', () => {
    expect(repeatLabel(null)).toBe('');
    expect(repeatLabel({ every: 0, unit: 'day' })).toBe('');
  });
});
