/**
 * Playbooks in the UI: the editor Settings uses, the "Apply playbook…"
 * flow on a lead or deal, and the offer a stage arrival makes.
 *
 * Applying always shows the dates it is about to create before it commits,
 * and always lands as one Undo - five follow-ups appearing out of one
 * click is only comfortable if one click takes them back.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { wireForm } from './forms.js';
import { requiredMark } from './bits.js';
import { formatDate, todayISO, countLabel, plural } from '../lib/util.js';
import {
  MAX_PLAYBOOKS, MAX_PLAYBOOK_STEPS, MAX_STEP_OFFSET, MAX_PLAYBOOK_NAME, MAX_STEP_TITLE,
  blankPlaybook, playbookSummary, playbookTasks, playbookForStage,
} from '../lib/playbooks.js';
import { openStages } from '../lib/forecast.js';

/* ---------- editor (Settings) ---------- */

const templateOptions = () => [
  { value: '', label: 'Без письма' },
  ...[...store.templates].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((t) => ({ value: t.id, label: t.name })),
];

function select(options, value, props = {}) {
  const node = el('select.select', props,
    options.map((o) => el('option', { value: o.value, selected: o.value === value }, o.label)));
  return { wrap: el('div.select-wrap', {}, node), node };
}

export function openPlaybookForm(playbook = null, { onSaved = null } = {}) {
  const source = playbook || blankPlaybook();
  const name = el('input.input', {
    type: 'text', value: source.name, required: true, maxlength: MAX_PLAYBOOK_NAME,
    id: 'pb-name', autocomplete: 'off', placeholder: 'Например, дожим КП',
  });

  const stages = openStages(store.stages());
  const trigger = select([
    { value: '', label: 'Только вручную' },
    ...stages.map((s) => ({ value: s.id, label: `Когда сделка переходит на этап «${s.label}»` })),
  ], source.trigger, { id: 'pb-trigger' });

  const stepsWrap = el('div.playbook-steps');
  const rows = [];
  const addBtn = el('button.btn.btn-ghost.btn-sm.btn-dashed', {
    type: 'button',
    html: icon('plus', 14, 2.2),
    onclick: () => addRow({}, { focus: true }),
  }, ' Добавить шаг');

  function syncRows() {
    addBtn.disabled = rows.length >= MAX_PLAYBOOK_STEPS;
    addBtn.title = addBtn.disabled ? `В сценарии не больше ${countLabel(MAX_PLAYBOOK_STEPS, ['шага', 'шагов', 'шагов'])}` : null;
    for (const row of rows) row.remove.disabled = rows.length <= 1;
    renderPreview();
  }

  function addRow(step = {}, { focus = false } = {}) {
    const title = el('input.input.playbook-title', {
      type: 'text', value: step.title || '', maxlength: MAX_STEP_TITLE,
      autocomplete: 'off', placeholder: 'Например, отправить письмо-итог',
      'aria-label': 'Шаг',
    });
    const offset = el('input.input.prob-input.playbook-offset', {
      type: 'number', min: '0', max: String(MAX_STEP_OFFSET), step: '1', inputmode: 'numeric',
      value: String(step.offset ?? 0),
      'aria-label': 'Через сколько дней после применения сценария',
    });
    const template = select(templateOptions(), step.templateId || '',
      { 'aria-label': 'Шаблон письма для этого шага' });
    const remove = el('button.icon-btn', {
      type: 'button',
      html: icon('x', 16, 2.2),
      'aria-label': 'Удалить шаг',
      onclick: () => {
        rows.splice(rows.indexOf(row), 1);
        node.remove();
        syncRows();
      },
    });
    const row = { title, offset, template, remove };
    const node = el('div.playbook-step', {},
      title,
      el('div.playbook-step-meta', {},
        el('span.stage-prob-field', {}, offset, el('span.prob-unit', { 'aria-hidden': 'true' }, 'дн.')),
        template.wrap,
        remove
      )
    );
    for (const input of [title, offset]) input.addEventListener('input', renderPreview);
    rows.push(row);
    stepsWrap.append(node);
    syncRows();
    if (focus) title.focus();
  }

  const preview = el('div.playbook-preview');
  const read = () => ({
    id: source.id,
    name: name.value.trim(),
    trigger: trigger.node.value,
    steps: rows.map((r) => ({
      title: r.title.value.trim(),
      offset: Number(r.offset.value) || 0,
      templateId: r.template.node.value,
    })),
  });

  function renderPreview() {
    clear(preview);
    const tasks = playbookTasks(read());
    if (!tasks.length) {
      preview.append(el('p.field-hint', {}, 'Назовите шаги, чтобы увидеть даты задач.'));
      return;
    }
    preview.append(
      el('p.field-hint', {}, 'Если применить сегодня, появятся задачи:'),
      el('ul.playbook-dates', {}, tasks.map((t) =>
        el('li', {}, el('span.grow.min0', {}, t.title), el('span.playbook-date', {}, formatDate(t.due)))))
    );
  }

  for (const step of source.steps.length ? source.steps : [{ title: '', offset: 0 }]) addRow(step);

  const form = el('form.form', {},
    el('div.field', {},
      el('label.field-label', { for: 'pb-name' }, 'Название сценария', requiredMark()), name),
    el('div.field', {},
      el('label.field-label', {}, 'Шаги'),
      stepsWrap,
      addBtn,
      el('p.field-hint', {}, 'Дни считаются от дня применения сценария. 0 — в тот же день.')
    ),
    el('div.field', {},
      el('label.field-label', { for: 'pb-trigger' }, 'Предлагать автоматически'),
      trigger.wrap,
      el('p.field-hint', {}, 'Когда сделка переходит на этот этап, система предложит сценарий. Сначала всегда спросит и только если у сделки нет других задач.')
    ),
    preview,
    el('div.form-actions', {},
      playbook && el('button.btn.btn-ghost.btn-danger-ghost', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Удалить «${playbook.name}»?`,
            message: 'Задачи, которые сценарий уже создал, останутся без изменений.',
          });
          if (!ok) return;
          try {
            await store.setPlaybooks(store.playbooks().filter((p) => p.id !== playbook.id));
          } catch {
            toast('Не удалось удалить. Проверьте подключение', { icon: 'wifiOff' });
            return;
          }
          modal.close();
          toast('Сценарий удалён', { icon: 'trash' });
          onSaved?.(null);
        },
      }, 'Удалить'),
      el('div.grow'),
      el('button.btn.btn-primary', { type: 'submit' }, playbook ? 'Сохранить' : 'Добавить сценарий')
    )
  );

  const modal = openModal({
    title: playbook ? 'Сценарий' : 'Новый сценарий',
    content: form,
    guardUnsaved: true,
  });

  wireForm(form, async () => {
    const next = read();
    const list = store.playbooks();
    const at = list.findIndex((p) => p.id === next.id);
    if (at >= 0) list[at] = next;
    else list.push(next);
    const saved = await store.setPlaybooks(list.slice(0, MAX_PLAYBOOKS));
    modal.close();
    toast(playbook ? 'Сценарий сохранён' : 'Сценарий добавлен');
    onSaved?.(saved.find((p) => p.id === next.id) || null);
  });
  return modal;
}

/* ---------- applying ---------- */

/** Who the follow-ups will hang off, in words. */
function targetName({ contactId, dealId }) {
  return store.dealById(dealId)?.name || store.contactById(contactId)?.name || '';
}

/**
 * The preview, and the commit. Shows every follow-up it would create with
 * its date, so nothing appears that wasn't agreed to first.
 */
export function openPlaybookPreview(playbook, { contactId = null, dealId = null, title = null } = {}) {
  const tasks = playbookTasks(playbook, todayISO());
  const who = targetName({ contactId, dealId });

  const apply = async () => {
    modal.close();
    let created;
    try {
      created = await store.applyPlaybook(playbook, { contactId, dealId });
    } catch {
      toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
      return;
    }
    const n = created.length;
    toast(`${plural(n, ['Добавлена', 'Добавлено', 'Добавлено'])} ${countLabel(n, ['задача', 'задачи', 'задач'])}`, {
      icon: 'followups',
      action: {
        label: 'Отменить',
        onClick: () => store.undoAddedTasks(created.map((t) => t.id))
          .catch(() => toast('Не удалось отменить. Проверьте подключение', { icon: 'wifiOff' })),
      },
    });
  };

  const modal = openModal({
    title: title || `Применить «${playbook.name}»`,
    content: el('div', {},
      el('p.settings-note.sheet-note', {}, tasks.length
        ? `${countLabel(tasks.length, ['задача', 'задачи', 'задач'])}${who ? ` для «${who}»` : ''}, даты от сегодняшнего дня:`
        : 'В сценарии пока нет шагов. Добавьте их в настройках.'),
      tasks.length > 0 && el('div.settings-body', {},
        el('ul.playbook-dates', {}, tasks.map((t) => el('li', {},
          el('span.grow.min0', {}, t.title),
          el('span.playbook-date', {}, formatDate(t.due))
        )))
      ),
      el('div.form-actions', {},
        el('div.grow'),
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Не сейчас'),
        tasks.length > 0 && el('button.btn.btn-primary', { type: 'button', onclick: apply },
          `Добавить ${countLabel(tasks.length, ['задачу', 'задачи', 'задач'])}`)
      )
    ),
  });
  return modal;
}

/** Pick a playbook to apply to this record, then preview it. */
export function openPlaybookPicker({ contactId = null, dealId = null } = {}) {
  const books = store.playbooks();
  const who = targetName({ contactId, dealId });

  const modal = openModal({
    title: 'Применить сценарий',
    content: el('div', {},
      books.length
        ? el('div', {},
            el('p.settings-note.sheet-note', {},
              who ? `Ваша обычная последовательность задач для «${who}».` : 'Ваша обычная последовательность задач от сегодняшнего дня.'),
            el('div.settings-list', {}, books.map((book) => el('button.settings-row', {
              type: 'button',
              onclick: () => {
                modal.close();
                setTimeout(() => openPlaybookPreview(book, { contactId, dealId }), 120);
              },
            },
              el('span.row-ic', { html: icon('listChecks', 20, 1.8) }),
              el('div.grow.min0', {},
                el('div.title', {}, book.name),
                el('div.sub', {}, playbookSummary(book))
              ),
              el('span.row-chev', { html: icon('chevR', 18) })
            )))
          )
        : el('p.settings-note.sheet-note', {},
            'Сценариев пока нет. Сохраните обычную последовательность задач в настройках, и она появится здесь.')
    ),
  });
  return modal;
}

/**
 * A deal has arrived in a stage. If a playbook is waiting on that stage,
 * offer it - always asking, never applying on its own, and only when the
 * deal has nothing else booked, so working a deal back and forth doesn't
 * turn into a queue of dialogs. Returns whether anything was offered, so
 * the caller can skip its own next-step nudge.
 */
export function maybeOfferPlaybook(deal, stage) {
  if (!deal) return false;
  const book = playbookForStage(store.settings, stage);
  if (!book || !book.steps.length) return false;
  if (store.hasOpenTask(deal.id)) return false;
  openPlaybookPreview(book, {
    dealId: deal.id,
    contactId: deal.contactId,
    title: `Применить «${book.name}»?`,
  });
  return true;
}

/** The button a lead or deal page shows when there is a playbook to apply. */
export function playbookButton({ contactId = null, dealId = null } = {}) {
  if (!store.playbooks().length) return null;
  return el('button.btn.btn-ghost.btn-sm', {
    type: 'button',
    html: icon('listChecks', 14, 2),
    'aria-haspopup': 'dialog',
    onclick: () => openPlaybookPicker({ contactId, dealId }),
  }, ' Сценарий');
}

export { MAX_PLAYBOOKS };
