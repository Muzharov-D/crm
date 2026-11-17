export const ROLE_LABELS = {
  admin: 'Администратор',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.admin;
}

export function canWrite(user) {
  return user?.role === 'admin' || user?.role === 'manager';
}

export function canAdmin(user) {
  return user?.role === 'admin';
}

export function adminOnlyError() {
  return new Error('Удаление записей доступно только администратору');
}

export function readOnlyError() {
  return new Error('read_only');
}
