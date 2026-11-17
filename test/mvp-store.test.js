import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/lib/store.js';
import { composeDealName } from '../src/lib/mvp.js';

let kvData;

async function freshStore() {
  const store = new Store();
  await store.init();
  return store;
}

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

describe('MVP v2.1 lead and deal rules', () => {
  it('converts a qualified lead once, copies its links, and never synchronises afterwards', async () => {
    const store = await freshStore();
    const company = await store.addCompany({ name: 'Клиент' });
    const partner = await store.addCompany({ name: 'Партнёр' });
    const contact = await store.addContact({ name: 'Иванов', companyId: company.id });
    const lead = await store.addLead({
      name: 'Внедрение CRM', status: 'Новый', companyId: company.id,
      partnerId: partner.id, contactId: contact.id, product: 'Платформа', subproduct: 'CRM',
    });
    await expect(store.convertLeadToDeal(lead.id)).rejects.toThrow('квалифицированный');
    await store.updateLead(lead.id, { status: 'Квалифицирован', stage: 'l3' });
    const deal = await store.convertLeadToDeal(lead.id);
    expect(deal).toMatchObject({
      companyId: company.id, partnerId: partner.id, contactId: contact.id,
      product: 'Платформа', subproduct: 'CRM', sourceLeadId: lead.id,
    });
    expect(store.leadById(lead.id)).toMatchObject({ status: 'Закрыт', convertedDealId: deal.id });
    await expect(store.convertLeadToDeal(lead.id)).rejects.toThrow('уже переведён');
    await store.updateLead(lead.id, { product: 'ИИ', subproduct: 'Ассистент' });
    expect(store.dealById(deal.id)).toMatchObject({ product: 'Платформа', subproduct: 'CRM' });
    const withoutCompany = await store.addLead({ name: 'Без контрагента', status: 'Квалифицирован' });
    await expect(store.convertLeadToDeal(withoutCompany.id)).rejects.toThrow('укажите контрагента');
  });

  it('does not reopen a disqualified lead', async () => {
    const store = await freshStore();
    const lead = await store.addLead({ name: 'Непрофильный' });
    await store.updateLead(lead.id, { status: 'Дисквалифицирован', closeReason: 'Не наш профиль' });
    await expect(store.updateLead(lead.id, { status: 'В работе' })).rejects.toThrow('нельзя открыть повторно');
    expect(store.leadById(lead.id).status).toBe('Дисквалифицирован');
  });

  it('keeps exactly one primary employee in each non-empty isolated sales team', async () => {
    const store = await freshStore();
    const a = await store.addEmployee({ name: 'A' });
    const b = await store.addEmployee({ name: 'B' });
    const first = await store.addDeal({ name: 'Первая' });
    const second = await store.addDeal({ name: 'Вторая' });
    await store.setSalesTeam(first.id, [
      { employeeId: a.id, primary: true }, { employeeId: b.id, primary: true }, { employeeId: a.id },
    ]);
    await store.setSalesTeam(second.id, [{ employeeId: b.id }]);
    expect(store.salesTeamFor(first.id)).toHaveLength(2);
    expect(store.salesTeamFor(first.id).filter((row) => row.primary)).toHaveLength(1);
    expect(store.salesTeamFor(second.id)).toHaveLength(1);
    expect(store.salesTeamFor(second.id)[0]).toMatchObject({ employeeId: b.id, primary: true });
  });

  it('requires valid closure data and forbids future customer events', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Сделка', stage: 's5' });
    await expect(store.updateDeal(deal.id, { outcome: 'Проиграна' })).rejects.toThrow('причину');
    await expect(store.updateDeal(deal.id, {
      outcome: 'Проиграна', closeReason: 'Выбран другой поставщик', winner: 'Победителя нет',
    })).rejects.toThrow('нельзя');
    await store.updateDeal(deal.id, {
      outcome: 'Проиграна', winner: 'Неизвестно', closeReason: 'Цена или коммерческие условия',
    });
    expect(store.dealById(deal.id)).toMatchObject({
      stage: 'lost', status: 'Завершена', outcome: 'Проиграна', winner: 'Неизвестно',
    });
    await store.updateDeal(deal.id, { outcome: 'Выиграна' });
    expect(store.dealById(deal.id)).toMatchObject({ stage: 'won', status: 'Завершена', outcome: 'Выиграна' });
    expect(store.dealById(deal.id).closedAt).toBeTypeOf('number');
    await expect(store.addActivity({ summary: 'Будущее', date: '2999-01-01', dealId: deal.id }))
      .rejects.toThrow('будущим');
    const activity = await store.addActivity({
      summary: 'Прошлое', date: '2026-01-10', dealId: deal.id, stepAction: 'keep',
    });
    await expect(store.updateActivity(activity.id, { date: '2999-01-01' })).rejects.toThrow('нельзя редактировать');
  });
});

describe('MVP v2.1 payments and append-only history', () => {
  it('migrates a legacy deal amount into one payment and derives totals from payments', async () => {
    kvData.set('crm:deals:v1', JSON.stringify([{
      id: 'legacy', name: 'Старая сделка', stage: 'proposal', value: 12000,
      createdAt: 1000, updatedAt: 1000,
    }]));
    const store = await freshStore();
    expect(store.dealById('legacy')).toMatchObject({ stage: 's5', value: 12000 });
    expect(store.paymentsFor('legacy')).toHaveLength(1);
    expect(store.paymentsFor('legacy')[0].amount).toBe(12000);
    await store.addPayment({ dealId: 'legacy', amount: 3000, fiscalYear: 2028, quarter: 'Q1' });
    expect(store.dealById('legacy').value).toBe(15000);
    await store.updateDeal('legacy', { value: 999999, status: 'Активно' });
    expect(store.dealById('legacy').value).toBe(15000);
  });

  it('keeps every regression without a history limit and does not duplicate entries on reload', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Длинная история' });
    for (let index = 0; index < 65; index++) {
      await store.moveDeal(deal.id, index % 2 ? 's1' : 's2');
    }
    const before = store.dealStageHistoryFor(deal.id);
    expect(before).toHaveLength(66);
    expect(before.filter((row) => row.previousStage === 's2' && row.newStage === 's1')).toHaveLength(32);
    expect(store.dealById(deal.id).stageHistory).toHaveLength(66);
    const reloaded = await freshStore();
    expect(reloaded.dealStageHistoryFor(deal.id)).toHaveLength(66);
    expect(new Set(reloaded.dealStageHistoryFor(deal.id).map((row) => row.id)).size).toBe(66);
  });
});

describe('MVP v2.1 delete, merge and restore links', () => {
  it('edits one company team without reassigning other companies’ team rows', async () => {
    const store = await freshStore();
    const first = await store.addCompany({ name: 'Первая' });
    const second = await store.addCompany({ name: 'Вторая' });
    const a = await store.addContact({ name: 'A', companyId: first.id });
    const b = await store.addContact({ name: 'B', companyId: second.id });
    await store.setCompanyTeam(first.id, [{ contactId: a.id, role: 'Чемпион' }]);
    await store.setCompanyTeam(second.id, [{ contactId: b.id, role: 'ИБ' }]);
    const foreign = store.companyTeamFor(second.id)[0];
    await store.setCompanyTeam(first.id, [...store.companyTeam,
      { companyId: first.id, contactId: b.id, role: 'Закупки' }]);
    expect(store.companyTeamFor(first.id)).toHaveLength(2);
    expect(store.companyTeamFor(second.id)).toHaveLength(1);
    expect(store.companyTeamFor(second.id)[0]).toMatchObject({ id: foreign.id, companyId: second.id, contactId: b.id });
  });

  it('restores every company link, including partner, competitor, child and team rows', async () => {
    const store = await freshStore();
    const company = await store.addCompany({ name: 'Головная' });
    const child = await store.addCompany({ name: 'Дочерняя', parentCompanyId: company.id });
    const contact = await store.addContact({ name: 'Контакт', companyId: company.id });
    const deal = await store.addDeal({
      name: 'Сделка', companyId: company.id, partnerId: company.id, competitorIds: [company.id],
    });
    const lead = await store.addLead({ name: 'Лид', companyId: company.id, partnerId: company.id });
    const task = await store.addTask({ title: 'Задача', companyId: company.id });
    const activity = await store.addActivity({ summary: 'Событие', companyId: company.id });
    await store.setCompanyTeam(company.id, [{ contactId: contact.id, role: 'Чемпион' }]);

    const entry = await store.deleteCompany(company.id);
    expect(store.companyById(child.id).parentCompanyId).toBeNull();
    expect(store.dealById(deal.id)).toMatchObject({ companyId: null, partnerId: null, competitorIds: [] });
    expect(store.leadById(lead.id)).toMatchObject({ companyId: null, partnerId: null });
    expect(store.tasks.find((row) => row.id === task.id).companyId).toBeNull();
    expect(store.activities.find((row) => row.id === activity.id).companyId).toBeNull();
    expect(store.companyTeam).toEqual([]);

    await store.restoreTrash(entry.id);
    expect(store.companyById(child.id).parentCompanyId).toBe(company.id);
    expect(store.contactById(contact.id).companyId).toBe(company.id);
    expect(store.dealById(deal.id)).toMatchObject({
      companyId: company.id, partnerId: company.id, competitorIds: [company.id],
    });
    expect(store.leadById(lead.id)).toMatchObject({ companyId: company.id, partnerId: company.id });
    expect(store.tasks.find((row) => row.id === task.id).companyId).toBe(company.id);
    expect(store.activities.find((row) => row.id === activity.id).companyId).toBe(company.id);
    expect(store.companyTeamFor(company.id)).toHaveLength(1);
  });

  it('restores contact-specific deal roles, lead links and company team membership', async () => {
    const store = await freshStore();
    const company = await store.addCompany({ name: 'Клиент' });
    const contact = await store.addContact({ name: 'ЛПР', companyId: company.id });
    const deal = await store.addDeal({
      name: 'Сделка', contactId: contact.id,
      economicBuyerContactId: contact.id, championContactId: contact.id,
    });
    const lead = await store.addLead({ name: 'Лид', contactId: contact.id });
    await store.setCompanyTeam(company.id, [{ contactId: contact.id, role: 'ЛПР' }]);
    const entry = await store.deleteContact(contact.id);
    expect(store.dealById(deal.id)).toMatchObject({
      contactId: null, economicBuyerContactId: null, championContactId: null,
    });
    expect(store.leadById(lead.id).contactId).toBeNull();
    expect(store.companyTeam).toEqual([]);
    await store.restoreTrash(entry.id);
    expect(store.dealById(deal.id)).toMatchObject({
      contactId: contact.id, economicBuyerContactId: contact.id, championContactId: contact.id,
    });
    expect(store.leadById(lead.id).contactId).toBe(contact.id);
    expect(store.companyTeamFor(company.id)).toHaveLength(1);
  });

  it('holds payments and sales team with a trashed deal and restores them without touching history', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Продавец' });
    const deal = await store.addDeal({ name: 'Сделка' });
    const payment = await store.addPayment({ dealId: deal.id, amount: 5000 });
    await store.setSalesTeam(deal.id, [{ employeeId: employee.id, primary: true }]);
    const history = store.dealStageHistoryFor(deal.id);
    const entry = await store.deleteDeal(deal.id);
    expect(store.payments).toEqual([]);
    expect(store.salesTeam).toEqual([]);
    expect(store.dealStageHistoryFor(deal.id)).toEqual(history);
    await store.restoreTrash(entry.id);
    expect(store.paymentsFor(deal.id).map((row) => row.id)).toEqual([payment.id]);
    expect(store.salesTeamFor(deal.id)).toHaveLength(1);
    expect(store.dealStageHistoryFor(deal.id)).toEqual(history);
  });

  it('re-points new company and contact references on merge', async () => {
    const store = await freshStore();
    const keep = await store.addCompany({ name: 'Основная' });
    const dupe = await store.addCompany({ name: 'Дубль' });
    const contactKeep = await store.addContact({ name: 'Контакт' });
    const contactDupe = await store.addContact({ name: 'Контакт-дубль' });
    const child = await store.addCompany({ name: 'Дочерняя', parentCompanyId: dupe.id });
    const deal = await store.addDeal({
      name: 'Сделка', companyId: dupe.id, partnerId: dupe.id, competitorIds: [keep.id, dupe.id],
      contactId: contactDupe.id, economicBuyerContactId: contactDupe.id,
    });
    const lead = await store.addLead({ name: 'Лид', companyId: dupe.id, contactId: contactDupe.id });
    await store.setCompanyTeam(dupe.id, [{ contactId: contactDupe.id, role: 'ЛПР' }]);
    await store.mergeContacts(contactKeep.id, contactDupe.id);
    await store.mergeCompanies(keep.id, dupe.id);
    expect(store.companyById(child.id).parentCompanyId).toBe(keep.id);
    expect(store.dealById(deal.id)).toMatchObject({
      companyId: keep.id, partnerId: keep.id, competitorIds: [keep.id],
      contactId: contactKeep.id, economicBuyerContactId: contactKeep.id,
    });
    expect(store.leadById(lead.id)).toMatchObject({ companyId: keep.id, contactId: contactKeep.id });
    expect(store.companyTeamFor(keep.id)).toHaveLength(1);
    expect(store.companyTeamFor(keep.id)[0].contactId).toBe(contactKeep.id);
  });
});


describe('deal card editing and mixed sales teams', () => {
  it('builds a deal name from company, product, subproduct and topic', () => {
    expect(composeDealName({ companyName: 'Авандок', product: 'Платформа', subproduct: 'CRM', topic: 'Внедрение продаж' }))
      .toBe('Авандок · Платформа · CRM · Внедрение продаж');
    expect(composeDealName({ companyName: 'Авандок', topic: 'CRM' })).toBe('Авандок · CRM');
    expect(composeDealName({ companyName: 'Авандок' }, 'Прежнее название')).toBe('Прежнее название');
  });

  it('allows partner contacts while only an employee can be primary', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Продавец' });
    const contact = await store.addContact({ name: 'Внешний партнёр' });
    const deal = await store.addDeal({ name: 'Сделка' });
    await store.setSalesTeam(deal.id, [{ contactId: contact.id, role: 'Партнёр' }]);
    expect(store.salesTeamFor(deal.id)).toHaveLength(1);
    expect(store.salesTeamFor(deal.id)[0]).toMatchObject({ contactId: contact.id, employeeId: null, primary: false });
    await store.setSalesTeam(deal.id, [...store.salesTeam, { dealId: deal.id, employeeId: employee.id }]);
    expect(store.salesTeamFor(deal.id)).toHaveLength(2);
    expect(store.salesTeamFor(deal.id).filter((row) => row.primary)).toHaveLength(1);
    expect(store.salesTeamFor(deal.id).find((row) => row.primary).employeeId).toBe(employee.id);
  });

  it('assigns the signed-in employee as the primary owner of a new deal', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Текущий пользователь', username: 'tester' });
    const deal = await store.addDeal({ name: 'Новая сделка' });
    expect(store.salesTeamFor(deal.id)).toHaveLength(1);
    expect(store.salesTeamFor(deal.id)[0]).toMatchObject({ employeeId: employee.id, primary: true });
  });

  it('touches the deal update stamp for payments, team, tasks and events', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Продавец' });
    const deal = await store.addDeal({ name: 'Сделка' });
    const expectTouch = async (run) => {
      store.dealById(deal.id).updatedAt = 1;
      await run();
      expect(store.dealById(deal.id).updatedAt).toBeGreaterThan(1);
    };
    let payment;
    await expectTouch(async () => { payment = await store.addPayment({ dealId: deal.id, amount: 100 }); });
    await expectTouch(() => store.updatePayment(payment.id, { amount: 200 }));
    await expectTouch(() => store.deletePayment(payment.id));
    await expectTouch(() => store.setSalesTeam(deal.id, [{ employeeId: employee.id }]));
    let task;
    await expectTouch(async () => { task = await store.addTask({ title: 'Следующий шаг', dealId: deal.id, employeeId: employee.id }); });
    await expectTouch(() => store.updateTask(task.id, { title: 'Уточнённый шаг' }));
    await expectTouch(() => store.toggleTask(task.id, true));
    await expectTouch(() => store.deleteTask(task.id));
    let activity;
    await expectTouch(async () => {
      activity = await store.addActivity({
        summary: 'Звонок', date: '2026-01-10', dealId: deal.id,
        nextStepText: 'Отправить итоги', nextStepDate: '2026-01-11', assigneeId: employee.id,
      });
    });
    expect(activity.appendOnly).toBe(true);
    await expect(store.updateActivity(activity.id, { summary: 'Состоявшийся звонок' })).rejects.toThrow('нельзя редактировать');
    await expect(store.deleteActivity(activity.id)).rejects.toThrow('нельзя удалять');
  });

  it('removes and restores contact membership in a sales team with the contact', async () => {
    const store = await freshStore();
    const contact = await store.addContact({ name: 'Партнёр' });
    const deal = await store.addDeal({ name: 'Сделка', contactId: contact.id });
    await store.setSalesTeam(deal.id, [{ contactId: contact.id, role: 'Партнёр' }]);
    const entry = await store.deleteContact(contact.id);
    expect(store.salesTeamFor(deal.id)).toEqual([]);
    await store.restoreTrash(entry.id);
    expect(store.salesTeamFor(deal.id)).toHaveLength(1);
    expect(store.salesTeamFor(deal.id)[0].contactId).toBe(contact.id);
  });
});


describe('November 2026 entity-card regressions', () => {
  it('assigns the signed-in employee to every newly created primary entity', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Текущий пользователь', username: 'tester' });
    const company = await store.addCompany({ name: 'Клиент' });
    const contact = await store.addContact({ name: 'Контакт' });
    const lead = await store.addLead({ name: 'Лид' });
    const deal = await store.addDeal({ name: 'Сделка' });
    const task = await store.addTask({ title: 'Задача' });
    const activity = await store.addActivity({ summary: 'Событие', date: '2026-01-10' });
    for (const record of [company, contact, lead, deal, task, activity]) {
      expect(record.employeeId).toBe(employee.id);
    }
  });

  it('normalizes forecast inclusion, payment probability and participant position', async () => {
    const store = await freshStore();
    const contact = await store.addContact({ name: 'ЛПР' });
    const deal = await store.addDeal({
      name: 'Сделка', includeInForecastFY: 'yes',
      contacts: [{ contactId: contact.id, role: 'decision', influence: 'high', position: 'Финансовый директор' }],
    });
    expect(deal.includeInForecastFY).toBe('yes');
    expect(deal.contacts[0]).toMatchObject({ position: 'Финансовый директор' });
    await store.updateDeal(deal.id, { includeInForecastFY: 'no' });
    expect(store.dealById(deal.id).includeInForecastFY).toBe('no');
    await store.updateDeal(deal.id, { includeInForecastFY: 'invalid' });
    expect(store.dealById(deal.id).includeInForecastFY).toBe('');

    const payment = await store.addPayment({ dealId: deal.id, amount: 1000, probability: 'Высокая' });
    expect(payment.probability).toBe('Высокая');
    await store.updatePayment(payment.id, { probability: 'Средняя' });
    expect(store.payments.find((row) => row.id === payment.id).probability).toBe('Средняя');
    await store.updatePayment(payment.id, { probability: 'unknown' });
    expect(store.payments.find((row) => row.id === payment.id).probability).toBe('');
  });

  it('keeps separate field journals with actor and readable values', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Текущий пользователь', username: 'tester' });
    const secondEmployee = await store.addEmployee({ name: 'Второй сотрудник' });
    const company = await store.addCompany({ name: 'Старое название' });
    const contact = await store.addContact({ name: 'Старый контакт' });
    const lead = await store.addLead({ name: 'Лид', stage: 'l0', phone: '+7 900 000-00-00' });

    await store.updateCompany(company.id, { name: 'Новое название', employeeId: secondEmployee.id });
    await store.updateContact(contact.id, { title: 'Директор', employeeId: secondEmployee.id });
    await store.updateLead(lead.id, { stage: 'l2', phone: '+7 900 111-11-11' });

    expect(store.entityFieldHistoryFor('company', company.id).map((row) => row.field))
      .toEqual(expect.arrayContaining(['name', 'employeeId']));
    expect(store.entityFieldHistoryFor('contact', contact.id)[0]).toMatchObject({
      entityType: 'contact', entityId: contact.id, actorId: employee.id, actorName: employee.name,
    });
    const leadRows = store.entityFieldHistoryFor('lead', lead.id);
    expect(leadRows.map((row) => row.field)).toEqual(expect.arrayContaining(['stage', 'phone']));
    expect(leadRows.every((row) => row.actorId === employee.id)).toBe(true);
    expect(store.leadStageHistoryFor(lead.id).at(-1)).toMatchObject({
      previousStage: 'l0', newStage: 'l2', actorId: employee.id, actorName: employee.name,
    });
    expect(store.dealFieldHistoryFor(lead.id)).toEqual([]);
  });

  it('rejects clearing required inline names', async () => {
    const store = await freshStore();
    const company = await store.addCompany({ name: 'Клиент' });
    const contact = await store.addContact({ name: 'Контакт' });
    await expect(store.updateCompany(company.id, { name: '  ' })).rejects.toThrow('название контрагента');
    await expect(store.updateContact(contact.id, { name: '' })).rejects.toThrow('ФИО контакта');
    expect(store.companyById(company.id).name).toBe('Клиент');
    expect(store.contactById(contact.id).name).toBe('Контакт');
  });
});

describe('administrator-only destructive store operations', () => {
  it('blocks direct, bulk, merge, undo and trash deletion for managers', async () => {
    const store = await freshStore();
    const employee = await store.addEmployee({ name: 'Сотрудник' });
    const company = await store.addCompany({ name: 'Клиент' });
    const companyDupe = await store.addCompany({ name: 'Дубль клиента' });
    const contact = await store.addContact({ name: 'Контакт' });
    const contactDupe = await store.addContact({ name: 'Дубль контакта' });
    const lead = await store.addLead({ name: 'Лид' });
    const deal = await store.addDeal({ name: 'Сделка' });
    const payment = await store.addPayment({ dealId: deal.id, amount: 100 });
    const task = await store.addTask({ title: 'Задача', employeeId: employee.id });
    const activity = await store.addActivity({ summary: 'Событие', date: '2026-01-10' });
    const template = await store.addTemplate({ name: 'Шаблон', subject: 'Тема', body: 'Текст' });
    store.user = { ...store.user, role: 'manager' };

    const removals = [
      () => store.deleteCompany(company.id),
      () => store.deleteContact(contact.id),
      () => store.deleteEmployee(employee.id),
      () => store.deleteLead(lead.id),
      () => store.deleteDeal(deal.id),
      () => store.deletePayment(payment.id),
      () => store.deleteActivity(activity.id),
      () => store.deleteTask(task.id),
      () => store.deleteTemplate(template.id),
      () => store.bulkDelete('companies', [companyDupe.id]),
      () => store.mergeContacts(contact.id, contactDupe.id),
      () => store.mergeCompanies(company.id, companyDupe.id),
      () => store.undoAddedTasks([task.id]),
      () => store.emptyTrash(),
      () => store.importAll(store.exportAll()),
    ];
    for (const remove of removals) {
      await expect(remove()).rejects.toThrow('только администратору');
    }
    expect(store.companies).toHaveLength(2);
    expect(store.contacts).toHaveLength(2);
    expect(store.deals).toHaveLength(1);
    expect(store.tasks).toHaveLength(1);
  });

  it('blocks snapshot restore for managers and all writes for viewers', async () => {
    const store = await freshStore();
    await store.addCompany({ name: 'Клиент' });
    await store.saveSnapshot('test');
    store.user = { ...store.user, role: 'manager' };
    await expect(store.restoreBackup()).rejects.toThrow('только администратору');
    store.user = { ...store.user, role: 'viewer' };
    await expect(store.addContact({ name: 'Запрещено' })).rejects.toThrow('read_only');
    await expect(store.deleteCompany(store.companies[0].id)).rejects.toThrow('read_only');
  });

  it('lets managers edit configuration but reserves removals for administrators', async () => {
    const store = await freshStore();
    store.user = { ...store.user, role: 'manager' };
    await store.setPlaybooks([{ id: 'new', name: 'Сценарий', steps: [{ title: 'Шаг', offset: 0 }] }]);
    await expect(store.setPlaybooks([])).rejects.toThrow('только администратору');
    const key = 'products';
    const before = store.settings.dictionaries[key];
    await store.updateDictionary(key, [...before, 'Новый продукт']);
    await expect(store.updateDictionary(key, before)).rejects.toThrow('только администратору');
    const view = { id: 'v1', name: 'Мой фильтр', filters: { status: 'cold' } };
    await store.setViews('contacts', [view]);
    await expect(store.setViews('contacts', [])).rejects.toThrow('только администратору');
    expect(store.views('contacts')).toHaveLength(1);
  });
});
