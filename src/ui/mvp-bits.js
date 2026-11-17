import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { canWrite } from '../lib/access.js';
import { dictionaryOptions } from '../lib/spec.js';
import { formatDate, formatMoney, todayISO } from '../lib/util.js';
import { openActivityForm, openTaskForm } from './mvp-forms.js';
import { field, textInput } from './forms.js';

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

function ownerPresets(kind, id) {
  if (kind === 'deal') {
    const deal = store.dealById(id);
    return { dealId: id, companyId: deal?.companyId || null,
      contactId: deal?.contactId || null, leadId: deal?.sourceLeadId || null };
  }
  if (kind === 'lead') {
    const lead = store.leadById(id);
    return { leadId: id, companyId: lead?.companyId || null, contactId: lead?.contactId || null };
  }
  if (kind === 'contact') {
    const contact = store.contactById(id);
    return { contactId: id, companyId: contact?.companyId || null };
  }
  if (kind === 'company') return { companyId: id };
  return { employeeId: id };
}

/** Universal related records: field filters and creation without leaving the card. */
export function relatedRecords(kind, id) {
  // Filter lists by the card itself; creation also inherits unambiguous parent links.
  const filters = { company: { companyId: id }, contact: { contactId: id },
    deal: { dealId: id }, lead: { leadId: id }, employee: { employeeId: id } }[kind];
  const presets = ownerPresets(kind, id);
  const search = el('input.input', { type: 'search', placeholder: 'Описание, событие или сотрудник', 'aria-label': 'Фильтр связанных записей' });
  const status = el('select.select', { 'aria-label': 'Статус связанной задачи' },
    dictionaryOptions(store.settings, 'taskStatuses', { empty: 'Все статусы задач' })
      .map((o) => el('option', { value: o.value }, o.label)));
  const employee = el('select.select', { 'aria-label': 'Сотрудник связанной записи' },
    el('option', { value: '' }, 'Все сотрудники'), store.employees.map((e) => el('option', { value: e.id }, e.name)));
  const from = el('input.input', { type: 'date', 'aria-label': 'Связанные записи с даты' });
  const to = el('input.input', { type: 'date', 'aria-label': 'Связанные записи по дату' });
  const body = el('div');
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const match = (r, date) => (!query || `${r.title || ''} ${r.summary || ''} ${r.notes || ''} ${store.employeeById(r.employeeId)?.name || ''}`.toLowerCase().includes(query))
      && (!employee.value || r.employeeId === employee.value)
      && (!from.value || (date && date >= from.value)) && (!to.value || (date && date <= to.value));
    const tasks = store.tasksFor(filters).filter((t) => match(t, t.due)
      && (!status.value || (t.status || 'К выполнению') === status.value));
    const events = store.activitiesFor(filters).filter((a) => match(a, a.date));
    clear(body).append(
      el('h3.related-subtitle', {}, `Задачи · ${tasks.length}`), tasksTable(tasks),
      el('h3.related-subtitle', {}, `События · ${events.length}`), eventsTable(events));
  };
  search.addEventListener('input', render);
  for (const control of [status, employee, from, to]) control.addEventListener('change', render);
  render();
  return el('section.detail-section', {},
    el('div.section-head', {}, el('h2.section-title', {}, 'Связанные записи'),
      canWrite(store.user) && el('div.view-actions', {},
        actionButton('Задача', () => openTaskForm(null, { presets }), { iconName: 'plus' }),
        actionButton('Событие', () => openActivityForm(null, { presets }), { iconName: 'plus' }))),
    el('div.related-filters', {}, search, status, employee, from, to), body,
    el('p.field-hint', {}, `Новые записи получают связь автоматически, включая однозначные связи родительских объектов. Дата создания — ${todayISO()}; ответственный по умолчанию — текущий сотрудник.`));
}

export function inlineField({ label, key, value = '', type = 'text', options = null, disabled = false,
  save, queue, parse = (v) => v, focusPrefix = 'entity', hint = '', rows = 3, required = false }) {
  const dataset = { focusKey: `${focusPrefix}-${key}` };
  const control = options
    ? el('select.select', { disabled, required, dataset },
      options.map((option) => el('option', { value: option.value, selected: String(option.value) === String(value ?? '') }, option.label)))
    : type === 'textarea'
      ? el('textarea.input.textarea', { rows, disabled, required, dataset }, value || '')
      : textInput({ value: value ?? '', type, disabled, required, dataset });
  const read = () => parse(control.value);
  if (!options && ['text', 'email', 'tel', 'number', 'textarea'].includes(type) && queue) {
    control.addEventListener('input', () => queue({ [key]: read() }));
  }
  control.addEventListener('change', () => save({ [key]: read() }));
  return { node: field(label, control, { hint }), control };
}

export function entityTabs(kind, tabs, current, onSelect) {
  const tablist = el('div.deal-tabs.entity-tabs', { role: 'tablist', 'aria-label': `Разделы карточки: ${kind}` }, tabs.map(([key, label]) =>
    el('button.deal-tab', {
      type: 'button', role: 'tab', id: `${kind}-tab-${key}`, 'aria-controls': `${kind}-panel-${key}`,
      'aria-selected': String(current === key), tabindex: current === key ? 0 : -1,
      dataset: { tab: key, focusKey: `${kind}-tab-${key}` }, onclick: () => onSelect(key),
      onkeydown: (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex(([tab]) => tab === key);
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tablist.querySelector(`[data-tab="${tabs[nextIndex][0]}"]`)?.click();
      },
    }, label)));
  return tablist;
}

export function fieldHistoryTable(rows) {
  const body = rows.length
    ? rows.map((row) => el('tr', {},
      el('td', {}, new Date(row.at).toLocaleString('ru-RU')),
      el('td', {}, row.actorName || 'Системный процесс'),
      el('td', {}, row.label || row.field),
      el('td', {}, row.previousDisplay || '—'),
      el('td', {}, row.newDisplay || '—')))
    : el('tr', {}, el('td', { colspan: 5 }, 'Изменений полей пока не зафиксировано'));
  return el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
    el('thead', {}, el('tr', {}, ['Дата и время', 'Пользователь / процесс', 'Поле', 'Старое значение', 'Новое значение']
      .map((label) => el('th', {}, label)))),
    el('tbody', {}, body)));
}

export function money(value) { return formatMoney(value || 0, store.settings.currency || 'RUB'); }
