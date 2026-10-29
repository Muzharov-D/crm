import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite } from '../lib/access.js';
import { dictionary } from '../lib/spec.js';
import { openTaskForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState } from '../ui/mvp-bits.js';
import { formatDate, fuzzyIncludes, todayISO } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';

export function tasksMvpView() {
  const root = el('div.view');
  const state = { search: '', employeeId: '', status: '', layout: 'kanban' };
  const render = keepingFocus(() => {
    clear(root);
    const search = el('input.input', { type: 'search', value: state.search, placeholder: 'Описание или связанный объект', oninput: (e) => { state.search = e.target.value; render(); } });
    const employee = el('select.select', { onchange: (e) => { state.employeeId = e.target.value; render(); } },
      el('option', { value: '' }, 'Все сотрудники'), store.employees.map((e) => el('option', { value: e.id, selected: state.employeeId === e.id }, e.name)));
    const status = el('select.select', { onchange: (e) => { state.status = e.target.value; render(); } },
      el('option', { value: '' }, 'Все статусы'), dictionary(store.settings, 'taskStatuses').map((v) => el('option', { value: v, selected: state.status === v }, v)));
    const tasks = store.tasks.filter((t) => (!state.employeeId || t.employeeId === state.employeeId)
      && (!state.status || (t.status || 'К выполнению') === state.status)
      && (!state.search || fuzzyIncludes(`${t.title} ${linkedText(t)}`, state.search)));
    root.append(pageHead('Задачи', 'Сроки, ответственные и необязательные связи с любыми объектами CRM',
      canWrite(store.user) && actionButton('Новая задача', () => openTaskForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, employee, status, el('div.segmented', {},
        actionButton('Канбан', () => { state.layout = 'kanban'; render(); }, { attrs: { 'aria-pressed': state.layout === 'kanban' } }),
        actionButton('Список', () => { state.layout = 'list'; render(); }, { attrs: { 'aria-pressed': state.layout === 'list' } }))),
      !store.tasks.length ? emptyState('Задач пока нет', 'Создайте задачу здесь или прямо из карточки контрагента, контакта, лида или сделки.')
        : state.layout === 'kanban' ? kanban(tasks) : table(tasks));
  });
  function linkedText(t) {
    return store.dealById(t.dealId)?.name || store.leadById(t.leadId)?.name || store.contactById(t.contactId)?.name || store.companyById(t.companyId)?.name || '';
  }
  function linkedHref(t) {
    if (t.dealId) return `#/pipeline?id=${t.dealId}`; if (t.leadId) return `#/leads?id=${t.leadId}`;
    if (t.contactId) return `#/contacts?id=${t.contactId}`; if (t.companyId) return `#/companies?id=${t.companyId}`;
    return '';
  }
  function card(t) {
    const href = linkedHref(t);
    const node = el('article.task-card', { draggable: canWrite(store.user) ? 'true' : 'false' },
      el('div.task-card-title', {}, t.title),
      el('div.task-card-meta', {}, store.employeeById(t.employeeId)?.name || 'Ответственный не назначен'),
      el('div.task-card-meta', {}, `${formatDate(t.startDate)} — ${formatDate(t.due)}${!t.done && t.due < todayISO() ? ' · просрочено' : ''}`),
      href && el('a.record-link', { href }, linkedText(t)),
      el('div.task-card-actions', {},
        el('select.select', { 'aria-label': `Статус задачи ${t.title}`, disabled: !canWrite(store.user), onchange: (e) => store.updateTask(t.id, { status: e.target.value, done: e.target.value === 'Выполнено' }) },
          dictionary(store.settings, 'taskStatuses').map((v) => el('option', { value: v, selected: v === (t.status || 'К выполнению') }, v))),
        canWrite(store.user) && actionButton('Изменить', () => openTaskForm(t), { iconName: 'pencil' })));
    node.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/task-id', t.id)); return node;
  }
  function kanban(tasks) {
    return el('div.task-kanban', {}, dictionary(store.settings, 'taskStatuses').map((status) => {
      const rows = tasks.filter((t) => (t.status || 'К выполнению') === status).sort((a, b) => a.due.localeCompare(b.due));
      const column = el('section.task-column', {}, el('div.task-column-head', {}, el('strong', {}, status), el('span', {}, rows.length)), rows.map(card));
      column.addEventListener('dragover', (e) => { if (canWrite(store.user)) { e.preventDefault(); column.classList.add('drag-over'); } });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', async (e) => { e.preventDefault(); column.classList.remove('drag-over'); const id = e.dataTransfer.getData('text/task-id'); if (id && canWrite(store.user)) await store.updateTask(id, { status, done: status === 'Выполнено' }); });
      return column;
    }));
  }
  function table(tasks) {
    return el('div.table-wrap', {}, el('table.data-table', {}, el('thead', {}, el('tr', {}, ['Задача', 'Сотрудник', 'Начало', 'Окончание', 'Статус', 'Связь', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, tasks.length ? tasks.sort((a, b) => a.due.localeCompare(b.due)).map((t) => el('tr', {},
        el('td', {}, t.title), el('td', {}, store.employeeById(t.employeeId)?.name || '—'), el('td', {}, formatDate(t.startDate)), el('td', {}, formatDate(t.due)),
        el('td', {}, t.status || 'К выполнению'), el('td', {}, linkedHref(t) ? el('a.record-link', { href: linkedHref(t) }, linkedText(t)) : '—'),
        el('td.row-actions', {}, canWrite(store.user) && actionButton('Изменить', () => openTaskForm(t), { iconName: 'pencil' }),
          canWrite(store.user) && actionButton('Удалить', async () => { if (await confirmDialog({ title: 'Удалить задачу?' })) await store.deleteTask(t.id); }, { iconName: 'trash' }))))
        : el('tr', {}, el('td', { colspan: 7 }, 'По фильтрам ничего не найдено')))));
  }
  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
