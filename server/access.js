/** Users and role rules for the CRM server. */

export const ROLES = ['admin', 'manager', 'viewer'];
export const ROLE_LABELS = { admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель' };

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

export function canWrite(user, key = '') {
  if (!user || user.role === 'viewer') return false;
  if (key === 'crm:audit:v1') return false;
  return user.role === 'admin' || user.role === 'manager';
}
