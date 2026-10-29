import { el, clear, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, ACTIVITY_TYPES } from '../lib/store.js';
import { fuzzyIncludes, formatDate, countLabel, plural } from '../lib/util.js';
import {
  ACTIVITY_WINDOWS, matchesActivityWindow, touchProgress, weekRange,
} from '../lib/activity.js';
import { pageHead, emptyState, statTile, activityRow, searchBox } from '../ui/bits.js';
import { openActivityForm } from '../ui/mvp-forms.js';

/** How many rows one page of the log shows before "Show more". */
const PAGE = 50;

/* Per-type tiles: the type named as a plural heading, and its genitive
   after "из N" ("3 из 5 звонков"). */
const TYPE_PLURAL = { meeting: 'Встречи', call: 'Звонки', email: 'Письма', note: 'Заметки' };
const TYPE_OF_N = {
  meeting: ['встречи', 'встреч', 'встреч'],
  call: ['звонка', 'звонков', 'звонков'],
  email: ['письма', 'писем', 'писем'],
  note: ['заметки', 'заметок', 'заметок'],
};

/**
 * The activity log: every meeting, call, email, and note in one place,
 * newest first.
 *
 * Activity is the most-written record type in the app - it feeds
 * last-contacted, going cold, and every timeline - and it was the only one
 * with no page of its own. Finding a call from three weeks ago meant
 * remembering which lead it was logged against.
 */
export function activityView() {
  const root = el('div.view');
  /* The week's target sits above the filters: it is about the week, not
     about whatever the list is currently narrowed to. */
  const targets = el('div');
  const controls = el('div');
  const body = el('div');

  let query = '';
  let typeFilter = 'all';
  let dateWindow = 'all';
  let linked = '';                 // "kind:id" of a contact, company, or deal
  let shown = PAGE;

  const filtersActive = () => query !== '' || typeFilter !== 'all'
    || dateWindow !== 'all' || linked !== '';

  function clearFilters() {
    query = '';
    typeFilter = 'all';
    dateWindow = 'all';
    linked = '';
    shown = PAGE;
    renderControls();
    render();
  }

  /** Only the records something has actually been logged against. */
  function linkOptions() {
    const seen = { contacts: new Set(), companies: new Set(), deals: new Set() };
    for (const a of store.activities) {
      if (a.contactId) seen.contacts.add(a.contactId);
      if (a.companyId) seen.companies.add(a.companyId);
      if (a.dealId) seen.deals.add(a.dealId);
    }
    const group = (label, kind, ids, nameOf) => {
      const options = [...ids]
        .map((id) => ({ value: `${kind}:${id}`, label: nameOf(id) }))
        .filter((o) => o.label)
        .sort((a, b) => a.label.localeCompare(b.label));
      return options.length ? { label, options } : null;
    };
    return [
      group('Контакты', 'contact', seen.contacts, (id) => store.contactById(id)?.name),
      group('Сделки', 'deal', seen.deals, (id) => store.dealById(id)?.name),
      group('Компании', 'company', seen.companies, (id) => store.companyById(id)?.name),
    ].filter(Boolean);
  }

  const matchesLink = (a) => {
    if (!linked) return true;
    const [kind, id] = linked.split(':');
    if (kind === 'contact') return a.contactId === id;
    if (kind === 'deal') return a.dealId === id;
    if (kind === 'company') return a.companyId === id;
    return true;
  };

  const matches = (a) => (typeFilter === 'all' || a.type === typeFilter)
    && matchesActivityWindow(a, dateWindow)
    && matchesLink(a)
    && (!query
      || fuzzyIncludes(a.summary, query)
      || fuzzyIncludes(a.notes, query)
      || fuzzyIncludes(store.contactById(a.contactId)?.name, query)
      || fuzzyIncludes(store.dealById(a.dealId)?.name, query)
      || fuzzyIncludes(store.companyById(a.companyId)?.name, query));

  /* A control that rebuilds its own row hands the keyboard back afterwards,
     the way the other list views do. */
  const refresh = (apply) => keepingFocus((...args) => {
    apply(...args);
    shown = PAGE;
    renderControls();
    render();
  });

  function renderControls() {
    clear(controls);
    const search = searchBox({
      placeholder: 'Поиск по истории…',
      value: query,
      oninput: (e) => { query = e.target.value.trim(); shown = PAGE; render(); },
    });

    const windowSelect = el('select.select', {
      'aria-label': 'Фильтр по дате',
      dataset: { focusKey: 'activity-window' },
      onchange: refresh((e) => { dateWindow = e.target.value; }),
    }, ACTIVITY_WINDOWS.map((w) =>
      el('option', { value: w.value, selected: w.value === dateWindow }, w.label)));

    const groups = linkOptions();
    const option = (o) => el('option', { value: o.value, selected: o.value === linked }, o.label);
    /* Null, not `groups.length && …`: a child of 0 is not one of the values
       the element builder treats as "nothing here", so an account whose only
       logged activity is linked to nobody printed a bare 0 beside the date
       filter. */
    const linkSelect = groups.length ? el('select.select', {
      'aria-label': 'Фильтр по связи',
      dataset: { focusKey: 'activity-link' },
      onchange: refresh((e) => { linked = e.target.value; }),
    },
      el('option', { value: '', selected: !linked }, 'Все связи'),
      groups.map((g) => el('optgroup', { label: g.label }, g.options.map(option)))
    ) : null;

    const chips = el('div.filter-row', { role: 'group', 'aria-label': 'Фильтр по типу' },
      [{ value: 'all', label: 'Все' }, ...ACTIVITY_TYPES].map((t) =>
        el('button.filter-chip', {
          type: 'button',
          className: `filter-chip${typeFilter === t.value ? ' active' : ''}`,
          'aria-pressed': String(typeFilter === t.value),
          dataset: { focusKey: `activity-type-${t.value}` },
          onclick: refresh(() => { typeFilter = t.value; }),
        }, t.label)));

    controls.append(
      el('div.deal-controls', {}, search,
        el('div.select-wrap.close-window', {}, windowSelect),
        linkSelect && el('div.select-wrap.close-window', {}, linkSelect)),
      chips
    );
  }

  /** This week against the touch target - the leading number, up top. */
  function renderTargets() {
    clear(targets);
    const progress = touchProgress(store.activities, store.settings.touchTargets);
    if (!progress.pace || !store.activities.length) return;
    const { from, to } = weekRange();
    targets.append(el('div.stat-grid', { className: 'stat-grid wide' },
      statTile({
        label: 'Касаний за неделю',
        value: `${progress.logged} из ${progress.target}`,
        progress: {
          pct: progress.pct,
          tone: progress.pace === 'met' ? 'good' : progress.pace === 'behind' ? 'warn' : '',
          label: `${Math.round(progress.pct * 100)}% из ${progress.target}`,
        },
        sub: el('span', {},
          `${formatDate(from)} – ${formatDate(to)} · `,
          el('span', { className: `stat-pace ${progress.pace === 'behind' ? 'warn' : 'good'}` },
            progress.pace === 'met' ? 'план выполнен'
              : progress.pace === 'on-track' ? 'в графике'
              : `отставание ${progress.gap}`)
        ),
      }),
      progress.byType.map((row) => statTile({
        label: TYPE_PLURAL[row.type] || row.label,
        value: `${row.logged} из ${row.target}`,
        progress: {
          pct: Math.min(1, row.pct ?? 0),
          tone: row.logged >= row.target ? 'good' : '',
          label: `${row.logged} из ${row.target}${TYPE_OF_N[row.type] ? ` ${plural(row.target, TYPE_OF_N[row.type])}` : ''}`,
        },
        sub: 'за неделю',
      }))
    ));
  }

  function render() {
    clear(body);
    controls.hidden = !store.activities.length;

    if (!store.activities.length) {
      body.append(emptyState({
        icon: 'video',
        title: 'В истории пока пусто',
        message: 'Сюда попадают все встречи, звонки, письма и заметки, которые вы записываете, сначала новые — история работы, чем бы ни закончились сделки.',
        action: el('button.btn.btn-primary', { onclick: () => openActivityForm() }, 'Сделать первую запись'),
      }));
      return;
    }

    const rows = store.activities
      .filter(matches)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

    if (!rows.length) {
      body.append(emptyState({
        icon: 'search',
        title: 'Ничего не найдено',
        message: 'Нет записей, подходящих под фильтры.',
        action: el('button.btn.btn-ghost', { onclick: clearFilters }, 'Сбросить фильтры'),
      }));
      return;
    }

    const page = rows.slice(0, shown);
    body.append(el('section.card', {},
      el('div.list-summary', {},
        el('span', {}, countLabel(rows.length, ['запись', 'записи', 'записей'])),
        filtersActive() && el('button.btn-inline', { onclick: clearFilters }, 'Сбросить фильтры')
      ),
      el('div.activity-list', {}, page.map((a) =>
        activityRow(a, { onEdit: (act) => openActivityForm(act) }))),
      rows.length > page.length && el('div.list-more-note', {},
        el('button.btn-inline', {
          onclick: keepingFocus(() => { shown += PAGE; render(); }),
          dataset: { focusKey: 'activity-more' },
        }, `Показать ещё ${Math.min(PAGE, rows.length - page.length)}`),
        ` · показано ${page.length} из ${rows.length}`)
    ));
  }

  /** What the linked-record filter would offer, as a comparable string. */
  const linkSignature = () => linkOptions()
    .flatMap((g) => g.options.map((o) => `${o.value}${o.label}`)).join('\0');

  renderControls();
  renderTargets();
  render();
  let links = linkSignature();
  const renderOnChange = keepingFocus(() => {
    // An activity logged against something new belongs in the link filter -
    // but only a real change rebuilds the row, or the search box would be
    // replaced under the caret on every unrelated save.
    const next = linkSignature();
    if (next !== links) {
      links = next;
      renderControls();
    }
    renderTargets();
    render();
  });
  store.addEventListener('change', renderOnChange);

  root.append(
    pageHead('История',
      el('button.btn.btn-primary', {
        html: icon('plus', 16, 2.2),
        onclick: () => openActivityForm(),
      }, ' Записать в историю')),
    targets,
    controls,
    body
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
