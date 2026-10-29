import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { canWrite } from '../lib/access.js';
import { formatDate, formatMoney, todayISO } from '../lib/util.js';
import { openActivityForm, openTaskForm } from './mvp-forms.js';

export const pageHead = (title, sub = '', ...actions) => el('div.view-head', {},
  el('div.grow.min0', {}, el('h1.view-title', {}, title), sub && el('p.view-sub', {}, sub)),
  actions.length && el('div.view-actions', {}, actions));

export const actionButton = (label, onClick, { primary = false, iconName = null, attrs = {} } = {}) =>
  el(`button.btn.${primary ? 'btn-primary' : 'btn-ghost'}`, { type: 'button', onclick: onClick, ...attrs },
    iconName ? el('span', { html: icon(iconName, 16), style: { display: 'inline-flex', verticalAlign: '-3px', marginRight: '6px' } }) : null, label);

export const emptyState = (title, text, action = null) => el('div.empty', {},
  el('div.empty-icon', { html: icon('inbox', 28) }), el('h2.empty-title', {}, title), el('p.empty-text', {}, text), action);

export const avandokEmpty = () => el('section.detail-section', {},
  el('div.section-head', {}, el('h2.section-title', {}, 'Файлы')),
  el('div.avandok-empty', {}, el('span', { html: icon('fileText', 22) }),
    el('div', {}, el('strong', {}, 'Авандок.Диск'), el('p', {}, 'Интеграция и файловое хранилище — этап 2. В MVP файлы не загружаются.'))));

export function facts(entries) {
  return el('dl.fact-grid', {}, entries.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) =>
    el('div.fact', {}, el('dt', {}, label), el('dd', {}, value))));
}

export function historyTable(rows, stages) {
  const label = (id) => stages.find((s) => s.id === id)?.label || id || '—';
  return el('div.table-wrap', {}, el('table.data-table.compact', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Дата и время'), el('th', {}, 'Предыдущая стадия'), el('th', {}, 'Новая стадия'))),
    el('tbody', {}, rows.length ? rows.map((h) => el('tr', {},
      el('td', {}, new Date(h.at).toLocaleString('ru-RU')), el('td', {}, label(h.previousStage)), el('td', {}, label(h.newStage))))
      : el('tr', {}, el('td', { colspan: 3 }, 'Записей пока нет')))));
}

export function tasksTable(tasks, { empty = 'Нет связанных задач' } = {}) {
  return el('div.table-wrap', {}, el('table.data-table.compact', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Задача'), el('th', {}, 'Сотрудник'), el('th', {}, 'Начало'), el('th', {}, 'Окончание'), el('th', {}, 'Статус'))),
    el('tbody', {}, tasks.length ? tasks.map((t) => el('tr', {},
      el('td', {}, t.title), el('td', {}, store.employeeById(t.employeeId)?.name || '—'),
      el('td', {}, formatDate(t.startDate)), el('td', {}, formatDate(t.due)), el('td', {}, t.status || (t.done ? 'Выполнено' : 'К выполнению'))))
      : el('tr', {}, el('td', { colspan: 5 }, empty)))));
}

export function eventsTable(events) {
  return el('div.table-wrap', {}, el('table.data-table.compact', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Дата'), el('th', {}, 'Сотрудник'), el('th', {}, 'Событие / комментарий'))),
    el('tbody', {}, events.length ? events.map((a) => el('tr', {},
      el('td', {}, formatDate(a.date)), el('td', {}, store.employeeById(a.employeeId)?.name || '—'), el('td', {}, a.summary || a.notes)))
      : el('tr', {}, el('td', { colspan: 3 }, 'Событий пока нет')))));
}

const ownerPresets = {
  company: (id) => ({ companyId: id }), contact: (id) => ({ contactId: id }),
  deal: (id) => ({ dealId: id }), lead: (id) => ({ leadId: id }), employee: (id) => ({ employeeId: id }),
};

/** Universal related records: field filters and creation without leaving the card. */
export function relatedRecords(kind, id) {
  const presets = ownerPresets[kind](id);
  const search = el('input.input', { type: 'search', placeholder: 'Фильтр по описанию, событию или сотруднику', 'aria-label': 'Фильтр связанных записей' });
  const status = el('select.select', { 'aria-label': 'Статус связанной задачи' },
    el('option', { value: '' }, 'Все статусы задач'), el('option', { value: 'К выполнению' }, 'К выполнению'),
    el('option', { value: 'В работе' }, 'В работе'), el('option', { value: 'Выполнено' }, 'Выполнено'));
  const body = el('div');
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const match = (r) => !query || `${r.title || ''} ${r.summary || ''} ${r.notes || ''} ${store.employeeById(r.employeeId)?.name || ''}`.toLowerCase().includes(query);
    const tasks = store.tasksFor(presets).filter((t) => match(t) && (!status.value || (t.status || '') === status.value));
    const events = store.activitiesFor(presets).filter(match);
    clear(body).append(
      el('h3.related-subtitle', {}, `Задачи · ${tasks.length}`), tasksTable(tasks),
      el('h3.related-subtitle', {}, `События · ${events.length}`), eventsTable(events));
  };
  search.addEventListener('input', render); status.addEventListener('change', render); render();
  return el('section.detail-section', {},
    el('div.section-head', {}, el('h2.section-title', {}, 'Связанные записи'),
      canWrite(store.user) && el('div.view-actions', {},
        actionButton('Задача', () => openTaskForm(null, { presets }), { iconName: 'plus' }),
        actionButton('Событие', () => openActivityForm(null, { presets }), { iconName: 'plus' }))),
    el('div.related-filters', {}, search, status), body,
    el('p.field-hint', {}, `Новые записи получают связь автоматически. Дата создания — ${todayISO()}; ответственный по умолчанию — текущий сотрудник.`));
}

export function money(value) { return formatMoney(value || 0, store.settings.currency || 'RUB'); }
