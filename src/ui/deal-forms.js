import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { dictionaryOptions, DEAL_STAGES } from '../lib/spec.js';
import { isFinalStage, WINNER_NONE, WINNER_UNKNOWN } from '../lib/deal-workflow.js';
import { uid, todayISO, formatDate } from '../lib/util.js';
import { ensureWritable, field, textInput, textArea, makeSelect, searchSelect, withCurrent } from './forms.js';

const byName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const options = (rows, empty = 'Не выбрано') => [{ value: '', label: empty }, ...byName(rows).map((row) => ({ value: row.id, label: row.name }))];
const dict = (key, current = '', empty = 'Не указано') => withCurrent(dictionaryOptions(store.settings, key, { empty }), current);
const stageName = (id) => store.stages().find((stage) => stage.id === id)?.label || id;
const employeeName = (id) => store.employeeById(id)?.name || 'Не назначен';

export function openDealClosureForm(deal, { stage = deal.stage, onSaved = null } = {}) {
  if (!ensureWritable() || !deal) return;
  const operationId = uid();
  const result = makeSelect([
    { value: 'won', label: 'Выиграна' }, { value: 'lost', label: 'Проиграна' },
  ], isFinalStage(stage) ? stage : 'won');
  const reason = makeSelect(dict('dealCloseReasons', deal.closeReason), deal.closeReason || '');
  const closedOn = textInput({ type: 'date', value: deal.closedOn || todayISO(), max: todayISO(), required: true });
  const prioritized = [
    ...byName(store.companies.filter((company) => deal.competitorIds?.includes(company.id))),
    ...byName(store.companies.filter((company) => !deal.competitorIds?.includes(company.id))),
  ];
  const winnerOptions = [
    { value: '__unknown', label: WINNER_UNKNOWN }, { value: '__none', label: WINNER_NONE },
    ...prioritized.map((company) => ({ value: company.id, label: `${company.name}${deal.competitorIds?.includes(company.id) ? ' · конкурент сделки' : ''}` })),
  ];
  const initialWinner = deal.winnerCompanyId || (deal.winner === WINNER_UNKNOWN ? '__unknown' : deal.winner === WINNER_NONE ? '__none' : '');
  const winner = searchSelect(winnerOptions, initialWinner, { placeholder: 'Компания, «Неизвестно» или «Победителя нет»' });
  const comment = textArea({ value: deal.closeReasonNote || '', rows: 3 });
  const winnerField = field('Кто выиграл', winner.wrap, { hint: 'Сначала показаны конкуренты этой сделки. Удалить компанию из справочника здесь нельзя.' });
  const form = el('form.form.deal-closure-form', {},
    el('p.field-hint', {}, 'Сохранение применит результат, статус «Завершена» и данные закрытия одной операцией.'),
    field('Результат', result.wrap), field('Причина', reason.wrap), field('Фактическая дата закрытия', closedOn),
    winnerField, field('Комментарий', comment),
    el('div.form-actions', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Отмена'),
      el('div.grow'), el('button.btn.btn-primary', { type: 'submit' }, 'Сохранить закрытие')));
  const modal = openModal({ title: 'Закрытие сделки', content: form, wide: false });
  const sync = () => {
    const lost = result.select.value === 'lost';
    winnerField.hidden = !lost;
    reason.select.required = lost;
    winner.input.required = lost;
    comment.required = lost && reason.select.value === 'Другое';
  };
  result.select.addEventListener('change', sync);
  reason.select.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const saved = await store.closeDeal(deal.id, {
        stage: result.select.value, closeReason: reason.select.value, closeReasonNote: comment.value.trim(), closedOn: closedOn.value,
        winnerCompanyId: winner.select.value && !winner.select.value.startsWith('__') ? winner.select.value : null,
        winner: winner.select.value === '__unknown' ? WINNER_UNKNOWN : winner.select.value === '__none' ? WINNER_NONE : '',
      }, { expectedRevision: deal.revision, operationId });
      toast('Закрытие сохранено', { icon: 'check' });
      modal.close(); onSaved?.(saved);
    } catch (error) {
      toast(error.message || 'Не удалось сохранить закрытие', { icon: 'alert' });
      button.disabled = false;
    }
  });
  return modal;
}

export function openDealEventForm(deal, { onSaved = null, presets = {} } = {}) {
  if (!ensureWritable() || !deal) return;
  const operationId = uid();
  const actor = store.currentEmployee();
  const summary = textArea({ value: presets.summary || '', required: true, rows: 5, maxlength: 4000, placeholder: 'Что произошло?' });
  const error = el('p.form-error', { role: 'alert', hidden: true });
  const form = el('form.form.deal-event-form', {},
    el('div.deal-event-automatic', {}, el('span', {}, `Автор: ${actor?.name || store.user?.username || 'Текущая учётная запись'}`),
      el('span', {}, `Стадия: ${stageName(deal.stage)} · дата и время фиксируются автоматически`)),
    field('Что произошло?', summary), error,
    el('div.form-actions', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Отмена'),
      el('div.grow'), el('button.btn.btn-primary', { type: 'submit' }, 'Добавить запись')));
  const modal = openModal({ title: 'Новая запись в хронологии', content: form, wide: false });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); error.hidden = true;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const saved = await store.addDealRecord(deal.id, { summary: summary.value.trim(), type: presets.type || 'note' }, {
        expectedRevision: deal.revision, operationId,
      });
      toast('Запись добавлена', { icon: 'check' }); modal.close(); onSaved?.(saved);
    } catch (err) {
      error.textContent = err.message || 'Не удалось сохранить запись. Текст остался в поле.';
      error.hidden = false; button.disabled = false;
    }
  });
  return modal;
}
