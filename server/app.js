/**
 * The CRM's API: stands in for the Puter cloud the app was written for
 * (sign-in, KV, files). See public/platform.js for the browser half.
 * server/index.js runs it with the built app; api/index.js on Vercel.
 *
 * Environment:
 *   CRM_USERS       "login:password:role;login2:password2:role" (legacy entries are admins)
 *   SESSION_SECRET  signs the session cookie (required in production)
 *   DATABASE_URL    Postgres; without it data goes to DATA_DIR as files
 *   DATA_DIR        local data folder (default ./data)
 */
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage, cleanKey, cleanPath } from './storage.js';
import { mergeValue } from './merge.js';
import { parseUsers, canWrite } from './access.js';
import { auditForKV, appendAudit, AUDIT_KEY } from './audit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const COOKIE = 'crm_session';
const SESSION_DAYS = 30;

const users = parseUsers(process.env.CRM_USERS);
if (!users.size) {
  throw new Error('CRM_USERS is empty: set it to "login:password".');
}

let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (production) {
    throw new Error('SESSION_SECRET is required in production.');
  }
  secret = crypto.randomBytes(32).toString('hex');
}

const storage = await openStorage({
  databaseUrl: process.env.DATABASE_URL,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
});

/* ---------- sessions: "login.expires.signature" in an HttpOnly cookie ---------- */

const sign = (text) => crypto.createHmac('sha256', secret).update(text).digest('base64url');

function makeSession(login) {
  const body = `${Buffer.from(login).toString('base64url')}.${Date.now() + SESSION_DAYS * 86400000}`;
  return `${body}.${sign(body)}`;
}

function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [login64, expires, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!login64 || !expires || !sig) return null;
  const expected = sign(`${login64}.${expires}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  const login = Buffer.from(login64, 'base64url').toString();
  return users.has(login) ? login : null;
}

function setCookie(res, value, maxAgeSeconds) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (production) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const sameText = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const fileDisplayName = (p) => p.split('/').pop()
  .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');

/* ---------- login attempts: 10 per IP per 15 minutes ---------- */

const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
  attempts.set(ip, list);
  return list.length >= 10;
}

/* ---------- app ---------- */

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const page = (error = '', next = '/') => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вход в CRM</title>
<style>
  :root { color-scheme: light dark; --bg: #f9f9f7; --panel: #fff; --line: #e3e3de; --text: #1a1a1a; --muted: #6b6b66; --accent: #3054ff; --bad: #c23a2b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d0d0d; --panel: #161616; --line: #2a2a2a; --text: #ececec; --muted: #9a9a9a; --bad: #ff6b5b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; padding: 16px; }
  form { width: 100%; max-width: 340px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 28px 24px; display: grid; gap: 14px; }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
  label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
  input { font: inherit; color: var(--text); background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  button { font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 11px; cursor: pointer; }
  .error { color: var(--bad); font-size: 13px; margin: 0; }
</style></head>
<body><form method="post" action="/login">
  <h1>CRM</h1>
  ${error ? `<p class="error" role="alert">${error}</p>` : ''}
  <input type="hidden" name="next" value="${next.replace(/"/g, '')}">
  <label>Логин<input name="login" autocomplete="username" required autofocus></label>
  <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Войти</button>
</form></body></html>`;

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/');

app.get('/login', (req, res) => {
  if (readSession(req)) return res.redirect(safeNext(req.query.next));
  res.type('html').send(page('', safeNext(req.query.next)));
});

app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
  const ip = req.ip || 'unknown';
  const next = safeNext(req.body?.next);
  if (tooManyAttempts(ip)) {
    return res.status(429).type('html').send(page('Слишком много попыток. Подождите 15 минут.', next));
  }
  const login = String(req.body?.login || '').trim();
  const known = users.get(login);
  if (!known || !sameText(known.password, req.body?.password || '')) {
    attempts.get(ip).push(Date.now());
    return res.status(401).type('html').send(page('Неверный логин или пароль.', next));
  }
  setCookie(res, makeSession(login), SESSION_DAYS * 86400);
  res.redirect(next);
});

app.post('/api/logout', (req, res) => {
  setCookie(res, '', 0);
  res.json({ ok: true });
});

/* Everything under /api below needs a session. */
app.use('/api', (req, res, next) => {
  const login = readSession(req);
  if (!login) return res.status(401).json({ error: 'not_signed_in' });
  req.login = login;
  req.user = users.get(login);
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/me', (req, res) => {
  res.json({ username: req.login, uuid: `local-${req.login}`, role: req.user.role });
});

app.get('/api/audit', async (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  try {
    const raw = await storage.kvGet(AUDIT_KEY);
    const events = raw ? JSON.parse(raw) : [];
    res.json(Array.isArray(events) ? events : []);
  } catch (err) {
    next(err);
  }
});

/* Role enforcement lives on the server: a modified client cannot turn a
   viewer into an editor. The audit log itself is append-only through writes
   performed by the server, never through the public KV API. */
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const target = req.path.startsWith('/kv/') ? req.path.slice(4) : req.path;
  if (!canWrite(req.user, target)) {
    return res.status(403).json({ error: 'read_only', message: 'Роль наблюдателя позволяет только просматривать данные.' });
  }
  next();
});

app.get('/api/kv/:key', async (req, res, next) => {
  const key = cleanKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'bad_key' });
  try {
    res.json({ value: await storage.kvGet(key) });
  } catch (err) {
    next(err);
  }
});

app.put('/api/kv/:key', express.json({ limit: '25mb' }), async (req, res, next) => {
  const key = cleanKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'bad_key' });
  const value = req.body?.value;
  if (typeof value !== 'string') return res.status(400).json({ error: 'value_must_be_text' });
  // With `base` (what this client last saw), changes saved by others since
  // are merged in instead of overwritten. See merge.js.
  const hasBase = req.body && 'base' in req.body;
  const base = typeof req.body?.base === 'string' ? req.body.base : null;
  try {
    let events = [];
    const stored = await storage.kvUpdate(key, (current) => {
      const next = hasBase ? mergeValue(base, value, current) : value;
      events = auditForKV({ key, currentRaw: current, nextRaw: next, actor: req.login });
      return next;
    });
    await appendAudit(storage, events).catch((err) => console.error('audit:', err));
    res.json({ ok: true, merged: stored !== value });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/kv/:key', async (req, res, next) => {
  const key = cleanKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'bad_key' });
  try {
    const currentRaw = await storage.kvGet(key);
    const deleted = await storage.kvDelete(key);
    if (deleted) {
      const events = auditForKV({ key, currentRaw, nextRaw: null, actor: req.login });
      await appendAudit(storage, events).catch((err) => console.error('audit:', err));
    }
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

app.get('/api/files/list', async (req, res, next) => {
  const dir = cleanPath(req.query.dir);
  if (!dir) return res.status(400).json({ error: 'bad_path' });
  try {
    const items = await storage.fileList(dir);
    res.json(items.map((f) => ({ ...f, name: f.path.split('/').pop(), is_dir: false })));
  } catch (err) {
    next(err);
  }
});

app.get('/api/files', async (req, res, next) => {
  const p = cleanPath(req.query.path);
  if (!p) return res.status(400).json({ error: 'bad_path' });
  try {
    const data = await storage.fileRead(p);
    if (!data) return res.status(404).json({ error: 'not_found' });
    res.type('application/octet-stream').send(data);
  } catch (err) {
    next(err);
  }
});

app.put('/api/files', express.raw({ type: () => true, limit: '50mb' }), async (req, res, next) => {
  const p = cleanPath(req.query.path);
  if (!p) return res.status(400).json({ error: 'bad_path' });
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const info = await storage.fileWrite(p, buf);
    await appendAudit(storage, [{
      actor: req.login, action: 'uploaded', kind: 'документ', name: fileDisplayName(p), fields: [], details: `${buf.length} байт`,
    }]).catch((err) => console.error('audit:', err));
    res.json({ path: p, name: p.split('/').pop(), ...info });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/files', async (req, res, next) => {
  const p = cleanPath(req.query.path);
  if (!p) return res.status(400).json({ error: 'bad_path' });
  try {
    await storage.fileDelete(p);
    await appendAudit(storage, [{
      actor: req.login, action: 'deleted', kind: 'документ', name: fileDisplayName(p), fields: [],
    }]).catch((err) => console.error('audit:', err));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

export const storageKind = storage.kind;
