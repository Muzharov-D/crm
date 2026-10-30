import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { store } from '../lib/store.js';
import { operationalAlerts } from '../lib/operations.js';

export function openNotifications() {
  const list = el('div.notification-list');
  const modal = openModal({
    title: 'Центр уведомлений',
    content: list,
    footer: el('p.field-hint', {}, 'Сигналы формируются из текущих сроков и данных CRM. Пуш-уведомления в демо не используются.'),
  });
  const render = () => {
    clear(list);
    const alerts = operationalAlerts(store, store.settings);
    if (!alerts.length) {
      list.append(el('div.notification-empty', {},
        el('span', { html: icon('check', 24), 'aria-hidden': 'true' }),
        el('h3', {}, 'Срочных сигналов нет'),
        el('p', {}, 'Просроченные задачи, зависшие сделки и пропущенные следующие шаги появятся здесь.')));
      return;
    }
    list.append(...alerts.map((alert) => el('a.notification-item', {
      href: alert.hash,
      onclick: () => modal.close(),
    },
      el('span.notification-severity', { dataset: { tone: alert.tone }, 'aria-hidden': 'true' }),
      el('span.grow.min0', {}, el('strong', {}, alert.title), el('small', {}, alert.detail)),
      el('span', { html: icon('chevR', 16), 'aria-hidden': 'true' }))));
  };
  render();
  return modal;
}
