import { describe, expect, it } from 'vitest';
import { parseUsers, canWrite } from '../server/access.js';
import { auditForKV, appendAudit, AUDIT_LIMIT } from '../server/audit.js';

describe('server roles', () => {
  it('keeps legacy users as admins and parses explicit roles', () => {
    const users = parseUsers('owner:secret;lead:p:a:ss:manager;guest:pw:viewer');
    expect(users.get('owner')).toEqual({ password: 'secret', role: 'admin' });
    expect(users.get('lead')).toEqual({ password: 'p:a:ss', role: 'manager' });
    expect(users.get('guest').role).toBe('viewer');
  });

  it('makes viewers read-only and protects the audit collection', () => {
    expect(canWrite({ role: 'viewer' }, 'crm:deals:v1')).toBe(false);
    expect(canWrite({ role: 'manager' }, 'crm:deals:v1')).toBe(true);
    expect(canWrite({ role: 'admin' }, 'crm:audit:v1')).toBe(false);
  });
});

describe('audit events', () => {
  it('describes created, changed and deleted records with changed fields', () => {
    const current = JSON.stringify([{ id: '1', name: 'A', value: 10 }, { id: '2', name: 'B' }]);
    const next = JSON.stringify([{ id: '1', name: 'A', value: 20 }, { id: '3', title: 'C' }]);
    const events = auditForKV({ key: 'crm:deals:v1', currentRaw: current, nextRaw: next, actor: 'lead' });
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.recordId === '1')).toMatchObject({ action: 'updated', fields: ['сумма'] });
    expect(events.find((e) => e.recordId === '2').action).toBe('deleted');
    expect(events.find((e) => e.recordId === '3').action).toBe('created');
  });

  it('summarizes settings without logging irrelevant timestamps', () => {
    const events = auditForKV({
      key: 'crm:settings:v1', currentRaw: '{"currency":"RUB"}',
      nextRaw: '{"currency":"EUR","forecastMode":"model"}', actor: 'admin',
    });
    expect(events[0].fields).toEqual(['валюта', 'режим прогноза']);
  });

  it('keeps only the newest 500 events and stamps new entries', async () => {
    let raw = JSON.stringify(Array.from({ length: 498 }, (_, i) => ({ id: `old-${i}`, at: i })));
    const storage = {
      kvUpdate: async (_key, update) => { raw = update(raw); },
    };
    await appendAudit(storage, [
      { actor: 'admin', action: 'created', kind: 'сделка', name: 'A', fields: [] },
      { actor: 'admin', action: 'deleted', kind: 'сделка', name: 'B', fields: [] },
      { actor: 'admin', action: 'updated', kind: 'сделка', name: 'C', fields: ['сумма'] },
    ], { at: 123456 });

    const events = JSON.parse(raw);
    expect(events).toHaveLength(AUDIT_LIMIT);
    expect(events.slice(0, 3).map((e) => e.name)).toEqual(['A', 'B', 'C']);
    expect(events[0]).toMatchObject({ actor: 'admin', at: 123456 });
    expect(events[0].id).toBeTruthy();
    expect(events.at(-1).id).toBe('old-496');
  });
});
