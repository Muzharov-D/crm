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
    id: text(raw.id), dealId: link(raw.dealId), at: stamp(raw.at),
    actorId: link(raw.actorId), actorName: text(raw.actorName) || 'Системный процесс',
    field: text(raw.field), label: text(raw.label || raw.field),
    previousValue: raw.previousValue ?? null, newValue: raw.newValue ?? null,
    previousDisplay: text(raw.previousDisplay), newDisplay: text(raw.newDisplay),
    reason: text(raw.reason),
  };
}

export function normalizeDealNotification(raw = {}) {
  return {
    ...raw,
    id: text(raw.id), stepId: link(raw.stepId), dealId: link(raw.dealId), employeeId: link(raw.employeeId),
    kind: text(raw.kind) || 'overdue', active: raw.active === true,
    overdueDays: Math.max(0, Math.floor(Number(raw.overdueDays) || 0)),
    createdAt: stamp(raw.createdAt), updatedAt: stamp(raw.updatedAt, stamp(raw.createdAt)),
    readAt: raw.readAt ? stamp(raw.readAt) : null,
  };
}

/** Pure overdue projection. Reading a notification never changes `active`. */
export function projectOverdue(steps = [], notifications = [], now = new Date()) {
  const nextSteps = steps.map((raw) => {
    const step = normalizeDealStep(raw);
    return { ...step, overdueDays: step.status === 'active' ? overdueDays(step.due, now) : 0 };
  });
  // Index the very objects returned to the caller. Updating a separate
  // normalized copy would leave the stored notification's day count stale.
  const nextNotifications = notifications.map(normalizeDealNotification);
  const byStep = new Map(nextNotifications.map((row) => [row.stepId, row]));
  for (const step of nextSteps) {
    if (step.status !== 'active') continue;
    const days = step.overdueDays;
    let note = byStep.get(step.id);
    if (!note && days > 0) {
      note = normalizeDealNotification({
        id: `overdue-${step.id}`, stepId: step.id, dealId: step.dealId, employeeId: step.employeeId,
        active: true, overdueDays: days, createdAt: now instanceof Date ? now.getTime() : Number(now), updatedAt: now instanceof Date ? now.getTime() : Number(now),
      });
      nextNotifications.push(note);
      byStep.set(step.id, note);
      continue;
    }
    if (!note) continue;
    note.dealId = step.dealId;
    note.employeeId = step.employeeId;
    note.overdueDays = days;
    note.active = days > 0;
    note.updatedAt = now instanceof Date ? now.getTime() : Number(now);
  }
  // A cancelled/completed step has no current notification, even if unread.
  const activeIds = new Set(nextSteps.filter((step) => step.status === 'active').map((step) => step.id));
  for (const note of nextNotifications) if (!activeIds.has(note.stepId)) note.active = false;
  return { steps: nextSteps, notifications: nextNotifications };
}

export function activeStepFor(steps, dealId) {
  return steps.find((step) => step.dealId === dealId && step.status === 'active') || null;
}

export function assertOneActiveStep(steps, dealId) {
  const count = steps.filter((step) => step.dealId === dealId && step.status === 'active').length;
  if (count > 1) throw new Error('У сделки не может быть двух активных следующих шагов');
}
