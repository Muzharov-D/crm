import { describe, it, expect } from 'vitest';
import { mergeValue } from '../server/merge.js';

const j = (v) => JSON.stringify(v);
const merge = (base, mine, theirs) => JSON.parse(mergeValue(base === null ? null : j(base), j(mine), theirs === null ? null : j(theirs)));
const ids = (list) => list.map((r) => r.id).sort();

describe('collections', () => {
  const a = { id: 'a', name: 'A', updatedAt: 1 };
  const b = { id: 'b', name: 'B', updatedAt: 1 };

  it('keeps a record someone else added while I edited another', () => {
    const c = { id: 'c', name: 'C', updatedAt: 2 };
    const out = merge([a, b], [{ ...a, name: 'A2', updatedAt: 3 }, b], [a, b, c]);
    expect(ids(out)).toEqual(['a', 'b', 'c']);
    expect(out.find((r) => r.id === 'a').name).toBe('A2');
  });

  it('keeps both sides when each edited a different record', () => {
    const out = merge([a, b], [{ ...a, name: 'A2', updatedAt: 2 }, b], [a, { ...b, name: 'B2', updatedAt: 2 }]);
    expect(out.map((r) => r.name).sort()).toEqual(['A2', 'B2']);
  });

  it('takes the newer edit when both changed the same record', () => {
    expect(merge([a], [{ ...a, name: 'mine', updatedAt: 5 }], [{ ...a, name: 'theirs', updatedAt: 9 }])[0].name).toBe('theirs');
    expect(merge([a], [{ ...a, name: 'mine', updatedAt: 9 }], [{ ...a, name: 'theirs', updatedAt: 5 }])[0].name).toBe('mine');
  });

  it('applies my delete, and theirs', () => {
    expect(ids(merge([a, b], [a], [a, b]))).toEqual(['a']);
    expect(ids(merge([a, b], [a, b], [a]))).toEqual(['a']);
  });

  it('keeps a record I deleted if someone edited it since', () => {
    const out = merge([a, b], [a], [a, { ...b, name: 'B2', updatedAt: 2 }]);
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('without a base, never drops what the server has', () => {
    expect(ids(merge(null, [a], [b]))).toEqual(['a', 'b']);
  });

  it('writes mine when the server has nothing', () => {
    expect(merge([], [a], null)).toEqual([a]);
  });
});

describe('objects', () => {
  it('merges settings field by field', () => {
    const out = merge({ currency: 'RUB', theme: 'light' }, { currency: 'EUR', theme: 'light' }, { currency: 'RUB', theme: 'dark' });
    expect(out).toEqual({ currency: 'EUR', theme: 'dark' });
  });
});
