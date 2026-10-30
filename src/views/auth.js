import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Pre-sign-in intro page: what the app is, why it's safe, one button in. */
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

  return el('div.auth-view', {},
    el('img.auth-logo', { src: './icon-192.png', alt: '', 'aria-hidden': 'true' }),
    el('h1.auth-title', {}, 'CRM для продаж'),
    el('p.auth-sub', {}, 'Контакты, сделки, задачи и прогноз для основателей, которые продают сами.'),
    el('div.auth-features', {},
      feature('pipeline', 'Воронка, где видно, на каком этапе каждая сделка'),
      feature('followups', 'Задачи со сроками, чтобы ни один контакт не остыл случайно'),
      feature('chart', 'Взвешенный прогноз по вашим этапам, а не по ожиданиям'),
      feature('company', 'Данные хранятся на вашем собственном сервере')
    ),
    cta
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
