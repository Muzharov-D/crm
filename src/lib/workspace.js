/**
 * Product-level workspace controls. These are application preferences, not
 * security permissions: server-side access rules remain in access.js.
 * Everything defaults to enabled so existing installations keep their UI.
 */

export const MODULES = [
  { key: 'dashboard', path: 'dashboard', label: 'Обзор', description: 'Утренняя сводка и показатели продаж.' },
  { key: 'pipeline', path: 'pipeline', label: 'Сделки', description: 'Воронка, реестр сделок, платежи и команды продаж.' },
  { key: 'leads', path: 'leads', label: 'Лиды', description: 'Квалификация L0–L5 и перевод в сделки.' },
  { key: 'companies', path: 'companies', label: 'Клиенты', description: 'Контрагенты, контакты и клиентские команды.' },
  { key: 'tasks', path: 'followups', label: 'Задачи', description: 'Канбан, сроки и связанные задачи.' },
  { key: 'reports', path: 'forecast', label: 'Отчёты', description: 'План-факт, прогноз и аналитика.' },
  { key: 'employees', path: 'employees', label: 'Сотрудники', description: 'Бизнес-роли, загрузка и активность команды.' },
  { key: 'dictionaries', path: 'dictionaries', label: 'Справочники', description: 'Управляемые значения прикладных полей.' },
  { key: 'audit', path: 'audit', label: 'Аудит', description: 'История прикладных изменений.' },
];

export const BLOCKS = [
  { key: 'dashboardKpis', label: 'Ключевые показатели', description: 'Воронка, прогноз, план и конверсия.', group: 'Обзор' },
  { key: 'dashboardAttention', label: 'Требует внимания', description: 'Просроченные задачи, зависшие сделки и решения.', group: 'Обзор' },
  { key: 'dashboardPulse', label: 'Пульс работы', description: 'Качество данных и операционные сигналы.', group: 'Обзор' },
  { key: 'dashboardCold', label: 'Остывающие клиенты', description: 'Контакты без касаний и сделки без следующего шага.', group: 'Обзор' },
  { key: 'dashboardPipeline', label: 'Воронка по этапам', description: 'Суммы и количество открытых сделок.', group: 'Обзор' },
  { key: 'dashboardActivity', label: 'Последние события', description: 'Лента свершившихся действий команды.', group: 'Обзор' },
  { key: 'globalSearch', label: 'Глобальный поиск', description: 'Ctrl/Cmd+K и поиск по записям.', group: 'Инструменты' },
  { key: 'quickCreate', label: 'Быстрое создание', description: 'Единое меню новых записей в верхней панели.', group: 'Инструменты' },
  { key: 'notifications', label: 'Центр уведомлений', description: 'Просрочки и риски в одном окне.', group: 'Инструменты' },
];

export const DEFAULT_WORKSPACE = Object.freeze({
  modules: Object.fromEntries(MODULES.map((m) => [m.key, true])),
  blocks: Object.fromEntries(BLOCKS.map((b) => [b.key, true])),
  home: 'dashboard',
  density: 'comfortable',
});

export function workspaceOf(settings = {}) {
  const source = settings.workspace || {};
  const modules = { ...DEFAULT_WORKSPACE.modules };
  const blocks = { ...DEFAULT_WORKSPACE.blocks };
  for (const key of Object.keys(modules)) {
    if (typeof source.modules?.[key] === 'boolean') modules[key] = source.modules[key];
  }
  for (const key of Object.keys(blocks)) {
    if (typeof source.blocks?.[key] === 'boolean') blocks[key] = source.blocks[key];
  }
  const home = MODULES.some((m) => m.key === source.home) ? source.home : 'dashboard';
  return {
    modules,
    blocks,
    home,
    density: source.density === 'compact' ? 'compact' : 'comfortable',
  };
}

export function moduleEnabled(settings, key) {
  return workspaceOf(settings).modules[key] !== false;
}

export function blockEnabled(settings, key) {
  return workspaceOf(settings).blocks[key] !== false;
}

const ROUTE_ALIASES = {
  forecast: 'reports',
  contacts: 'companies',
  tasks: 'tasks',
  activity: 'companies',
  control: null,
  settings: null,
};

export function routeModule(path) {
  if (Object.prototype.hasOwnProperty.call(ROUTE_ALIASES, path)) return ROUTE_ALIASES[path];
  return MODULES.find((m) => m.path === path || m.key === path)?.key || null;
}

export function routeEnabled(settings, path) {
  const module = routeModule(path);
  return !module || moduleEnabled(settings, module);
}

export function homeHash(settings) {
  const workspace = workspaceOf(settings);
  const selected = MODULES.find((m) => m.key === workspace.home && workspace.modules[m.key]);
  const first = selected || MODULES.find((m) => workspace.modules[m.key]);
  return first ? `#/${first.path}` : '#/settings';
}

export function enabledModuleCount(settings) {
  const workspace = workspaceOf(settings);
  return MODULES.filter((m) => workspace.modules[m.key]).length;
}

export const WORKSPACE_PRESETS = [
  {
    key: 'full', label: 'Полный цикл', description: 'Все прикладные разделы и рабочие блоки.',
    modules: Object.fromEntries(MODULES.map((m) => [m.key, true])),
    blocks: Object.fromEntries(BLOCKS.map((b) => [b.key, true])),
  },
  {
    key: 'sales', label: 'Только продажи', description: 'Лиды, сделки, клиенты, задачи и команда — без административных разделов.',
    modules: { dashboard: true, pipeline: true, leads: true, companies: true, tasks: true, reports: false, employees: true, dictionaries: false, audit: false },
    blocks: { dashboardPulse: true, dashboardActivity: true, globalSearch: true, quickCreate: true, notifications: true },
  },
  {
    key: 'executive', label: 'Руководитель', description: 'Обзор, сделки, клиенты и отчётность с фокусом на показателях.',
    modules: { dashboard: true, pipeline: true, leads: false, companies: true, tasks: false, reports: true, employees: false, dictionaries: false, audit: false },
    blocks: { dashboardKpis: true, dashboardAttention: true, dashboardPulse: true, dashboardCold: false, dashboardPipeline: true, dashboardActivity: false, globalSearch: true, quickCreate: false, notifications: true },
  },
];
