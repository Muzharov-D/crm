/** MVP v2.1 entity forms. All monetary deal totals live in the payment register. */
import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { dictionaryOptions, productForSubproduct, fiscalYearAt, fiscalQuarterAt } from '../lib/spec.js';
import { todayISO } from '../lib/util.js';
import {
  ensureWritable, field, textInput, makeSelect, withCurrent, textArea, submitRow, wireForm,
} from './forms.js';

const byName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const recordOptions = (rows, empty = 'Не выбрано') => [
  { value: '', label: empty }, ...byName(rows).map((r) => ({ value: r.id, label: r.name })),
];
const companiesWithRole = (role, currentIds = []) => store.companies.filter((c) => c.role === role || currentIds.includes(c.id));
const dictOptions = (key, current = '', parent = null, empty = 'Не указано') =>
  withCurrent(dictionaryOptions(store.settings, key, { parent, empty }), current);
const val = (input) => input.value || null;
const num = (input) => Math.max(0, Number(input.value) || 0);

function openEntityModal(title, form, wide = true) {
  const modal = openModal({ title, content: form, wide });
  return modal;
}

function saveWithFeedback(form, save) {
  wireForm(form, async () => {
    const result = await save();
    toast('Сохранено', { icon: 'check' });
    return result;
  });
}

export function openCompanyForm(company = null, { onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const name = textInput({ value: company?.name || '', required: true, maxlength: 200 });
  const inn = textInput({ value: company?.inn || '', inputmode: 'numeric', maxlength: 12, pattern: '[0-9]{10}|[0-9]{12}', placeholder: '10 или 12 цифр' });
  const role = makeSelect(dictOptions('companyRoles', company?.role), company?.role || '');
  const parent = makeSelect(recordOptions(store.companies.filter((c) => c.id !== company?.id), 'Нет головной структуры'), company?.parentCompanyId || '');
  const industry = textInput({ value: company?.industry || '', maxlength: 120 });
  const website = textInput({ value: company?.website || '', maxlength: 200 });
  const notes = textArea({ value: company?.notes || '' });
  const form = el('form.form', {},
    field('Название', name),
    el('div.form-grid', {}, field('ИНН', inn), field('Роль контрагента', role.wrap)),
    field('Головная структура', parent.wrap),
    el('div.form-grid', {}, field('Отрасль', industry), field('Сайт', website)),
    field('Комментарий', notes),
    submitRow(company ? 'Сохранить' : 'Добавить контрагента'));
  const modal = openEntityModal(company ? 'Контрагент' : 'Новый контрагент', form, false);
  saveWithFeedback(form, async () => {
    const data = { name: name.value.trim(), inn: inn.value.trim(), role: role.select.value,
      parentCompanyId: val(parent.select), industry: industry.value.trim(), website: website.value.trim(), notes: notes.value };
    const saved = company ? await store.updateCompany(company.id, data) : await store.addCompany(data);
    modal.close(); onSaved?.(saved); return saved;
  });
}

export function openContactForm(contact = null, { presets = {}, onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const data = { ...presets, ...contact };
  const name = textInput({ value: data.name || '', required: true, maxlength: 160 });
  const title = textInput({ value: data.title || '', maxlength: 160 });
  const phone = textInput({ value: data.phone || '', type: 'tel' });
  const email = textInput({ value: data.email || '', type: 'email' });
  const company = makeSelect(recordOptions(store.companies, 'Без контрагента'), data.companyId || '');
  const notes = textArea({ value: data.notes || '' });
  const form = el('form.form', {}, field('ФИО', name), field('Должность', title),
    el('div.form-grid', {}, field('Телефон', phone), field('Email', email)),
    field('Контрагент', company.wrap), field('Комментарий', notes), submitRow(contact ? 'Сохранить' : 'Добавить контакт'));
  const modal = openEntityModal(contact ? 'Контакт' : 'Новый контакт', form, false);
  saveWithFeedback(form, async () => {
    const payload = { name: name.value.trim(), title: title.value.trim(), phone: phone.value.trim(),
      email: email.value.trim(), companyId: val(company.select), notes: notes.value };
    const saved = contact ? await store.updateContact(contact.id, payload) : await store.addContact(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}

export function openEmployeeForm(employee = null, { onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const name = textInput({ value: employee?.name || '', required: true, maxlength: 160 });
  const role = makeSelect(dictOptions('employeeRoles', employee?.role), employee?.role || '');
  const username = textInput({ value: employee?.username || '', placeholder: 'Логин в CRM (необязательно)' });
  const notes = textArea({ value: employee?.notes || '' });
  const form = el('form.form', {}, field('ФИО', name), field('Роль сотрудника', role.wrap),
    field('Системный пользователь', username, { hint: 'Связь нужна только для назначения задач текущему пользователю по умолчанию.' }),
    field('Комментарий', notes), submitRow(employee ? 'Сохранить' : 'Добавить сотрудника'));
  const modal = openEntityModal(employee ? 'Сотрудник' : 'Новый сотрудник', form, false);
  saveWithFeedback(form, async () => {
    const payload = { name: name.value.trim(), role: role.select.value, username: username.value.trim(), notes: notes.value };
    const saved = employee ? await store.updateEmployee(employee.id, payload) : await store.addEmployee(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}

function productFields(record = {}) {
  const product = makeSelect(dictOptions('products', record.product), record.product || '');
  const subproduct = makeSelect(dictOptions('subproducts', record.subproduct, record.product || null), record.subproduct || '');
  const refill = () => {
    const current = subproduct.select.value;
    subproduct.select.replaceChildren(...dictOptions('subproducts', current, product.select.value || null)
      .map((o) => el('option', { value: o.value, selected: o.value === current }, o.label)));
    if (productForSubproduct(store.settings, current) !== product.select.value) subproduct.select.value = '';
  };
  product.select.addEventListener('change', refill);
  return { product, subproduct };
}

export function openLeadForm(lead = null, { presets = {}, onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const data = { ...presets, ...lead };
  const name = textInput({ value: data.name || '', required: true, maxlength: 240 });
  const status = makeSelect(dictOptions('leadStatuses', data.status || 'Новый'), data.status || 'Новый');
  if (lead?.status === 'Дисквалифицирован') status.select.disabled = true;
  const stage = makeSelect([
    { value: 'l0', label: 'L0 — Целевой рынок' }, { value: 'l1', label: 'L1 — Целевой контакт' },
    { value: 'l2', label: 'L2 — Лид, проявивший интерес' }, { value: 'l3', label: 'L3 — Квалифицированный лид' },
    { value: 'l4', label: 'L4 — Глубоко проработанный лид' }, { value: 'l5', label: 'L5 — Лид-возможность' },
  ], data.stage || 'l0');
  const source = makeSelect(dictOptions('leadSources', data.source), data.source || '');
  const contact = makeSelect(recordOptions(store.contacts, 'Без контакта'), data.contactId || '');
  const company = makeSelect(recordOptions(store.companies, 'Без контрагента'), data.companyId || '');
  const partner = makeSelect(recordOptions(companiesWithRole('Партнёр-интегратор', [data.partnerId]), 'Без партнёра'), data.partnerId || '');
  const employee = makeSelect(recordOptions(store.activeEmployees([data.employeeId]), 'Не назначен'), data.employeeId || (store.currentEmployee()?.active !== false ? store.currentEmployee()?.id : '') || '');
  const { product, subproduct } = productFields(data);
  const budget = textInput({ value: data.preliminaryBudget || '', type: 'number', min: 0, step: '0.01', inputmode: 'decimal' });
  const reason = makeSelect(dictOptions('leadReasons', data.closeReason), data.closeReason || '');
  const description = textArea({ value: data.description || '', rows: 5 });
  const form = el('form.form', {}, field('Название лида', name),
    el('div.form-grid', {}, field('Статус', status.wrap), field('Стадия', stage.wrap)),
    el('div.form-grid', {}, field('Источник', source.wrap), field('Ответственный сотрудник', employee.wrap)),
    el('div.form-grid', {}, field('Контакт', contact.wrap), field('Контрагент', company.wrap)),
    el('div.form-grid', {}, field('Продукт', product.wrap), field('Подпродукт', subproduct.wrap)),
    el('div.form-grid', {}, field('Партнёр', partner.wrap), field('Предварительный бюджет, без НДС', budget)),
    field('Причина закрытия / дисквалификации', reason.wrap),
    field('Описание задачи / комментарий', description), submitRow(lead ? 'Сохранить' : 'Добавить лид'));
  const modal = openEntityModal(lead ? 'Лид' : 'Новый лид', form);
  saveWithFeedback(form, async () => {
    const payload = { name: name.value.trim(), status: status.select.value, stage: stage.select.value,
      source: source.select.value, contactId: val(contact.select), companyId: val(company.select),
      partnerId: val(partner.select), employeeId: val(employee.select), product: product.select.value,
      subproduct: subproduct.select.value, preliminaryBudget: num(budget), closeReason: reason.select.value,
      description: description.value };
    const saved = lead ? await store.updateLead(lead.id, payload) : await store.addLead(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}

export function openDealForm(deal = null, { presets = {}, onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const data = { ...presets, ...deal };
  const name = textInput({ value: data.name || '', required: true, maxlength: 240 });
  const company = makeSelect(recordOptions(store.companies, 'Выберите контрагента'), data.companyId || '');
  company.select.required = true;
  const contact = makeSelect(recordOptions(store.contacts, 'Без основного контакта'), data.contactId || '');
  const partner = makeSelect(recordOptions(companiesWithRole('Партнёр-интегратор', [data.partnerId]), 'Без партнёра'), data.partnerId || '');
  const { product, subproduct } = productFields(data);
  const stages = store.stages().map((s) => ({ value: s.id, label: s.label }));
  const stage = makeSelect(stages, data.stage || store.firstStage());
  const status = makeSelect(dictOptions('dealStatuses', data.status || 'Новая'), data.status || 'Новая');
  const probability = makeSelect(dictOptions('probabilityCategories', data.probabilityCategory), data.probabilityCategory || '');
  const competitors = el('select.select', { multiple: true, size: 3, 'aria-label': 'Конкуренты' },
    byName(companiesWithRole('Конкурент', data.competitorIds || [])).map((c) => el('option', { value: c.id, selected: data.competitorIds?.includes(c.id) }, c.name)));
  const risks = textArea({ value: data.risks || '', rows: 2 });
  const contractDate = textInput({ value: data.contractDate || '', type: 'date' });
  const workStartDate = textInput({ value: data.workStartDate || '', type: 'date' });
  const clientEvent = textInput({ value: data.clientEvent || '' });
  const clientEventDate = textInput({ value: data.clientEventDate || '', type: 'date' });
  const investment = makeSelect(dictOptions('clientInvestments', data.clientInvestment), data.clientInvestment || '');
  const budget = makeSelect(dictOptions('budgets', data.budget), data.budget || '');
  const purchase = makeSelect(dictOptions('purchaseTypes', data.purchaseType), data.purchaseType || '');
  const nextText = textInput({ value: data.nextStepText || '' });
  const nextDate = textInput({ value: data.nextStepDate || '', type: 'date' });
  const outcome = makeSelect(dictOptions('dealOutcomes', data.outcome, null, 'Открыта'), data.outcome || '');
  const closeReason = makeSelect(dictOptions('dealCloseReasons', data.closeReason), data.closeReason || '');
  const winner = textInput({ value: data.winner || '' });
  const notes = textArea({ value: data.notes || '', rows: 3 });
  const outcomeFields = el('div.form-grid', {}, field('Исход', outcome.wrap), field('Причина закрытия', closeReason.wrap));
  const form = el('form.form', {},
    field('Название сделки', name),
    el('div.form-grid', {}, field('Контрагент · один договор', company.wrap), field('Основной контакт', contact.wrap)),
    el('div.form-grid', {}, field('Продукт', product.wrap), field('Подпродукт', subproduct.wrap)),
    el('div.form-grid', {}, field('Стадия', stage.wrap), field('Независимый статус', status.wrap)),
    el('div.form-grid', {}, field('Категория вероятности', probability.wrap), field('Партнёр', partner.wrap)),
    field('Конкуренты-контрагенты', competitors, { hint: 'Ctrl/Cmd — выбрать несколько.' }), field('Риски', risks),
    el('div.form-grid', {}, field('Дата договора', contractDate), field('Дата старта работ', workStartDate)),
    el('div.form-grid', {}, field('Событие заказчика', clientEvent), field('Дата события', clientEventDate)),
    el('div.form-grid', {}, field('Что клиент вложил', investment.wrap), field('Бюджет', budget.wrap)),
    field('Тип покупки', purchase.wrap),
    el('div.form-grid', {}, field('Следующий шаг', nextText), field('Дата следующего шага', nextDate)),
    deal ? outcomeFields : null,
    deal ? field('Кто выиграл (при проигрыше)', winner) : null,
    field('Комментарий', notes),
    el('p.field-hint', {}, 'Общая сумма и суммы ФГ рассчитываются в реестре платежей карточки сделки.'),
    submitRow(deal ? 'Сохранить' : 'Добавить сделку'));
  const syncOutcome = () => {
    closeReason.select.required = !!outcome.select.value && outcome.select.value !== 'Выиграна';
    winner.required = outcome.select.value === 'Проиграна';
  };
  outcome.select.addEventListener('change', syncOutcome); syncOutcome();
  const modal = openEntityModal(deal ? 'Сделка' : 'Новая сделка', form);
  saveWithFeedback(form, async () => {
    const payload = { name: name.value.trim(), companyId: val(company.select), contactId: val(contact.select),
      contacts: val(contact.select) ? [{ contactId: val(contact.select), role: deal?.contacts?.[0]?.role || '', influence: deal?.contacts?.[0]?.influence || '' }, ...(deal?.contacts || []).slice(1)] : [],
      partnerId: val(partner.select), product: product.select.value, subproduct: subproduct.select.value,
      stage: stage.select.value, status: status.select.value, probabilityCategory: probability.select.value,
      competitorIds: [...competitors.selectedOptions].map((o) => o.value), risks: risks.value,
      contractDate: contractDate.value, workStartDate: workStartDate.value,
      clientEvent: clientEvent.value.trim(), clientEventDate: clientEventDate.value,
      clientInvestment: investment.select.value, budget: budget.select.value, purchaseType: purchase.select.value,
      nextStepText: nextText.value.trim(), nextStepDate: nextDate.value, notes: notes.value,
      ...(deal ? { outcome: outcome.select.value, closeReason: closeReason.select.value, winner: winner.value.trim() } : {}),
    };
    const saved = deal ? await store.updateDeal(deal.id, payload) : await store.addDeal(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}

export function openPaymentForm(payment = null, { presets = {}, onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const data = { fiscalYear: fiscalYearAt(), quarter: fiscalQuarterAt(), ...presets, ...payment };
  const deal = makeSelect(recordOptions(store.deals, 'Выберите сделку'), data.dealId || '');
  deal.select.required = true;
  const fiscalYear = textInput({ value: data.fiscalYear, type: 'number', min: 2000, max: 2200, required: true });
  const quarter = makeSelect(['Q1', 'Q2', 'Q3', 'Q4'].map((q) => ({ value: q, label: q })), data.quarter);
  const amount = textInput({ value: data.amount ?? '', type: 'number', min: 0, step: '0.01', required: true });
  const type = makeSelect(dictOptions('paymentTypes', data.type || 'Лицензия'), data.type || 'Лицензия');
  const status = makeSelect(dictOptions('paymentStatuses', data.status || 'Прогноз'), data.status || 'Прогноз');
  const paymentDate = textInput({ value: data.paymentDate || '', type: 'date' });
  const actDate = textInput({ value: data.actDate || '', type: 'date' });
  const form = el('form.form', {}, field('Сделка', deal.wrap),
    el('div.form-grid', {}, field('Финансовый год', fiscalYear, { hint: 'ФГ27 = апрель 2026 — март 2027.' }), field('Квартал ФГ', quarter.wrap)),
    field('Сумма без НДС', amount),
    el('div.form-grid', {}, field('Тип', type.wrap), field('Статус', status.wrap)),
    el('div.form-grid', {}, field('Дата оплаты', paymentDate), field('Дата акта', actDate)),
    submitRow(payment ? 'Сохранить платёж' : 'Добавить платёж'));
  const modal = openEntityModal(payment ? 'Платёж' : 'Новый платёж', form, false);
  saveWithFeedback(form, async () => {
    const payload = { dealId: val(deal.select), fiscalYear: Number(fiscalYear.value), quarter: quarter.select.value,
      amount: num(amount), type: type.select.value, status: status.select.value,
      paymentDate: paymentDate.value, actDate: actDate.value };
    const saved = payment ? await store.updatePayment(payment.id, payload) : await store.addPayment(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}

export function openActivityForm(activity = null, { presets = {}, onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const data = { ...presets, ...activity };
  const date = textInput({ value: data.date || todayISO(), type: 'date', max: todayISO(), required: true });
  const employee = makeSelect(recordOptions(store.activeEmployees([data.employeeId]), 'Не указан'), data.employeeId || (store.currentEmployee()?.active !== false ? store.currentEmployee()?.id : '') || '');
  const type = makeSelect([
    { value: 'note', label: 'Событие / комментарий' }, { value: 'meeting', label: 'Встреча' },
    { value: 'call', label: 'Звонок' }, { value: 'email', label: 'Письмо' },
  ], data.type || 'note');
  const summary = textInput({ value: data.summary || '', required: true, maxlength: 300 });
  const deal = makeSelect(recordOptions(store.deals, 'Без сделки'), data.dealId || '');
  const lead = makeSelect(recordOptions(store.leads, 'Без лида'), data.leadId || '');
  const contact = makeSelect(recordOptions(store.contacts, 'Без контакта'), data.contactId || '');
  const company = makeSelect(recordOptions(store.companies, 'Без контрагента'), data.companyId || '');
  const notes = textArea({ value: data.notes || '' });
  const form = el('form.form', {},
    el('p.field-hint', {}, 'Здесь фиксируются только свершившиеся события. Планы создаются задачами или следующим шагом сделки.'),
    el('div.form-grid', {}, field('Дата события', date), field('Сотрудник', employee.wrap)),
    field('Тип', type.wrap), field('Событие / комментарий', summary),
    el('div.form-grid', {}, field('Сделка', deal.wrap), field('Лид', lead.wrap)),
    el('div.form-grid', {}, field('Контакт', contact.wrap), field('Контрагент', company.wrap)),
    field('Детали', notes), submitRow(activity ? 'Сохранить событие' : 'Добавить событие'));
  const modal = openEntityModal(activity ? 'Событие' : 'Новое событие', form);
  saveWithFeedback(form, async () => {
    if (date.value > todayISO()) throw new Error('Событие не может быть датировано будущим');
    const payload = { date: date.value, employeeId: val(employee.select), type: type.select.value,
      summary: summary.value.trim(), dealId: val(deal.select), leadId: val(lead.select),
      contactId: val(contact.select), companyId: val(company.select), notes: notes.value };
    const saved = activity ? await store.updateActivity(activity.id, payload) : await store.addActivity(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}

export function openTaskForm(task = null, { presets = {}, onSaved = null } = {}) {
  if (!ensureWritable()) return;
  const data = { ...presets, ...task };
  const title = textInput({ value: data.title || '', required: true, maxlength: 400 });
  const employee = makeSelect(recordOptions(store.activeEmployees([data.employeeId]), 'Не назначен'), data.employeeId || (store.currentEmployee()?.active !== false ? store.currentEmployee()?.id : '') || '');
  const startDate = textInput({ value: data.startDate || todayISO(), type: 'date', required: true });
  const due = textInput({ value: data.due || todayISO(), type: 'date', required: true });
  const status = makeSelect(dictOptions('taskStatuses', data.status || 'К выполнению', null, null), data.status || 'К выполнению');
  const deal = makeSelect(recordOptions(store.deals, 'Без сделки'), data.dealId || '');
  const lead = makeSelect(recordOptions(store.leads, 'Без лида'), data.leadId || '');
  const contact = makeSelect(recordOptions(store.contacts, 'Без контакта'), data.contactId || '');
  const company = makeSelect(recordOptions(store.companies, 'Без контрагента'), data.companyId || '');
  const form = el('form.form', {}, field('Описание задачи', title),
    field('Ответственный сотрудник', employee.wrap),
    el('div.form-grid', {}, field('Дата начала', startDate), field('Дата окончания', due)),
    field('Статус', status.wrap),
    el('div.form-grid', {}, field('Сделка', deal.wrap), field('Лид', lead.wrap)),
    el('div.form-grid', {}, field('Контакт', contact.wrap), field('Контрагент', company.wrap)),
    submitRow(task ? 'Сохранить задачу' : 'Добавить задачу'));
  const modal = openEntityModal(task ? 'Задача' : 'Новая задача', form);
  saveWithFeedback(form, async () => {
    if (due.value < startDate.value) throw new Error('Дата окончания не может быть раньше даты начала');
    const payload = { title: title.value.trim(), employeeId: val(employee.select), startDate: startDate.value,
      due: due.value, status: status.select.value, done: status.select.value === 'Выполнено',
      dealId: val(deal.select), leadId: val(lead.select), contactId: val(contact.select), companyId: val(company.select) };
    const saved = task ? await store.updateTask(task.id, payload) : await store.addTask(payload);
    modal.close(); onSaved?.(saved); return saved;
  });
}
