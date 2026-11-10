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

export function openDealEventForm(deal, { complete = false, onSaved = null, presets = {} } = {}) {
  if (!ensureWritable() || !deal) return;
  const current = store.activeDealStep(deal.id);
  const revision = deal.revision;
  const operationId = uid();
  const actor = store.currentEmployee();
  const type = makeSelect([
    { value: 'note', label: 'Событие / результат' }, { value: 'meeting', label: 'Встреча' },
    { value: 'call', label: 'Звонок' }, { value: 'email', label: 'Письмо' },
  ], presets.type || 'note');
  const openStages = store.stages().filter((stage) => !isFinalStage(stage.id) || stage.id === deal.stage);
  const stage = makeSelect(openStages.map((row) => ({ value: row.id, label: row.label })), presets.stage || deal.stage);
  const summary = textArea({ value: presets.summary || '', required: true, rows: 4, maxlength: 2000, placeholder: 'Что произошло и какой результат получен?' });
  const terminal = isFinalStage(deal.stage);
  const actionChoices = terminal ? (current ? [
    { value: 'complete', label: 'Выполнить текущий шаг' },
    { value: 'cancel', label: 'Отменить текущий шаг с указанием причины' },
  ] : [{ value: 'keep', label: 'Только добавить событие в хронологию' }]) : current ? [
    { value: 'keep', label: 'Оставить текущий шаг без изменений' },
    { value: 'complete-next', label: 'Выполнить текущий и назначить следующий' },
    { value: 'change', label: 'Изменить текущий шаг' },
    { value: 'cancel-replace', label: 'Отменить и заменить с указанием причины' },
  ] : [{ value: 'create', label: 'Создать следующий шаг' }];
  const stepAction = makeSelect(actionChoices, complete && current ? (terminal ? 'complete' : 'complete-next') : actionChoices[0].value);
  const nextAction = textInput({ value: current?.action || '', maxlength: 500, placeholder: 'Конкретное следующее действие' });
  const nextDue = textInput({ type: 'date', value: current?.due || todayISO() });
  const assignee = makeSelect(options(store.activeEmployees([current?.employeeId, actor?.id]), 'Выберите активного сотрудника'), current?.employeeId || actor?.id || '');
  const changeReason = textArea({ rows: 2, placeholder: 'Причина отмены или изменения действия, срока, ответственного' });
  const nextFields = el('div.deal-event-next-fields', {},
    field('Действие следующего шага', nextAction), el('div.form-grid', {}, field('Срок', nextDue), field('Ответственный', assignee.wrap)));
  const reasonField = field('Причина изменения', changeReason);
  const currentBlock = current ? el('div.deal-current-step', {},
    el('strong', {}, current.action), el('span', {}, `${employeeName(current.employeeId)} · срок ${formatDate(current.due)}${current.overdueDays ? ` · просрочка ${current.overdueDays} дн.` : ''}`))
    : el('div.notice.warning', {}, terminal ? 'Активного следующего шага нет. Событие будет добавлено в хронологию закрытой сделки.' : 'Активного следующего шага нет. Для активной сделки создайте его при сохранении события.');
  const error = el('p.form-error', { role: 'alert', hidden: true });
  const form = el('form.form.deal-event-form', {},
    el('div.deal-event-automatic', {}, el('span', {}, `Автор: ${actor?.name || store.user?.username || 'Текущая учётная запись'}`),
      el('span', {}, 'Дата и время события фиксируются автоматически')),
    currentBlock,
    el('div.form-grid', {}, field('Тип события', type.wrap), field('Стадия сделки', stage.wrap)),
    field('Текущее событие / результат', summary),
    field('Действие со следующим шагом', stepAction.wrap), nextFields, reasonField, error,
    el('div.form-actions', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Отмена'),
      el('div.grow'), el('button.btn.btn-primary', { type: 'submit' }, 'Сохранить событие')));
  const modal = openModal({ title: complete ? 'Выполнить / внести результат' : 'Новое событие сделки', content: form, wide: true });
  const sync = () => {
    const action = stepAction.select.value;
    nextFields.hidden = ['keep', 'complete', 'cancel'].includes(action);
    reasonField.hidden = !['change', 'cancel-replace', 'cancel'].includes(action);
    nextAction.required = ['complete-next', 'cancel-replace', 'create'].includes(action);
    nextDue.required = nextAction.required;
    assignee.select.required = ['complete-next', 'cancel-replace', 'create', 'change'].includes(action);
    changeReason.required = ['change', 'cancel-replace', 'cancel'].includes(action);
  };
  stepAction.select.addEventListener('change', sync); sync();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const saved = await store.saveDealEvent(deal.id, {
        type: type.select.value, stage: stage.select.value, summary: summary.value.trim(), stepAction: stepAction.select.value,
        changeReason: changeReason.value.trim(),
        nextStep: { action: nextAction.value.trim(), due: nextDue.value, employeeId: assignee.select.value || actor?.id || null },
      }, { expectedRevision: revision, operationId });
      toast('Событие и следующий шаг сохранены', { icon: 'check' });
      modal.close(); onSaved?.(saved);
    } catch (err) {
      error.textContent = err.message || 'Не удалось сохранить операцию. Изменения не применены.';
      error.hidden = false;
      button.disabled = false;
    }
  });
  return modal;
}
