import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { store } from '../lib/store.js';
import {
  openStages, isTerminalStage, MAX_OPEN_STAGES, DEFAULT_STALE_DAYS, ABR_OPEN_STAGES,
} from '../lib/forecast.js';
import { FORECAST_MODES } from '../lib/qualification.js';
import { DEFAULT_COLD_DAYS } from '../lib/attention.js';
import { normalizeTouchTargets, touchTarget } from '../lib/activity.js';
import { aiAvailable } from '../lib/ai.js';
import { openOfflineSheet, kvLabel } from '../ui/offline.js';
import { ACTIVITY_TYPES } from '../lib/store.js';
import {
  CUSTOM_KINDS, FIELD_TYPES, MAX_CUSTOM_FIELDS, MAX_FIELD_NAME, MAX_FIELD_OPTIONS,
  MAX_OPTION_LENGTH, blankField, fieldTypeInfo, hasOptions, isBlankValue, retypeReport,
} from '../lib/fields.js';
import { notificationPermission, requestNotifications } from '../lib/reminders.js';
import { downloadOpenICS } from '../ui/calendar.js';
import { downloadFile, pickFile } from '../ui/download.js';
import { openCSVImport, openCSVExport } from '../ui/csv.js';
import { openDuplicatesReview } from '../ui/merge.js';
import { openTemplateForm } from '../ui/email.js';
import { openPlaybookForm } from '../ui/playbooks.js';
import { MAX_PLAYBOOKS, playbookSummary } from '../lib/playbooks.js';
import { deletedToast } from '../ui/bits.js';
import { listBackups, readBackup, writeBackup } from '../lib/backups.js';
import { formatBytes } from '../lib/files.js';
import { applyTheme } from '../ui/theme.js';
import { pageHead, section, stageBadge, stageRampStyle } from '../ui/bits.js';
import { sampleDataset } from '../lib/sample.js';
import {
  todayISO, clamp, formatMoney, timeAgo, formatDate, plural, countLabel,
} from '../lib/util.js';
import { canWrite, roleLabel } from '../lib/access.js';

export async function confirmSignOut() {
  const ok = await confirmDialog({
    title: 'Выйти?',
    message: 'Данные останутся на сервере и будут на месте, когда вы снова войдёте.',
    confirmLabel: 'Выйти',
    danger: false,
  });
  if (!ok) return;
  // Let the SDK finish clearing the session before the reload re-runs the
  // auth check, or a raced reload can boot back into a half-signed-out state.
  try {
    await puter.auth.signOut();
  } catch {}
  location.reload();
}

const THEMES = [
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' },
  { value: 'system', label: 'Как в системе', icon: 'monitor' },
];

const CURRENCIES = ['RUB', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'BRL', 'CHF', 'SEK'];

/* Russian count forms (1 / 2-4 / 5+) for the record kinds custom fields
   attach to, and the genitive plural for "no fields on ... yet". */
const KIND_FORMS = {
  contacts: ['контакт', 'контакта', 'контактов'],
  companies: ['компания', 'компании', 'компаний'],
  deals: ['сделка', 'сделки', 'сделок'],
};
const KIND_GENITIVE = { contacts: 'контактов', companies: 'компаний', deals: 'сделок' };
const RECORD_FORMS = ['запись', 'записи', 'записей'];

/* What a value has to read as for a field type ("прочитать как число"). */
const TYPE_AS = {
  text: 'текст', number: 'число', date: 'дату', select: 'вариант из списка', checkbox: '«да» или «нет»',
};

/* Activity types in the plural and in count forms. */
const ACTIVITY_PLURAL = { meeting: 'Встречи', call: 'Звонки', email: 'Письма', note: 'Заметки' };
const ACTIVITY_FORMS = {
  meeting: ['встреча', 'встречи', 'встреч'],
  call: ['звонок', 'звонка', 'звонков'],
  email: ['письмо', 'письма', 'писем'],
  note: ['заметка', 'заметки', 'заметок'],
};

export function settingsView() {
  const root = el('div.view');
  const readOnly = !canWrite(store.user);

  /* ----- appearance ----- */
  const themeGroup = el('div.seg-group', { role: 'group', 'aria-label': 'Тема' });
  function renderThemes() {
    clear(themeGroup);
    const current = store.settings.theme || 'light';
    for (const t of THEMES) {
      themeGroup.append(el('button.seg', {
        type: 'button',
        'aria-pressed': String(current === t.value),
        className: `seg${current === t.value ? ' active' : ''}`,
        html: icon(t.icon, 16, 2),
        onclick: (e) => {
          applyTheme(t.value);
          store.updateSettings({ theme: t.value })
            .catch(() => toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' }));
          // Move the highlight in place instead of rebuilding the group -
          // a rebuild drops keyboard focus on the floor mid-interaction.
          for (const b of e.currentTarget.parentElement.children) {
            const on = b === e.currentTarget;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          }
        },
      }, ` ${t.label}`));
    }
  }
  renderThemes();

  const currencySelect = el('select.select', {
    'aria-label': 'Валюта',
    onchange: async (e) => {
      const saved = store.updateSettings({ currency: e.target.value });
      // The goal field spells the currency out beside the number; it has to
      // follow, not wait for a reload.
      syncCurrencyLabels();
      try {
        await saved;
      } catch {
        toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
        return;
      }
      toast('Валюта изменена');
    },
  }, CURRENCIES.map((c) => el('option', { value: c, selected: c === store.settings.currency }, c)));

  const forecastModeSelect = el('select.select', {
    id: 'forecast-mode',
    onchange: async (e) => {
      try {
        await store.updateSettings({ forecastMode: e.target.value });
        toast('Способ прогноза изменён');
      } catch {
        toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
      }
    },
  }, FORECAST_MODES.map((m) => el('option', {
    value: m.value, selected: m.value === (store.settings.forecastMode || 'stage'),
  }, m.label)));

  /* Controls that mirror a settings value, so a bulk replace (import,
     snapshot restore) can pull the whole page back in step. */
  const settingsFields = [];

  /* ----- pipeline stages (order, names, win probabilities) ----- */
  const stageRows = el('div.stage-edit-list');

  /** The editable part of the funnel as a fresh, mutable copy. */
  const currentOpen = () => openStages(store.stages()).map((s) => ({ ...s }));

  /** Readable, collision-free id for a new stage ("Demo booked" → demo-booked). */
  function makeStageId(label, taken) {
    const base = String(label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
    let id = base;
    for (let n = 2; isTerminalStage(id) || taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** Persist a structural change, then rebuild the editor (focus restored). */
  async function saveStages(list, { remap = {}, focus = null, message = null } = {}) {
    try {
      const moved = await store.setStages(list, remap);
      renderStageRows(focus);
      if (message) toast(typeof message === 'function' ? message(moved) : message);
    } catch {
      renderStageRows(focus);
      toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
    }
  }

  /** Removing a stage that holds deals: pick where those deals land. */
  function askReassign(stage, count, targets) {
    return new Promise((resolve) => {
      let picked = null;
      const modal = openModal({
        title: `Удалить этап «${stage.label}»?`,
        content: el('div', {},
          el('p.confirm-message', {},
            `На этом этапе ${countLabel(count, ['сделка', 'сделки', 'сделок'])}. Выберите этап, куда ${count === 1 ? 'её' : 'их'} перенести.`),
          el('div.settings-list', {}, targets.map((t) => el('button.settings-row', {
            type: 'button',
            onclick: () => { picked = t.id; modal.close(); },
          },
            stageBadge(t.id),
            el('div.grow'),
            el('span.row-chev', { html: icon('chevR', 18) })
          )))
        ),
        onClose: () => resolve(picked),
      });
    });
  }

  function renderStageRows(focus = null) {
    clear(stageRows);
    const open = currentOpen();
    const probs = store.settings.stageProbabilities || {};

    open.forEach((s, i) => {
      const override = probs[s.id];
      const pct = Math.round((Number.isFinite(override) ? override : s.probability) * 100);

      const name = el('input.input.stage-name-input', {
        type: 'text', value: s.label, maxlength: 40, autocomplete: 'off',
        'aria-label': `Название этапа ${i + 1}`,
        onchange: () => {
          const label = name.value.trim();
          if (!label || label === s.label) { name.value = s.label; return; }
          const list = currentOpen();
          list[i].label = label;
          saveStages(list, { focus: { id: s.id, control: '.stage-name-input' } });
        },
      });

      const prob = el('input.input.prob-input', {
        // Whole percents, not fives. A coarser step reads as a spinner
        // nicety and lands as validation: this field exists to be tuned to
        // the conversion rate that actually emerged, so "43" is the whole
        // point of typing in it - and the browser called it invalid ("the
        // two nearest valid values are 40 and 45") about a number the app
        // then stored exactly as typed. Same trade the deal form's
        // confidence percent already makes.
        type: 'number', min: '0', max: '100', step: '1', value: String(pct),
        'aria-label': `Вероятность выигрыша на этапе «${s.label}», %`,
        onchange: async () => {
          const v = clamp(Math.round(Number(prob.value) || 0), 0, 100);
          prob.value = String(v);
          await store.updateSettings({
            stageProbabilities: { ...store.settings.stageProbabilities, [s.id]: v / 100 },
          }).catch(() => toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' }));
        },
      });

      const move = (dir) => el(`button.icon-btn.stage-move.stage-move-${dir > 0 ? 'down' : 'up'}`, {
        type: 'button',
        html: icon(dir > 0 ? 'chevD' : 'chevU', 17, 2.2),
        'aria-label': `Переместить «${s.label}» ${dir > 0 ? 'ниже' : 'выше'}`,
        disabled: dir > 0 ? i === open.length - 1 : i === 0,
        onclick: () => {
          const list = currentOpen();
          [list[i], list[i + dir]] = [list[i + dir], list[i]];
          // A stage that has just arrived at an end of the funnel has this
          // arrow disabled in its rebuilt row, so the keyboard falls back
          // to the one still pointing somewhere.
          saveStages(list, {
            focus: {
              id: s.id,
              control: `.stage-move-${dir > 0 ? 'down' : 'up'}`,
              orElse: [`.stage-move-${dir > 0 ? 'up' : 'down'}`],
            },
          });
        },
      });

      const remove = el('button.icon-btn.stage-remove', {
        type: 'button',
        html: icon('trash', 16, 2),
        'aria-label': `Удалить этап «${s.label}»`,
        disabled: open.length <= 1,
        title: open.length <= 1 ? 'В воронке должен остаться хотя бы один открытый этап' : null,
        onclick: async () => {
          const held = store.deals.filter((d) => d.stage === s.id);
          const targets = open.filter((o) => o.id !== s.id);
          let remap = {};
          if (held.length) {
            const to = await askReassign(s, held.length, targets);
            if (!to) return;
            remap = { [s.id]: to };
          } else {
            const ok = await confirmDialog({
              title: `Удалить этап «${s.label}»?`,
              message: 'На этом этапе нет сделок, переносить ничего не нужно. Этап можно добавить снова позже.',
              confirmLabel: 'Удалить этап',
            });
            if (!ok) return;
          }
          await saveStages(targets, {
            remap,
            message: (moved) => moved
              ? `Этап «${s.label}» удалён · ${moved} ${plural(moved, ['сделка перенесена', 'сделки перенесены', 'сделок перенесено'])}`
              : `Этап «${s.label}» удалён`,
          });
        },
      });

      stageRows.append(el('div.stage-edit-row', {
        dataset: { stageId: s.id },
        style: stageRampStyle(s.id),
      },
        el('span.stage-dot.stage-edit-dot', { 'aria-hidden': 'true' }),
        name,
        el('div.stage-edit-controls', {},
          el('span.stage-prob-field', {}, prob, el('span.prob-unit', { 'aria-hidden': 'true' }, '%')),
          move(-1),
          move(1),
          remove
        )
      ));
    });

    /* Won and Lost are the funnel's terminals: shown, never editable. */
    stageRows.append(el('div.stage-edit-row.static', {},
      stageBadge('won'), el('div.grow'), el('span.prob-unit', {}, '100%')
    ));
    stageRows.append(el('div.stage-edit-row.static', {},
      stageBadge('lost'), el('div.grow'), el('span.prob-unit', {}, '0%')
    ));

    const atCap = open.length >= MAX_OPEN_STAGES;
    stageRows.append(el('div.stage-edit-actions', {},
      el('button.btn.btn-ghost.btn-sm.btn-dashed', {
        type: 'button',
        html: icon('plus', 14, 2.2),
        disabled: atCap,
        title: atCap ? `Максимум открытых этапов на доске: ${MAX_OPEN_STAGES}` : null,
        onclick: () => {
          const list = currentOpen();
          const label = 'Новый этап';
          const id = makeStageId(label, new Set(list.map((x) => x.id)));
          list.push({ id, label, probability: 0.5 });
          // Land the caret in the new name so it can be typed over at once.
          saveStages(list, { focus: { id, control: '.stage-name-input', select: true } });
        },
      }, ' Добавить этап'),
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        html: icon('reset', 14, 2),
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Сбросить этапы?',
            message: 'Вернутся стандартная воронка (Новая, Квалификация, Предложение, Переговоры) и стандартные вероятности. Сделки с этапов, которых больше нет, перейдут на первый этап.',
            confirmLabel: 'Сбросить этапы',
            danger: false,
          });
          if (!ok) return;
          await store.updateSettings({ stageProbabilities: {} }).catch(() => {});
          await saveStages(null, { message: 'Этапы сброшены' });
        },
      }, ' Вернуть по умолчанию')
    ));

    if (focus) {
      const row = stageRows.querySelector(`[data-stage-id="${CSS.escape(focus.id)}"]`);
      // First control that is actually there and actually takes focus:
      // handing the keyboard to a disabled button hands it to the body.
      const target = [focus.control, ...(focus.orElse || [])]
        .map((sel) => row?.querySelector(sel))
        .find((node) => node && !node.disabled);
      if (target) {
        target.focus();
        if (focus.select) target.select?.();
      }
    }
  }
  renderStageRows();

  /* ----- custom fields ----------
     Definitions live in settings, values on the records (lib/fields.js).
     One record type is edited at a time, because a founder adds a field
     while thinking about one kind of record. */
  let fieldKind = CUSTOM_KINDS[0].key;
  const fieldKindGroup = el('div.seg-group', { role: 'group', 'aria-label': 'Поля для' });
  const fieldRows = el('div.stage-edit-list.field-edit-list');

  /** The current definitions as a fresh, mutable copy. */
  const currentFields = () => store.customFields(fieldKind)
    .map((f) => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) }));

  /** Records of the kind being edited - what a type change has to convert. */
  const fieldRecords = () => store[fieldKind] || [];

  /** How many records hold a value for a field. */
  const valueCount = (field) =>
    fieldRecords().filter((r) => !isBlankValue(r.custom?.[field.id])).length;

  async function saveFields(list, { focus = null, message = null } = {}) {
    try {
      const result = await store.setCustomFields(fieldKind, list);
      renderFieldRows(focus);
      if (message) toast(typeof message === 'function' ? message(result) : message);
    } catch (err) {
      renderFieldRows(focus);
      // The store refuses a type change it can't make without losing a
      // value; anything else is the connection.
      toast(err.message === 'custom-field-type'
        ? 'В некоторых записях значения не подходят к этому типу'
        : 'Не удалось сохранить. Проверьте подключение',
      { icon: err.message === 'custom-field-type' ? 'alert' : 'wifiOff' });
    }
  }

  function renderFieldKinds() {
    clear(fieldKindGroup);
    for (const kind of CUSTOM_KINDS) {
      const on = kind.key === fieldKind;
      fieldKindGroup.append(el('button.seg', {
        type: 'button',
        className: `seg${on ? ' active' : ''}`,
        'aria-pressed': String(on),
        dataset: { focusKey: `field-kind-${kind.key}` },
        onclick: () => {
          if (on) return;
          fieldKind = kind.key;
          renderFieldKinds();
          renderFieldRows();
        },
      }, kind.label));
    }
  }

  function renderFieldRows(focus = null) {
    clear(fieldRows);
    const fields = currentFields();

    fields.forEach((field, i) => {
      const name = el('input.input.field-name-input', {
        type: 'text', value: field.name, maxlength: MAX_FIELD_NAME, autocomplete: 'off',
        'aria-label': `Название поля ${i + 1}`,
        onchange: () => {
          const label = name.value.trim();
          if (!label || label === field.name) { name.value = field.name; return; }
          const list = currentFields();
          list[i].name = label;
          saveFields(list, { focus: { id: field.id, control: '.field-name-input' } });
        },
      });

      const type = el('select.select.field-type-select', {
        'aria-label': `Тип поля «${field.name}»`,
        onchange: async () => {
          const next = type.value;
          if (next === field.type) return;
          const report = retypeReport(fieldRecords(), field, next);
          if (report.blocked.length) {
            // Refuse rather than drop what people typed. The count is the
            // useful part: it says how much work fixing it would be.
            type.value = field.type;
            const n = report.blocked.length;
            await confirmDialog({
              title: `Нельзя сменить тип поля «${field.name}»`,
              message: `${n === 1 ? 'Есть значение, которое' : 'Есть значения, которые'} нельзя прочитать как ${TYPE_AS[next] || fieldTypeInfo(next).label}: ${countLabel(n, KIND_FORMS[fieldKind] || RECORD_FORMS)}. При смене типа ${n === 1 ? 'оно пропадёт' : 'они пропадут'}. Сначала очистите или исправьте эти значения.`,
              confirmLabel: 'Понятно',
              danger: false,
              cancelLabel: null,
            });
            return;
          }
          if (report.total) {
            const ok = await confirmDialog({
              title: `Сменить тип поля «${field.name}» на «${fieldTypeInfo(next).label}»?`,
              message: `${countLabel(report.total, ['сохранённое значение будет преобразовано', 'сохранённых значения будут преобразованы', 'сохранённых значений будет преобразовано'])}.`,
              confirmLabel: 'Сменить тип',
              danger: false,
            });
            if (!ok) { type.value = field.type; return; }
          }
          const list = currentFields();
          list[i].type = next;
          if (hasOptions(next)) list[i].options = list[i].options || [];
          else delete list[i].options;
          saveFields(list, { focus: { id: field.id, control: '.field-type-select' } });
        },
      }, FIELD_TYPES.map((t) =>
        el('option', { value: t.value, selected: t.value === field.type }, t.label)));

      const move = (dir) => el(`button.icon-btn.stage-move.stage-move-${dir > 0 ? 'down' : 'up'}`, {
        type: 'button',
        html: icon(dir > 0 ? 'chevD' : 'chevU', 17, 2.2),
        'aria-label': `Переместить «${field.name}» ${dir > 0 ? 'ниже' : 'выше'}`,
        disabled: dir > 0 ? i === fields.length - 1 : i === 0,
        onclick: () => {
          const list = currentFields();
          [list[i], list[i + dir]] = [list[i + dir], list[i]];
          saveFields(list, {
            focus: {
              id: field.id,
              control: `.stage-move-${dir > 0 ? 'down' : 'up'}`,
              orElse: [`.stage-move-${dir > 0 ? 'up' : 'down'}`],
            },
          });
        },
      });

      const remove = el('button.icon-btn.stage-remove', {
        type: 'button',
        html: icon('trash', 16, 2),
        'aria-label': `Удалить поле «${field.name}»`,
        onclick: async () => {
          const n = valueCount(field);
          const ok = await confirmDialog({
            title: `Удалить поле «${field.name}»?`,
            message: n
              ? `Поле заполнено: ${countLabel(n, KIND_FORMS[fieldKind] || RECORD_FORMS)}. Значения удалятся вместе с полем, отменить это нельзя.`
              : 'Поле нигде не заполнено, больше ничего не изменится. Его можно добавить снова позже.',
            confirmLabel: 'Удалить поле',
          });
          if (!ok) return;
          await saveFields(fields.filter((f) => f.id !== field.id), {
            message: (result) => (result.removed
              ? `Поле «${field.name}» удалено · ${result.removed} ${plural(result.removed, ['значение удалено', 'значения удалены', 'значений удалено'])}`
              : `Поле «${field.name}» удалено`),
          });
        },
      });

      const optionsInput = hasOptions(field.type) && el('input.input.field-options-input', {
        type: 'text', value: (field.options || []).join(', '), autocomplete: 'off',
        placeholder: 'например: Высокий, Средний, Низкий',
        'aria-label': `Варианты поля «${field.name}» через запятую`,
        onchange: () => {
          const list = currentFields();
          list[i].options = optionsInput.value.split(',')
            .map((o) => o.trim().slice(0, MAX_OPTION_LENGTH))
            .filter(Boolean)
            .slice(0, MAX_FIELD_OPTIONS);
          saveFields(list, { focus: { id: field.id, control: '.field-options-input' } });
        },
      });

      const n = valueCount(field);
      fieldRows.append(el('div.stage-edit-row.field-edit-row', { dataset: { fieldId: field.id } },
        el('div.field-edit-main', {},
          name,
          el('div.select-wrap.field-type-wrap', {}, type)
        ),
        el('div.stage-edit-controls', {}, move(-1), move(1), remove),
        optionsInput && el('div.field-edit-options', {},
          optionsInput,
          el('span.field-hint', {}, 'Варианты через запятую.')
        ),
        n > 0 && el('span.field-edit-note', {},
          `Заполнено: ${countLabel(n, KIND_FORMS[fieldKind] || RECORD_FORMS)}`)
      ));
    });

    if (!fields.length) {
      fieldRows.append(el('p.card-empty', {},
        `У ${KIND_GENITIVE[fieldKind] || 'этих записей'} пока нет своих полей. Добавьте поле для того, что важно вашему бизнесу и чего нет среди стандартных.`));
    }

    const atCap = fields.length >= MAX_CUSTOM_FIELDS;
    fieldRows.append(el('div.stage-edit-actions', {},
      el('button.btn.btn-ghost.btn-sm.btn-dashed', {
        type: 'button',
        html: icon('plus', 14, 2.2),
        disabled: atCap,
        title: atCap ? `Максимум своих полей для одного типа записей: ${MAX_CUSTOM_FIELDS}` : null,
        onclick: () => {
          const field = blankField(new Set(fields.map((f) => f.id)));
          // Land the caret in the new name so it can be typed over at once.
          saveFields([...fields, field], {
            focus: { id: field.id, control: '.field-name-input', select: true },
          });
        },
      }, ' Добавить поле')
    ));

    if (focus) {
      const row = fieldRows.querySelector(`[data-field-id="${CSS.escape(focus.id)}"]`);
      const target = [focus.control, ...(focus.orElse || [])]
        .map((sel) => row?.querySelector(sel))
        .find((node) => node && !node.disabled);
      if (target) {
        target.focus();
        if (focus.select) target.select?.();
      }
    }
  }
  renderFieldKinds();
  renderFieldRows();

  /* ----- reminders ----- */
  const notifyRow = el('div.switch-slot');
  function renderNotify() {
    // The row is rebuilt after every toggle; a keyboard user's focus has
    // to land back on the switch or Tab restarts from the top of the page.
    const hadFocus = notifyRow.contains(document.activeElement);
    clear(notifyRow);
    const permission = notificationPermission();
    const blocked = permission === 'denied';
    const unsupported = permission === 'unsupported';
    const on = !!store.settings.notifications && permission === 'granted';

    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id: 'notify-switch',
      'aria-checked': String(on),
      className: `switch${on ? ' on' : ''}`,
      disabled: blocked || unsupported,
      onclick: async () => {
        if (on) {
          try {
            await store.updateSettings({ notifications: false });
          } catch {
            toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
          }
          renderNotify();
          return;
        }
        const result = await requestNotifications();
        if (result !== 'granted') {
          renderNotify();
          toast(result === 'denied'
            ? 'Браузер блокирует уведомления для этого сайта'
            : 'Уведомления не включены', { icon: 'alert' });
          return;
        }
        // The success message is reserved for a save that actually
        // persisted - a failed write here would quietly re-flip the
        // toggle on the next visit.
        try {
          await store.updateSettings({ notifications: true });
        } catch {
          renderNotify();
          toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
          return;
        }
        renderNotify();
        toast('Напоминания включены. Они приходят, пока приложение открыто', { icon: 'check' });
      },
    }, el('span.switch-knob', { 'aria-hidden': 'true' }));

    notifyRow.append(el('div.switch-row', {},
      el('div.grow.min0', {},
        el('label.title', { for: 'notify-switch' }, 'Уведомления в браузере'),
        el('div.sub', {}, unsupported
          ? 'Этот браузер не поддерживает уведомления.'
          : blocked
            ? 'Заблокированы для этого сайта. Сначала разрешите уведомления в настройках браузера.'
            : 'Сводка при первом за день открытии приложения и напоминание, когда подходит срок задачи со временем.')
      ),
      toggle
    ));
    if (hadFocus && !toggle.disabled) toggle.focus();
  }
  renderNotify();

  /* ----- next-step nudges ----- */
  const nudgeRow = el('div.switch-slot');
  function renderNudges() {
    const hadFocus = nudgeRow.contains(document.activeElement);
    clear(nudgeRow);
    const on = store.settings.nextStepNudges !== false;
    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id: 'nudge-switch',
      'aria-checked': String(on),
      className: `switch${on ? ' on' : ''}`,
      onclick: async () => {
        try {
          await store.updateSettings({ nextStepNudges: !on });
        } catch {
          toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
        }
        renderNudges();
      },
    }, el('span.switch-knob', { 'aria-hidden': 'true' }));
    nudgeRow.append(el('div.switch-row', {},
      el('div.grow.min0', {},
        el('label.title', { for: 'nudge-switch' }, 'Подсказки о следующем шаге'),
        el('div.sub', {}, 'Когда вы завершаете задачу, записываете в историю или переносите сделку, а дальше ничего не запланировано, приложение предложит поставить следующую задачу.')
      ),
      toggle
    ));
    if (hadFocus) toggle.focus();
  }
  renderNudges();

  /* ----- AI assist -----
     Opt-out, and only where the platform offers it. The copy says plainly
     what leaves the user's cloud, because "your data stays in your Puter
     cloud" is the promise this feature has to keep honest. */
  const aiRow = el('div.switch-slot');
  function renderAI() {
    const hadFocus = aiRow.contains(document.activeElement);
    clear(aiRow);
    const available = aiAvailable();
    const on = available && store.settings.aiAssist !== false;
    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id: 'ai-switch',
      'aria-checked': String(on),
      className: `switch${on ? ' on' : ''}`,
      disabled: !available,
      onclick: async () => {
        try {
          await store.updateSettings({ aiAssist: !on });
        } catch {
          toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
        }
        renderAI();
      },
    }, el('span.switch-knob', { 'aria-hidden': 'true' }));

    aiRow.append(el('div.switch-row', {},
      el('div.grow.min0', {},
        el('label.title', { for: 'ai-switch' }, 'ИИ-помощник'),
        el('div.sub', {}, available
          ? 'Добавляет три кнопки: разобрать вставленный текст в новый контакт или компанию, набросать письмо и кратко пересказать длинную историю. Каждая срабатывает только по нажатию, результат попадает в поле, которое можно поправить, и ничего не сохраняется само.'
          : 'ИИ на этом сервере не подключён, поэтому кнопки помощника скрыты.')
      ),
      toggle
    ));
    if (available) {
      aiRow.append(el('p.settings-note.mt-sm', {},
        'По нажатию кнопки в ИИ уходит только та запись, на которой вы её нажали, и только для этого запроса. Если выключить помощника, приложение не обращается к модели совсем.'));
    }
    if (hadFocus && !toggle.disabled) toggle.focus();
  }
  renderAI();

  /* ----- attention thresholds ----- */

  /** A days field that saves itself; 0 means "never flag". */
  function daysField(id, label, key, fallback, hint) {
    const input = el('input.input.prob-input', {
      id, type: 'number', min: '0', max: '365', step: '1',
      value: String(store.settings[key] ?? fallback),
      onchange: async () => {
        const v = clamp(Math.round(Number(input.value) || 0), 0, 365);
        input.value = String(v);
        await store.updateSettings({ [key]: v })
          .catch(() => toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' }));
      },
    });
    settingsFields.push(() => { input.value = String(store.settings[key] ?? fallback); });
    return el('div.threshold-field', {},
      el('label.field-label.grow', { for: id }, label),
      input,
      el('span.prob-unit', {}, 'дн.'),
      el('span.field-hint', {}, hint)
    );
  }

  /* ----- monthly revenue goal ----- */
  const goalCurrency = el('span.goal-currency', {}, store.settings.currency);
  const goalInput = el('input.input.goal-input', {
    // Whole currency units, for the same reason the stage percent above
    // takes them: a goal of 12,345 is saved as 12,345, and a step of 100
    // only made the control call it invalid.
    type: 'number', min: '0', step: '1', inputmode: 'decimal',
    value: store.settings.revenueGoal ? String(store.settings.revenueGoal) : '',
    placeholder: '0',
    'aria-label': `План выручки на месяц, ${store.settings.currency}`,
    onchange: async () => {
      const v = Math.max(0, Math.round(Number(goalInput.value) || 0));
      goalInput.value = v ? String(v) : '';
      try {
        await store.updateSettings({ revenueGoal: v });
      } catch {
        toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
        return;
      }
      toast(v ? `План: ${formatMoney(v, store.settings.currency)}` : 'План сброшен');
    },
  });

  /* ----- weekly touch target -----
     The leading number beside the lagging one: revenue is what happened,
     touches are what you can still do something about today. One overall
     figure, or per type for a founder who runs a specific cadence. */
  const touchInputs = [];

  /** A whole-count field that saves itself. `key` is 'all' or a type id. */
  function touchInput(key) {
    const id = `touch-${key}`;
    const input = el('input.input.prob-input.touch-input', {
      id, type: 'number', min: '0', max: '999', step: '1', inputmode: 'numeric',
      value: normalizeTouchTargets(store.settings.touchTargets)[key] || '',
      placeholder: '0',
      onchange: async () => {
        const next = normalizeTouchTargets(store.settings.touchTargets);
        next[key] = clamp(Math.round(Number(input.value) || 0), 0, 999);
        input.value = next[key] || '';
        try {
          await store.updateSettings({ touchTargets: next });
        } catch {
          toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
          return;
        }
        syncTouchHint();
      },
    });
    touchInputs.push(() => {
      input.value = normalizeTouchTargets(store.settings.touchTargets)[key] || '';
    });
    return { id, input };
  }

  /** The overall target: a threshold row like the attention ones. */
  function touchTotalField() {
    const { id, input } = touchInput('all');
    return el('div.threshold-field', {},
      el('label.field-label.grow', { for: id }, 'Всего касаний'),
      input,
      el('span.prob-unit', {}, 'в неделю')
    );
  }

  /* Per type, side by side: four stacked rows of zeroes made an optional
     setting look like the main event. */
  function touchTypeFields() {
    return el('div.touch-types', {}, ACTIVITY_TYPES.map((t) => {
      const { id, input } = touchInput(t.value);
      return el('div.touch-type', {},
        el('label.field-label', { for: id }, ACTIVITY_PLURAL[t.value] || t.label),
        input
      );
    }));
  }

  const touchHint = el('p.settings-note.mt-sm');
  function syncTouchHint() {
    const total = touchTarget(store.settings.touchTargets);
    const targets = normalizeTouchTargets(store.settings.touchTargets);
    const perType = ACTIVITY_TYPES.filter((t) => targets[t.value] > 0)
      .map((t) => (ACTIVITY_FORMS[t.value]
        ? countLabel(targets[t.value], ACTIVITY_FORMS[t.value])
        : `${targets[t.value]} ${t.label.toLowerCase()}`));
    touchHint.textContent = total
      ? `План: ${countLabel(total, ['касание', 'касания', 'касаний'])} в неделю`
        + (perType.length ? ` · ${perType.join(', ')}` : '')
        + (targets.all && perType.length ? ' (в расчёт идёт общее число)' : '')
      : 'План не задан. Когда вы укажете число, план появится на главной и в истории.';
  }
  syncTouchHint();
  touchInputs.push(syncTouchHint);

  function syncCurrencyLabels() {
    goalCurrency.textContent = store.settings.currency;
    goalInput.setAttribute('aria-label', `План выручки на месяц, ${store.settings.currency}`);
  }

  settingsFields.push(() => {
    goalInput.value = store.settings.revenueGoal ? String(store.settings.revenueGoal) : '';
  });

  /**
   * Put every settings-backed control back in step. An import or a snapshot
   * restore swaps the whole settings object, so the page has to re-read it
   * or it shows the previous account's thresholds until the next reload.
   */
  function syncSettingsUI() {
    applyTheme(store.settings.theme || 'light');
    renderThemes();
    renderStageRows();
    renderFieldKinds();
    renderFieldRows();
    renderNotify();
    renderNudges();
    renderAI();
    currencySelect.value = store.settings.currency;
    syncCurrencyLabels();
    for (const sync of settingsFields) sync();
    for (const sync of touchInputs) sync();
    renderTemplates();
    renderPlaybooks();
    renderTags();
    renderTrash();
    renderBackup();
  }

  /**
   * Rebuild a list and hand the keyboard back, the way renderNotify and
   * renderTrash already do for theirs. Renaming a tag or deleting a
   * template throws the whole list away and builds it again, which left
   * focus on the body - so the next Tab restarted at the top of a page
   * this long.
   *
   * The control is found again by the accessible name it still carries.
   * A rename changes that name, so callers can pass the one it becomes;
   * when the row is gone for good the list's first control takes the
   * keyboard rather than nothing at all. Focus that had already left the
   * list is left where the user put it.
   */
  function refocusList(list, render, renamedTo = null) {
    const label = list.contains(document.activeElement)
      ? document.activeElement.getAttribute('aria-label')
      : null;
    render();
    if (label === null) return;
    const byLabel = (name) => (name ? list.querySelector(`[aria-label=${CSS.escape(name)}]`) : null);
    (byLabel(label) || byLabel(renamedTo) || list.querySelector('input, button'))?.focus();
  }

  /* ----- email templates ----- */
  const templatesList = el('div');
  const renderTemplates = () => refocusList(templatesList, buildTemplates);
  function buildTemplates() {
    clear(templatesList);
    if (!store.templates.length) {
      templatesList.append(el('p.card-empty', {},
        'Письма, которые вы отправляете снова и снова (первое знакомство, итоги встречи, напоминание): пишутся один раз и заполняются из записи, с которой вы их отправляете.'));
      return;
    }
    templatesList.append(el('div.settings-list', {},
      [...store.templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) =>
        el('div.settings-row.static', {},
          el('span.row-ic', { html: icon('mail', 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, t.name || 'Без названия'),
            t.subject && el('div.sub', {}, t.subject)
          ),
          el('button.icon-btn', {
            html: icon('pencil', 16, 2),
            'aria-label': `Изменить шаблон «${t.name}»`,
            onclick: () => openTemplateForm(t, { onSaved: renderTemplates }),
          }),
          el('button.icon-btn', {
            html: icon('trash', 16, 2),
            'aria-label': `Удалить шаблон «${t.name}»`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: `Удалить шаблон «${t.name}»?`,
                message: 'Шаблон попадёт в корзину на 30 дней. Уже записанные письма останутся.',
              });
              if (!ok) return;
              try {
                deletedToast('Шаблон удалён', await store.deleteTemplate(t.id));
              } catch {
                toast('Не удалось удалить. Проверьте подключение', { icon: 'wifiOff' });
              }
              renderTemplates();
            },
          })
        ))));
  }
  renderTemplates();

  /* ----- playbooks -----
     The follow-up cadence a founder runs every time, saved once. */
  const playbooksList = el('div');
  const newPlaybookBtn = el('button.btn.btn-ghost.btn-sm', {
    html: icon('plus', 14, 2.2),
    onclick: () => openPlaybookForm(null, { onSaved: renderPlaybooks }),
  }, ' Новый');
  const renderPlaybooks = () => refocusList(playbooksList, buildPlaybooks);
  function buildPlaybooks() {
    clear(playbooksList);
    const books = store.playbooks();
    // The cap is reached by adding one, so the button has to answer for
    // itself on every render rather than at page build time.
    newPlaybookBtn.disabled = books.length >= MAX_PLAYBOOKS;
    newPlaybookBtn.title = newPlaybookBtn.disabled
      ? `Максимум сценариев: ${MAX_PLAYBOOKS}` : null;
    if (!books.length) {
      playbooksList.append(el('p.card-empty', {},
        'Сценариев пока нет. Сохраните шаги, которые вы делаете после демо (итоги в тот же день, напоминание через три дня, звонок через две недели), и применяйте их к контакту или сделке в один клик.'));
      return;
    }
    const stages = store.stages();
    playbooksList.append(el('div.settings-list', {}, books.map((book) => {
      const stage = book.trigger && stages.find((s) => s.id === book.trigger);
      return el('div.settings-row.static', {},
        el('span.row-ic', { html: icon('listChecks', 20, 1.8) }),
        el('div.grow.min0', {},
          el('div.title', {}, book.name),
          el('div.sub', {}, playbookSummary(book)
            + (stage ? ` · предлагается на этапе «${stage.label}»` : ''))
        ),
        el('button.icon-btn', {
          html: icon('pencil', 16, 2),
          'aria-label': `Изменить сценарий «${book.name}»`,
          onclick: () => openPlaybookForm(book, { onSaved: renderPlaybooks }),
        })
      );
    })));
  }
  renderPlaybooks();

  /* ----- tags ----- */
  const tagsList = el('div');
  const renderTags = (renamedTo = null) =>
    refocusList(tagsList, buildTags, renamedTo && `Переименовать метку «${renamedTo}»`);
  function buildTags() {
    clear(tagsList);
    const all = store.allTags();
    if (!all.length) {
      tagsList.append(el('p.card-empty', {},
        'Меток пока нет. Добавляйте их контактам, компаниям и сделкам, чтобы группировать записи так, как не позволяют обычные поля.'));
      return;
    }
    tagsList.append(el('div.settings-list', {}, all.map((t) => {
      const name = el('input.input.tag-name-input', {
        type: 'text', value: t.name, maxlength: 40, autocomplete: 'off',
        'aria-label': `Переименовать метку «${t.name}»`,
        onchange: async () => {
          const next = name.value.trim();
          if (!next || next === t.name) { name.value = t.name; return; }
          try {
            const n = await store.renameTag(t.name, next);
            toast(`Метка переименована в ${countLabel(n, ['записи', 'записях', 'записях'])}`);
          } catch {
            toast('Не удалось сохранить. Проверьте подключение', { icon: 'wifiOff' });
          }
          renderTags(next);
        },
      });
      return el('div.settings-row.static.tag-manage-row', {},
        el('span.row-ic', { html: icon('tag', 18, 2) }),
        el('div.grow.min0', {},
          name,
          el('div.sub', {}, countLabel(t.count, RECORD_FORMS))
        ),
        el('button.icon-btn', {
          html: icon('trash', 16, 2),
          'aria-label': `Удалить метку «${t.name}»`,
          onclick: async () => {
            const ok = await confirmDialog({
              title: `Удалить метку «${t.name}»?`,
              message: `Метка снимется с ${countLabel(t.count, ['записи', 'записей', 'записей'])}. Сами записи не изменятся.`,
              confirmLabel: 'Удалить метку',
            });
            if (!ok) return;
            try {
              await store.deleteTag(t.name);
              toast('Метка удалена', { icon: 'trash' });
            } catch {
              toast('Не удалось удалить. Проверьте подключение', { icon: 'wifiOff' });
            }
            renderTags();
          },
        })
      );
    })));
  }
  renderTags();

  /* ----- data ----- */

  /** Undo the last bulk replace by swapping the snapshot back in. */
  async function undoBulk() {
    try {
      await store.restoreBackup();
      syncSettingsUI();
      toast('Прежние данные восстановлены', { icon: 'undo' });
    } catch {
      toast('Не удалось восстановить. Проверьте подключение', { icon: 'wifiOff' });
    }
  }

  function exportData() {
    downloadFile(`crm-export-${todayISO()}.json`,
      JSON.stringify(store.exportAll(), null, 2), 'application/json');
    toast('Экспорт скачан', { icon: 'fileDown' });
  }

  function importData() {
    pickFile('application/json,.json', async (file) => {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toast('Файл не читается как JSON', { icon: 'alert' });
        return;
      }
      const ok = await confirmDialog({
        title: 'Заменить все данные?',
        message: 'Импорт заменит все контакты, компании, сделки, задачи и историю содержимым файла. Текущие данные сохранятся в снимке, так что импорт можно отменить.',
        confirmLabel: 'Импортировать и заменить',
      });
      if (!ok) return;
      const hadData = store.hasData();
      try {
        await store.importAll(data);
        // The file's settings replace the current ones; reflect them in
        // the app and this view now rather than on the next full reload.
        syncSettingsUI();
        // The snapshot taken inside importAll makes this reversible.
        toast('Импорт завершён', {
          icon: 'fileUp',
          action: hadData && { label: 'Отменить', onClick: undoBulk },
        });
      } catch (err) {
        console.error(err);
        toast(err.message === 'Not a CRM export file'
          ? 'Это не файл экспорта CRM' : 'Импорт не удался. Проверьте подключение', { icon: 'alert' });
      }
    });
  }

  async function loadSample() {
    const ok = await confirmDialog({
      title: 'Загрузить демо-данные?',
      message: 'Текущие данные заменятся демонстрационной воронкой. Перед этим сохранится снимок, так что свои данные можно вернуть.',
      confirmLabel: 'Загрузить демо-данные',
      danger: store.contacts.length > 0 || store.deals.length > 0,
    });
    if (!ok) return;
    const hadData = store.hasData();
    try {
      await store.importAll(sampleDataset(store), { reason: 'sample' });
      syncSettingsUI();
      toast('Демо-данные загружены', {
        icon: 'sparkle',
        action: hadData && { label: 'Отменить', onClick: undoBulk },
      });
    } catch {
      toast('Не удалось загрузить демо-данные. Проверьте подключение', { icon: 'wifiOff' });
    }
  }

  async function eraseAll() {
    const ok = await confirmDialog({
      title: 'Удалить все данные?',
      message: 'Все контакты, компании, сделки, задачи и записи истории будут удалены с сервера. Останется только один снимок, из которого всё можно вернуть здесь же.',
      confirmLabel: 'Удалить всё',
    });
    if (!ok) return;
    const hadData = store.hasData();
    try {
      await store.importAll({
        app: 'crm', version: 1,
        settings: { ...store.settings, onboarded: false, sampleData: false },
        companies: [], contacts: [], deals: [], activities: [], tasks: [],
      }, { reason: 'erase' });
      await store.emptyTrash();
      syncSettingsUI();
      toast('Все данные удалены', {
        icon: 'trash',
        action: hadData && { label: 'Отменить', onClick: undoBulk },
      });
      location.hash = '#/';
    } catch {
      toast('Не удалось удалить данные. Проверьте подключение', { icon: 'wifiOff' });
    }
  }

  /* ----- what hasn't reached the cloud yet -----
     The outbox keeps offline writes; this says whether it is holding any,
     because "saved" should never be a guess. */
  const syncRow = el('div');
  /* One settle of the outbox emits more than once - a failed write marks
     the connection down and then reports the new queue length - so two of
     these can be in flight at a time. Reading the queue is a round trip to
     IndexedDB, and clearing before that await let both renders clear an
     empty row and then both append, listing every pending write twice.
     Clear after the read instead, and let the newest render win. */
  let syncRenderId = 0;
  async function renderSync() {
    const id = ++syncRenderId;
    const pending = await store.pendingWrites().catch(() => []);
    if (id !== syncRenderId) return;
    clear(syncRow);
    const conflicts = pending.filter((row) => row.conflict);
    if (!pending.length) {
      syncRow.append(el('p.card-empty', {},
        store.offline.offline
          ? 'Нет связи. Всё, что вы меняли раньше, уже на сервере; новые изменения хранятся здесь и уйдут, когда сервер ответит.'
          : 'Всё на сервере. Изменения, сделанные без связи, ждут здесь, пока сервер не ответит.'));
      return;
    }
    syncRow.append(el('div.settings-list', {},
      pending.map((row) => el('div.settings-row.static', {},
        el('span.row-ic', { html: icon(row.conflict ? 'alert' : 'wifiOff', 20, 1.8) }),
        el('div.grow.min0', {},
          el('div.title', {}, kvLabel(row.key)),
          el('div.sub', {}, row.conflict
            ? 'Изменено и в другом месте — нужно выбрать версию'
            : `Сохранено на этом устройстве ${timeAgo(row.at)}`)
        )
      ))
    ),
    el('div.settings-body', {},
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        html: icon(conflicts.length ? 'alert' : 'upload', 14, 2),
        onclick: openOfflineSheet,
      }, conflicts.length ? ' Разобраться' : ' Повторить сейчас')
    ));
  }
  renderSync();
  const onOffline = () => { renderSync(); };
  store.addEventListener('offline', onOffline);

  /* ----- automatic cloud backups ----- */
  const cloudBackups = el('div');

  async function restoreCloudBackup(b) {
    let data;
    try {
      data = await readBackup(b.path);
    } catch {
      toast('Не удалось прочитать резервную копию. Проверьте подключение', { icon: 'wifiOff' });
      return;
    }
    const ok = await confirmDialog({
      title: 'Восстановить эту копию?',
      message: `Все данные заменятся резервной копией от ${formatDate(todayISO(new Date(b.at)), { year: 'always' })}. Перед этим сохранится снимок текущих данных, так что восстановление можно отменить.`,
      confirmLabel: 'Восстановить копию',
    });
    if (!ok) return;
    const hadData = store.hasData();
    try {
      await store.importAll(data, { reason: 'cloud-backup' });
      syncSettingsUI();
      toast('Резервная копия восстановлена', {
        icon: 'undo',
        action: hadData && { label: 'Отменить', onClick: undoBulk },
      });
    } catch (err) {
      console.error(err);
      toast(err.message === 'Not a CRM export file'
        ? 'Это не резервная копия CRM' : 'Восстановление не удалось. Проверьте подключение', { icon: 'alert' });
    }
  }

  async function backupNow(btn) {
    btn.disabled = true;
    try {
      await writeBackup(store);
      toast('Резервная копия сохранена на сервере', { icon: 'check' });
    } catch {
      toast('Не удалось создать резервную копию. Проверьте подключение', { icon: 'wifiOff' });
    }
    btn.disabled = false;
    renderCloudBackups();
  }

  async function renderCloudBackups() {
    // Reading the folder is a round trip to the user's cloud. This section
    // had an error state and an empty state but nothing for the wait, so on
    // a slow connection it stood blank and read as "no backups" - the one
    // wrong answer to give about the copies that exist to be relied on.
    clear(cloudBackups);
    cloudBackups.append(el('p.card-empty', {}, 'Проверяем папку с резервными копиями…'));
    let backups;
    try {
      backups = await listBackups();
    } catch {
      backups = null;
    }
    clear(cloudBackups);
    if (backups === null) {
      cloudBackups.append(el('p.card-empty', {},
        'Не удалось открыть папку с резервными копиями. Проверьте подключение.'));
      return;
    }
    if (!backups.length) {
      cloudBackups.append(el('p.card-empty', {},
        'Резервных копий пока нет. Копия создаётся автоматически при открытии приложения, можно сделать её и сейчас.'));
      return;
    }
    cloudBackups.append(
      el('div.settings-body', {},
        el('p.settings-note', {}, `Последняя автоматическая копия: ${timeAgo(backups[0].at)}.`)
      ),
      el('div.settings-list', {}, backups.map((b) => el('div.settings-row.static', {},
        el('span.row-ic', { html: icon('fileDown', 20, 1.8) }),
        el('div.grow.min0', {},
          el('div.title', {}, formatDate(todayISO(new Date(b.at)), { year: 'always' })),
          el('div.sub', {}, `${timeAgo(b.at)}${b.size ? ` · ${formatBytes(b.size)}` : ''}`)
        ),
        el('button.icon-btn', {
          html: icon('download', 16, 2),
          'aria-label': `Скачать копию, сохранённую ${timeAgo(b.at)}`,
          onclick: async () => {
            try {
              const data = await readBackup(b.path);
              downloadFile(b.name, JSON.stringify(data, null, 2), 'application/json');
              toast('Резервная копия скачана', { icon: 'fileDown' });
            } catch {
              toast('Не удалось прочитать резервную копию. Проверьте подключение', { icon: 'wifiOff' });
            }
          },
        }),
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('undo', 14, 2),
          onclick: () => restoreCloudBackup(b),
        }, ' Восстановить')
      )))
    );
  }
  renderCloudBackups();

  /* ----- recently deleted ----- */
  const TRASH_KINDS = {
    company: { icon: 'company', label: 'Компания', restored: 'Компания восстановлена' },
    contact: { icon: 'user', label: 'Контакт', restored: 'Контакт восстановлен' },
    deal: { icon: 'deal', label: 'Сделка', restored: 'Сделка восстановлена' },
    activity: { icon: 'video', label: 'Запись в истории', restored: 'Запись восстановлена' },
    task: { icon: 'followups', label: 'Задача', restored: 'Задача восстановлена' },
    template: { icon: 'mail', label: 'Шаблон письма', restored: 'Шаблон восстановлен' },
    attachment: { icon: 'paperclip', label: 'Файл', restored: 'Файл восстановлен' },
  };

  const trashSection = el('div');
  function renderTrash() {
    // Restoring an entry rebuilds this list under the keyboard user's
    // focus; hand it to the next actionable control rather than the body.
    const hadFocus = trashSection.contains(document.activeElement);
    clear(trashSection);
    if (!store.trash.length) {
      trashSection.append(el('p.card-empty', {},
        'Корзина пуста. Удалённые записи хранятся здесь 30 дней, потом удаляются навсегда.'));
      return;
    }
    trashSection.append(
      el('div.settings-list', {}, store.trash.map((entry) => {
        const kind = TRASH_KINDS[entry.kind] || { icon: 'inbox', label: 'Запись', restored: 'Запись восстановлена' };
        return el('div.settings-row.static', {},
          el('span.row-ic', { html: icon(kind.icon, 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, entry.name || 'Без названия'),
            el('div.sub', {}, `${kind.label} · удалено ${timeAgo(entry.at)}`)
          ),
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            html: icon('undo', 14, 2),
            onclick: async () => {
              try {
                await store.restoreTrash(entry.id);
                toast(kind.restored, { icon: 'undo' });
              } catch {
                toast('Не удалось восстановить. Проверьте подключение', { icon: 'wifiOff' });
              }
              renderTrash();
            },
          }, ' Восстановить')
        );
      })),
      el('div.settings-body', {},
        el('button.btn.btn-ghost.btn-sm.btn-danger-ghost', {
          type: 'button',
          html: icon('trash', 14, 2),
          onclick: async () => {
            const n = store.trash.length;
            const ok = await confirmDialog({
              title: 'Очистить корзину?',
              message: `${countLabel(n, ['запись будет удалена', 'записи будут удалены', 'записей будут удалены'])} навсегда. Отменить это нельзя.`,
              confirmLabel: 'Очистить корзину',
            });
            if (!ok) return;
            try {
              await store.emptyTrash();
              toast('Корзина очищена', { icon: 'trash' });
            } catch {
              toast('Не удалось очистить корзину. Проверьте подключение', { icon: 'wifiOff' });
            }
            renderTrash();
          },
        }, ' Очистить корзину')
      )
    );
    if (hadFocus) trashSection.querySelector('button')?.focus();
  }
  renderTrash();

  /* ----- safety snapshot ----- */
  const backupRow = el('div');
  function renderBackup() {
    clear(backupRow);
    if (!store.backup) return;
    const when = timeAgo(store.backup.at);
    const why = {
      sample: 'загрузкой демо-данных',
      erase: 'удалением всех данных',
      restore: 'последним восстановлением',
      wipe: 'очисткой демо-данных',
      'cloud-backup': 'восстановлением резервной копии с сервера',
    }[store.backup.reason] || 'последним импортом';
    backupRow.append(dataRow('undo', 'Вернуть прежние данные',
      `Снимок сделан ${when}, перед ${why}`, async () => {
        const ok = await confirmDialog({
          title: 'Восстановить снимок?',
          message: `Всё вернётся к тому, что было ${when}. Текущие данные тоже сохранятся в снимке, так что можно будет вернуться обратно.`,
          confirmLabel: 'Восстановить',
          danger: false,
        });
        if (!ok) return;
        try {
          await store.restoreBackup();
          syncSettingsUI();
          toast('Прежние данные восстановлены', { icon: 'undo' });
        } catch {
          toast('Не удалось восстановить. Проверьте подключение', { icon: 'wifiOff' });
        }
      }));
  }

  const dataRow = (name, title, sub, onclick, danger = false) => {
    const row = el(`button.settings-row${danger ? '.danger' : ''}`, { type: 'button', onclick },
      el('span.row-ic', { html: icon(name, 20, 1.8) }),
      el('div.grow', {},
        el('div.title', {}, title),
        el('div.sub', {}, sub)
      ),
      el('span.row-chev', { html: icon('chevR', 18) })
    );
    // Exports and sign-out do not mutate CRM data and remain available to
    // viewers; every other settings action is disabled below.
    if ([downloadOpenICS, openCSVExport, exportData, confirmSignOut].includes(onclick)) {
      row.dataset.readonlySafe = 'true';
    }
    return row;
  };

  /* ----- account ----- */
  const username = store.user?.username || 'Пользователь';
  const accountRows = el('div.settings-list', {},
    el('div.settings-row.static', {},
      el('span.avatar', {}, username.charAt(0).toUpperCase()),
      el('div.grow', {},
        el('div.title', {}, username),
        el('div.sub', {}, `${roleLabel(store.user?.role)} · ${readOnly ? 'только просмотр' : 'можно изменять данные'}`)
      )
    ),
    // Inside Puter's desktop the platform owns the session - no sign-out.
    puter.env !== 'app' && dataRow('logout', 'Выйти', 'Данные останутся на сервере', confirmSignOut)
  );

  renderBackup();

  /* Trash and the snapshot row change from outside this page's own buttons
     - a CSV import writes a new snapshot, a toast Undo restores a trash
     entry - so they follow the store. Only these two: re-rendering the
     input-bearing sections on every save would steal focus mid-edit. */
  const syncPassive = () => {
    renderTrash();
    renderBackup();
    // No inputs in the templates list, so following the store is safe -
    // and a template restored from the trash reappears without a reload.
    renderTemplates();
  };
  store.addEventListener('change', syncPassive);
  root.destroy = () => {
    store.removeEventListener('change', syncPassive);
    store.removeEventListener('offline', onOffline);
  };

  root.append(
    pageHead('Настройки'),
    readOnly && el('p.page-sub', {}, 'Вы вошли как наблюдатель. Настройки и данные доступны только для просмотра; экспорт и выход из аккаунта по-прежнему работают.'),
    section('Оформление', null,
      el('div.settings-body', {},
        el('div.field', {},
          el('label.field-label', {}, 'Тема'),
          themeGroup
        ),
        el('div.field', {},
          el('label.field-label', { for: 'currency-select' }, 'Валюта'),
          el('div.select-wrap', {}, Object.assign(currencySelect, { id: 'currency-select' }))
        )
      )
    ),
    section('Прогноз и квалификация', null,
      el('div.settings-body', {},
        el('div.field', {},
          el('label.field-label', { for: 'forecast-mode' }, 'Взвешивать прогноз'),
          forecastModeSelect,
          el('p.field-hint', {}, FORECAST_MODES.find((m) => m.value === (store.settings.forecastMode || 'stage'))?.hint)
        ),
        el('p.settings-note', {}, 'Модель АБР использует факты из карточки сделки: команду клиента, экономического покупателя, сторонника, внешний срок, вложения клиента, бюджет и тип закупки. Запись с «?» засчитывается как половина факта.')
      )
    ),
    section('Этапы воронки',
      el('button.btn.btn-ghost.btn-sm', {
        onclick: () => saveStages(ABR_OPEN_STAGES.map((s) => ({ ...s })), {
          remap: { new: 's1', qualified: 's2', proposal: 's5', negotiation: 's7' },
          message: 'Воронка АБР применена',
        }),
      }, 'Применить АБР'),
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Ваша воронка по порядку. Переименуйте, переставьте, добавьте или удалите этапы, чтобы они совпадали с тем, как вы продаёте на самом деле. Процент — вероятность выиграть сделку на этом этапе; прогноз умножает на него суммы сделок.'),
        stageRows
      )
    ),
    section('Свои поля', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Всё, что важно вашему бизнесу и чего нет среди стандартных полей: число мест, конец пробного периода, соответствие портрету клиента, кто порекомендовал. Поля появляются в формах добавления и редактирования и на карточках, а по полям с вариантами и «да/нет» можно фильтровать списки.'),
        fieldKindGroup,
        fieldRows
      )
    ),
    section('Напоминания', null,
      el('div.settings-body', {},
        notifyRow,
        nudgeRow,
        el('p.settings-note.mt-sm', {}, 'Уведомления приходят, только пока приложение открыто во вкладке. Чтобы напоминания работали и при закрытом ноутбуке, выгрузите задачи в календарь.')
      ),
      el('div.settings-list', {},
        dataRow('calendar', 'Экспорт открытых задач (.ics)',
          'Все открытые задачи и даты закрытия открытых сделок — для любого календаря',
          downloadOpenICS)
      )
    ),
    section('ИИ-помощник', null,
      el('div.settings-body', {}, aiRow)
    ),
    section('Что требует внимания', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Когда доска и главная начинают подсказывать. Поставьте 0, чтобы отключить отметку.'),
        daysField('stale-days', 'Сделка зависла, если без движения', 'staleDays', DEFAULT_STALE_DAYS,
          'Отмечает карточки на доске, самые зависшие показываются на главной.'),
        daysField('cold-days', 'Контакт остывает, если без касаний', 'coldDays', DEFAULT_COLD_DAYS,
          'Для фильтра «Остывает» в контактах и карточки на главной.')
      )
    ),
    section('План выручки на месяц', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Сумма, на которую вы продаёте. Главная показывает выигранную выручку как выполнение плана (с темпом на текущий день месяца), а прогноз проводит план линией по следующим месяцам.'),
        el('div.goal-field', {},
          goalCurrency,
          Object.assign(goalInput, { id: 'revenue-goal' }),
          el('label.field-hint', { for: 'revenue-goal' }, 'в месяц · оставьте пустым, если плана нет')
        )
      )
    ),
    section('План касаний на неделю', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Выручка — то, что уже случилось; касания — то, на что можно повлиять сегодня. Укажите, сколько встреч, звонков, писем и заметок в неделю вы собираетесь записывать в историю, и главная и история будут сравнивать с этим текущую неделю — с темпом на день недели.'),
        touchTotalField(),
        el('p.field-hint.mt-sm', {}, 'Или задайте план по типам: столько-то звонков и столько-то встреч.'),
        touchTypeFields(),
        touchHint
      )
    ),
    section('Шаблоны писем',
      el('button.btn.btn-ghost.btn-sm', {
        html: icon('plus', 14, 2.2),
        onclick: () => openTemplateForm(null, { onSaved: renderTemplates }),
      }, ' Новый'),
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Вызываются кнопкой «Письмо» на карточке контакта или сделки. Подстановки вроде {{firstName}} и {{dealValue}} заполняются из записи.')
      ),
      templatesList
    ),
    section('Сценарии задач',
      newPlaybookBtn,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Шаги, которые вы повторяете каждый раз, сохранённые один раз: примените сценарий к контакту или сделке, и он поставит все задачи со сроками от сегодняшнего дня. Сценарий может сам предлагаться, когда сделка переходит на этап, но всегда сначала спрашивает.')
      ),
      playbooksList
    ),
    section('Метки', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Все метки контактов, компаний и сделок. Переименование меняет метку во всех записях, удаление снимает только саму метку.')
      ),
      tagsList
    ),
    section('Ваши данные', null,
      el('div.settings-list', {},
        dataRow('merge', 'Проверить возможные дубли', 'Контакты и компании, которые похожи на одну и ту же запись', openDuplicatesReview),
        dataRow('fileUp', 'Импорт из CSV', 'Загрузить контакты, компании или сделки из таблицы', openCSVImport),
        dataRow('fileDown', 'Экспорт в CSV', 'По файлу на каждый тип записей — для таблиц и других программ', openCSVExport),
        dataRow('fileDown', 'Экспорт всех данных', 'Скачать JSON-файл со всеми данными', exportData),
        dataRow('fileUp', 'Импорт из файла экспорта', 'Заменить данные ранее выгруженным файлом', importData),
        dataRow('sparkle', 'Загрузить демо-данные', 'Посмотреть приложение на демонстрационной воронке', loadSample),
        dataRow('trash', 'Удалить все данные', 'Стереть всё в этом аккаунте', eraseAll, true)
      ),
      backupRow
    ),
    section('Ждут отправки', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Изменения сначала сохраняются на этом устройстве, поэтому при обрыве связи ничего не теряется, а потом уходят на сервер. Всё, что ещё в пути, показано здесь.')
      ),
      syncRow
    ),
    section('Резервные копии на сервере',
      (() => {
        const btn = el('button.btn.btn-ghost.btn-sm', {
          html: icon('upload', 14, 2),
        }, ' Создать копию');
        btn.addEventListener('click', () => backupNow(btn));
        return btn;
      })(),
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Регулярная копия всех данных в папке резервных копий на вашем сервере: страховка от неудачной массовой правки или сбоя записи, от которых не спасёт корзина на 30 дней. Старые копии удаляются сами.'),
        daysField('backup-days', 'Создавать копию автоматически раз в', 'autoBackupDays', 7,
          'Проверяется при открытии приложения. 0 отключает автоматические копии.')
      ),
      cloudBackups
    ),
    section('Корзина', null, trashSection),
    section('Аккаунт', null, accountRows)
  );

  if (readOnly) {
    root.classList.add('is-read-only');
    for (const control of root.querySelectorAll('input, select, textarea, button')) {
      if (!control.closest('[data-readonly-safe]')) control.disabled = true;
    }
    // Lists can be rebuilt after a background refresh. Capture clicks on any
    // newly created action too, rather than relying only on the first pass.
    root.addEventListener('click', (event) => {
      const control = event.target.closest('button');
      if (!control || control.closest('[data-readonly-safe]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Роль наблюдателя позволяет только просматривать данные', { icon: 'info' });
    }, true);
  }

  return root;
}
