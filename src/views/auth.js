import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Pre-sign-in intro page: local corporate assets, no third-party requests. */
export function authView({ onSignedIn }) {
  const cta = el('button.btn.btn-primary.auth-cta', {
    onclick: async () => {
      cta.disabled = true;
      cta.textContent = 'Входим…';
      try {
        await puter.auth.signIn();
        onSignedIn();
      } catch {
        cta.disabled = false;
        cta.textContent = 'Войти';
      }
    },
  }, 'Войти');

  return el('div.auth-shell', {},
    el('section.auth-brand', {},
      el('img.auth-brand-logo', { src: './brand/avandok-white-wordmark.png', alt: 'Авандок' }),
      el('div.auth-brand-copy', {},
        el('div.brand-kicker.light', {}, 'CRM · SALES OS'),
        el('h1', {}, 'Продажи. Процесс. Результат.'),
        el('p', {}, 'Полный цикл от первого лида до платежа — в едином управляемом пространстве команды.'),
        el('div.auth-pulse-line', { 'aria-hidden': 'true' }, el('span.pulse-dot'))),
      el('div.auth-brand-foot', {}, 'Ваши данные · Ваш сервер · Ваши правила')),
    el('section.auth-panel', {},
      el('div.auth-view', {},
        el('img.auth-wordmark', { src: './brand/avandok-navy-wordmark.png', alt: 'Авандок' }),
        el('div.brand-kicker', {}, 'РАБОЧЕЕ ПРОСТРАНСТВО'),
        el('h2.auth-title', {}, 'Вход в CRM'),
        el('p.auth-sub', {}, 'Контрагенты, лиды, сделки, платежи и прогноз — с понятным следующим шагом.'),
        el('div.auth-features', {},
          feature('pipeline', 'Единая воронка и контроль полного цикла продаж'),
          feature('followups', 'Задачи, сроки и сигналы, требующие внимания'),
          feature('chart', 'План-факт и взвешенный прогноз по финансовым годам')
        ),
        cta,
        el('p.auth-note', {}, 'Данные хранятся на сервере вашей CRM.'))));

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
