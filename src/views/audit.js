import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHead, emptyState, section } from '../ui/bits.js';
import { todayISO, formatDate, fuzzyIncludes } from '../lib/util.js';

const ACTIONS = {
  created: 'Создана', updated: 'Изменена', deleted: 'Удалена', uploaded: 'Загружен документ',
};

function eventTime(at) {
  const date = new Date(at);
  return `${formatDate(todayISO(date), { year: 'always' })} · ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

export function auditView() {
  const root = el('div.view');
  const body = el('div');
  let events = [];
  let query = '';
  let action = '';
  let loading = true;
  let error = '';

  const search = el('input.input', {
    type: 'search', placeholder: 'Пользователь, запись или поле…', 'aria-label': 'Поиск по журналу',
    oninput: (e) => { query = e.target.value; render(); },
  });
  const actionSelect = el('select.select', {
    'aria-label': 'Тип действия',
    onchange: (e) => { action = e.target.value; render(); },
  },
    el('option', { value: '' }, 'Все действия'),
    ...Object.entries(ACTIONS).map(([value, label]) => el('option', { value }, label))
  );

  async function load() {
    loading = true;
    error = '';
    render();
    try {
      const response = await fetch('/api/audit', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 403 ? 'forbidden' : 'request');
      events = await response.json();
    } catch (err) {
      error = err.message === 'forbidden'
        ? 'Журнал доступен только администратору.'
        : 'Не удалось загрузить журнал. Проверьте подключение и повторите.';
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    clear(body);
    if (loading) {
      body.append(el('div.card-empty', { role: 'status' }, 'Загружаем журнал изменений…'));
      return;
    }
    if (error) {
      body.append(emptyState({
        icon: 'alert', title: 'Журнал недоступен', message: error,
        action: el('button.btn.btn-primary', { onclick: load }, 'Повторить'),
      }));
      return;
    }
    const filtered = events.filter((event) => (!action || event.action === action)
      && fuzzyIncludes(`${event.actor} ${event.name} ${event.kind} ${event.details || ''} ${(event.fields || []).join(' ')}`, query));
    body.append(
      section('Журнал', null,
        el('div.audit-filters', {}, search, el('div.select-wrap', {}, actionSelect)),
        filtered.length
          ? el('div.audit-list', {}, filtered.map((event) =>
              el('article.audit-row', {},
                el('time.audit-time', { datetime: new Date(event.at).toISOString() }, eventTime(event.at)),
                el('div.audit-event', {},
                  el('div.audit-title', {},
                    el('span.audit-action', { dataset: { action: event.action } }, ACTIONS[event.action] || event.action),
                    el('span', {}, ` ${event.kind} «${event.name}»`)),
                  event.fields?.length > 0 && el('div.audit-fields', {}, `Поля: ${event.fields.join(', ')}`),
                  event.details && el('div.audit-fields', {}, event.details)),
                el('span.audit-actor', { title: 'Пользователь' }, event.actor)))
            )
          : el('p.card-empty', {}, events.length ? 'По этому фильтру событий нет.' : 'Изменений пока не было. Создание и редактирование записей появятся здесь.')
      )
    );
  }

  root.append(
    pageHead('Журнал изменений',
      el('button.btn.btn-ghost', { html: icon('reset', 16, 2), onclick: load }, ' Обновить')),
    el('p.page-sub', {}, 'Кто, когда и что изменил. Хранятся последние 500 событий.'),
    body
  );
  load();
  return root;
}
