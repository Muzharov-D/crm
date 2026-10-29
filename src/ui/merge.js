/**
 * Possible-duplicates review and the merge flow.
 *
 * Review lists contact pairs matched by identical email, normalized name,
 * or phone, and company pairs by normalized name or website domain. Merge
 * picks a survivor, resolves conflicting fields one by one, re-points
 * every linked record, and drops the merged-away record in the trash so
 * the whole thing is undoable like a delete.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store, CONTACT_STATUSES } from '../lib/store.js';
import { contactDuplicates, companyDuplicates } from '../lib/dupes.js';
import { formatDate, todayISO } from '../lib/util.js';
import { avatar } from './bits.js';

const KINDS = {
  contact: {
    title: 'Объединить контакты',
    fields: [
      { key: 'name', label: 'Имя' },
      { key: 'title', label: 'Должность' },
      { key: 'email', label: 'Эл. почта' },
      { key: 'phone', label: 'Телефон' },
      { key: 'companyId', label: 'Компания', display: (v) => store.companyById(v)?.name || '' },
      { key: 'source', label: 'Источник' },
      { key: 'status', label: 'Статус', display: (v) => CONTACT_STATUSES.find((s) => s.value === v)?.label || String(v || '') },
      { key: 'notes', label: 'Заметки' },
    ],
    sub: (c) => [c.title, store.companyById(c.companyId)?.name, c.email].filter(Boolean).join(' · '),
    merge: (survivorId, mergedId, patch) => store.mergeContacts(survivorId, mergedId, patch),
  },
  company: {
    title: 'Объединить компании',
    fields: [
      { key: 'name', label: 'Название' },
      { key: 'industry', label: 'Отрасль' },
      { key: 'website', label: 'Сайт' },
      { key: 'size', label: 'Размер компании' },
      { key: 'notes', label: 'Заметки' },
    ],
    sub: (c) => [c.industry, c.website].filter(Boolean).join(' · '),
    merge: (survivorId, mergedId, patch) => store.mergeCompanies(survivorId, mergedId, patch),
  },
};

const REASON_LABELS = {
  email: 'та же почта', name: 'то же имя', phone: 'тот же телефон', domain: 'тот же домен',
};

const addedOn = (r) => `Добавлено ${formatDate(todayISO(new Date(r.createdAt || Date.now())), { year: 'always' })}`;

/* ---------- merge form ---------- */

export function openMergeForm(kind, a, b) {
  const spec = KINDS[kind];
  let survivor = a;                 // the older record is the natural keeper
  let merged = b;
  const picks = {};                 // field key → chosen raw value (conflicts only)

  const body = el('div');
  const modal = openModal({ title: spec.title, content: body, wide: true });

  const valueText = (field, record) => {
    const raw = record[field.key];
    const text = field.display ? field.display(raw) : String(raw ?? '');
    return text.trim();
  };

  function conflicts() {
    return spec.fields.filter((f) => {
      const va = valueText(f, survivor);
      const vb = valueText(f, merged);
      return va && vb && va !== vb;
    });
  }

  function render() {
    // Picking a survivor or settling a conflict rebuilds this whole body,
    // which tears the pressed button out from under the keyboard - find
    // its rebuilt twin afterwards and hand focus back, the same bargain
    // keepingFocus strikes for the views.
    const focusKey = body.contains(document.activeElement)
      ? document.activeElement.dataset?.focusKey : null;
    clear(body);

    const card = (record, other) => el('button.merge-record', {
      type: 'button',
      className: `merge-record${record === survivor ? ' active' : ''}`,
      'aria-pressed': String(record === survivor),
      dataset: { focusKey: `record-${record.id}` },
      onclick: () => {
        if (record === survivor) return;
        survivor = record;
        merged = other;
        for (const k of Object.keys(picks)) delete picks[k];
        render();
      },
    },
      kind === 'contact'
        ? avatar(record.name)
        : el('span.avatar.square', { 'aria-hidden': 'true', html: icon('building', 18, 1.8) }),
      el('div.grow.min0', {},
        el('div.title', {}, record.name || 'Без названия'),
        el('div.sub', {}, spec.sub(record) || addedOn(record)),
        el('div.merge-keep', {}, record === survivor ? 'Остаётся · связи перейдут сюда' : 'Объединяется · уйдёт в корзину')
      )
    );

    const rows = conflicts().map((f) => {
      const option = (record) => {
        const active = (picks[f.key] ?? survivor[f.key]) === record[f.key];
        return el('button.merge-option', {
          type: 'button',
          className: `merge-option${active ? ' active' : ''}`,
          'aria-pressed': String(active),
          dataset: { focusKey: `option-${f.key}-${record.id}` },
          onclick: () => { picks[f.key] = record[f.key]; render(); },
        }, valueText(f, record));
      };
      return el('div.merge-field', {},
        el('span.field-label', {}, f.label),
        el('div.merge-options', {}, option(survivor), option(merged))
      );
    });

    body.append(
      el('p.settings-note.sheet-note', {},
        'Выберите, какую карточку оставить. Сделки, история и задачи второй перейдут к ней, а вторая карточка на 30 дней попадёт в корзину.'),
      el('div.merge-records', {}, card(a, b), card(b, a)),
      rows.length
        ? el('div.merge-conflicts', {},
            el('h3.csv-preview-title', {}, 'Различия'),
            rows)
        : el('p.settings-note', {}, 'Противоречий нет. Пустые поля заполнятся из второй карточки.'),
      el('div.form-actions', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Отмена'),
        el('div.grow'),
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: async (e) => {
            const patch = {};
            // Conflicts take the chosen side; gaps fill from the merged record.
            for (const f of conflicts()) {
              const v = picks[f.key] ?? survivor[f.key];
              if (v !== survivor[f.key]) patch[f.key] = v;
            }
            for (const f of spec.fields) {
              if (!valueText(f, survivor) && valueText(f, merged)) patch[f.key] = merged[f.key];
            }
            // One merge per click: a double-click's second call would find
            // the merged record already gone and put up a second toast -
            // the one without the Undo.
            const btn = e.currentTarget;
            btn.disabled = true;
            let entry;
            try {
              entry = await spec.merge(survivor.id, merged.id, patch);
            } catch {
              btn.disabled = false;
              toast('Не удалось объединить. Проверьте подключение', { icon: 'wifiOff' });
              return;
            }
            modal.close();
            toast(`Объединено в «${survivor.name}»`, {
              icon: 'merge',
              action: entry && {
                label: 'Отменить',
                onClick: () => store.restoreTrash(entry.id)
                  .catch(() => toast('Не удалось восстановить. Проверьте подключение', { icon: 'wifiOff' })),
              },
            });
          },
        }, 'Объединить')
      )
    );

    if (focusKey) {
      body.querySelector(`[data-focus-key=${CSS.escape(focusKey)}]`)?.focus();
    }
  }

  render();
  return modal;
}

/* ---------- review ---------- */

export function openDuplicatesReview() {
  const body = el('div');

  function pairRow(kind, pair) {
    const spec = KINDS[kind];
    const line = (r) => el('div.dupe-line', {},
      kind === 'contact' ? avatar(r.name) : el('span.avatar.square', { 'aria-hidden': 'true', html: icon('building', 16, 1.8) }),
      el('div.grow.min0', {},
        el('div.title', {}, r.name || 'Без названия'),
        el('div.sub', {}, spec.sub(r) || addedOn(r))
      )
    );
    return el('div.dupe-pair', {},
      el('div.grow.min0', {},
        line(pair.a),
        line(pair.b),
        el('div.chip-row.dupe-reasons', {}, pair.reasons.map((r) =>
          el('span.chip.static', {}, REASON_LABELS[r] || r)))
      ),
      el('button.btn.btn-ghost.btn-sm', {
        html: icon('merge', 14, 2),
        dataset: { focusKey: `merge-${pair.a.id}-${pair.b.id}` },
        onclick: () => openMergeForm(kind, pair.a, pair.b),
      }, ' Объединить…')
    );
  }

  function render() {
    // The list is rebuilt under whatever the keyboard was on; a pair that
    // survives the change keeps its row, so hand it back - the same
    // bargain the merge form above strikes.
    const focusKey = body.contains(document.activeElement)
      ? document.activeElement.dataset?.focusKey : null;
    clear(body);
    const contactPairs = contactDuplicates(store.contacts);
    const companyPairs = companyDuplicates(store.companies);
    const restoreFocus = () => {
      if (focusKey) body.querySelector(`[data-focus-key=${CSS.escape(focusKey)}]`)?.focus();
    };

    if (!contactPairs.length && !companyPairs.length) {
      body.append(el('div.all-clear', { html: icon('check', 18, 2.4) },
        el('span', {}, 'Дублей не найдено. Все контакты и компании уникальны.')));
      return;
    }
    if (contactPairs.length) {
      body.append(
        el('h3.csv-preview-title', {}, `Контакты (${contactPairs.length})`),
        el('div.dupe-list', {}, contactPairs.map((p) => pairRow('contact', p)))
      );
    }
    if (companyPairs.length) {
      body.append(
        el('h3.csv-preview-title', {}, `Компании (${companyPairs.length})`),
        el('div.dupe-list', {}, companyPairs.map((p) => pairRow('company', p)))
      );
    }
    restoreFocus();
  }

  render();
  /* The review is a reading of the data, so it follows the data rather
     than only the merges it starts itself. A merge undone from its toast
     puts the pair back while this is still open, and the list said "No
     possible duplicates" over a leads page that plainly said otherwise -
     with no way to ask again short of closing and reopening. */
  const onChange = () => render();
  store.addEventListener('change', onChange);
  return openModal({
    title: 'Возможные дубли',
    wide: true,
    onClose: () => store.removeEventListener('change', onChange),
    content: el('div', {},
      el('p.settings-note.sheet-note', {},
        'Совпадения по почте, имени или телефону (контакты) и по названию или домену сайта (компании) без учёта регистра и знаков препинания.'),
      body
    ),
  });
}
