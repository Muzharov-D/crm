/** Users and role rules for the CRM server. */

export const ROLES = ['admin', 'manager', 'viewer'];
export const ROLE_LABELS = { admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель' };

/* Collections allowed in one optimistic, idempotent deal mutation. */
export const DEAL_TRANSACTION_KEYS = new Set([
  'crm:deals:v1', 'crm:activities:v1', 'crm:deal-steps:v1', 'crm:deal-stage-history:v1',
  'crm:deal-field-history:v1', 'crm:deal-notifications:v1', 'crm:tasks:v1',
]);

/** Top-level records whose removal is an administrator-only operation. */
export const ADMIN_DELETE_KEYS = new Set([
  'crm:companies:v1', 'crm:contacts:v1', 'crm:deals:v1', 'crm:employees:v1',
  'crm:leads:v1', 'crm:payments:v1', 'crm:activities:v1', 'crm:tasks:v1', 'crm:templates:v1',
  'crm:attachments:v1',
]);

/**
 * CRM_USERS accepts legacy login:password entries (admin by default) and
 * login:password:role entries. A password may contain colons; only a final
 * recognized role segment is treated as a role.
 */
export function parseUsers(raw) {
  const users = new Map();
  for (const pair of String(raw || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const first = pair.indexOf(':');
    if (first <= 0) continue;
    const login = pair.slice(0, first).trim();
    let password = pair.slice(first + 1);
    let role = 'admin';
    const last = password.lastIndexOf(':');
    const candidate = last >= 0 ? password.slice(last + 1).trim() : '';
    if (ROLES.includes(candidate)) {
      role = candidate;
      password = password.slice(0, last);
    }
    if (login && password) users.set(login, { password, role });
  }
  return users;
}

/**
 * CRM_READ_TOKEN: a key for agents such as the morning briefing.
 * With `Authorization: Bearer <token>` a request may only read one KV
 * collection (GET /api/kv/<key>); writes, files and the journal are refused.
 */
export const READ_TOKEN_MIN = 32;

export function readTokenFrom(raw) {
  const token = String(raw || '').trim();
  if (token && token.length < READ_TOKEN_MIN) {
    throw new Error(`CRM_READ_TOKEN must be at least ${READ_TOKEN_MIN} characters.`);
  }
  return token;
}

export function agentMayRead(method, path) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const match = /^\/kv\/([^/]+)$/.exec(path);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) !== 'crm:audit:v1';
  } catch {
    return false;
  }
}

export function canWrite(user, key = '') {
  if (!user || user.role === 'viewer') return false;
  if (key === 'crm:audit:v1') return false;
  return user.role === 'admin' || user.role === 'manager';
}

/**
 * Record deletion reaches the API as a whole-collection PUT, not HTTP DELETE.
 * Compare stable row ids after merging so a modified manager client cannot
 * bypass the administrator-only rule. Nested participants and team links are
 * intentionally unaffected: removing a relation does not delete the person.
 */
export function removesRecords(key, currentRaw, nextRaw) {
  if (!ADMIN_DELETE_KEYS.has(key) || typeof nextRaw !== 'string') return false;
  try {
    const current = currentRaw ? JSON.parse(currentRaw) : [];
    const next = JSON.parse(nextRaw);
    if (!Array.isArray(current) || !Array.isArray(next)) return false;
    const remaining = new Set(next.map((row) => row?.id).filter(Boolean));
    return current.some((row) => row?.id && !remaining.has(row.id));
  } catch {
    return false;
  }
}
