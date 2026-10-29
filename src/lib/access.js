export const ROLE_LABELS = {
  admin: 'Администратор',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.admin;
}

export function canWrite(user) {
  return user?.role !== 'viewer';
}

export function readOnlyError() {
  return new Error('read_only');
}
