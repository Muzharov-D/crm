import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, CONTACT_STATUSES } from '../lib/store.js';
import {
  fuzzyIncludes, timeAgo, formatDate, sinceLabel, todayISO, countLabel, plural,
} from '../lib/util.js';
import { goingCold } from '../lib/attention.js';
import {
  pageHead, emptyState, avatar, searchBox, stageBadge,
  activityRow, taskRow, companyChip, section, deletedToast,
} from '../ui/bits.js';
import { openContactForm, openDealForm, openActivityForm, openTaskForm } from '../ui/forms.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { isOpen } from '../lib/forecast.js';
import { rateText } from '../lib/recurring.js';
import { roleLabel, roleOf } from '../lib/deal-contacts.js';
import { hasTag } from '../lib/tags.js';
import { tagFilterControl, tagVocabulary } from '../ui/tag-input.js';
import { customFilterControls, customFieldRows, fieldFilterLabel } from '../ui/custom-fields.js';
import { matchesCustomFilters, activeFieldFilters, fieldSignature } from '../lib/fields.js';
import { viewChips, startingFilters } from '../ui/views.js';
import { contactDuplicates } from '../lib/dupes.js';
import { openDuplicatesReview } from '../ui/merge.js';
import { playbookButton } from '../ui/playbooks.js';
import { catchUpButton } from '../ui/ai.js';
import {
  rowSelection, selectBox, selectableRow, bulkBar, pickSheet, openBulkTagSheet,
  confirmBulkDelete, bulkToast,
} from '../ui/bulk.js';
import { openEmailFlow } from '../ui/email.js';
import { buildMailto, buildTel } from '../lib/templates.js';
import { attachmentsSection } from '../ui/attachments.js';
import { exportRecords } from '../lib/csv.js';
import { exportContext } from '../ui/csv.js';
import { downloadFile } from '../ui/download.js';

export function leadsView({ params }) {
  const id = params.get('id');
  if (id) return leadDetail(id);
  return leadsList(params);
}

function statusLabel(status) {
  return CONTACT_STATUSES.find((s) => s.value === status)?.label || status;
}

function statusBadge(status) {
  return el('span.status-badge', { dataset: { status } }, statusLabel(status));
}

/** A filter chip's own words - including the cross-cut that isn't a status. */
function filterLabel(value) {
  return value === 'cold' ? 'Остывает' : statusLabel(value);
}

/**
 * "Last touch 3w ago" for a lead row - amber once it crosses the cold
 * threshold, so the list itself shows who is drifting.
 */
function lastTouchNote(contact, coldDays) {
  const lastAt = store.lastContactedAt(contact.id);
  const since = lastAt || todayISO(new Date(contact.createdAt));
  const { text, days } = sinceLabel(since);
  // Only the statuses worth chasing go amber - a customer you spoke to in
  // June is not a problem.
  const cold = coldDays > 0 && days >= coldDays
    && (contact.status === 'lead' || contact.status === 'active');
  const label = lastAt ? `Последнее касание: ${text}` : `Добавлен ${text}, касаний не было`;
  return el('span.mini-note', {
    className: `mini-note touch-note${cold ? ' cold' : ''}`,
    title: label,
  }, lastAt ? text : 'не общались');
}

/* ---------- list ---------- */

function leadsList(params) {
  const root = el('div.view');
  const listWrap = el('div');
  const bulkWrap = el('div');
  const viewRow = el('div');
  let query = '';
  let statusFilter = 'all';
  let tagsFilter = [];
  /* Choice and yes/no custom fields filter this list like a status chip:
     { [fieldId]: value }, everything ANDed. */
  let fieldFilters = {};

  /* Saved views are filter sets, so the whole of this list's filter state
     goes in and comes back out through these two. */
  const currentFilters = () => ({
    query, status: statusFilter, tags: tagsFilter, fields: fieldFilters,
  });
  function adoptFilters(f) {
    query = f.query;
    statusFilter = f.status;
    tagsFilter = f.tags;
    fieldFilters = f.fields;
    search.querySelector('input').value = query;
    renderFilters();
    renderList();
  }
  // The view named in the URL (the palette links into one), else the
  // default view this list opens with.
  const start = startingFilters('contacts', params);

  const selection = rowSelection(() => renderList());

  const filters = el('div.filter-row', { role: 'group', 'aria-label': 'Фильтр по статусу' });

  const search = searchBox({
    placeholder: 'Поиск по контактам, почте, компаниям…',
    oninput: (e) => { query = e.target.value.trim(); renderList(); },
  });

  /* A search box and six status chips over "No leads yet" are controls with
     nothing to control, and they were the first thing a new account saw on
     this page. Held together so an empty book can put them away, the way
     the board already hides its own filters over an empty pipeline. */
  const controls = el('div', {}, viewRow, search, filters);

  function renderViews() {
    clear(viewRow);
    append(viewRow, [viewChips({
      kind: 'contacts',
      filters: currentFilters(),
      onApply: adoptFilters,
      onChanged: renderViews,
    })]);
  }

  function clearFilters() {
    query = '';
    statusFilter = 'all';
    tagsFilter = [];
    fieldFilters = {};
    search.querySelector('input').value = '';
    renderFilters();
    renderList();
  }

  /* Everything the actions bar can do to the selected leads. */
  function bulkActions() {
    const ids = () => selection.ids();
    const done = (n, what, iconName) => {
      selection.clear();
      bulkToast(n, what, iconName);
    };
    const fail = () => toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
    return [
      {
        icon: 'listChecks', label: 'Статус',
        onClick: () => pickSheet('Изменить статус', CONTACT_STATUSES, async (v) => {
          try { done(await store.bulkUpdateContacts(ids(), { status: v }), 'Статус изменён'); }
          catch { fail(); }
        }),
      },
      {
        icon: 'company', label: 'Компания',
        onClick: () => pickSheet('Указать компанию', [
          { value: '', label: 'Без компании' },
          ...[...store.companies].sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => ({ value: c.id, label: c.name })),
        ], async (v) => {
          try { done(await store.bulkUpdateContacts(ids(), { companyId: v || null }), 'Компания указана', 'company'); }
          catch { fail(); }
        }),
      },
      {
        icon: 'tag', label: 'Метка',
        onClick: () => openBulkTagSheet(async (tag) => {
          try { done(await store.bulkTag('contacts', ids(), tag), `Метка «${tag}» добавлена`, 'tag'); }
          catch { fail(); }
        }),
      },
      {
        icon: 'fileDown', label: 'Экспорт',
        onClick: () => {
          const records = store.contacts.filter((c) => selection.has(c.id));
          downloadFile(`crm-leads-selection-${todayISO()}.csv`,
            `﻿${exportRecords('contacts', records, exportContext())}`, 'text/csv');
          toast(`${countLabel(records.length, ['контакт', 'контакта', 'контактов'])} ${plural(records.length, ['экспортирован', 'экспортированы', 'экспортировано'])}`, { icon: 'fileDown' });
        },
      },
      {
        icon: 'trash', label: 'Удалить', danger: true,
        onClick: async () => {
          if (!await confirmBulkDelete(selection.size, plural(selection.size, ['контакт', 'контакта', 'контактов']))) return;
          try {
            const entries = await store.bulkDelete('contacts', ids());
            selection.clear();
            toast(`${countLabel(entries.length, ['контакт', 'контакта', 'контактов'])} ${plural(entries.length, ['удалён', 'удалены', 'удалено'])}`, { icon: 'trash' });
          } catch { fail(); }
        },
      },
    ];
  }

  /**
   * A filter chip rebuilds the row it lives in, so the keyboard has to be
   * handed back afterwards the way a store change does - the rebuilt chip
   * is found again by the focus key it still carries.
   */
  const refreshFilters = (apply) => keepingFocus((...args) => {
    apply(...args);
    renderFilters();
    renderList();
  });

  function renderFilters() {
    clear(filters);
    const options = [
      { value: 'all', label: 'Все' },
      ...CONTACT_STATUSES,
      // Not a status: a cross-cut of the two chaseable ones, oldest first.
      { value: 'cold', label: 'Остывает' },
    ];
    for (const o of options) {
      filters.append(el('button.filter-chip', {
        type: 'button',
        className: `filter-chip${statusFilter === o.value ? ' active' : ''}`,
        'aria-pressed': String(statusFilter === o.value),
        dataset: { focusKey: `status-filter-${o.value}` },
        onclick: refreshFilters(() => { statusFilter = o.value; }),
      }, o.label));
    }
    append(filters, [tagFilterControl(tagsFilter, refreshFilters((next) => {
      tagsFilter = next;
    }), 'contacts')]);
    append(filters, customFilterControls('contacts', fieldFilters, refreshFilters((next) => {
      fieldFilters = next;
    })));
  }

  function renderList() {
    clear(listWrap);
    clear(bulkWrap);
    renderViews();
    controls.hidden = !store.contacts.length;
    // A quiet pointer, not a banner campaign: duplicates corrupt exactly
    // the signals this list runs on (last touch, going cold).
    //
    // Asked only when the answer can be shown. This function runs on every
    // keystroke in the search box, and the scan is a normalizing pass over
    // every contact for each of three match keys, then a pass over the pairs
    // it groups - which was being spent per keystroke to fill a hint that a
    // non-empty query hides anyway.
    if (statusFilter === 'all' && !query) {
      const dupePairs = contactDuplicates(store.contacts).length;
      if (dupePairs > 0) {
        listWrap.append(el('div.dupe-hint', {},
          el('span', { html: icon('merge', 14, 2), 'aria-hidden': 'true' }),
          el('span.grow', {}, `Возможные дубли среди контактов: ${countLabel(dupePairs, ['пара', 'пары', 'пар'])}`),
          el('button.btn-inline', { onclick: () => openDuplicatesReview() }, 'Проверить')
        ));
      }
    }
    if (!store.contacts.length) {
      listWrap.append(emptyState({
        icon: 'users',
        title: 'Контактов пока нет',
        message: 'Здесь все, кому вы можете продать: имя, компания и вся история общения.',
        action: el('button.btn.btn-primary', { onclick: () => openContactForm() }, 'Добавить первый контакт'),
      }));
      return;
    }

    const coldDays = store.settings.coldDays;
    const fields = store.customFields('contacts');
    const matchesQuery = (c) => (!query
      || fuzzyIncludes(c.name, query)
      || fuzzyIncludes(c.email, query)
      || fuzzyIncludes(store.companyById(c.companyId)?.name, query))
      && tagsFilter.every((t) => hasTag(c.tags, t))
      && matchesCustomFilters(c, fields, fieldFilters);

    let rows;
    if (statusFilter === 'cold') {
      // Coldest first: the point of the view is the top of the list.
      rows = goingCold(store.contacts, (id) => store.lastContactedAt(id), { coldDays })
        .map((r) => r.contact)
        .filter(matchesQuery);
    } else {
      rows = [...store.contacts]
        .filter((c) => statusFilter === 'all' || c.status === statusFilter)
        .filter(matchesQuery)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    selection.prune(store.contacts.map((c) => c.id));
    const order = rows.map((c) => c.id);
    append(bulkWrap, [bulkBar(selection, { total: order.length, order, actions: bulkActions() })]);

    if (!rows.length) {
      // "Nobody is going cold" is a claim about the data, so it only holds
      // when no search or tag filter could be what emptied the list.
      const activeFields = activeFieldFilters(fields, fieldFilters);
      if (statusFilter === 'cold' && !query && !tagsFilter.length && !activeFields.length) {
        listWrap.append(emptyState({
          icon: 'check',
          title: 'Никто не остывает',
          message: coldDays
            ? `Со всеми лидами и контактами в работе связывались за последние ${coldDays} дн.`
            : 'Отметка остывающих контактов выключена в настройках.',
        }));
        return;
      }
      // Three controls narrow this list and any of them can empty it, so
      // "try a different search" sent people looking in the wrong place
      // when it was a status chip or a tag doing it - over no way back at
      // all. Name what is on, and offer the way out, as Companies does.
      const active = [
        query && 'этот запрос',
        tagsFilter.length && (tagsFilter.length === 1 ? 'эту метку' : 'эти метки'),
        statusFilter !== 'all' && `фильтр «${filterLabel(statusFilter)}»`,
        ...activeFields.map((f) => `условие «${fieldFilterLabel(f.field, f.value)}»`),
      ].filter(Boolean);
      const last = active[active.length - 1];
      listWrap.append(emptyState({
        icon: 'search',
        title: 'Ничего не найдено',
        message: active.length > 1
          ? `Ни один контакт не подходит одновременно под ${active.slice(0, -1).join(', ')} и ${last}.`
          : `Ни один контакт не подходит под ${last}.`,
        action: el('button.btn.btn-ghost', { onclick: clearFilters }, 'Сбросить фильтры'),
      }));
      return;
    }

    listWrap.append(el('div.card.list-card', {},
      rows.map((c) => {
        const company = store.companyById(c.companyId);
        const openDeals = store.dealsFor({ contactId: c.id }).filter(isOpen);
        const touch = lastTouchNote(c, coldDays);
        return selectableRow(selectBox(selection, c.id, order, c.name),
          el('a.person-row', { href: `#/leads?id=${c.id}` },
          avatar(c.name),
          el('div.grow.min0', {},
            el('div.person-name', {}, c.name),
            el('div.person-sub', {},
              [c.title, company?.name].filter(Boolean).join(' · ') || c.email || 'Данных пока нет')
          ),
          openDeals.length > 0 && el('span.mini-note.hide-sm', {},
            countLabel(openDeals.length, ['открытая сделка', 'открытые сделки', 'открытых сделок'])),
          touch,
          statusBadge(c.status),
          el('span.row-chev', { html: icon('chevR', 18) })
        ));
      })
    ));
  }

  renderFilters();
  if (start) {
    query = start.filters.query;
    statusFilter = start.filters.status;
    tagsFilter = start.filters.tags;
    fieldFilters = start.filters.fields;
    search.querySelector('input').value = query;
    renderFilters();
  }
  renderList();
  let vocabulary = tagVocabulary('contacts');
  let fieldsSig = fieldSignature(store.customFields('contacts'));
  const rerender = () => {
    // A tag or a custom field added while this list is open belongs in its
    // filter row - and only a real change rebuilds it, so the search box
    // isn't replaced under the caret on every unrelated save.
    const next = tagVocabulary('contacts');
    const nextFields = fieldSignature(store.customFields('contacts'));
    if (next !== vocabulary || nextFields !== fieldsSig) {
      vocabulary = next;
      fieldsSig = nextFields;
      renderFilters();
    }
    renderList();
  };
  const rerenderOnChange = keepingFocus(rerender);
  store.addEventListener('change', rerenderOnChange);

  root.append(
    pageHead('Контакты',
      el('button.btn.btn-primary', {
        html: icon('userPlus', 16, 2),
        onclick: () => openContactForm(),
      }, ' Новый контакт')),
    controls,
    listWrap,
    bulkWrap
  );
  root.destroy = () => store.removeEventListener('change', rerenderOnChange);
  return root;
}

/** The same signal on the detail page, spelled out. */
function lastTouchChip(contact) {
  const coldDays = store.settings.coldDays;
  const lastAt = store.lastContactedAt(contact.id);
  const since = lastAt || todayISO(new Date(contact.createdAt));
  const { text, days } = sinceLabel(since);
  const cold = coldDays > 0 && days >= coldDays
    && (contact.status === 'lead' || contact.status === 'active');
  return el('span.chip.static', { dataset: cold ? { tone: 'stalled' } : {} },
    el('span', { html: icon('clock', 13, 2) }),
    lastAt ? `Последнее касание: ${text}` : `Касаний не было · добавлен ${text}`
  );
}

/* ---------- detail ---------- */

function leadDetail(id) {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const contact = store.contactById(id);
    if (!contact) {
      body.append(emptyState({
        icon: 'users', title: 'Контакт не найден',
        message: 'Возможно, его удалили.',
        action: el('a.btn.btn-ghost', { href: '#/leads' }, 'Вернуться к контактам'),
      }));
      return;
    }

    const company = store.companyById(contact.companyId);
    const deals = store.dealsFor({ contactId: id }).sort((a, b) => b.updatedAt - a.updatedAt);
    const tasks = store.tasksFor({ contactId: id });
    const history = store.activitiesFor({ contactId: id });

    const contactRow = (ic, value, href = null) => value && el('div.info-row', {},
      el('span.row-ic', { html: icon(ic, 16, 2) }),
      href ? el('a', { href }, value) : el('span', {}, value)
    );

    append(body, [
      el('div.detail-head.card', {},
        avatar(contact.name, 'lg'),
        el('div.grow.min0', {},
          el('div.detail-title-row', {},
            el('h1.detail-title', {}, contact.name),
            statusBadge(contact.status)
          ),
          el('p.detail-sub', {}, [contact.title, company?.name].filter(Boolean).join(' · ')
            || 'Должность и компания не указаны'),
          el('div.chip-row', {},
            companyChip(contact.companyId),
            contact.source && el('span.chip.static', {},
              el('span', { html: icon('tag', 13, 2) }), contact.source),
            lastTouchChip(contact),
            (contact.tags || []).map((t) => el('span.chip.static', {},
              el('span', { html: icon('tag', 13, 2) }), t))
          )
        ),
        el('div.detail-actions', {},
          contact.email && el('button.btn.btn-ghost.btn-sm', {
            html: icon('mail', 15, 2),
            onclick: () => openEmailFlow({
              contact,
              // Give the merge fields a deal to speak about: the newest
              // open one, the same deal a check-in would be nudging along.
              deal: deals.find((d) => isOpen(d)) || null,
            }),
          }, ' Письмо…'),
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('pencil', 15, 2),
            onclick: () => openContactForm(contact),
          }, ' Изменить'),
          el('button.icon-btn', {
            html: icon('trash', 17, 2), 'aria-label': `Удалить ${contact.name}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Удалить контакт?',
                message: 'Сделки и история останутся, но потеряют связь с контактом. Сам контакт 30 дней пролежит в корзине в настройках.',
              });
              if (!ok) return;
              // Leave first - see the note on the deal delete: waiting out
              // the KV write here parks the user on "Lead not found".
              location.hash = '#/leads';
              try {
                const entry = await store.deleteContact(id);
                deletedToast('Контакт удалён', entry);
              } catch {
                toast('Не удалось удалить. Проверьте подключение', { icon: 'wifiOff' });
              }
            },
          })
        )
      ),

      (contact.email || contact.phone || contact.notes) && el('section.card', {},
        el('div.settings-body', {},
          contactRow('mail', contact.email, buildMailto(contact.email)),
          contactRow('phone', contact.phone, buildTel(contact.phone)),
          contact.notes && el('p.detail-notes', {}, contact.notes)
        )
      ),

      (() => {
        const rows = customFieldRows('contacts', contact);
        return rows && section('Дополнительно', null, el('div.settings-body', {}, rows));
      })(),

      section('Сделки',
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('plus', 14, 2.2),
          onclick: () => openDealForm(null, { presets: { contactId: id, companyId: contact.companyId } }),
        }, ' Добавить'),
        deals.length
          ? el('div.deal-list', {}, deals.map((d) => el('a.deal-row', { href: `#/pipeline?id=${d.id}` },
              el('div.grow.min0', {},
                el('div.deal-row-name', {}, d.name),
                el('div.person-sub', {}, d.expectedClose && isOpen(d)
                  ? `Закрытие ${formatDate(d.expectedClose)}` : `Обновлена ${timeAgo(d.updatedAt)}`)
              ),
              // What this person is on that deal, where they are one of
              // several people on it.
              roleOf(d, id) && el('span.role-badge', { dataset: { role: roleOf(d, id) } },
                roleLabel(roleOf(d, id))),
              el('span.deal-row-value', {}, rateText(d, store.settings.currency)),
              stageBadge(d.stage)
            )))
          : el('p.card-empty', {}, 'Сделок с этим контактом пока нет.')
      ),

      section('Задачи',
        el('div.card-actions', {},
          playbookButton({ contactId: id }),
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('plus', 14, 2.2),
            onclick: () => openTaskForm(null, { presets: { contactId: id } }),
          }, ' Добавить')
        ),
        tasks.length
          ? el('div.task-list', {}, tasks.map((t) =>
              taskRow(t, { context: { contactId: id }, onEdit: (task) => openTaskForm(task) })))
          : el('p.card-empty', {}, 'С этим контактом ничего не запланировано.')
      ),

      section('История',
        el('div.card-actions', {},
          catchUpButton({ contact }),
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('plus', 14, 2.2),
            onclick: () => openActivityForm(null, { presets: { contactId: id } }),
          }, ' Записать')
        ),
        history.length
          ? el('div.activity-list', {}, history.map((a) =>
              activityRow(a, { context: { contactId: id }, onEdit: (act) => openActivityForm(act) })))
          : el('p.card-empty', {}, 'Здесь появятся встречи, звонки, письма и заметки по этому контакту.')
      ),

      attachmentsSection({ contactId: id }),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  root.append(
    el('a.back-link', { href: '#/leads', html: icon('chevL', 16, 2.2) }, 'Контакты'),
    body
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
