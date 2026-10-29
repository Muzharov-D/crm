/**
 * Attachments on detail pages: the proposal PDF, the signed order form,
 * the pricing sheet - tied to the record they belong to instead of a
 * Downloads folder. Bytes live in the user's Puter cloud (lib/files.js);
 * this renders the list, uploads, downloads, and deletes.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';
import { store } from '../lib/store.js';
import { uploadFile, readFile, formatBytes, MAX_FILE_BYTES } from '../lib/files.js';
import { section, deletedToast } from './bits.js';
import { formatDate, todayISO } from '../lib/util.js';

/** Fetch the bytes and hand them to the browser under the original name. */
async function download(attachment) {
  let blob;
  try {
    blob = await readFile(attachment.path);
  } catch {
    toast('Не удалось получить файл. Проверьте подключение', { icon: 'wifiOff' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: attachment.name || 'file' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function upload(owner, picker, button) {
  const file = picker.files?.[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    toast(`Размер файла — до ${formatBytes(MAX_FILE_BYTES)}. Этот весит ${formatBytes(file.size)}`, { icon: 'alert' });
    picker.value = '';
    return;
  }
  // Keep what the button looked like: setting textContent throws away the
  // paperclip that came in as markup, and the failure path below has to put
  // the whole label back, not just re-enable a button reading "Uploading…".
  const label = [...button.childNodes];
  button.disabled = true;
  button.textContent = ' Загрузка…';
  try {
    const path = await uploadFile(file);
    await store.addAttachment({
      name: file.name, path, size: file.size, type: file.type, ...owner,
    });
    toast('Файл прикреплён', { icon: 'paperclip' });
  } catch (err) {
    console.error(err);
    toast('Не удалось загрузить. Проверьте подключение', { icon: 'wifiOff' });
  } finally {
    // The section re-renders on the store change; this button only
    // survives on the failure path, where it has to come back to life.
    button.disabled = false;
    button.replaceChildren(...label);
    picker.value = '';
  }
}

function attachmentRow(a) {
  return el('div.attachment-row', {},
    el('span.attachment-ic', { html: icon('fileText', 17, 1.8), 'aria-hidden': 'true' }),
    el('button.attachment-name', {
      type: 'button',
      title: `Скачать ${a.name}`,
      onclick: () => download(a),
    }, a.name || 'Файл без названия'),
    el('span.attachment-sub', {},
      `${formatBytes(a.size)} · ${formatDate(todayISO(new Date(a.uploadedAt)))}`),
    el('button.icon-btn.row-edit', {
      html: icon('download', 15, 2),
      'aria-label': `Скачать ${a.name}`,
      dataset: { focusKey: `file-download-${a.id}` },
      onclick: () => download(a),
    }),
    el('button.icon-btn.row-edit', {
      html: icon('trash', 15, 2),
      'aria-label': `Удалить файл ${a.name}`,
      // Two files on one record may carry the same name, and the rebuilt
      // list would find the wrong one by label - on the button that
      // deletes it. Keyed by the attachment instead.
      dataset: { focusKey: `file-delete-${a.id}` },
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Удалить файл?',
          message: 'Он на 30 дней попадёт в корзину, а после этого будет удалён с сервера.',
        });
        if (!ok) return;
        try {
          deletedToast('Файл удалён', await store.deleteAttachment(a.id));
        } catch {
          toast('Не удалось удалить. Проверьте подключение', { icon: 'wifiOff' });
        }
      },
    })
  );
}

/**
 * The whole section for one record; `owner` is exactly one of
 * { contactId } | { companyId } | { dealId }. Views drop it into their
 * render pass like any other section.
 */
export function attachmentsSection(owner) {
  const files = store.attachmentsFor(owner);
  // The input lives (hidden) in the DOM rather than being minted per
  // click - some mobile engines refuse a picker on a detached input.
  const picker = el('input.attachment-picker', {
    type: 'file', tabindex: -1, 'aria-hidden': 'true',
  });
  const addBtn = el('button.btn.btn-ghost.btn-sm', {
    html: icon('paperclip', 14, 2),
    onclick: () => picker.click(),
  }, ' Прикрепить');
  picker.addEventListener('change', () => upload(owner, picker, addBtn));

  return section('Файлы', addBtn,
    picker,
    files.length
      ? el('div.attachment-list', {}, files.map(attachmentRow))
      : el('p.card-empty', {},
          `КП, заявки и прайс-листы хранятся вместе с карточкой на вашем сервере. До ${formatBytes(MAX_FILE_BYTES)} на файл.`)
  );
}
