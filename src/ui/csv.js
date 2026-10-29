/**
 * CSV export and the import wizard.
 *
 * Import is deliberately three small steps - what am I importing, which
 * column is which, does this preview look right - because the alternative
 * is a founder pasting their whole pipeline into a black box.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { downloadFile, pickFile } from './download.js';
import { store } from '../lib/store.js';
import { requiredMark } from './bits.js';
import { stageInfo } from '../lib/forecast.js';
import { todayISO, countLabel, plural } from '../lib/util.js';
import {
  parseCSV, exportSet, EXPORT_SETS, IMPORT_KINDS, importFieldsFor, autoMap, mapRows,
  unguardFormula,
} from '../lib/csv.js';

/** Ids become names on the way out - a spreadsheet can't follow a uuid. */
export function exportContext() {
  return {
    companyName: (id) => store.companyById(id)?.name || '',
    contactName: (id) => store.contactById(id)?.name || '',
    dealName: (id) => store.dealById(id)?.name || '',
    stageLabel: (id) => stageInfo(id, store.stages()).label,
    lastContacted: (id) => store.lastContactedAt(id) || '',
    // One column per custom field, under the name the user gave it.
    customFields: (key) => store.customFields(key),
  };
}

const rowCount = (key) => EXPORT_SETS[key].rows(store).length;

export function openCSVExport() {
  const modal = openModal({
    title: 'Экспорт в CSV',
    content: el('div', {},
      el('p.settings-note.sheet-note', {}, 'Отдельный файл для каждого типа записей, готовый для таблицы.'),
      el('div.settings-list', {}, Object.entries(EXPORT_SETS).map(([key, set]) => {
        const n = rowCount(key);
        return el('button.settings-row', {
          type: 'button',
          disabled: !n,
          onclick: () => {
            // The BOM is for Excel, which otherwise guesses a legacy codepage
            // and mangles accented names; parseCSV strips it on the way back.
            downloadFile(`crm-${key}-${todayISO()}.csv`,
              `﻿${exportSet(key, store, exportContext())}`, 'text/csv');
            modal.close();
            toast(`${set.label}: экспорт готов`, { icon: 'fileDown' });
          },
        },
          el('span.row-ic', { html: icon(set.icon, 20, 1.8) }),
          el('div.grow', {},
            el('div.title', {}, set.label),
            el('div.sub', {}, n ? countLabel(n, ['строка', 'строки', 'строк']) : 'Пока нечего экспортировать')
          ),
          el('span.row-chev', { html: icon('fileDown', 18) })
        );
      }))
    ),
  });
  return modal;
}

/* ---------- import ---------- */

export function openCSVImport() {
  const modal = openModal({
    title: 'Импорт из CSV',
    content: el('div', {},
      el('p.settings-note.sheet-note', {}, 'Что в этом файле? Строки добавятся к вашим данным, ничего не заменится.'),
      el('div.settings-list', {}, IMPORT_KINDS.map((kind) => el('button.settings-row', {
        type: 'button',
        onclick: () => { modal.close(); pickCSV(kind); },
      },
        el('span.row-ic', { html: icon(kind.icon, 20, 1.8) }),
        el('div.grow', {},
          el('div.title', {}, kind.label),
          el('div.sub', {}, `Сопоставление по ${kind.matchOn}`)
        ),
        el('span.row-chev', { html: icon('chevR', 18) })
      )))
    ),
  });
  return modal;
}

function pickCSV(kind) {
  pickFile('.csv,text/csv,text/plain', async (file) => {
    let rows;
    try {
      rows = parseCSV(await file.text());
    } catch {
      toast('Не удалось прочитать файл', { icon: 'alert' });
      return;
    }
    if (rows.length < 2) {
      toast('В файле нет строк с данными', { icon: 'alert' });
      return;
    }
    openMapping(kind, rows, file.name);
  });
}

function openMapping(kind, rows, filename) {
  // The user's own fields are columns like any other, matched by name.
  const fields = importFieldsFor(kind.key, store.customFields(kind.key));
  // Unguarded, the way the data cells are: a header the export prefixed
  // against a spreadsheet formula should match its field by name again, and
  // read back to the user as the name they gave it.
  const headers = rows[0].map((h, i) =>
    unguardFormula(String(h || '').trim()) || `Колонка ${i + 1}`);
  const mapping = autoMap(headers, fields);
  const nameField = fields.find((f) => f.key === 'name');
  let update = true;

  const preview = el('div.csv-preview');
  const summary = el('p.settings-note');

  /** First non-empty value in a column, to show what it holds. */
  const sampleFor = (index) => {
    for (let r = 1; r < Math.min(rows.length, 12); r++) {
      const value = String(rows[r][index] ?? '').trim();
      if (value) return value.length > 24 ? `${value.slice(0, 24)}…` : value;
    }
    return '';
  };

  function renderPreview() {
    clear(preview);
    const mapped = mapRows(rows.slice(0, 4), mapping);
    const used = fields.filter((f) => mapping[f.key] >= 0);
    const skipped = mapped.filter((r) => !String(r.name || '').trim()).length;

    clear(summary);
    summary.append(`${countLabel(rows.length - 1, ['строка', 'строки', 'строк'])} в файле ${filename}`
      + (used.length ? ` · сопоставлено колонок: ${used.length}` : '')
      + (mapping.name >= 0 ? '' : ` · чтобы продолжить, выберите колонку для поля «${nameField.label}»`));

    if (!used.length) return;
    preview.append(el('div.table-wrap.flush', {},
      el('table.data-table', {},
        el('thead', {}, el('tr', {}, used.map((f) => el('th', { scope: 'col' }, f.label)))),
        el('tbody', {}, mapped.map((row) => el('tr', {},
          used.map((f) => el('td', {}, row[f.key] || '–')))))
      )
    ));
    if (skipped) {
      preview.append(el('p.field-hint', {},
        `${countLabel(skipped, ['строка', 'строки', 'строк'])} ${kind.noName} `
        + `${plural(skipped, ['будет пропущена', 'будут пропущены', 'будут пропущены'])}.`));
    }
  }

  const fieldRows = fields.map((field) => {
    const select = el('select.select', {
      'aria-label': `Колонка для поля «${field.label}»`,
      onchange: () => {
        mapping[field.key] = Number(select.value);
        renderPreview();
        syncMergeRow();
        importBtn.disabled = mapping.name < 0;
      },
    },
      el('option', { value: '-1', selected: mapping[field.key] < 0 }, 'Не импортировать'),
      headers.map((h, i) => {
        const sample = sampleFor(i);
        return el('option', { value: String(i), selected: mapping[field.key] === i },
          sample ? `${h}  ·  ${sample}` : h);
      })
    );
    return el('div.csv-field', {},
      el('span.csv-field-label', {},
        field.label,
        field.required && requiredMark()),
      el('div.select-wrap', {}, select)
    );
  });

  const importBtn = el('button.btn.btn-primary', {
    type: 'button',
    disabled: mapping.name < 0,
    onclick: async () => {
      importBtn.disabled = true;
      const records = mapRows(rows, mapping);
      try {
        // A big paste deserves the same safety net as a JSON import.
        await store.saveSnapshot('csv');
        const result = await store.importRecords(kind.key, records, { update: canMatch() && update });
        modal.close();
        showSummary(kind, result);
      } catch (err) {
        console.error(err);
        importBtn.disabled = false;
        toast('Импорт не удался. Проверьте подключение', { icon: 'wifiOff' });
      }
    },
  }, 'Импортировать');

  /* The merge needs a column to match rows against - the email column for
     leads, the name for companies and deals. A file without one left this
     switch on and doing nothing: every re-import of the same spreadsheet
     added the whole list again, under a promise on screen that it
     wouldn't. Say so, and switch it off rather than lie about it. */
  const matchField = fields.find((f) => f.key === kind.matchKey);
  const canMatch = () => mapping[kind.matchKey] >= 0;

  const updateSub = el('div.sub');
  const updateToggle = el('button.switch', {
    type: 'button',
    role: 'switch',
    id: 'csv-update',
    onclick: () => {
      update = !update;
      syncMergeRow();
    },
  }, el('span.switch-knob', { 'aria-hidden': 'true' }));

  function syncMergeRow() {
    const on = update && canMatch();
    updateToggle.classList.toggle('on', on);
    updateToggle.setAttribute('aria-checked', String(on));
    updateToggle.disabled = !canMatch();
    updateSub.textContent = canMatch()
      ? `Строка, которая совпадает ${kind.existing} по ${kind.matchOn}, обновит эту запись, а не создаст дубль.`
      : `Чтобы сопоставлять записи, выберите колонку для поля «${matchField.label}». Без неё каждая строка добавится как ${kind.newOne}.`;
  }

  const modal = openModal({
    title: kind.title,
    wide: true,
    content: el('div.csv-mapping', {},
      summary,
      el('div.csv-fields', {}, fieldRows),
      el('div.switch-row.csv-merge', {},
        el('div.grow.min0', {},
          el('label.title', { for: 'csv-update' }, 'Обновлять существующие записи'),
          updateSub
        ),
        updateToggle
      ),
      el('h3.csv-preview-title', {}, 'Предпросмотр'),
      preview,
      el('div.form-actions', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Отмена'),
        el('div.grow'),
        importBtn
      )
    ),
  });

  renderPreview();
  syncMergeRow();
  return modal;
}

function showSummary(kind, result) {
  const line = (label, value, tone = '') => el('div.csv-result-row', {},
    el('span.grow', {}, label),
    el('span', { className: `csv-result-value ${tone}` }, String(value))
  );
  const modal = openModal({
    title: 'Импорт завершён',
    content: el('div', {},
      el('div.csv-results', {},
        line(`Добавлено ${kind.many}`, result.added, 'good'),
        result.updated > 0 && line(`Обновлено ${kind.many}`, result.updated),
        result.companiesCreated > 0 && line('Создано компаний', result.companiesCreated),
        result.skipped > 0 && line(`Пропущено строк (${kind.noName})`, result.skipped, 'muted')
      ),
      el('p.settings-note.mt-sm', {}, 'Копия данных до этого импорта сохранена: «Настройки» → «Вернуть прежние данные».'),
      el('div.row.row-end.mt-sm', {},
        el('button.btn.btn-primary', { type: 'button', onclick: () => modal.close() }, 'Готово')
      )
    ),
  });
  toast(`Импортировано: ${countLabel(result.added + result.updated, ['запись', 'записи', 'записей'])}`,
    { icon: 'fileUp' });
}
