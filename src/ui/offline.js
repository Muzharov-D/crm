/**
 * Being honest about where the data is.
 *
 * The outbox keeps a write nobody could deliver (lib/outbox.js); this is
 * the part that says so out loud: an indicator in the shell, one plain
 * message when a save lands locally instead of remotely, and - when a
 * queued write can't be replayed because another device wrote first - a
 * choice, rather than a quiet overwrite either way.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { timeAgo } from '../lib/util.js';

/** The collections, in the words the user knows them by. */
const KV_LABELS = {
  'crm:settings:v1': 'Настройки',
  'crm:companies:v1': 'Компании',
  'crm:contacts:v1': 'Контакты',
  'crm:deals:v1': 'Сделки',
  'crm:activities:v1': 'История',
  'crm:tasks:v1': 'Задачи',
  'crm:templates:v1': 'Шаблоны писем',
  'crm:attachments:v1': 'Файлы',
  'crm:trash:v1': 'Корзина',
  'crm:backup:v1': 'Резервная копия',
};

export const kvLabel = (key) => KV_LABELS[key] || key;

/** Is the browser telling us there is no network? */
const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * The shell pill: offline, or the queue that is still owed. Nothing at all
 * when everything is where it should be - this is a status line, not a
 * badge to be worn.
 */
export function offlineIndicator() {
  const node = el('div.offline-slot');

  function render() {
    clear(node);
    const { offline, queued, conflicts } = store.offline;
    const off = offline || browserOffline();
    if (!off && !queued) return;
    const label = conflicts
      ? `Требуют решения: ${conflicts}`
      : queued
        ? `Ждут отправки: ${queued}`
        : 'Нет связи';
    node.append(el('button.offline-pill', {
      type: 'button',
      className: `offline-pill${conflicts ? ' conflict' : off ? ' off' : ''}`,
      'aria-haspopup': 'dialog',
      title: off ? 'Нет связи — изменения сохраняются на этом устройстве' : 'Изменения ждут отправки на сервер',
      onclick: openOfflineSheet,
    },
      el('span', { html: icon(conflicts ? 'alert' : 'wifiOff', 14, 2.2), 'aria-hidden': 'true' }),
      el('span.offline-label', {}, label)
    ));
  }

  store.addEventListener('offline', render);
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
  return node;
}

/** What the pill opens: what is waiting, and what to do about it. */
export async function openOfflineSheet() {
  const pending = await store.pendingWrites().catch(() => []);
  const body = el('div');

  const syncBtn = el('button.btn.btn-primary', { type: 'button' }, 'Повторить сейчас');
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    const result = await store.syncNow();
    modal.close();
    reportSync(result);
  });

  /* A conflicted write is not on its way anywhere: it is held back until
     the user says which version stands. Promising it would go "as soon as
     the cloud answers" contradicted the row right underneath it, which
     says the cloud has already answered and a decision is what's missing. */
  const blocked = pending.filter((row) => row.conflict).length;
  const note = () => {
    if (!pending.length) {
      return 'Все данные на сервере. Изменения, сделанные без связи, сохранятся здесь и отправятся, когда связь появится.';
    }
    if (!blocked) {
      return 'Эти изменения сохранены на этом устройстве и отправятся на сервер, как только он ответит.';
    }
    if (blocked === pending.length) {
      return pending.length === 1
        ? 'Это изменение сохранено на этом устройстве и ждёт вашего решения: пока не было связи, данные на сервере тоже изменились, и остаться может только одна версия.'
        : 'Эти изменения сохранены на этом устройстве и ждут вашего решения: пока не было связи, данные на сервере тоже изменились, и для каждого остаться может только одна версия.';
    }
    return 'Эти изменения сохранены на этом устройстве. Большая часть отправится на сервер, как только он ответит, а по отмеченным ниже сначала нужно ваше решение.';
  };

  body.append(
    el('p.settings-note.sheet-note', {}, note()),
    pending.length > 0 && el('div.settings-list', {}, pending.map((row) => el('div.settings-row.static', {},
      el('span.row-ic', { html: icon(row.conflict ? 'alert' : 'wifiOff', 20, 1.8) }),
      el('div.grow.min0', {},
        el('div.title', {}, kvLabel(row.key)),
        el('div.sub', {}, row.conflict
          ? 'Изменено и на другом устройстве — нужно решение'
          : `Сохранено здесь ${timeAgo(row.at)}`)
      ),
      row.conflict && el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        onclick: () => { modal.close(); setTimeout(() => openConflictDialog(row.key), 120); },
      }, ' Решить')
    ))),
    el('div.form-actions', {},
      el('div.grow'),
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Закрыть'),
      pending.length > 0 && syncBtn
    )
  );

  const modal = openModal({
    title: pending.length ? 'Ждут отправки' : 'Всё синхронизировано',
    content: body,
  });
  return modal;
}

/**
 * The one decision this feature can't make for the user: a queued write
 * whose collection was also changed somewhere else. Whole-collection
 * writes mean one of the two versions wins, so it says which is which and
 * asks - never silently.
 */
export function openConflictDialog(key) {
  const modal = openModal({
    title: `«${kvLabel(key)}»: изменения в двух местах`,
    content: el('div', {},
      el('p.confirm-message', {},
        `Пока на этом устройстве не было связи, раздел «${kvLabel(key)}» изменили где-то ещё — `
        + 'в другой вкладке или на другом устройстве. Остаться может только одна версия.'),
      el('div.settings-list', {},
        el('button.settings-row', {
          type: 'button',
          onclick: () => decide(key, 'mine', modal),
        },
          el('span.row-ic', { html: icon('upload', 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, 'Оставить версию с этого устройства'),
            el('div.sub', {}, 'Ваши изменения отправятся на сервер и заменят другую версию')
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        ),
        el('button.settings-row', {
          type: 'button',
          onclick: () => decide(key, 'theirs', modal),
        },
          el('span.row-ic', { html: icon('download', 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, 'Взять другую версию'),
            el('div.sub', {}, 'Ваши изменения в этом разделе будут отброшены')
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        )
      )
    ),
  });
  return modal;
}

async function decide(key, choice, modal) {
  modal.close();
  const done = await store.resolveConflict(key, choice);
  if (!done) {
    toast('Сервер не отвечает. Изменение по-прежнему ждёт отправки', { icon: 'wifiOff' });
    return;
  }
  toast(choice === 'mine'
    ? `«${kvLabel(key)}»: на сервере теперь версия с этого устройства`
    : `«${kvLabel(key)}»: взята версия с сервера`, { icon: 'check' });
}

/** After a replay attempt: say what happened, once. */
export function reportSync(result) {
  if (result.conflicts.length) {
    const key = result.conflicts[0];
    toast(`«${kvLabel(key)}»: пока не было связи, данные изменились в двух местах`, {
      icon: 'alert',
      duration: 10000,
      action: { label: 'Решить', onClick: () => openConflictDialog(key) },
    });
    return;
  }
  if (result.failed.length) {
    toast('Связи по-прежнему нет. Изменения сохранены на этом устройстве', { icon: 'wifiOff' });
    return;
  }
  if (result.synced.length) toast('Всё синхронизировано', { icon: 'check' });
}

/**
 * Watch the connection for the whole session: replay when the browser says
 * it is back, and say the honest thing the first time a save lands locally
 * instead of remotely.
 */
export function startOfflineSync() {
  let told = false;

  store.addEventListener('offline', () => {
    const { queued, conflicts } = store.offline;
    if (!queued) { told = false; return; }
    if (told || conflicts) return;
    told = true;
    toast('Сохранено на этом устройстве · отправится, когда появится связь', {
      icon: 'wifiOff',
      duration: 8000,
      action: { label: 'Подробнее', onClick: openOfflineSheet },
    });
  });

  const trySync = async () => {
    if (!store.offline.queued) return;
    const result = await store.syncNow().catch(() => null);
    if (!result) return;
    if (result.synced.length || result.conflicts.length) reportSync(result);
  };

  window.addEventListener('online', trySync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) trySync(); });
  // A session that starts with something already queued (the tab was
  // closed offline) tries once, quietly.
  store.syncNow().then((result) => {
    if (result.conflicts.length) reportSync(result);
  }).catch(() => {});
}
