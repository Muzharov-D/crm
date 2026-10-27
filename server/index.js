/**
 * The CRM's own server: serves the built app and stands in for the Puter
 * cloud it was written for (sign-in, KV, files). See public/platform.js
 * for the browser half.
 *
 * Environment:
 *   PORT            listen port (Render sets it)
 *   CRM_USERS       "login:password;login2:password2"
 *   SESSION_SECRET  signs the session cookie (required in production)
 *   DATABASE_URL    Postgres; without it data goes to DATA_DIR as files
 *   DATA_DIR        local data folder (default ./data)
 */
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage, cleanKey, cleanPath } from './storage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 8790;
const COOKIE = 'crm_session';
const SESSION_DAYS = 30;

const users = new Map(
  String(process.env.CRM_USERS || '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      return [pair.slice(0, i).trim(), pair.slice(i + 1)];
    })
    .filter(([login, pass]) => login && pass),
);
if (!users.size) {
  console.error('CRM_USERS is empty: set it to "login:password".');
  process.exit(1);
}

let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (production) {
    console.error('SESSION_SECRET is required in production.');
    process.exit(1);
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

/* ---------- login attempts: 10 per IP per 15 minutes ---------- */

const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
  attempts.set(ip, list);
  return list.length >= 10;
}

/* ---------- app ---------- */

const app = express();
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
  if (!known || !sameText(known, req.body?.password || '')) {
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
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/me', (req, res) => {
  res.json({ username: req.login, uuid: `local-${req.login}` });
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
  try {
    await storage.kvSet(key, value);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/kv/:key', async (req, res, next) => {
  const key = cleanKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'bad_key' });
  try {
    res.json({ deleted: await storage.kvDelete(key) });
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
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

/* The built app. The service worker must always be revalidated. */
const dist = path.join(root, 'dist');
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(dist, 'sw.js'));
});
app.use(express.static(dist, { index: 'index.html' }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => {
  console.log(`CRM on http://localhost:${PORT} (storage: ${storage.kind})`);
});
