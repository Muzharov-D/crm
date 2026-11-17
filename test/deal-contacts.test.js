import { describe, it, expect } from 'vitest';
import {
  DEAL_ROLES, DECIDER_ROLE, MAX_DEAL_CONTACTS, normalizeRole, roleLabel,
  normalizeDealContacts, dealContactIds, roleOf, hasDecisionMaker,
  replacePrimary, withoutContact, repointContact, withContact,
} from '../src/lib/deal-contacts.js';

describe('roles', () => {
  it('offers a fixed short list', () => {
    expect(DEAL_ROLES.map((r) => r.value))
      .toEqual(['champion', 'decision-maker', 'influencer', 'blocker', 'other']);
    expect(DECIDER_ROLE).toBe('decision-maker');
  });

  it('normalizes anything unrecognized to no role', () => {
    expect(normalizeRole('champion')).toBe('champion');
    expect(normalizeRole('CHAMPION')).toBe('CHAMPION');
    expect(normalizeRole(undefined)).toBe('');
    expect(normalizeRole(7)).toBe('7');
    expect(roleLabel('decision-maker')).toBe('ЛПР');
    expect(roleLabel('nope')).toBe('');
  });
});

describe('normalizeDealContacts', () => {
  it('migrates a deal that only ever had one contact', () => {
    expect(normalizeDealContacts(undefined, 'c1')).toEqual([{ contactId: 'c1', role: '', influence: '', position: '' }]);
    expect(normalizeDealContacts(null, null)).toEqual([]);
  });

  it('takes bare ids as well as entries', () => {
    expect(normalizeDealContacts(['c1', { contactId: 'c2', role: 'blocker', influence: '', position: '' }], null))
      .toEqual([{ contactId: 'c1', role: '', influence: '', position: '' }, { contactId: 'c2', role: 'blocker', influence: '', position: '' }]);
  });

  it('pulls the primary to the front, adding it when the list forgot it', () => {
    expect(normalizeDealContacts([
      { contactId: 'c1', role: 'champion', influence: '', position: '' }, { contactId: 'c2', role: 'decision-maker', influence: '', position: '' },
    ], 'c2')).toEqual([
      { contactId: 'c2', role: 'decision-maker', influence: '', position: '' }, { contactId: 'c1', role: 'champion', influence: '', position: '' },
    ]);
    expect(normalizeDealContacts([{ contactId: 'c1', role: 'champion', influence: '', position: '' }], 'c9')[0])
      .toEqual({ contactId: 'c9', role: '', influence: '', position: '' });
  });

  it('drops duplicates, blanks, and junk, and caps the list', () => {
    expect(normalizeDealContacts([
      { contactId: 'c1' }, { contactId: 'c1', role: 'blocker', influence: '', position: '' }, { contactId: '' }, null, 7,
    ], null)).toEqual([{ contactId: 'c1', role: '', influence: '', position: '' }]);
    const many = Array.from({ length: 20 }, (_, i) => ({ contactId: `c${i}` }));
    expect(normalizeDealContacts(many, null)).toHaveLength(MAX_DEAL_CONTACTS);
  });

  it('drops a role the list does not recognize', () => {
    expect(normalizeDealContacts([{ contactId: 'c1', role: 'boss', influence: '', position: '' }], null))
      .toEqual([{ contactId: 'c1', role: 'boss', influence: '', position: '' }]);
  });
});

describe('reading a deal', () => {
  const deal = {
    contactId: 'c1',
    contacts: [
      { contactId: 'c1', role: 'champion', influence: '', position: '' },
      { contactId: 'c2', role: 'decision-maker', influence: '', position: '' },
    ],
  };

  it('lists the people, primary first', () => {
    expect(dealContactIds(deal)).toEqual(['c1', 'c2']);
    expect(dealContactIds({})).toEqual([]);
  });

  it('answers what someone does here', () => {
    expect(roleOf(deal, 'c2')).toBe('decision-maker');
    expect(roleOf(deal, 'nobody')).toBe('');
  });

  it('answers whether anyone can actually sign', () => {
    expect(hasDecisionMaker(deal)).toBe(true);
    expect(hasDecisionMaker({ contacts: [{ contactId: 'c1', role: 'champion', influence: '', position: '' }] })).toBe(false);
    expect(hasDecisionMaker({})).toBe(false);
  });
});

describe('editing the list', () => {
  const list = [
    { contactId: 'c1', role: 'champion', influence: '', position: '' },
    { contactId: 'c2', role: 'decision-maker', influence: '', position: '' },
  ];

  it('swaps the primary, keeping the others and their roles', () => {
    expect(replacePrimary(list, 'c3'))
      .toEqual([{ contactId: 'c3', role: '', influence: '', position: '' }, { contactId: 'c2', role: 'decision-maker', influence: '', position: '' }]);
  });

  it('promotes someone already on the deal, with the role they had', () => {
    expect(replacePrimary(list, 'c2')).toEqual([{ contactId: 'c2', role: 'decision-maker', influence: '', position: '' }]);
  });

  it('a null primary detaches, leaving the rest', () => {
    expect(replacePrimary(list, null)).toEqual([{ contactId: 'c2', role: 'decision-maker', influence: '', position: '' }]);
  });

  it('removes one person', () => {
    expect(withoutContact(list, 'c1')).toEqual([{ contactId: 'c2', role: 'decision-maker', influence: '', position: '' }]);
    expect(withoutContact(list, 'zz')).toHaveLength(2);
  });

  it('re-points a merged duplicate without leaving them on twice', () => {
    const merged = repointContact(list, 'c2', 'c1');
    expect(merged).toEqual([{ contactId: 'c1', role: 'champion', influence: '', position: '' }]);
    // The survivor's own role wins; a survivor with none takes the merged one.
    expect(repointContact([{ contactId: 'a', role: '', influence: '', position: '' }, { contactId: 'b', role: 'blocker', influence: '', position: '' }], 'b', 'a'))
      .toEqual([{ contactId: 'a', role: 'blocker', influence: '', position: '' }]);
    expect(repointContact(list, 'zz', 'c1')).toBe(list);
  });

  it('adds a person once, and never past the cap', () => {
    expect(withContact(list, 'c3', 'other')).toHaveLength(3);
    expect(withContact(list, 'c1')).toBe(list);
    expect(withContact(list, '')).toBe(list);
    const full = Array.from({ length: MAX_DEAL_CONTACTS }, (_, i) => ({ contactId: `x${i}` }));
    expect(withContact(full, 'one-more')).toBe(full);
  });
});
