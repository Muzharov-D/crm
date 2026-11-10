import { el, clear, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, ACTIVITY_TYPES } from '../lib/store.js';
import { fuzzyIncludes, formatDate, countLabel, plural } from '../lib/util.js';
import { ACTIVITY_WINDOWS, matchesActivityWindow, touchProgress, weekRange } from '../lib/activity.js';
import { pageHead, emptyState, statTile } from '../ui/bits.js';
import { openActivityForm } from '../ui/mvp-forms.js';
import { canWrite } from '../lib/access.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

const PAGE = 50;
const TYPE_PLURAL = { meeting: 'Встречи', call: 'Звонки', email: 'Письма', note: 'Заметки' };
const TYPE_OF_N = {
  meeting: ['встречи', 'встреч', 'встреч'], call: ['звонка', 'звонков', 'звонков'],
  email: ['письма', 'писем', 'писем'], note: ['заметки', 'заметок', 'заметок'],
};
const typeLabel = (type) => ACTIVITY_TYPES.find((row) => row.value === type)?.label || type || 'Событие';
const STEP_ACTIONS = {
  keep: 'Шаг оставлен', 'complete-next': 'Шаг выполнен, создан следующий', complete: 'Шаг выполнен',
  change: 'Шаг изменён', 'cancel-replace': 'Шаг отменён и заменён', cancel: 'Шаг отменён', create: 'Создан следующий шаг',
};

export function activityView() {
  const root = el('div.view');
  const targets = el('div');
  const controls = el('div');
  const body = el('div');
  const state = {
    query: '', type: 'all', dateWindow: 'all', linked: '', shown: PAGE,
    sortKey: 'date', sortDirection: 'desc', filters: [],
  };
  const columns = [
    { key: 'summary', label: 'Событие / результат', get: (row) => row.summary || row.notes || '' },
    { key: 'date', label: 'Дата', type: 'date', get: (row) => row.date || '' },
    { key: 'type', label: 'Тип', get: (row) => typeLabel(row.type) },
    { key: 'employee', label: 'Автор / сотрудник', get: (row) => store.employeeById(row.employeeId)?.name || '' },
    { key: 'linked', label: 'Связанные объекты', get: linkedText },
    { key: 'step', label: 'Следующий шаг', get: (row) => STEP_ACTIONS[row.stepAction] || '' },
    { key: 'actions', label: '', sort: false, get: () => '' },
  ];

  function linkedText(row) {
    return [store.dealById(row.dealId)?.name, store.leadById(row.leadId)?.name,
      store.contactById(row.contactId)?.name, store.companyById(row.companyId)?.name].filter(Boolean).join(' · ');
  }

  function linkedNodes(row) {
    const links = [
      row.dealId && store.dealById(row.dealId) && [`#/pipeline?id=${row.dealId}`, store.dealById(row.dealId).name],
      row.leadId && store.leadById(row.leadId) && [`#/leads?id=${row.leadId}`, store.leadById(row.leadId).name],
      row.contactId && store.contactById(row.contactId) && [`#/contacts?id=${row.contactId}`, store.contactById(row.contactId).name],
      row.companyId && store.companyById(row.companyId) && [`#/companies?id=${row.companyId}`, store.companyById(row.companyId).name],
    ].filter(Boolean);
    return links.length ? el('div.registry-links', {}, links.map(([href, label]) => el('a.record-link', { href }, label))) : '—';
  }

  function linkOptions() {
    const seen = { contacts: new Set(), companies: new Set(), deals: new Set(), leads: new Set() };
    for (const row of store.activities) {
      if (row.contactId) seen.contacts.add(row.contactId);
      if (row.companyId) seen.companies.add(row.companyId);
      if (row.dealId) seen.deals.add(row.dealId);
      if (row.leadId) seen.leads.add(row.leadId);
    }
    const group = (label, kind, ids, nameOf) => {
      const options = [...ids].map((id) => ({ value: `${kind}:${id}`, label: nameOf(id) }))
        .filter((option) => option.label).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
      return options.length ? { label, options } : null;
    };
    return [
      group('Сделки', 'deal', seen.deals, (id) => store.dealById(id)?.name),
      group('Лиды', 'lead', seen.leads, (id) => store.leadById(id)?.name),
      group('Контакты', 'contact', seen.contacts, (id) => store.contactById(id)?.name),
      group('Компании', 'company', seen.companies, (id) => store.companyById(id)?.name),
    ].filter(Boolean);
  }

  const matchesLink = (row) => {
    if (!state.linked) return true;
    const [kind, id] = state.linked.split(':');
    return row[`${kind}Id`] === id;
  };
  const matches = (row) => (state.type === 'all' || row.type === state.type)
    && matchesActivityWindow(row, state.dateWindow) && matchesLink(row)
    && (!state.query || fuzzyIncludes(`${row.summary || ''} ${row.notes || ''} ${linkedText(row)} ${store.employeeById(row.employeeId)?.name || ''}`, state.query));
  const filtered = () => filterRecords(store.activities.filter(matches), columns, state.filters);
  const filtersActive = () => state.query || state.type !== 'all' || state.dateWindow !== 'all' || state.linked || state.filters.length > 0;

  function clearFilters() {
    Object.assign(state, { query: '', type: 'all', dateWindow: 'all', linked: '', shown: PAGE });
    state.filters.length = 0;
    renderControls();
    render();
  }

  function renderControls() {
    clear(controls);
    controls.hidden = !store.activities.length;
    const search = el('input.input', {
      type: 'search', value: state.query, placeholder: 'Событие, результат, сотрудник или связанный объект',
      'aria-label': 'Поиск по истории', dataset: { focusKey: 'activity-search' },
      oninput: (event) => { state.query = event.target.value; state.shown = PAGE; render(); },
    });
    const windowSelect = el('select.select', {
      'aria-label': 'Фильтр по дате', dataset: { focusKey: 'activity-window' },
      onchange: (event) => { state.dateWindow = event.target.value; state.shown = PAGE; render(); },
    }, ACTIVITY_WINDOWS.map((item) => el('option', { value: item.value, selected: item.value === state.dateWindow }, item.label)));
    const groups = linkOptions();
    const option = (item) => el('option', { value: item.value, selected: item.value === state.linked }, item.label);
    const linkSelect = groups.length ? el('select.select', {
      'aria-label': 'Фильтр по связи', dataset: { focusKey: 'activity-link' },
      onchange: (event) => { state.linked = event.target.value; state.shown = PAGE; render(); },
    }, el('option', { value: '', selected: !state.linked }, 'Все связи'),
      groups.map((group) => el('optgroup', { label: group.label }, group.options.map(option)))) : null;
    const chips = el('div.filter-row', { role: 'group', 'aria-label': 'Фильтр по типу' },
      [{ value: 'all', label: 'Все' }, ...ACTIVITY_TYPES].map((item) => el('button.filter-chip', {
        type: 'button', className: `filter-chip${state.type === item.value ? ' active' : ''}`,
        'aria-pressed': String(state.type === item.value), dataset: { focusKey: `activity-type-${item.value}` },
        onclick: keepingFocus(() => { state.type = item.value; state.shown = PAGE; renderControls(); render(); }),
      }, item.label)));
    controls.append(el('div.filter-bar.activity-filter-bar', {}, search, windowSelect, linkSelect), chips,
      advancedFilters(columns.filter((column) => column.sort !== false), state.filters, () => { state.shown = PAGE; render(); }));
  }

  function renderTargets() {
    clear(targets);
    const progress = touchProgress(store.activities, store.settings.touchTargets);
    if (!progress.pace || !store.activities.length) return;
    const { from, to } = weekRange();
    targets.append(el('div.stat-grid.wide', {},
      statTile({
        label: 'Касаний за неделю', value: `${progress.logged} из ${progress.target}`,
        progress: { pct: progress.pct, tone: progress.pace === 'met' ? 'good' : progress.pace === 'behind' ? 'warn' : '', label: `${Math.round(progress.pct * 100)}% из ${progress.target}` },
        sub: el('span', {}, `${formatDate(from)} – ${formatDate(to)} · `,
          el('span', { className: `stat-pace ${progress.pace === 'behind' ? 'warn' : 'good'}` },
            progress.pace === 'met' ? 'план выполнен' : progress.pace === 'on-track' ? 'в графике' : `отставание ${progress.gap}`)),
      }),
      progress.byType.map((row) => statTile({
        label: TYPE_PLURAL[row.type] || row.label, value: `${row.logged} из ${row.target}`,
        progress: { pct: Math.min(1, row.pct ?? 0), tone: row.logged >= row.target ? 'good' : '', label: `${row.logged} из ${row.target}${TYPE_OF_N[row.type] ? ` ${plural(row.target, TYPE_OF_N[row.type])}` : ''}` },
        sub: 'за неделю',
      }))));
  }

  function table(rows) {
    const sorted = sortRecords(rows, columns, state);
    const page = sorted.slice(0, state.shown);
    return el('section.registry-section', {},
      el('div.registry-summary', {}, el('span', {}, countLabel(rows.length, ['запись', 'записи', 'записей'])),
        filtersActive() ? el('button.btn-inline', { type: 'button', onclick: clearFilters }, 'Сбросить фильтры') : el('span', {}, 'События сделок доступны только для чтения')),
      el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
        registryHead(columns, state, (key) => { toggleSort(state, key); state.shown = PAGE; render(); }),
        el('tbody', {}, page.map((row) => el('tr', {},
          el('td', {}, el('div.registry-primary', {}, row.summary || row.notes || 'Без описания'),
            row.appendOnly && el('span.registry-secondary', {}, 'Новое уточнение добавляется отдельным событием')),
          el('td', {}, formatDate(row.date) || '—'), el('td', {}, typeLabel(row.type)),
          el('td', {}, store.employeeById(row.employeeId)?.name || '—'), el('td', {}, linkedNodes(row)),
          el('td', {}, STEP_ACTIONS[row.stepAction] || '—'),
          el('td.row-actions', {}, row.dealId || row.appendOnly
            ? el('span.muted', {}, 'Только чтение')
            : canWrite(store.user) && el('button.btn.btn-ghost', { type: 'button', onclick: () => openActivityForm(row) }, 'Изменить'))))))),
      rows.length > page.length && el('div.list-more-note', {},
        el('button.btn-inline', { type: 'button', dataset: { focusKey: 'activity-more' },
          onclick: keepingFocus(() => { state.shown += PAGE; render(); }) }, `Показать ещё ${Math.min(PAGE, rows.length - page.length)}`),
        ` · показано ${page.length} из ${rows.length}`));
  }

  function render() {
    clear(body);
    if (!store.activities.length) {
      body.append(emptyState({ icon: 'video', title: 'В истории пока пусто',
        message: 'Сюда попадают все встречи, звонки, письма и заметки — сначала новые.',
        action: el('button.btn.btn-primary', { type: 'button', onclick: () => openActivityForm() }, 'Сделать первую запись') }));
      return;
    }
    const rows = filtered();
    if (!rows.length) {
      body.append(emptyState({ icon: 'search', title: 'Ничего не найдено', message: 'Нет записей, подходящих под фильтры.',
        action: el('button.btn.btn-ghost', { type: 'button', onclick: clearFilters }, 'Сбросить фильтры') }));
      return;
    }
    body.append(table(rows));
  }

  const linkSignature = () => linkOptions().flatMap((group) => group.options.map((option) => `${option.value}\0${option.label}`)).join('\0');
  renderControls(); renderTargets(); render();
  let links = linkSignature();
  const renderOnChange = keepingFocus(() => {
    const next = linkSignature();
    if (next !== links) { links = next; renderControls(); }
    renderTargets(); render();
  });
  store.addEventListener('change', renderOnChange);
  root.append(pageHead('История', el('button.btn.btn-primary', { type: 'button', html: icon('plus', 16, 2.2), onclick: () => openActivityForm() }, ' Записать в историю')),
    targets, controls, body);
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
