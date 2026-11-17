/** Deal closing, next-step and overdue rules shared by the UI and server. */
import { todayISO, isValidISODate } from './util.js';

export const FINAL_STAGES = new Set(['won', 'lost']);
export const WINNER_UNKNOWN = 'Неизвестно';
export const WINNER_NONE = 'Победителя нет';
export const CLOSE_REASONS = [
  'Цена или коммерческие условия',
  'Функциональность или состав решения',
  'Сроки',
  'Выбран другой поставщик',
  'Нет бюджета',
  'Проект или закупка отменены',
  'Другое',
];

export const isFinalStage = (stage) => FINAL_STAGES.has(stage);
export const outcomeForStage = (stage) => stage === 'won' ? 'Выиграна' : stage === 'lost' ? 'Проиграна' : '';
const text = (value) => String(value ?? '').trim();
const stamp = (value, fallback = Date.now()) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const link = (value) => text(value) || null;

/** Validate the whole close as one value; callers persist nothing on a throw. */
export function validateClosure(deal, input = {}, companies = [], now = new Date()) {
  const stage = input.stage || deal?.stage;
  if (!isFinalStage(stage)) throw new Error('Выберите результат: Выиграна или Проиграна');
  const outcome = outcomeForStage(stage);
  const reason = text(input.closeReason);
  const comment = text(input.closeReasonNote);
  const closedOn = input.closedOn || todayISO(now);
  if (!isValidISODate(closedOn) || closedOn > todayISO(now)) {
    throw new Error('Фактическая дата закрытия не может быть позже сегодняшней');
  }
  if (outcome === 'Проиграна' && !reason) throw new Error('При проигрыше укажите причину');
  if (reason === 'Другое' && !comment) throw new Error('Для причины «Другое» заполните комментарий');

  const winnerCompanyId = outcome === 'Проиграна' ? link(input.winnerCompanyId) : null;
  let winner = outcome === 'Проиграна' ? text(input.winner) : '';
  if (winnerCompanyId) winner = text(companies.find((company) => company.id === winnerCompanyId)?.name);
  if (outcome === 'Проиграна' && !winnerCompanyId && ![WINNER_UNKNOWN, WINNER_NONE].includes(winner)) {
    throw new Error('При проигрыше обязательно укажите, кто выиграл');
  }
  if (reason === 'Выбран другой поставщик' && winner === WINNER_NONE) {
    throw new Error('При выборе другого поставщика нельзя указать «Победителя нет»');
  }
  if (reason === 'Проект или закупка отменены' && winner !== WINNER_NONE) {
    throw new Error('При отмене проекта или закупки укажите «Победителя нет»');
  }
  return {
    stage, outcome, status: 'Завершена', closeReason: reason, closeReasonNote: comment,
    closedOn, winner, winnerCompanyId,
  };
}

/** Calendar date in the CRM's business timezone, independent of server locale. */
export function moscowDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return todayISO();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const utcDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

/** Zero through the due date; day one starts on the next Moscow calendar day. */
export function overdueDays(due, now = new Date()) {
  if (!isValidISODate(due)) return 0;
  return Math.max(0, utcDay(moscowDate(now)) - utcDay(due));
}

export function normalizeDealStep(raw = {}) {
  const status = ['active', 'completed', 'cancelled'].includes(raw.status) ? raw.status : 'active';
  return {
    ...raw,
    id: text(raw.id), dealId: link(raw.dealId), action: text(raw.action), due: isValidISODate(raw.due) ? raw.due : '',
    employeeId: link(raw.employeeId), status,
    originalDue: isValidISODate(raw.originalDue) ? raw.originalDue : (isValidISODate(raw.due) ? raw.due : ''),
    createdAt: stamp(raw.createdAt), createdBy: link(raw.createdBy),
    closedAt: status === 'active' ? null : stamp(raw.closedAt), closedBy: status === 'active' ? null : link(raw.closedBy),
    closeReason: status === 'cancelled' ? text(raw.closeReason) : '',
    resultActivityId: link(raw.resultActivityId), revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
    changes: Array.isArray(raw.changes) ? raw.changes : [],
    overdueDays: Math.max(0, Math.floor(Number(raw.overdueDays) || 0)),
  };
}

export function normalizeFieldHistory(raw = {}) {
  return {
    ...raw,
    id: text(raw.id), dealId: link(raw.dealId), entityType: text(raw.entityType), entityId: link(raw.entityId), at: stamp(raw.at),
    actorId: link(raw.actorId), actorName: text(raw.actorName) || 'Системный процесс',
    field: text(raw.field), label: text(raw.label || raw.field),
    previousValue: raw.previousValue ?? null, newValue: raw.newValue ?? null,
    previousDisplay: text(raw.previousDisplay), newDisplay: text(raw.newDisplay),
    reason: text(raw.reason),
  };
}

export function normalizeDealNotification(raw = {}) {
  const taskId = link(raw.taskId || raw.stepId);
  return {
    ...raw,
    id: text(raw.id), taskId, stepId: taskId, dealId: link(raw.dealId), employeeId: link(raw.employeeId),
    kind: text(raw.kind) || 'overdue', active: raw.active === true,
    overdueDays: Math.max(0, Math.floor(Number(raw.overdueDays) || 0)),
    createdAt: stamp(raw.createdAt), updatedAt: stamp(raw.updatedAt, stamp(raw.createdAt)),
    readAt: raw.readAt ? stamp(raw.readAt) : null,
  };
}

export const isCancelledTask = (task) => task?.status === 'Отменена' || Boolean(task?.cancelledAt);
export const isOpenTask = (task) => !task?.done && !isCancelledTask(task);

/** Pure overdue projection for every open task. Reading never clears `active`. */
export function projectOverdue(tasks = [], notifications = [], now = new Date()) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  const nextTasks = tasks.map((raw) => ({
    ...raw,
    overdueDays: isOpenTask(raw) ? overdueDays(raw.due, now) : 0,
  }));
  const nextNotifications = notifications.map(normalizeDealNotification);
  const byTask = new Map(nextNotifications.map((row) => [row.taskId || row.stepId, row]));
  for (const task of nextTasks) {
    if (!isOpenTask(task) || !task.dealId) continue;
    const days = task.overdueDays;
    let note = byTask.get(task.id);
    if (!note && days > 0) {
      note = normalizeDealNotification({
        id: `overdue-${task.id}`, taskId: task.id, dealId: task.dealId, employeeId: task.employeeId,
        active: true, overdueDays: days, createdAt: at, updatedAt: at,
      });
      nextNotifications.push(note);
      byTask.set(task.id, note);
      continue;
    }
    if (!note) continue;
    note.taskId = task.id;
    note.stepId = task.id;
    note.dealId = task.dealId;
    note.employeeId = task.employeeId;
    note.overdueDays = days;
    note.active = days > 0;
    note.updatedAt = at;
  }
  const activeIds = new Set(nextTasks.filter((task) => task.dealId && isOpenTask(task)).map((task) => task.id));
  for (const note of nextNotifications) {
    const id = note.taskId || note.stepId;
    if (!activeIds.has(id)) note.active = false;
  }
  // `steps` is kept as a read-compatible alias for older integrations.
  return { tasks: nextTasks, steps: nextTasks, notifications: nextNotifications };
}

export function nextTaskFor(tasks, dealId) {
  return tasks.find((task) => task.dealId === dealId && task.isNextStep === true && isOpenTask(task)) || null;
}

export function assertOneNextStep(tasks, dealId) {
  const count = tasks.filter((task) => task.dealId === dealId && task.isNextStep === true && isOpenTask(task)).length;
  if (count > 1) throw new Error('У сделки не может быть двух основных следующих шагов');
}
