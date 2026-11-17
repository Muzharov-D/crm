import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite, canAdmin } from '../lib/access.js';
import { dictionary } from '../lib/spec.js';
import { openTaskForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState } from '../ui/mvp-bits.js';
import { formatDate, fuzzyIncludes, todayISO } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

export function tasksMvpView() {
  const root = el('div.view');
  const state = { search: '', employeeId: '', status: '', layout: 'list', sortKey: 'due', sortDirection: 'asc', filters: [] };
  const render = keepingFocus(() => {
    clear(root);
    const results = el('div');
    const columns = () => [
      { key: 'title', label: 'Задача', get: (task) => task.title },
      { key: 'employee', label: 'Ответственный', get: (task) => store.employeeById(task.employeeId)?.name || '' },
      { key: 'startDate', label: 'Начало', type: 'date', get: (task) => task.startDate },
      { key: 'due', label: 'Окончание', type: 'date', get: (task) => task.due },
      { key: 'status', label: 'Статус', get: (task) => task.status || 'К выполнению' },
      { key: 'linked', label: 'Связь', get: linkedText },
      { key: 'actions', label: '', sort: false, get: () => '' },
    ];
    const filtered = () => filterRecords(store.tasks.filter((task) => (!state.employeeId || task.employeeId === state.employeeId)
      && (!state.status || (task.status || 'К выполнению') === state.status)
      && (!state.search || fuzzyIncludes(`${task.title} ${linkedText(task)}`, state.search))), columns(), state.filters);
    const renderResults = () => {
      const tasks = filtered();
      clear(results).append(el('div.registry-summary', {}, el('span', {}, `${tasks.length} из ${store.tasks.length}`),
        el('span', {}, 'Сортировка и фильтры применяются ко всему реестру')),
      !store.tasks.length ? emptyState('Задач пока нет', 'Создайте задачу здесь или прямо из карточки контрагента, контакта, лида или сделки.')
        : state.layout === 'kanban' ? kanban(tasks) : table(tasks, columns()));
    };
    tableRefresh = renderResults;
    const search = el('input.input', { type: 'search', value: state.search, placeholder: 'Описание или связанный объект',
      dataset: { focusKey: 'task-search' }, oninput: (event) => { state.search = event.target.value; renderResults(); } });
    const employee = el('select.select', { onchange: (event) => { state.employeeId = event.target.value; renderResults(); } },
      el('option', { value: '' }, 'Все сотрудники'), store.employees.map((employee) => el('option', { value: employee.id, selected: state.employeeId === employee.id }, employee.name)));
    const status = el('select.select', { onchange: (event) => { state.status = event.target.value; renderResults(); } },
      el('option', { value: '' }, 'Все статусы'), dictionary(store.settings, 'taskStatuses').map((value) => el('option', { value, selected: state.status === value }, value)));
    root.append(pageHead('Задачи', 'Сроки, ответственные и необязательные связи с любыми объектами CRM',
      canWrite(store.user) && actionButton('Новая задача', () => openTaskForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, employee, status, el('div.segmented', {},
        actionButton('Канбан', () => { state.layout = 'kanban'; render(); }, { attrs: { 'aria-pressed': state.layout === 'kanban' } }),
        actionButton('Список', () => { state.layout = 'list'; render(); }, { attrs: { 'aria-pressed': state.layout === 'list' } }))),
      advancedFilters(columns().filter((field) => field.sort !== false), state.filters, renderResults), results);
    renderResults();
  });
  function linkedText(task) {
    return store.dealById(task.dealId)?.name || store.leadById(task.leadId)?.name || store.contactById(task.contactId)?.name || store.companyById(task.companyId)?.name || '';
  }
  function linkedHref(task) {
    if (task.dealId) return `#/pipeline?id=${task.dealId}`; if (task.leadId) return `#/leads?id=${task.leadId}`;
    if (task.contactId) return `#/contacts?id=${task.contactId}`; if (task.companyId) return `#/companies?id=${task.companyId}`;
    return '';
  }
  function card(task) {
    const href = linkedHref(task);
    const node = el('article.task-card', { draggable: canWrite(store.user) ? 'true' : 'false' },
      el('div.task-card-title', {}, task.title),
      el('div.task-card-meta', {}, store.employeeById(task.employeeId)?.name || 'Ответственный не назначен'),
      el('div.task-card-meta', {}, `${formatDate(task.startDate)} — ${formatDate(task.due)}${!task.done && task.due < todayISO() ? ' · просрочено' : ''}`),
      href && el('a.record-link', { href }, linkedText(task)),
      el('div.task-card-actions', {},
        el('select.select', { 'aria-label': `Статус задачи ${task.title}`, disabled: !canWrite(store.user), onchange: (event) => store.updateTask(task.id, { status: event.target.value, done: event.target.value === 'Выполнено' }) },
          dictionary(store.settings, 'taskStatuses').map((value) => el('option', { value, selected: value === (task.status || 'К выполнению') }, value))),
        canWrite(store.user) && actionButton('Изменить', () => openTaskForm(task), { iconName: 'pencil' })));
    node.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/task-id', task.id)); return node;
  }
  function kanban(tasks) {
    return el('div.task-kanban', {}, dictionary(store.settings, 'taskStatuses').map((status) => {
      const rows = tasks.filter((task) => (task.status || 'К выполнению') === status).sort((a, b) => a.due.localeCompare(b.due));
      const column = el('section.task-column', {}, el('div.task-column-head', {}, el('strong', {}, status), el('span', {}, rows.length)), rows.map(card));
      column.addEventListener('dragover', (event) => { if (canWrite(store.user)) { event.preventDefault(); column.classList.add('drag-over'); } });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', async (event) => { event.preventDefault(); column.classList.remove('drag-over'); const id = event.dataTransfer.getData('text/task-id'); if (id && canWrite(store.user)) await store.updateTask(id, { status, done: status === 'Выполнено' }); });
      return column;
    }));
  }
  function table(tasks, columns) {
    const rows = sortRecords(tasks, columns, state);
    return el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
      registryHead(columns, state, (key) => { toggleSort(state, key); tableRefresh(); }),
      el('tbody', {}, rows.length ? rows.map((task) => el('tr', {},
        el('td', {}, task.title), el('td', {}, store.employeeById(task.employeeId)?.name || '—'), el('td', {}, formatDate(task.startDate)), el('td', {}, formatDate(task.due)),
        el('td', {}, task.status || 'К выполнению'), el('td', {}, linkedHref(task) ? el('a.record-link', { href: linkedHref(task) }, linkedText(task)) : '—'),
        el('td.row-actions', {}, canWrite(store.user) && actionButton('Изменить', () => openTaskForm(task), { iconName: 'pencil' }),
          canAdmin(store.user) && actionButton('Удалить', async () => { if (await confirmDialog({ title: 'Удалить задачу?' })) await store.deleteTask(task.id); }, { iconName: 'trash' }))))
        : el('tr', {}, el('td', { colspan: columns.length }, 'По фильтрам ничего не найдено')))));
  }
  let tableRefresh = () => render();
  render();
  const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
