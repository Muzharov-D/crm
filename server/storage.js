/**
 * Where the CRM's data lives on our own server.
 *
 *   kv     the app's collections (contacts, deals, ...), one text value per key
 *   files  attachments and backups, raw bytes by path
 *
 * Postgres when DATABASE_URL is set (Render), plain files under DATA_DIR
 * otherwise (local runs). Both sides answer the same small interface.
 */
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** App paths look like "attachments/ab12-proposal.pdf"; nothing else gets in. */
export function cleanPath(p) {
  const s = String(p || '').replace(/^\/+|\/+$/g, '');
  if (!s || s.length > 300 || !/^[A-Za-z0-9._\/-]+$/.test(s)) return null;
  if (s.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return s;
}

export function cleanKey(k) {
  const s = String(k || '');
  return s && s.length <= 200 && /^[A-Za-z0-9:._-]+$/.test(s) ? s : null;
}

export async function openStorage({ databaseUrl, dataDir }) {
  return databaseUrl ? postgresStorage(databaseUrl) : fileStorage(dataDir);
}

async function postgresStorage(url) {
  const { default: pg } = await import('pg');
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
    // A serverless instance handles one request at a time.
    max: process.env.VERCEL ? 2 : 10,
  });
  await pool.query(`
    create table if not exists crm_kv (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    );
    create table if not exists crm_files (
      path text primary key,
      data bytea not null,
      size integer not null,
      updated_at timestamptz not null default now()
    );
  `);
  return {
    kind: 'postgres',
    async kvGet(key) {
      const r = await pool.query('select value from crm_kv where key = $1', [key]);
      return r.rows[0]?.value || null;
    },
    async kvSet(key, value) {
      await pool.query(
        `insert into crm_kv (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [key, value],
      );
    },
    /** Read, change and write one key under a row lock, so concurrent saves queue up. */
    async kvUpdate(key, change) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('insert into crm_kv (key, value) values ($1, $2) on conflict (key) do nothing', [key, '']);
        const r = await client.query('select value from crm_kv where key = $1 for update', [key]);
        const current = r.rows[0]?.value || null;
        const next = change(current);
        await client.query('update crm_kv set value = $2, updated_at = now() where key = $1', [key, next]);
        await client.query('commit');
        return next;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async kvDelete(key) {
      const r = await pool.query('delete from crm_kv where key = $1', [key]);
      return r.rowCount > 0;
    },
    async fileWrite(p, buf) {
      await pool.query(
        `insert into crm_files (path, data, size) values ($1, $2, $3)
         on conflict (path) do update set data = excluded.data, size = excluded.size, updated_at = now()`,
        [p, buf, buf.length],
      );
      return { size: buf.length, modified: Date.now() };
    },
    async fileRead(p) {
      const r = await pool.query('select data from crm_files where path = $1', [p]);
      return r.rows[0]?.data ?? null;
    },
    async fileDelete(p) {
      await pool.query('delete from crm_files where path = $1 or path like $2', [p, `${p}/%`]);
    },
    async fileList(dir) {
      const r = await pool.query(
        `select path, size, extract(epoch from updated_at) * 1000 as modified
         from crm_files where path like $1 and position('/' in substr(path, $2)) = 0`,
        [`${dir}/%`, dir.length + 2],
      );
      return r.rows.map((row) => ({ path: row.path, size: row.size, modified: Number(row.modified) }));
    },
  };
}

async function fileStorage(dataDir) {
  const kvDir = path.join(dataDir, 'kv');
  const filesDir = path.join(dataDir, 'files');
  await mkdir(kvDir, { recursive: true });
  await mkdir(filesDir, { recursive: true });
  const kvFile = (key) => path.join(kvDir, `${encodeURIComponent(key)}.txt`);
  const missing = (err) => err?.code === 'ENOENT';
  // One process owns the folder: a promise chain per key is enough of a lock.
  const queues = new Map();
  return {
    kind: 'files',
    kvUpdate(key, change) {
      const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        const next = change(await this.kvGet(key));
        await this.kvSet(key, next);
        return next;
      });
      queues.set(key, run);
      return run;
    },
    async kvGet(key) {
      try {
        return await readFile(kvFile(key), 'utf8');
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async kvSet(key, value) {
      await writeFile(kvFile(key), value, 'utf8');
    },
    async kvDelete(key) {
      try {
        await rm(kvFile(key));
        return true;
      } catch (err) {
        if (missing(err)) return false;
        throw err;
      }
    },
    async fileWrite(p, buf) {
      const full = path.join(filesDir, p);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, buf);
      return { size: buf.length, modified: Date.now() };
    },
    async fileRead(p) {
      try {
        return await readFile(path.join(filesDir, p));
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async fileDelete(p) {
      await rm(path.join(filesDir, p), { recursive: true, force: true });
    },
    async fileList(dir) {
      let names;
      try {
        names = await readdir(path.join(filesDir, dir));
      } catch (err) {
        if (missing(err)) return [];
        throw err;
      }
      const out = [];
      for (const name of names) {
        const s = await stat(path.join(filesDir, dir, name));
        if (s.isFile()) out.push({ path: `${dir}/${name}`, size: s.size, modified: s.mtimeMs });
      }
      return out;
    },
  };
}
