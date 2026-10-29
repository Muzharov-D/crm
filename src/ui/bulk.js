/**
 * Multi-select plumbing for list views: a selection set with shift-click
 * ranges, the row checkbox, the floating actions bar, and the small pick
 * sheets bulk actions open. Desktop-first - the checkboxes hide on phone
 * widths, where one record at a time is the honest interaction.
 *
 * CSV import lands hundreds of rows in one go; this is how corrections
 * afterwards stop being one form per record.
 */

import { el, keepingFocus } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, TRASH_MAX } from '../lib/store.js';
import { cleanTag } from '../lib/tags.js';
import { countLabel } from '../lib/util.js';

/**
 * Selection over row ids. `onChange` re-renders the view; shift-click
 * applies the clicked row's new state across the range back to the last
 * row clicked, in the order currently on screen.
 */
export function rowSelection(change) {
  const set = new Set();
  let anchorId = null;
  // Every one of these rebuilds the list, which throws away the checkbox
  // the keyboard is on - so ticking three rows in a row meant tabbing back
  // from the top of the page twice. Store-driven renders already go
  // through this; a selection is just as much a re-render.
  const onChange = keepingFocus(change);
  return {
    set,
    get size() { return set.size; },
    has: (id) => set.has(id),
    ids: () => [...set],
    clear() {
      set.clear();
      anchorId = null;
      onChange();
    },
    /** Forget everything without announcing - for view switches that
        re-render themselves anyway. The anchor goes with the set: a
        cleared selection whose anchor survived would hand the next
        shift-click a range nobody started. */
    reset() {
      set.clear();
      anchorId = null;
    },
    click(id, order, shiftKey) {
      const on = !set.has(id);
      if (shiftKey && anchorId && order.includes(anchorId)) {
        const a = order.indexOf(anchorId);
        const b = order.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) {
          if (on) set.add(order[i]);
          else set.delete(order[i]);
        }
      } else if (on) {
        set.add(id);
      } else {
        set.delete(id);
      }
      anchorId = id;
      onChange();
    },
    selectAll(order) {
      for (const id of order) set.add(id);
      onChange();
    },
    /** Drop ids the data no longer has, without announcing a change. */
    prune(validIds) {
      const ok = new Set(validIds);
      for (const id of [...set]) if (!ok.has(id)) set.delete(id);
    },
  };
}

/** The per-row checkbox. Overlaid on link rows, so it eats the click. */
export function selectBox(selection, id, order, label) {
  return el('button.row-select', {
    type: 'button',
    role: 'checkbox',
    'aria-checked': String(selection.has(id)),
    'aria-label': `Выбрать: ${label}`,
    // Found again by the record, not by its name: two leads may share one
    // (this app has a whole screen for that), and the rebuilt list would
    // hand the keyboard to the first of them - a box the user had not
    // ticked, one Space away from selecting the wrong record.
    dataset: { focusKey: `select-${id}` },
    className: `row-select${selection.has(id) ? ' on' : ''}`,
    html: selection.has(id) ? icon('check', 13, 3) : '',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      selection.click(id, order, e.shiftKey);
    },
  });
}

/**
 * Pair a row link with its checkbox as *siblings* - a button may not nest
 * inside an anchor, and screen readers misreport the ones that do. The
 * link carries a spacer where the checkbox appears; the wrapper overlays
 * the real control on top of it.
 */
export function selectableRow(box, row) {
  row.prepend(el('span.row-select-space', { 'aria-hidden': 'true' }));
  return el('div.select-row', {}, box, row);
}

/**
 * The floating actions bar. `actions`: [{ icon, label, onClick, danger }].
 * `total` is the filtered row count, so "Select all N" can finish the job
 * a few clicks started.
 */
export function bulkBar(selection, { total, order, actions }) {
  if (!selection.size) return null;
  return el('div.bulk-bar', { role: 'toolbar', 'aria-label': 'Массовые действия' },
    el('span.bulk-count', {}, `Выбрано: ${selection.size}`),
    selection.size < total && el('button.btn-inline.bulk-all', {
      onclick: () => selection.selectAll(order),
    }, `Выбрать все (${total})`),
    el('span.bulk-sep', { 'aria-hidden': 'true' }),
    actions.map((a) => el(`button.btn.btn-ghost.btn-sm${a.danger ? '.btn-danger-ghost' : ''}`, {
      html: icon(a.icon, 14, 2),
      onclick: a.onClick,
    }, ` ${a.label}`)),
    el('button.icon-btn.bulk-clear', {
      html: icon('x', 16, 2.2),
      'aria-label': 'Снять выделение',
      onclick: () => selection.clear(),
    })
  );
}

/** Small chooser sheet: options [{ value, label, node? }]. */
export function pickSheet(title, options, onPick) {
  const modal = openModal({
    title,
    content: el('div.settings-list', {}, options.map((o) => el('button.settings-row', {
      type: 'button',
      onclick: () => {
        modal.close();
        onPick(o.value);
      },
    },
      o.node || el('div.grow', {}, el('div.title', {}, o.label)),
      o.node && el('div.grow'),
      el('span.row-chev', { html: icon('chevR', 18) })
    ))),
  });
  return modal;
}

/** Tag picker for bulk tagging: existing tags one tap away, new ones typed. */
export function openBulkTagSheet(onPick) {
  const input = el('input.input', {
    type: 'text', placeholder: 'Новая или существующая метка…', maxlength: 40,
    autocomplete: 'off', 'aria-label': 'Метка',
  });
  const apply = (tag) => {
    const clean = cleanTag(tag);
    if (!clean) return;
    modal.close();
    onPick(clean);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      apply(input.value);
    }
  });
  const existing = store.allTags();
  const modal = openModal({
    title: 'Добавить метку',
    content: el('div', {},
      el('div.settings-body', {},
        el('div.snooze-pick', {},
          input,
          el('button.btn.btn-primary', { type: 'button', onclick: () => apply(input.value) }, 'Добавить')
        )
      ),
      existing.length > 0 && el('div.settings-list', {}, existing.map((t) =>
        el('button.settings-row', {
          type: 'button',
          onclick: () => apply(t.name),
        },
          el('span.row-ic', { html: icon('tag', 18, 2) }),
          el('div.grow', {}, el('div.title', {}, t.name)),
          el('span.sub', {}, String(t.count))
        )))
    ),
  });
  return modal;
}

/** Shared bulk-delete confirm, honest about the trash cap. `noun` comes in
    already pluralized, in the accusative ("контакта", "сделок"). */
export async function confirmBulkDelete(count, noun) {
  const overCap = count > TRASH_MAX;
  return confirmDialog({
    title: `Удалить ${count} ${noun}?`,
    message: overCap
      ? `В корзине помещается ${countLabel(TRASH_MAX, ['элемент', 'элемента', 'элементов'])}, поэтому восстановить можно будет только последние ${TRASH_MAX}, остальные удалятся безвозвратно. Лучше сначала сделайте экспорт.`
      : 'Связанные сделки, история и задачи останутся, но потеряют связь. Всё удалённое на 30 дней попадёт в корзину в настройках.',
    confirmLabel: 'Удалить',
  });
}

/** One toast for a finished bulk action. */
export function bulkToast(n, what, iconName = 'check') {
  toast(`${what}: ${n}`, { icon: iconName });
}
