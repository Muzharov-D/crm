/**
 * The slice of the Puter SDK this app uses, answered by our own server
 * (server/index.js) instead of the Puter cloud: sign-in, KV and files.
 * No puter.ai here, so the AI assist controls stay hidden.
 */
(() => {
  const api = async (url, options = {}) => {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    if (!res.ok) {
      const err = new Error(res.status === 404 ? 'not found' : `request failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  };
  const json = async (url, options) => (await api(url, options)).json();
  const q = (name, value) => `${name}=${encodeURIComponent(String(value).replace(/^\/+/, ''))}`;

  window.puter = {
    env: 'web',
    auth: {
      // A network failure throws (the app then boots offline from its local
      // copy); a server that answers "not signed in" is a plain false.
      async isSignedIn() {
        const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
        return res.ok;
      },
      async signIn() {
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
        return new Promise(() => {});
      },
      async signOut() {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
      },
      getUser: () => json('/api/me', { cache: 'no-store' }),
    },
    kv: {
      get: async (key) => (await json(`/api/kv/${encodeURIComponent(key)}`, { cache: 'no-store' })).value,
      async set(key, value) {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        await api(`/api/kv/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: text }),
        });
        return true;
      },
      del: async (key) => (await json(`/api/kv/${encodeURIComponent(key)}`, { method: 'DELETE' })).deleted,
    },
    fs: {
      async write(path, data) {
        const body = data instanceof Blob ? data : new Blob([data ?? '']);
        return json(`/api/files?${q('path', path)}`, { method: 'PUT', body });
      },
      read: async (path) => (await api(`/api/files?${q('path', path)}`, { cache: 'no-store' })).blob(),
      async delete(path) {
        await api(`/api/files?${q('path', path)}`, { method: 'DELETE' });
      },
      readdir: (dir) => json(`/api/files/list?${q('dir', dir)}`, { cache: 'no-store' }),
      mkdir: async () => ({}),
    },
  };
})();
