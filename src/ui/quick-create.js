import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { store } from '../lib/store.js';
import { moduleEnabled } from '../lib/workspace.js';
import {
  openDealForm, openLeadForm, openCompanyForm, openContactForm, openTaskForm,
} from './mvp-forms.js';

const actions = [
  { module: 'pipeline', label: 'Сделка', description: 'Новая возможность в воронке', icon: 'deal', run: openDealForm },
  { module: 'leads', label: 'Лид', description: 'Начать квалификацию L0–L5', icon: 'target', run: openLeadForm },
  { module: 'companies', label: 'Контрагент', description: 'Организация и реквизиты', icon: 'building', run: openCompanyForm },
  { module: 'companies', label: 'Контакт', description: 'Человек в клиентской команде', icon: 'userPlus', run: openContactForm },
  { module: 'tasks', label: 'Задача', description: 'Следующий шаг со сроком', icon: 'followups', run: openTaskForm },
];

export function openQuickCreate() {
  const available = actions.filter((a) => moduleEnabled(store.settings, a.module));
  const modal = openModal({
    title: 'Создать запись',
    content: el('div.quick-create-grid', {}, available.map((action) => el('button.quick-create-option', {
      type: 'button',
      onclick: () => {
        modal.close();
        setTimeout(() => action.run(), 100);
      },
    },
      el('span.quick-create-icon', { html: icon(action.icon, 21), 'aria-hidden': 'true' }),
      el('span', {}, el('strong', {}, action.label), el('small', {}, action.description))))),
    footer: el('p.field-hint', {}, 'Состав меню зависит от включённых модулей в Пульте управления.'),
  });
  return modal;
}
