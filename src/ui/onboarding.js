/**
 * First-run onboarding: one decision (set up / sample data / skip) and one
 * setting (currency). Gated on an empty dataset; closing at any point marks
 * onboarding done, so it never nags twice.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { sampleDataset } from '../lib/sample.js';
import { openContactForm } from './mvp-forms.js';

const CURRENCIES = [
  { code: 'RUB', name: 'Российский рубль' },
  { code: 'USD', name: 'Доллар США' },
  { code: 'EUR', name: 'Евро' },
  { code: 'GBP', name: 'Фунт стерлингов' },
  { code: 'CAD', name: 'Канадский доллар' },
  { code: 'AUD', name: 'Австралийский доллар' },
  { code: 'INR', name: 'Индийская рупия' },
  { code: 'JPY', name: 'Японская иена' },
  { code: 'BRL', name: 'Бразильский реал' },
  { code: 'CHF', name: 'Швейцарский франк' },
  { code: 'SEK', name: 'Шведская крона' },
];

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && store.contacts.length === 0 && store.companies.length === 0
    && store.deals.length === 0;
}

export function openOnboarding() {
  const body = el('div');

  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  const modal = openModal({ title: 'Добро пожаловать', content: body, onClose: markDone });

  const skipBtn = () => el('button.btn.btn-ghost.btn-block.mt-sm', {
    type: 'button',
    onclick: () => { markDone(); modal.close(); },
  }, 'Пропустить');

  /* Step 0 - welcome */
  function renderWelcome() {
    clear(body);
    append(body, [
      el('div.empty.onboard-hero', {},
        el('img.onboard-mark', { src: './icon-192.png', width: 58, height: 58, alt: '' }),
        el('h3', {}, 'Ваша воронка, ваши данные'),
        el('p', {}, 'Контакты, компании, сделки и задачи в одном месте, а ещё прогноз, которому можно доверять. Данные хранятся на вашем сервере, их никто не продаёт и не передаёт.')
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: renderCurrency,
      }, 'Настроить воронку'),
      el('button.btn.btn-ghost.btn-block.btn-dashed.mt-sm', {
        type: 'button',
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Посмотреть на демо-данных'),
      skipBtn(),
    ]);
  }

  async function useSampleData(e) {
    // currentTarget, not target: the button carries an icon, so a click on
    // the SVG would otherwise "disable" the svg and leave the button live.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await store.importAll(sampleDataset(store));
    } catch (err) {
      console.error(err);
      toast('Не удалось загрузить демо-данные. Проверьте подключение', { icon: 'wifiOff' });
      btn.disabled = false;
      return;
    }
    modal.close();
    toast('Демо-данные загружены. Удалить их можно в любой момент через баннер', { icon: 'sparkle' });
  }

  /* Step 1 - currency, then straight into the first lead */
  function renderCurrency() {
    clear(body);
    let picked = store.settings.currency;
    append(body, [
      el('h3.onboard-h', {}, 'В какой валюте вы продаёте?'),
      el('p.onboard-p', {}, 'В этой валюте будут суммы сделок, итоги воронки и прогноз.'),
      el('div.field', {},
        el('div.select-wrap', {},
          el('select.select', {
            'aria-label': 'Валюта',
            onchange: (ev) => { picked = ev.target.value; },
          }, CURRENCIES.map((c) =>
            el('option', { value: c.code, selected: c.code === picked }, `${c.code} · ${c.name}`)))
        )
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          await store.updateSettings({ currency: picked, onboarded: true }).catch(() => {});
          modal.close();
          // The natural first move in an empty CRM: add the first lead.
          openContactForm();
        },
      }, 'Добавить первый контакт'),
      skipBtn(),
    ]);
  }

  renderWelcome();
}
