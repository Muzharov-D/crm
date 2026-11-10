import { el, clear } from './dom.js';

const text = (value) => String(value ?? '').trim();
const comparable = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return text(value);
};

/** Stable, null-safe sorting for every visible registry column. */
export function sortRecords(rows, fields, state) {
  const field = fields.find((item) => item.key === state.sortKey);
  if (!field) return [...rows];
  const direction = state.sortDirection === 'desc' ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const av = comparable(field.get(a.row));
    const bv = comparable(field.get(b.row));
    if (av === '' && bv !== '') return 1;
    if (bv === '' && av !== '') return -1;
    let result = 0;
    if (typeof av === 'number' && typeof bv === 'number') result = av - bv;
    else result = String(av).localeCompare(String(bv), 'ru', { numeric: true, sensitivity: 'base' });
    return result * direction || a.index - b.index;
  }).map(({ row }) => row);
}

export function registryHead(fields, state, onSort) {
  return el('thead', {}, el('tr', {}, fields.map((field) => {
    const active = state.sortKey === field.key;
    const direction = active ? state.sortDirection || 'asc' : 'none';
    return el('th', {
      className: field.numeric ? 'num' : '',
      'aria-sort': direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none',
    }, field.sort === false ? field.label : el('button.th-sort', {
      type: 'button', className: `th-sort${active ? ' active' : ''}`,
      dataset: { focusKey: `registry-sort-${field.key}` },
      'aria-label': `${field.label}: сортировать${active ? `, сейчас ${direction === 'asc' ? 'по возрастанию' : 'по убыванию'}` : ''}`,
      onclick: () => onSort(field.key),
    }, field.label, el('span.th-arrow', { 'aria-hidden': 'true' }, active ? direction === 'asc' ? '↑' : '↓' : '↕')));
  })));
}

export function toggleSort(state, key) {
  if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  else { state.sortKey = key; state.sortDirection = 'asc'; }
}

const operatorsFor = (field) => ['number', 'date'].includes(field.type)
  ? [{ value: 'eq', label: '=' }, { value: 'gt', label: '≥' }, { value: 'lt', label: '≤' }, { value: 'empty', label: 'Не заполнено' }, { value: 'filled', label: 'Заполнено' }]
  : [{ value: 'contains', label: 'Содержит' }, { value: 'eq', label: 'Равно' }, { value: 'empty', label: 'Не заполнено' }, { value: 'filled', label: 'Заполнено' }];

function matchesOperator(actual, filter, field) {
  const value = comparable(actual);
  const wanted = text(filter.value);
  if (filter.op === 'empty') return value === '';
  if (filter.op === 'filled') return value !== '';
  if (!wanted) return true;
  if (field.type === 'number') {
    const left = Number(value); const right = Number(wanted.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return filter.op === 'gt' ? left >= right : filter.op === 'lt' ? left <= right : left === right;
  }
  const left = String(value).toLocaleLowerCase('ru');
  const right = wanted.toLocaleLowerCase('ru');
  if (filter.op === 'contains') return left.includes(right);
  if (filter.op === 'gt') return left >= right;
  if (filter.op === 'lt') return left <= right;
  return left === right;
}

export function filterRecords(rows, fields, filters = []) {
  return rows.filter((row) => filters.every((filter) => {
    const field = fields.find((item) => item.key === filter.field);
    return !field || matchesOperator(field.get(row), filter, field);
  }));
}

/** Any number of user-built field filters; typing never rebuilds the input. */
export function advancedFilters(fields, filters, onChange) {
  const root = el('div.advanced-filters');
  let sequence = 0;
  const render = () => {
    clear(root);
    filters.forEach((filter, index) => {
      filter.id ||= `field-filter-${Date.now()}-${sequence++}`;
      const field = fields.find((item) => item.key === filter.field) || fields[0];
      const fieldSelect = el('select.select', { 'aria-label': `Поле фильтра ${index + 1}` },
        fields.map((item) => el('option', { value: item.key, selected: item.key === field.key }, item.label)));
      const operator = el('select.select', { 'aria-label': `Условие фильтра ${index + 1}` },
        operatorsFor(field).map((item) => el('option', { value: item.value, selected: item.value === filter.op }, item.label)));
      const value = el('input.input', {
        type: field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'search',
        value: filter.value || '', placeholder: 'Значение', 'aria-label': `Значение фильтра ${index + 1}`,
      });
      value.hidden = ['empty', 'filled'].includes(filter.op);
      fieldSelect.addEventListener('change', () => {
        filter.field = fieldSelect.value;
        filter.op = operatorsFor(fields.find((item) => item.key === filter.field))[0].value;
        filter.value = ''; render(); onChange();
      });
      operator.addEventListener('change', () => { filter.op = operator.value; render(); onChange(); });
      value.addEventListener('input', () => { filter.value = value.value; onChange(); });
      root.append(el('div.advanced-filter-row', {}, fieldSelect, operator, value,
        el('button.btn.btn-ghost', { type: 'button', 'aria-label': `Удалить фильтр ${index + 1}`, onclick: () => { filters.splice(index, 1); render(); onChange(); } }, 'Удалить')));
    });
    root.append(el('button.btn.btn-ghost.advanced-filter-add', { type: 'button', onclick: () => {
      const field = fields[0];
      filters.push({ id: `field-filter-${Date.now()}-${sequence++}`, field: field.key, op: operatorsFor(field)[0].value, value: '' });
      render(); onChange();
    } }, '+ Фильтр по полю'));
  };
  render();
  return root;
}
