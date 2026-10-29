/** XLSX exchange for the MVP. Column matching accepts Russian business names. */
import * as XLSX from 'xlsx';
import { store } from './store.js';
import { DEAL_STAGES, LEAD_STAGES, dealTotals, fiscalYearQuarterForDate } from './spec.js';
import { todayISO } from './util.js';
import { downloadFile } from '../ui/download.js';

const clean = (v) => String(v ?? '').trim();
const money = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(clean(v).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const normalized = (v) => clean(v).toLowerCase().replace(/[ё]/g, 'е').replace(/[\s_./-]+/g, ' ');
const cell = (row, names) => {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => normalized(key) === normalized(name));
    if (found) return found[1];
  }
  return '';
};
const nameOf = (rows, id) => rows.find((r) => r.id === id)?.name || '';
const iso = (v) => {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return todayISO(v);
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = clean(v);
  const m = text.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
};

export function exportXlsx(kind, rows = null, filename = '') {
  const data = rows || store[kind] || [];
  let sheetRows;
  if (kind === 'deals') {
    sheetRows = data.map((d) => {
      const totals = dealTotals(d.id, store.payments);
      return {
        'Название': d.name, 'Контрагент': nameOf(store.companies, d.companyId), 'ИНН': store.companies.find((c) => c.id === d.companyId)?.inn || '',
        'Продукт': d.product, 'Подпродукт': d.subproduct,
        'Стадия': DEAL_STAGES.find((s) => s.id === d.stage)?.label || d.stage,
        'Статус': d.status, 'Исход': d.outcome, 'Категория вероятности': d.probabilityCategory,
        'Сумма без НДС': totals.total, 'Текущий ФГ': totals.currentFY, 'Следующий ФГ': totals.nextFY,
        'Партнёр': nameOf(store.companies, d.partnerId), 'Контакт': nameOf(store.contacts, d.contactId),
        'Ответственный': nameOf(store.employees, store.salesTeam.find((r) => r.dealId === d.id && r.primary)?.employeeId),
        'Следующий шаг': d.nextStepText, 'Дата следующего шага': d.nextStepDate,
        'Дата договора': d.contractDate, 'Дата старта работ': d.workStartDate,
        'Дата закрытия': d.closedAt ? todayISO(new Date(d.closedAt)) : '', 'Причина закрытия': d.closeReason,
        'Кто выиграл': d.winner, 'Риски': d.risks, 'Комментарий': d.notes,
      };
    });
  } else if (kind === 'leads') {
    sheetRows = data.map((l) => ({
      'Название': l.name, 'Статус': l.status, 'Стадия': LEAD_STAGES.find((s) => s.id === l.stage)?.label || l.stage,
      'Источник': l.source, 'Контакт': nameOf(store.contacts, l.contactId), 'Контрагент': nameOf(store.companies, l.companyId),
      'Продукт': l.product, 'Подпродукт': l.subproduct, 'Ответственный': nameOf(store.employees, l.employeeId),
      'Партнёр': nameOf(store.companies, l.partnerId), 'Предварительный бюджет': l.preliminaryBudget,
      'Причина закрытия/дисквалификации': l.closeReason, 'Описание': l.description,
      'Дата создания': todayISO(new Date(l.createdAt)), 'Сделка': nameOf(store.deals, l.convertedDealId),
    }));
  } else if (kind === 'companies') {
    sheetRows = data.map((c) => ({
      'Название': c.name, 'ИНН': c.inn, 'Роль': c.role,
      'Головная структура': nameOf(store.companies, c.parentCompanyId), 'Отрасль': c.industry,
      'Сайт': c.website, 'Комментарий': c.notes,
    }));
  } else if (kind === 'contacts') {
    sheetRows = data.map((c) => ({ 'ФИО': c.name, 'Должность': c.title, 'Телефон': c.phone, 'Email': c.email, 'Контрагент': nameOf(store.companies, c.companyId), 'Комментарий': c.notes }));
  } else if (kind === 'employees') {
    sheetRows = data.map((e) => ({ 'ФИО': e.name, 'Роль': e.role, 'Пользователь': e.username, 'Комментарий': e.notes }));
  } else {
    throw new Error('Этот объект не поддерживает экспорт XLSX');
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows), kind === 'deals' ? 'Сделки' : kind === 'leads' ? 'Лиды' : kind === 'companies' ? 'Контрагенты' : kind === 'contacts' ? 'Контакты' : 'Сотрудники');
  const output = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true });
  downloadFile(filename || `${kind}-${todayISO()}.xlsx`, output, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function stageId(value) {
  const text = normalized(value);
  if (!text) return '';
  return DEAL_STAGES.find((s) => normalized(s.id) === text || normalized(s.label) === text || text.startsWith(normalized(s.id)))?.id || '';
}

/** Import the current pipeline from the first worksheet. Existing amounts are never duplicated. */
export async function importPipelineXlsx(file) {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let created = 0; let updated = 0; let skipped = 0;
  for (const row of rows) {
    const name = clean(cell(row, ['Название', 'Сделка', 'Название сделки', 'Наименование']));
    if (!name) { skipped++; continue; }
    const companyName = clean(cell(row, ['Контрагент', 'Компания', 'Клиент', 'Организация']));
    const inn = clean(cell(row, ['ИНН']));
    let company = store.companies.find((c) => (inn && c.inn === inn) || (companyName && normalized(c.name) === normalized(companyName)));
    if (!company && companyName) company = await store.addCompany({ name: companyName, inn, role: 'Клиент' });
    if (company && inn && !company.inn) await store.updateCompany(company.id, { inn });
    const contactName = clean(cell(row, ['Контакт', 'ФИО', 'Основной контакт']));
    let contact = store.contacts.find((c) => contactName && normalized(c.name) === normalized(contactName));
    if (!contact && contactName) contact = await store.addContact({ name: contactName, companyId: company?.id || null });
    const partnerName = clean(cell(row, ['Партнёр', 'Партнер']));
    const partner = store.companies.find((c) => partnerName && normalized(c.name) === normalized(partnerName));
    let deal = store.deals.find((d) => normalized(d.name) === normalized(name) && (d.companyId || null) === (company?.id || null));
    const payload = {
      name, companyId: company?.id || null, contactId: contact?.id || null,
      contacts: contact ? [{ contactId: contact.id, role: '', influence: '' }] : [],
      partnerId: partner?.id || null,
      product: clean(cell(row, ['Продукт'])), subproduct: clean(cell(row, ['Подпродукт'])),
      stage: stageId(cell(row, ['Стадия', 'Этап'])) || undefined,
      status: clean(cell(row, ['Статус'])) || undefined,
      probabilityCategory: clean(cell(row, ['Категория вероятности', 'Вероятность'])),
      nextStepText: clean(cell(row, ['Следующий шаг'])), nextStepDate: iso(cell(row, ['Дата следующего шага'])),
      contractDate: iso(cell(row, ['Дата договора'])), workStartDate: iso(cell(row, ['Дата старта работ'])),
      notes: clean(cell(row, ['Комментарий', 'Примечание'])), risks: clean(cell(row, ['Риски'])),
    };
    Object.keys(payload).forEach((key) => { if (payload[key] === undefined) delete payload[key]; });
    if (deal) { await store.updateDeal(deal.id, payload); updated++; }
    else { deal = await store.addDeal({ ...payload, value: 0 }); created++; }
    const amount = money(cell(row, ['Сумма без НДС', 'Сумма', 'Бюджет', 'Стоимость']));
    if (amount && !store.paymentsFor(deal.id).length) {
      const date = iso(cell(row, ['Дата платежа', 'Дата оплаты', 'Дата закрытия'])) || payload.contractDate || todayISO();
      await store.addPayment({ dealId: deal.id, ...fiscalYearQuarterForDate(date), amount,
        type: clean(cell(row, ['Тип платежа', 'Тип'])) || 'Лицензия', status: 'Прогноз', paymentDate: iso(cell(row, ['Дата оплаты'])) });
    }
  }
  return { created, updated, skipped, total: rows.length };
}
