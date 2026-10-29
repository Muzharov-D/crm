/**
 * Next-step nudges: the moment after doing something is the cheapest time
 * to book the next touch, so completing a follow-up, logging an activity,
 * or moving a deal offers to schedule one - but only when the record now
 * has nothing else scheduled, and never as a blocking dialog. The nudge is
 * a toast (one click to act, dismisses itself); the quick sheet behind it
 * books a date in one more tap. A Settings toggle turns the whole thing off.
 *
 * The full task form is loaded on demand rather than imported - forms.js
 * imports its way back into the modules that call this one.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { todayISO, addDays, addMonthsClamped, formatDate } from '../lib/util.js';

/** Anything still open on either half of the link means no nagging. */
function hasOpenFollowUp(contactId, dealId) {
  return store.tasks.some((t) => !t.done
    && ((dealId && t.dealId === dealId) || (contactId && t.contactId === contactId)));
}

/**
 * Offer to schedule the next step for a record that has none. Returns
 * whether a nudge was shown, so callers can fall back to their plain
 * confirmation toast when it wasn't.
 */
export function maybeNudgeNextStep({ contactId = null, dealId = null, title = '', lead = 'Выполнено' }) {
  if (store.settings.nextStepNudges === false) return false;
  if (!contactId && !dealId) return false;
  if (hasOpenFollowUp(contactId, dealId)) return false;
  const deal = store.dealById(dealId);
  const contact = store.contactById(contactId);
  if (!deal && !contact) return false;
  const name = deal ? deal.name : contact.name;
  toast(`${lead} · нет следующего шага: ${name}`, {
    icon: 'followups',
    duration: 8000,
    action: {
      label: 'Запланировать',
      onClick: () => openNextStepSheet({ contactId, dealId, title }),
    },
  });
  return true;
}

/** Quick presets first, the full form one tap behind. */
export function openNextStepSheet({ contactId = null, dealId = null, title = '' } = {}) {
  const contact = store.contactById(contactId);
  const deal = store.dealById(dealId);
  const fallback = deal ? `Связаться по сделке «${deal.name}»`
    : contact ? `Связаться: ${contact.name}` : 'Связаться';
  const titleInput = el('input.input', {
    type: 'text', id: 'next-step-title', value: title || fallback,
    maxlength: 200, autocomplete: 'off',
  });

  const today = todayISO();
  const add = async (due) => {
    modal.close();
    try {
      await store.addTask({
        title: titleInput.value.trim() || fallback, due,
        contactId: contactId || deal?.contactId || null, dealId,
      });
    } catch {
      toast('Не удалось сохранить. Проверьте связь', { icon: 'wifiOff' });
      return;
    }
    toast(`Задача добавлена · ${formatDate(due)}`, { icon: 'followups' });
  };

  const option = (label, due) => el('button.settings-row', {
    type: 'button',
    onclick: () => add(due),
  },
    el('span.row-ic', { html: icon('followups', 20, 1.8) }),
    el('div.grow', {},
      el('div.title', {}, label),
      el('div.sub', {}, formatDate(due))
    ),
    el('span.row-chev', { html: icon('chevR', 18) })
  );

  const modal = openModal({
    title: 'Запланировать следующий шаг',
    content: el('div', {},
      el('div.settings-body', {},
        el('div.field', {},
          el('label.field-label', { for: 'next-step-title' }, 'Что нужно сделать?'),
          titleInput
        )
      ),
      el('div.settings-list', {},
        option('Через 3 дня', addDays(today, 3)),
        option('Через неделю', addDays(today, 7)),
        option('Через месяц', addMonthsClamped(today, 1))
      ),
      el('div.settings-body', {},
        el('button.btn.btn-ghost.btn-sm.btn-dashed', {
          type: 'button',
          onclick: async () => {
            const presets = { contactId, dealId, title: titleInput.value.trim() };
            modal.close();
            const { openTaskForm } = await import('./forms.js');
            setTimeout(() => openTaskForm(null, { presets }), 120);
          },
        }, ' Выбрать дату и время…')
      )
    ),
  });
  return modal;
}
