import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseUsers, canWrite, removesRecords, DEAL_TRANSACTION_KEYS } from '../server/access.js';
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

  it('allows canonical deal tasks in atomic server transactions', () => {
    expect(DEAL_TRANSACTION_KEYS.has('crm:tasks:v1')).toBe(true);
    expect(DEAL_TRANSACTION_KEYS.has('crm:deal-notifications:v1')).toBe(true);
    expect(DEAL_TRANSACTION_KEYS.has('crm:audit:v1')).toBe(false);
  });
});

describe('administrator-only record removal', () => {
  it('detects a removed top-level record in a whole-collection update', () => {
    const current = JSON.stringify([{ id: 'deal-1' }, { id: 'deal-2' }]);
    const next = JSON.stringify([{ id: 'deal-1', name: 'Изменено' }]);
    expect(removesRecords('crm:deals:v1', current, next)).toBe(true);
  });

  it('allows creates, updates and unchanged collections', () => {
    const current = JSON.stringify([{ id: 'deal-1', name: 'До' }]);
    expect(removesRecords('crm:deals:v1', current,
      JSON.stringify([{ id: 'deal-1', name: 'После' }, { id: 'deal-2' }]))).toBe(false);
    expect(removesRecords('crm:deals:v1', current, current)).toBe(false);
    expect(removesRecords('crm:deals:v1', null,
      JSON.stringify([{ id: 'deal-1' }]))).toBe(false);
  });

  it('protects attachment records as well as CRM entities', () => {
    expect(removesRecords('crm:attachments:v1',
      JSON.stringify([{ id: 'file-1' }, { id: 'file-2' }]),
      JSON.stringify([{ id: 'file-1' }]))).toBe(true);
  });

  it('does not confuse nested relation removal with deleting a record', () => {
    const current = JSON.stringify([{
      id: 'deal-1',
      contacts: [{ contactId: 'contact-1' }, { contactId: 'contact-2' }],
      companyTeam: [{ id: 'member-1' }, { id: 'member-2' }],
    }]);
    const next = JSON.stringify([{
      id: 'deal-1', contacts: [{ contactId: 'contact-1' }], companyTeam: [],
    }]);
    expect(removesRecords('crm:deals:v1', current, next)).toBe(false);
  });

  it('ignores non-record collections and malformed payloads', () => {
    expect(removesRecords('crm:settings:v1', '{"a":1}', '{}')).toBe(false);
    expect(removesRecords('crm:deals:v1', 'not-json', '[]')).toBe(false);
    expect(removesRecords('crm:deals:v1', '[]', null)).toBe(false);
  });
});

describe('API administrator-only deletion enforcement', () => {
  let server;
  let baseUrl;
  let dataDir;
  let cookies;
  const previousEnv = {};

  function sessionCookie(username) {
    const body = `${Buffer.from(username).toString('base64url')}.${Date.now() + 60000}`;
    const signature = crypto.createHmac('sha256', 'test-only-session-secret').update(body).digest('base64url');
    return `crm_session=${body}.${signature}`;
  }

  async function api(pathname, { method = 'GET', cookie = cookies.admin, body } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    for (const key of ['CRM_USERS', 'SESSION_SECRET', 'DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NODE_ENV']) {
      previousEnv[key] = process.env[key];
    }
    dataDir = await mkdtemp(path.join(tmpdir(), 'crm-api-access-'));
    process.env.CRM_USERS = 'api-admin:test-secret:admin;api-manager:test-secret:manager;api-viewer:test-secret:viewer';
    process.env.SESSION_SECRET = 'test-only-session-secret';
    process.env.DATA_DIR = dataDir;
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'test';
    const { app } = await import('../server/app.js');
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    cookies = {
      admin: sessionCookie('api-admin'),
      manager: sessionCookie('api-manager'),
      viewer: sessionCookie('api-viewer'),
    };
    expect((await api('/api/kv/crm:deals:v1', {
      method: 'PUT', body: { value: JSON.stringify([
        { id: 'deal-1', name: 'Первая', revision: 1 },
        { id: 'deal-2', name: 'Вторая', revision: 1 },
      ]) },
    })).status).toBe(200);
    expect((await api('/api/kv/crm:attachments:v1', {
      method: 'PUT', body: { value: JSON.stringify([{ id: 'file-1' }, { id: 'file-2' }]) },
    })).status).toBe(200);
  }, 20000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns 403 and preserves records when a manager submits a removal after merging', async () => {
    const current = JSON.stringify([
      { id: 'deal-1', name: 'Первая', revision: 1 },
      { id: 'deal-2', name: 'Вторая', revision: 1 },
    ]);
    const next = JSON.stringify([{ id: 'deal-1', name: 'Изменено менеджером', revision: 1 }]);
    const result = await api('/api/kv/crm:deals:v1', {
      method: 'PUT', cookie: cookies.manager, body: { base: current, value: next },
    });
    expect(result).toMatchObject({ status: 403, body: { error: 'admin_only' } });
    const stored = await api('/api/kv/crm:deals:v1');
    expect(JSON.parse(stored.body.value)).toHaveLength(2);
    expect(JSON.parse(stored.body.value)[0].name).toBe('Первая');
  });

  it('lets a manager change nested relations without deleting the deal', async () => {
    const stored = await api('/api/kv/crm:deals:v1');
    const deals = JSON.parse(stored.body.value);
    deals[0].contacts = [{ contactId: 'contact-1' }];
    const result = await api('/api/kv/crm:deals:v1', {
      method: 'PUT', cookie: cookies.manager, body: { value: JSON.stringify(deals) },
    });
    expect(result.status).toBe(200);
  });

  it('rejects viewer writes and manager attachment removal', async () => {
    expect((await api('/api/kv/crm:deals:v1', {
      method: 'PUT', cookie: cookies.viewer, body: { value: '[]' },
    })).body.error).toBe('read_only');
    const result = await api('/api/kv/crm:attachments:v1', {
      method: 'PUT', cookie: cookies.manager,
      body: { value: JSON.stringify([{ id: 'file-1' }]) },
    });
    expect(result).toMatchObject({ status: 403, body: { error: 'admin_only' } });
    const stored = await api('/api/kv/crm:attachments:v1');
    expect(JSON.parse(stored.body.value)).toHaveLength(2);
  });

  it('blocks record removal inside an atomic deal transaction', async () => {
    const deals = JSON.parse((await api('/api/kv/crm:deals:v1')).body.value);
    const tasks = [{ id: 'task-1', dealId: 'deal-1', title: 'Позвонить' }];
    expect((await api('/api/kv/crm:tasks:v1', {
      method: 'PUT', body: { value: JSON.stringify(tasks) },
    })).status).toBe(200);
    const result = await api('/api/transaction', {
      method: 'POST', cookie: cookies.manager,
      body: {
        dealId: 'deal-1', expectedRevision: 1, operationId: 'delete-task-1',
        writes: [
          { key: 'crm:deals:v1', value: JSON.stringify(deals) },
          { key: 'crm:tasks:v1', value: '[]' },
        ],
      },
    });
    expect(result).toMatchObject({ status: 403, body: { error: 'admin_only' } });
    const stored = await api('/api/kv/crm:tasks:v1');
    expect(JSON.parse(stored.body.value)).toHaveLength(1);
  });

  it('still allows an administrator to remove a record', async () => {
    const deals = JSON.parse((await api('/api/kv/crm:deals:v1')).body.value);
    const result = await api('/api/kv/crm:deals:v1', {
      method: 'PUT', body: { value: JSON.stringify(deals.filter((deal) => deal.id !== 'deal-2')) },
    });
    expect(result.status).toBe(200);
    const stored = await api('/api/kv/crm:deals:v1');
    expect(JSON.parse(stored.body.value).map((deal) => deal.id)).toEqual(['deal-1']);
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
