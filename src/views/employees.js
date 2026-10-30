import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite } from '../lib/access.js';
import { openEmployeeForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState, facts, relatedRecords, avandokEmpty } from '../ui/mvp-bits.js';
import { exportXlsx } from '../lib/xlsx.js';
import { confirmDialog } from '../ui/modal.js';

export function employeesView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });
  function list() {
    root.append(pageHead('Сотрудники', 'Бизнес-сотрудники и их роли — отдельно от системных прав доступа',
      actionButton('Экспорт XLSX', () => exportXlsx('employees'), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый сотрудник', () => openEmployeeForm(), { primary: true, iconName: 'plus' })),
      store.employees.length ? el('div.table-wrap', {}, el('table.data-table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'ФИО'), el('th', {}, 'Роль'), el('th', {}, 'Статус'), el('th', {}, 'Пользователь'), el('th', {}, 'Лиды'), el('th', {}, 'Сделки в команде'), el('th', {}, 'Задачи'))),
        el('tbody', {}, store.employees.map((e) => el('tr', {},
          el('td', {}, el('a.record-link', { href: `#/employees?id=${e.id}` }, e.name)), el('td', {}, e.role || '—'),
          el('td', {}, el('span.status-chip', { className: `status-chip${e.active !== false ? ' success' : ' muted'}` }, e.active !== false ? 'Активен' : 'Выключен')),
          el('td', {}, e.username || '—'), el('td.num', {}, store.leads.filter((l) => l.employeeId === e.id).length),
          el('td.num', {}, new Set(store.salesTeam.filter((r) => r.employeeId === e.id).map((r) => r.dealId)).size),
          el('td.num', {}, store.tasks.filter((t) => t.employeeId === e.id && !t.done).length))))))
        : emptyState('Сотрудников пока нет', 'Добавьте команду, чтобы назначать ответственных в лидах, задачах, событиях и сделках.'));
  }
  function detail() {
    const employee = store.employeeById(id);
    if (!employee) { root.append(emptyState('Сотрудник не найден', '', el('a.btn.btn-ghost', { href: '#/employees' }, 'К списку'))); return; }
    const teams = store.salesTeam.filter((r) => r.employeeId === id);
    root.append(el('a.back-link', { href: '#/employees' }, '← Все сотрудники'),
      pageHead(employee.name, employee.role || 'Роль не указана', canWrite(store.user) && actionButton('Редактировать', () => openEmployeeForm(employee), { iconName: 'pencil' })),
      el('section.detail-section', {}, facts([['ФИО', employee.name], ['Роль', employee.role || '—'], ['Статус', employee.active !== false ? 'Активен' : 'Выключен'], ['Системный пользователь', employee.username || 'Не связан'], ['Комментарий', employee.notes || '—']]),
        el('p.field-hint', {}, 'Системные роли admin / manager / viewer управляются доступом к CRM и не подменяют бизнес-роль сотрудника.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Команды продаж')),
        teams.length ? el('div.link-list', {}, teams.map((r) => { const d = store.dealById(r.dealId); return d && el('a.person-row', { href: `#/pipeline?id=${d.id}` },
          el('span.grow', {}, d.name), el('span.muted', {}, `${r.role || 'Роль не указана'}${r.primary ? ' · Основной' : ''}`)); })) : el('p.muted', {}, 'Нет сделок в команде продаж.')),
      relatedRecords('employee', id), avandokEmpty(),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить сотрудника', async () => {
        if (!await confirmDialog({ title: 'Удалить сотрудника?', message: 'Связи в записях будут сняты, сами записи сохранятся.' })) return;
        await store.deleteEmployee(id); navigate('#/employees');
      }, { iconName: 'trash' })));
  }
  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
