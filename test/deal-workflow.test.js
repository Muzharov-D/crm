import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/lib/store.js';
import { moscowDate, overdueDays } from '../src/lib/deal-workflow.js';
import { addDays, todayISO } from '../src/lib/util.js';

let kvData;

beforeEach(() => {
  kvData = new Map();
  globalThis.puter = {
    env: 'web',
    kv: {
      get: vi.fn(async (key) => kvData.get(key) ?? null),
      set: vi.fn(async (key, value) => { kvData.set(key, value); return true; }),
    },
    fs: { write: vi.fn(), read: vi.fn(), delete: vi.fn(async () => {}) },
    auth: {
      getUser: vi.fn(async () => ({ username: 'tester', role: 'admin' })),
      isSignedIn: () => true,
    },
  };
});

async function setup() {
  const store = new Store();
  await store.init();
  const author = await store.addEmployee({ name: 'Автор', username: 'tester' });
  const assignee = await store.addEmployee({ name: 'Ответственный за шаг' });
  const deal = await store.addDeal({ name: 'Сделка', stage: 's2' });
  return { store, author, assignee, deal };
}

async function createStep(store, deal, assignee, data = {}) {
  return store.saveDealEvent(deal.id, {
    summary: 'Событие / результат',
    stepAction: 'create',
    nextStep: {
      action: 'Связаться с клиентом', due: addDays(todayISO(), 1),
      employeeId: assignee.id, ...data,
    },
  }, { expectedRevision: deal.revision, operationId: data.operationId || 'create-step' });
}

describe('deal amount and closure invariants', () => {
  it('distinguishes an empty manual estimate from explicit zero and payment totals', async () => {
    const { store, deal } = await setup();
    expect(store.dealById(deal.id)).toMatchObject({ amountMode: 'manual', manualValue: null, value: null });

    await store.setDealAmount(deal.id, { mode: 'manual', value: 0 });
    expect(store.dealById(deal.id)).toMatchObject({ manualValue: 0, value: 0 });
    await store.setDealAmount(deal.id, { mode: 'manual', value: null });
    expect(store.dealById(deal.id)).toMatchObject({ manualValue: null, value: null });

    await store.addPayment({ dealId: deal.id, amount: 12500 });
    expect(store.dealById(deal.id).value).toBeNull();
    await store.setDealAmount(deal.id, { mode: 'payments' });
    expect(store.dealById(deal.id)).toMatchObject({ amountMode: 'payments', value: 12500 });
    await store.setDealAmount(deal.id, { mode: 'manual', value: 7000 });
    expect(store.dealById(deal.id)).toMatchObject({ amountMode: 'manual', value: 7000 });
  });

  it('validates every terminal write and journals a corrected result', async () => {
    const { store, deal } = await setup();
    const competitor = await store.addCompany({ name: 'Конкурент' });
    const tomorrow = addDays(todayISO(), 1);
    await expect(store.updateDeal(deal.id, { stage: 'won', closedOn: tomorrow }))
      .rejects.toThrow('не может быть позже');
    await expect(store.updateDeal(deal.id, {
      stage: 'lost', closeReason: 'Выбран другой поставщик', winner: 'Победителя нет',
    })).rejects.toThrow('нельзя');
    await expect(store.updateDeal(deal.id, {
      stage: 'lost', closeReason: 'Другое', winner: 'Неизвестно',
    })).rejects.toThrow('комментарий');

    await store.updateDeal(deal.id, {
      stage: 'lost', closeReason: 'Выбран другой поставщик', winnerCompanyId: competitor.id,
    });
    expect(store.dealById(deal.id)).toMatchObject({
      stage: 'lost', outcome: 'Проиграна', status: 'Завершена', winner: 'Конкурент',
    });
    const historySize = store.dealFieldHistoryFor(deal.id).length;
    await store.updateDeal(deal.id, { stage: 'won' });
    expect(store.dealById(deal.id)).toMatchObject({ stage: 'won', outcome: 'Выиграна', status: 'Завершена' });
    expect(store.dealFieldHistoryFor(deal.id).length).toBeGreaterThan(historySize);
    expect(store.dealFieldHistoryFor(deal.id).some((row) => row.field === 'outcome' && row.newValue === 'Выиграна')).toBe(true);
  });

  it('does not journal no-op or failed saves', async () => {
    const { store, deal } = await setup();
    await store.updateDeal(deal.id, { topic: 'Тема' });
    const size = store.dealFieldHistoryFor(deal.id).length;
    await store.updateDeal(deal.id, { topic: 'Тема' });
    expect(store.dealFieldHistoryFor(deal.id)).toHaveLength(size);

    puter.crm = { transaction: vi.fn(async () => { throw new Error('write failed'); }) };
    await expect(store.updateDeal(deal.id, {
      stage: 'won', expectedRevision: store.dealById(deal.id).revision, operationId: 'failed-close',
    })).rejects.toThrow('write failed');
    expect(store.dealById(deal.id)).toMatchObject({ topic: 'Тема', stage: 's2' });
    expect(store.dealFieldHistoryFor(deal.id)).toHaveLength(size);
  });
});

describe('atomic deal events and next steps', () => {
  it('separates the immutable event author from the step assignee', async () => {
    const { store, author, assignee, deal } = await setup();
    const activity = await createStep(store, deal, assignee);
    const step = store.activeDealStep(deal.id);
    expect(activity).toMatchObject({ employeeId: author.id, appendOnly: true, newStepId: step.id });
    expect(step).toMatchObject({
      status: 'active', employeeId: assignee.id, createdBy: author.id,
      originalDue: step.due, action: 'Связаться с клиентом',
    });
    expect(store.dealStepsFor(deal.id).filter((row) => row.status === 'active')).toHaveLength(1);
  });

  it('recovers an idempotent retry and rejects a stale revision', async () => {
    const { store, assignee, deal } = await setup();
    const first = await createStep(store, deal, assignee, { operationId: 'same-operation' });
    const retry = await store.saveDealEvent(deal.id, {
      summary: 'Повторный запрос', stepAction: 'create',
    }, { expectedRevision: 1, operationId: 'same-operation' });
    expect(retry.id).toBe(first.id);
    expect(store.activities.filter((row) => row.dealId === deal.id)).toHaveLength(1);
    expect(store.dealStepsFor(deal.id)).toHaveLength(1);

    await expect(store.saveDealEvent(deal.id, {
      summary: 'Конфликт', stepAction: 'keep',
    }, { expectedRevision: 1, operationId: 'stale-operation' })).rejects.toMatchObject({ code: 'STALE_DEAL' });
    expect(store.activities.filter((row) => row.dealId === deal.id)).toHaveLength(1);
  });

  it('requires an active assignee and reasons for changes', async () => {
    const { store, assignee, deal } = await setup();
    await expect(createStep(store, deal, { id: 'missing' })).rejects.toThrow('активного ответственного');
    await createStep(store, deal, assignee);
    const step = store.activeDealStep(deal.id);
    await expect(store.saveDealEvent(deal.id, {
      summary: 'Перенос', stepAction: 'change',
      nextStep: { due: addDays(todayISO(), 3) },
    }, { expectedRevision: store.dealById(deal.id).revision })).rejects.toThrow('причину');

    await store.saveDealEvent(deal.id, {
      summary: 'Перенос согласован', stepAction: 'change', changeReason: 'Просьба клиента',
      nextStep: { due: addDays(todayISO(), 3), employeeId: assignee.id },
    }, { expectedRevision: store.dealById(deal.id).revision });
    const changed = store.activeDealStep(deal.id);
    expect(changed.id).toBe(step.id);
    expect(changed.originalDue).toBe(step.originalDue);
    expect(changed.due).not.toBe(step.due);
    expect(changed.changes.at(-1)).toMatchObject({ field: 'due', reason: 'Просьба клиента' });
  });

  it('closes and replaces steps atomically, and closes a terminal step without a replacement', async () => {
    const { store, assignee, deal } = await setup();
    await createStep(store, deal, assignee);
    const first = store.activeDealStep(deal.id);
    await store.saveDealEvent(deal.id, {
      summary: 'Шаг выполнен', stepAction: 'complete-next',
      nextStep: { action: 'Подписать договор', due: addDays(todayISO(), 2), employeeId: assignee.id },
    }, { expectedRevision: store.dealById(deal.id).revision });
    expect(store.dealStepsFor(deal.id).find((row) => row.id === first.id)).toMatchObject({ status: 'completed', closedBy: expect.any(String) });
    const second = store.activeDealStep(deal.id);
    expect(second.id).not.toBe(first.id);
    expect(store.dealStepsFor(deal.id).filter((row) => row.status === 'active')).toHaveLength(1);

    await store.updateDeal(deal.id, { stage: 'won' });
    await store.saveDealEvent(deal.id, {
      summary: 'Завершающее событие', stepAction: 'complete',
    }, { expectedRevision: store.dealById(deal.id).revision });
    expect(store.dealStepsFor(deal.id).find((row) => row.id === second.id).status).toBe('completed');
    expect(store.activeDealStep(deal.id)).toBeNull();
  });

  it('keeps one current overdue notification after reading and recalculation', async () => {
    const { store, assignee, deal } = await setup();
    await createStep(store, deal, assignee, { due: addDays(todayISO(), -1), operationId: 'overdue-create' });
    const step = store.activeDealStep(deal.id);
    expect(step.overdueDays).toBe(1);
    expect(store.dealNotificationsFor(assignee.id)).toHaveLength(1);
    const note = store.dealNotificationsFor(assignee.id)[0];
    await store.markDealNotificationRead(note.id);
    expect(store.dealNotificationsFor(assignee.id)[0]).toMatchObject({ active: true, readAt: expect.any(Number) });
    await store.recalculateOverdue(new Date(`${addDays(todayISO(), 2)}T12:00:00Z`));
    expect(store.dealNotifications.filter((row) => row.stepId === step.id)).toHaveLength(1);
    expect(store.dealNotificationsFor(assignee.id)[0].overdueDays).toBeGreaterThan(1);
  });

  it('restores working step collections while preserving the audit journals on delete', async () => {
    const { store, assignee, deal } = await setup();
    await createStep(store, deal, assignee);
    const history = store.dealStageHistoryFor(deal.id);
    const entry = await store.deleteDeal(deal.id);
    expect(store.dealStepsFor(deal.id)).toEqual([]);
    expect(store.dealStageHistoryFor(deal.id)).toEqual(history);
    await store.restoreTrash(entry.id);
    expect(store.dealStepsFor(deal.id).filter((row) => row.status === 'active')).toHaveLength(1);
    expect(store.dealStageHistoryFor(deal.id)).toEqual(history);
  });
});

describe('Moscow overdue calendar', () => {
  it('starts overdue on the next calendar day, independent of server timezone', () => {
    expect(moscowDate('2026-11-09T21:30:00Z')).toBe('2026-11-10');
    expect(overdueDays('2026-11-10', '2026-11-10T23:59:00+03:00')).toBe(0);
    expect(overdueDays('2026-11-10', '2026-11-11T00:00:00+03:00')).toBe(1);
  });
});
