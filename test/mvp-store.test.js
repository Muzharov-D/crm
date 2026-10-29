import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/lib/store.js';

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

  it('requires a winner on loss and forbids future customer events', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Сделка', stage: 's5' });
    await expect(store.updateDeal(deal.id, { outcome: 'Проиграна' })).rejects.toThrow('кто выиграл');
    await store.updateDeal(deal.id, { outcome: 'Проиграна', winner: 'Конкурент' });
    expect(store.dealById(deal.id)).toMatchObject({ stage: 's5', outcome: 'Проиграна', winner: 'Конкурент' });
    await expect(store.addActivity({ summary: 'Будущее', date: '2999-01-01', dealId: deal.id }))
      .rejects.toThrow('будущим');
    const activity = await store.addActivity({ summary: 'Прошлое', date: '2026-01-10', dealId: deal.id });
    await expect(store.updateActivity(activity.id, { date: '2999-01-01' })).rejects.toThrow('будущим');
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
