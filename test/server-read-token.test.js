import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentMayRead, readTokenFrom } from '../server/access.js';

const TOKEN = 'r'.repeat(40);

describe('read token rules', () => {
  it('is optional, but must be long when set', () => {
    expect(readTokenFrom('')).toBe('');
    expect(readTokenFrom(`  ${TOKEN}  `)).toBe(TOKEN);
    expect(() => readTokenFrom('short')).toThrow(/32/);
  });

  it('allows reading one collection and nothing else', () => {
    expect(agentMayRead('GET', '/kv/crm:deals:v1')).toBe(true);
    expect(agentMayRead('GET', '/kv/crm%3Atasks%3Av1')).toBe(true);
    expect(agentMayRead('PUT', '/kv/crm:deals:v1')).toBe(false);
    expect(agentMayRead('DELETE', '/kv/crm:deals:v1')).toBe(false);
    expect(agentMayRead('POST', '/transaction')).toBe(false);
    expect(agentMayRead('GET', '/kv/crm:audit:v1')).toBe(false);
    expect(agentMayRead('GET', '/kv/crm%3Aaudit%3Av1')).toBe(false);
    expect(agentMayRead('GET', '/audit')).toBe(false);
    expect(agentMayRead('GET', '/files')).toBe(false);
    expect(agentMayRead('GET', '/me')).toBe(false);
    expect(agentMayRead('GET', '/kv/%E0%A4%A')).toBe(false);
  });
});

describe('read token over HTTP', () => {
  let server;
  let base;
  let dataDir;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-read-token-'));
    vi.stubEnv('CRM_USERS', 'owner:pw:admin');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(32));
    vi.stubEnv('DATA_DIR', dataDir);
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('CRM_READ_TOKEN', TOKEN);
    vi.stubEnv('VERCEL', '1'); // no background scheduler in tests
    const { app } = await import('../server/app.js');
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api`;

    const login = await fetch(`http://127.0.0.1:${server.address().port}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'login=owner&password=pw',
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    await fetch(`${base}/kv/crm:tasks:v1`, {
      method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify([{ id: 't1', title: 'Позвонить' }]) }),
    });
  });

  afterAll(() => {
    server?.close();
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

  it('reads a collection with the token', async () => {
    const res = await fetch(`${base}/kv/crm:tasks:v1`, { headers: auth() });
    expect(res.status).toBe(200);
    expect(JSON.parse((await res.json()).value)[0].title).toBe('Позвонить');
  });

  it('refuses a wrong token', async () => {
    const res = await fetch(`${base}/kv/crm:tasks:v1`, { headers: auth('x'.repeat(40)) });
    expect(res.status).toBe(401);
  });

  it('refuses every write and the journal', async () => {
    const put = await fetch(`${base}/kv/crm:tasks:v1`, {
      method: 'PUT', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ value: '[]' }),
    });
    expect(put.status).toBe(403);
    const del = await fetch(`${base}/kv/crm:tasks:v1`, { method: 'DELETE', headers: auth() });
    expect(del.status).toBe(403);
    expect((await fetch(`${base}/audit`, { headers: auth() })).status).toBe(403);
    expect((await fetch(`${base}/kv/crm:audit:v1`, { headers: auth() })).status).toBe(403);

    const after = await fetch(`${base}/kv/crm:tasks:v1`, { headers: auth() });
    expect(JSON.parse((await after.json()).value)).toHaveLength(1);
  });

  it('still needs a session without the token', async () => {
    expect((await fetch(`${base}/kv/crm:tasks:v1`)).status).toBe(401);
  });
});
