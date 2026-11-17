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

async function createTask(store, deal, assignee, data = {}) {
  const { operationId = `create-task-${Math.random()}`, ...fields } = data;
  return store.addDealTask(deal.id, {
    title: 'Связаться с клиентом', due: addDays(todayISO(), 1),
    employeeId: assignee.id, ...fields,
  }, { expectedRevision: store.dealById(deal.id).revision, operationId });
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

describe('independent deal tasks and simple timeline records', () => {
  it('creates a marked task with an automatic record and separate author/assignee', async () => {
    const { store, author, assignee, deal } = await setup();
    const task = await createTask(store, deal, assignee, { operationId: 'create-main' });
    expect(store.activeDealTask(deal.id)).toMatchObject({
      id: task.id, isNextStep: true, employeeId: assignee.id,
      title: 'Связаться с клиентом', createdBy: author.id,
    });
    const activity = store.activities.find((row) => row.operationId === 'create-main');
    expect(activity).toMatchObject({
      employeeId: author.id, appendOnly: true, taskId: task.id, taskOperation: 'create',
      summary: 'Создана задача: Связаться с клиентом', stage: 's2',
    });
  });

  it('adds simple records idempotently without changing stage or tasks', async () => {
    const { store, assignee, deal } = await setup();
    const task = await createTask(store, deal, assignee);
    const before = { stage: store.dealById(deal.id).stage, revision: task.revision, tasks: store.tasks.length };
    const first = await store.addDealRecord(deal.id, { summary: 'Провели демо' }, {
      expectedRevision: store.dealById(deal.id).revision, operationId: 'record-same',
    });
    const retry = await store.addDealRecord(deal.id, { summary: 'Повтор' }, { expectedRevision: 1, operationId: 'record-same' });
    expect(retry.id).toBe(first.id);
    expect(store.activities.filter((row) => row.operationId === 'record-same')).toHaveLength(1);
    expect(store.dealById(deal.id).stage).toBe(before.stage);
    expect(store.tasks.find((row) => row.id === task.id).revision).toBe(before.revision);
    expect(store.tasks).toHaveLength(before.tasks);
    await expect(store.addDealRecord(deal.id, { summary: 'Конфликт' }, {
      expectedRevision: 1, operationId: 'record-stale',
    })).rejects.toMatchObject({ code: 'STALE_DEAL' });
  });

  it('validates assignee and edits inline without a mandatory reason or timeline entry', async () => {
    const { store, assignee, deal } = await setup();
    await expect(createTask(store, deal, { id: 'missing' })).rejects.toThrow('активного ответственного');
    const task = await createTask(store, deal, assignee);
    const activities = store.activities.length;
    const originalDue = store.tasks.find((row) => row.id === task.id).due;
    const newDue = addDays(todayISO(), 3);
    await store.updateDealTask(task.id, { title: 'Уточнённое действие', due: newDue });
    const changed = store.tasks.find((row) => row.id === task.id);
    expect(changed).toMatchObject({ title: 'Уточнённое действие', due: newDue, originalDue });
    expect(changed.changes.at(-1)).toMatchObject({ field: 'due', reason: '' });
    expect(store.dealFieldHistoryFor(deal.id).some((row) => row.taskId === task.id && row.field === 'task.due')).toBe(true);
    expect(store.activities).toHaveLength(activities);
  });

  it('keeps multiple open tasks, transfers one marker and never auto-assigns after completion', async () => {
    const { store, assignee, deal } = await setup();
    const first = await createTask(store, deal, assignee);
    const second = await createTask(store, deal, assignee, { title: 'Подготовить демо' });
    expect(first.isNextStep).toBe(true);
    expect(second.isNextStep).toBe(false);
    expect(store.dealFieldHistoryFor(deal.id).some((row) => row.taskId === second.id
      && row.field === 'task.isNextStep' && row.previousDisplay === row.newDisplay)).toBe(false);
    await store.setDealNextStep(second.id, { expectedRevision: store.dealById(deal.id).revision });
    expect(store.activeDealTask(deal.id).id).toBe(second.id);
    expect(store.tasks.find((row) => row.id === first.id)).toMatchObject({ isNextStep: false, done: false });
    await store.completeDealTask(second.id, { expectedRevision: store.dealById(deal.id).revision });
    expect(store.activeDealTask(deal.id)).toBeNull();
    expect(store.tasks.find((row) => row.id === first.id).done).toBe(false);
    const third = await createTask(store, deal, assignee, { title: 'Дополнительная проверка' });
    expect(third.isNextStep).toBe(false);
  });

  it('cancels only the selected task and leaves tasks unchanged on stage close', async () => {
    const { store, assignee, deal } = await setup();
    const first = await createTask(store, deal, assignee);
    const second = await createTask(store, deal, assignee, { title: 'Presale' });
    await store.updateDeal(deal.id, { stage: 'won' });
    expect(store.tasks.find((row) => row.id === first.id).done).toBe(false);
    expect(store.tasks.find((row) => row.id === second.id).done).toBe(false);
    await store.cancelDealTask(second.id);
    expect(store.tasks.find((row) => row.id === second.id).status).toBe('Отменена');
    expect(store.tasks.find((row) => row.id === first.id).status).toBe('К выполнению');
    await store.addDealRecord(deal.id, { summary: 'Запись после закрытия' });
    expect(store.activeDealTask(deal.id).id).toBe(first.id);
  });

  it('writes exactly one automatic record for create, complete and cancel', async () => {
    const { store, assignee, deal } = await setup();
    const first = await createTask(store, deal, assignee);
    const second = await createTask(store, deal, assignee, { title: 'Отменяемая задача' });
    await store.completeDealTask(first.id);
    await store.cancelDealTask(second.id);
    const automatic = store.activities.filter((row) => [first.id, second.id].includes(row.taskId));
    expect(automatic).toHaveLength(4);
    expect(automatic.map((row) => row.taskOperation).sort()).toEqual(['cancel', 'complete', 'create', 'create']);
    expect(automatic.some((row) => row.summary === 'Выполнена задача: Связаться с клиентом')).toBe(true);
    expect(automatic.some((row) => row.summary === 'Отменена задача: Отменяемая задача')).toBe(true);
  });

  it('tracks overdue independently for every open task and responsible employee', async () => {
    const { store, assignee, deal } = await setup();
    const first = await createTask(store, deal, assignee, { due: addDays(todayISO(), -2) });
    const second = await createTask(store, deal, assignee, { title: 'Просрочка presale', due: addDays(todayISO(), -1) });
    expect(store.dealNotificationsFor(assignee.id)).toHaveLength(2);
    await store.completeDealTask(first.id);
    expect(store.dealNotifications.filter((row) => row.taskId === first.id)[0].active).toBe(false);
    expect(store.dealNotificationsFor(assignee.id)).toHaveLength(1);
    const note = store.dealNotificationsFor(assignee.id)[0];
    expect(note.taskId).toBe(second.id);
    await store.markDealNotificationRead(note.id);
    await store.recalculateOverdue(new Date(`${addDays(todayISO(), 2)}T12:00:00Z`));
    const reread = store.dealNotificationsFor(assignee.id)[0];
    expect(reread).toMatchObject({ taskId: second.id, active: true, readAt: expect.any(Number) });
    expect(reread.overdueDays).toBeGreaterThan(1);
  });

  it('migrates an existing active step into its matching task without a duplicate', async () => {
    const employee = { id: 'e1', name: 'Менеджер', username: 'tester', active: true };
    kvData.set('crm:employees:v1', JSON.stringify([employee]));
    kvData.set('crm:deals:v1', JSON.stringify([{ id: 'd1', name: 'Старая сделка', stage: 's2', revision: 1 }]));
    kvData.set('crm:tasks:v1', JSON.stringify([{ id: 'task-1', dealId: 'd1', title: 'Позвонить', due: '2026-11-18', employeeId: 'e1' }]));
    kvData.set('crm:deal-steps:v1', JSON.stringify([
      { id: 'step-active', dealId: 'd1', action: 'Позвонить', due: '2026-11-18', employeeId: 'e1', status: 'active', originalDue: '2026-11-17', changes: [{ field: 'due' }] },
      { id: 'step-closed', dealId: 'd1', action: 'Старая история', due: '2026-11-01', employeeId: 'e1', status: 'completed', closedAt: 1 },
    ]));
    kvData.set('crm:deal-notifications:v1', JSON.stringify([{ id: 'note-1', stepId: 'step-active', dealId: 'd1', employeeId: 'e1', active: true }]));
    const store = new Store(); await store.init();
    expect(store.tasks.filter((row) => row.dealId === 'd1' && row.title === 'Позвонить')).toHaveLength(1);
    expect(store.activeDealTask('d1')).toMatchObject({ id: 'task-1', legacyStepId: 'step-active', originalDue: '2026-11-17' });
    expect(store.tasks.find((row) => row.id === 'step-closed').status).toBe('Выполнено');
    expect(store.dealNotifications[0]).toMatchObject({ taskId: 'task-1', stepId: 'task-1' });
    expect(store.dealSteps).toEqual([]);
  });

  it('restores task links and next marker while preserving audit journals', async () => {
    const { store, assignee, deal } = await setup();
    const task = await createTask(store, deal, assignee);
    const history = store.dealStageHistoryFor(deal.id);
    const entry = await store.deleteDeal(deal.id);
    expect(store.activeDealTask(deal.id)).toBeNull();
    expect(store.dealStageHistoryFor(deal.id)).toEqual(history);
    await store.restoreTrash(entry.id);
    expect(store.activeDealTask(deal.id).id).toBe(task.id);
    expect(store.dealStageHistoryFor(deal.id)).toEqual(history);
  });

  it('rolls back a failed atomic task save and rejects a stale marker transfer', async () => {
    const { store, assignee, deal } = await setup();
    const first = await createTask(store, deal, assignee);
    const second = await createTask(store, deal, assignee);
    const staleRevision = store.dealById(deal.id).revision;
    await store.setDealNextStep(second.id, { expectedRevision: staleRevision });
    await expect(store.setDealNextStep(first.id, { expectedRevision: staleRevision })).rejects.toMatchObject({ code: 'STALE_DEAL' });
    expect(store.activeDealTask(deal.id).id).toBe(second.id);

    puter.crm = { transaction: vi.fn(async () => { throw new Error('write failed'); }) };
    const beforeTasks = store.tasks.length;
    const beforeActivities = store.activities.length;
    await expect(store.addDealTask(deal.id, { title: 'Не сохранится', due: todayISO(), employeeId: assignee.id }, {
      expectedRevision: store.dealById(deal.id).revision, operationId: 'failed-task',
    })).rejects.toThrow('write failed');
    expect(store.tasks).toHaveLength(beforeTasks);
    expect(store.activities).toHaveLength(beforeActivities);
  });
});

describe('Moscow overdue calendar', () => {
  it('starts overdue on the next calendar day, independent of server timezone', () => {
    expect(moscowDate('2026-11-09T21:30:00Z')).toBe('2026-11-10');
    expect(overdueDays('2026-11-10', '2026-11-10T23:59:00+03:00')).toBe(0);
    expect(overdueDays('2026-11-10', '2026-11-11T00:00:00+03:00')).toBe(1);
  });
});
