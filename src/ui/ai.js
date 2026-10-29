/**
 * The three AI assist controls, and nothing else: paste-to-fill on the
 * lead and company forms, draft-this-email in the compose flow, and
 * catch-me-up on a lead or deal.
 *
 * Every one of them is a button with a visible pending state, a result
 * that lands in a field the user can edit, and a failure that leaves what
 * was on screen exactly as it was.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import {
  aiEnabled, askAI, contactPrompt, companyPrompt, parseDraft, recordContext,
  summaryPrompt, CONTACT_DRAFT_FIELDS, COMPANY_DRAFT_FIELDS,
} from '../lib/ai.js';
import { rateText } from '../lib/recurring.js';

/** Is the assist on for this session? */
export const assistOn = () => aiEnabled(store.settings);

/**
 * Run one request behind a button: pending label while it is out, the
 * button back exactly as it was afterwards, whatever happened.
 */
async function withPending(button, label, run) {
  const before = button.innerHTML;
  button.disabled = true;
  button.replaceChildren(el('span.ai-spinner', { 'aria-hidden': 'true' }), ` ${label}`);
  button.setAttribute('aria-busy', 'true');
  try {
    return await run();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = before;
  }
}

const failed = () => toast('Модель не ответила. Ничего не изменено', { icon: 'alert' });

/* ---------- 1. paste to create ---------- */

/**
 * The dashed button that opens the paste sheet, or null when assist is
 * off. `fields` maps a draft key to the form control it fills; `onFilled`
 * hears which keys landed so a form can say so in its own words.
 */
export function pasteToFillButton({ kind, fields, onFilled = null }) {
  if (!assistOn()) return null;
  return el('button.btn.btn-ghost.btn-sm.btn-dashed.ai-btn', {
    type: 'button',
    html: icon('sparkle', 14, 2),
    'aria-haspopup': 'dialog',
    onclick: () => openPasteSheet({ kind, fields, onFilled }),
  }, ' Вставить данные');
}

function openPasteSheet({ kind, fields, onFilled }) {
  const isCompany = kind === 'companies';
  const text = el('textarea.input.textarea', {
    rows: 7,
    id: 'ai-paste',
    placeholder: isCompany
      ? 'Вставьте текст со страницы «О компании», подвал сайта или любой текст с названием компании…'
      : 'Вставьте подпись из письма, текст из профиля, заметки после звонка…',
  });

  const fill = el('button.btn.btn-primary', { type: 'button' }, 'Заполнить форму');
  fill.addEventListener('click', () => withPending(fill, 'Читаю…', async () => {
    const source = text.value.trim();
    if (!source) {
      toast('Сначала вставьте текст', { icon: 'alert' });
      return;
    }
    let draft;
    try {
      const answer = await askAI(isCompany ? companyPrompt(source) : contactPrompt(source));
      draft = parseDraft(answer, isCompany ? COMPANY_DRAFT_FIELDS : CONTACT_DRAFT_FIELDS);
    } catch {
      failed();
      return;
    }
    const keys = Object.keys(draft);
    if (!keys.length) {
      toast('В этом тексте не нашлось данных', { icon: 'alert' });
      return;
    }
    // Only empty fields are filled: an extraction is a suggestion, and it
    // must never overwrite something the user typed themselves.
    const filled = [];
    const skipped = [];
    for (const [key, value] of Object.entries(draft)) {
      const target = fields[key];
      if (!target) { skipped.push([key, value]); continue; }
      if (target.apply) {
        const done = target.apply(value);
        if (done) filled.push(key);
        else skipped.push([key, value]);
        continue;
      }
      if (target.value?.trim()) { skipped.push([key, value]); continue; }
      target.value = value;
      filled.push(key);
    }
    modal.close();
    onFilled?.({ filled, skipped, draft });
  }));

  const modal = openModal({
    title: 'Вставить данные',
    focusFirst: true,
    content: el('div', {},
      el('p.settings-note.sheet-note', {},
        'Вставленный текст отправляется в ИИ Puter, который разберёт его по полям. Ничего не сохранится, пока вы не сохраните форму.'),
      el('div.settings-body', {},
        el('div.field', {},
          el('label.field-label', { for: 'ai-paste' }, 'Текст'),
          text
        )
      ),
      el('div.form-actions', {},
        el('div.grow'),
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Отмена'),
        fill
      )
    ),
  });
  return modal;
}

/** Field names as a paste summary reads them. */
const FILL_LABELS = {
  name: 'имя', title: 'должность', email: 'почта', phone: 'телефон',
  company: 'компания', industry: 'отрасль', website: 'сайт',
};

/** "Заполнено: имя, должность и почта" - what a paste actually did. */
export function fillSummary({ filled, skipped }) {
  const label = (k) => FILL_LABELS[k] || k;
  if (!filled.length) return 'Заполнять нечего: в этих полях уже есть значения';
  const names = filled.map(label);
  const list = names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
  const left = skipped.length ? ` · не тронуто: ${skipped.length}` : '';
  return `Заполнено: ${list}${left}`;
}

/* ---------- 2. draft this email ---------- */

/**
 * The "Draft it" button for the compose sheet. Writes into the same
 * editable body a template fills, so the founder edits and sends exactly
 * as they always did.
 */
export function draftEmailButton({ contact, deal, subject, body }) {
  if (!assistOn()) return null;
  const button = el('button.btn.btn-ghost.btn-sm.btn-dashed.ai-btn', {
    type: 'button',
    html: icon('sparkle', 14, 2),
  }, ' Написать черновик');
  button.addEventListener('click', () => withPending(button, 'Пишу…', async () => {
    const { emailPrompt } = await import('../lib/ai.js');
    const context = contextFor({ contact, deal });
    let text;
    try {
      text = await askAI(emailPrompt(context, {
        subject: subject.value.trim(),
        body: body.value.trim(),
        sender: store.user?.username || '',
      }));
    } catch {
      failed();
      return;
    }
    body.value = text;
    body.focus();
    toast('Черновик готов. Проверьте его перед отправкой', { icon: 'sparkle' });
  }));
  return button;
}

/* ---------- 3. catch me up ---------- */

/** Everything the model is told: this record, and its own history. */
function contextFor({ contact = null, deal = null, company = null }) {
  const activities = deal
    ? store.dealActivities(deal)
    : contact ? store.activitiesFor({ contactId: contact.id })
      : company ? store.activitiesFor({ companyId: company.id }) : [];
  const tasks = (deal || contact)
    ? store.tasksFor({ dealId: deal?.id, contactId: contact?.id }).filter((t) => !t.done)
    : [];
  return recordContext({
    contact: contact || (deal ? store.contactById(deal.contactId) : null),
    company: company || store.companyById(deal?.companyId ?? contact?.companyId),
    deal,
    activities,
    tasks,
    currency: store.settings.currency,
    dealRate: deal ? rateText(deal, store.settings.currency) : null,
  });
}

/** How much history makes "catch me up" worth offering at all. */
const WORTH_SUMMARIZING = 3;

/**
 * The "Catch me up" button for a lead or deal page - only once there is
 * enough history that reading it back is a chore.
 */
export function catchUpButton({ contact = null, deal = null }) {
  if (!assistOn()) return null;
  const activities = deal
    ? store.dealActivities(deal)
    : contact ? store.activitiesFor({ contactId: contact.id }) : [];
  if (activities.length < WORTH_SUMMARIZING) return null;

  const button = el('button.btn.btn-ghost.btn-sm.ai-btn', {
    type: 'button',
    html: icon('sparkle', 14, 2),
    'aria-haspopup': 'dialog',
  }, ' Краткая сводка');
  button.addEventListener('click', () => withPending(button, 'Читаю…', async () => {
    let text;
    try {
      text = await askAI(summaryPrompt(contextFor({ contact, deal })));
    } catch {
      failed();
      return;
    }
    openSummary(text, deal?.name || contact?.name || '');
  }));
  return button;
}

function openSummary(text, who) {
  const area = el('textarea.input.textarea.ai-summary', { rows: 8, value: text, id: 'ai-summary' });
  const modal = openModal({
    title: who ? `Сводка: ${who}` : 'Краткая сводка',
    content: el('div', {},
      el('div.settings-body', {},
        el('div.field', {},
          el('label.field-label.sr-only', { for: 'ai-summary' }, 'Сводка'),
          area,
          el('p.field-hint', {},
            'Составлено ИИ Puter по истории этой карточки. Ничего не сохраняется — скопируйте нужное.')
        )
      ),
      el('div.form-actions', {},
        el('div.grow'),
        el('button.btn.btn-primary', { type: 'button', onclick: () => modal.close() }, 'Готово')
      )
    ),
  });
  // Whatever else it is, it is text to be read: give the reader the top of
  // it rather than a field scrolled to its end by focus.
  area.setSelectionRange(0, 0);
  return modal;
}
