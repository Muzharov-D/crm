import { el, clear, keepingFocus, append } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { LEAD_STAGES } from '../lib/spec.js';
import { canWrite } from '../lib/access.js';
import { openLeadForm } from '../ui/mvp-forms.js';
import { actionButton, pageHead, emptyState, facts, relatedRecords, historyTable, avandokEmpty, money } from '../ui/mvp-bits.js';
import { exportXlsx } from '../lib/xlsx.js';
import { formatDate, fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

const stageLabel = (id) => LEAD_STAGES.find((s) => s.id === id)?.label || id;

export function leadsMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = { search: '', status: '', stage: '', employeeId: '', sortKey: 'createdAt', sortDirection: 'desc', filters: [] };
  const render = keepingFocus(() => {
    clear(root);
    if (id) renderDetail(); else renderList();
  });

  function renderList() {
    const columns = [
      { key: 'name', label: 'Название', get: (lead) => lead.name || '' },
      { key: 'status', label: 'Статус', get: (lead) => lead.status || '' },
      { key: 'stage', label: 'Стадия', get: (lead) => stageLabel(lead.stage) },
      { key: 'company', label: 'Контрагент', get: (lead) => store.companyById(lead.companyId)?.name || '' },
      { key: 'contact', label: 'Контакт', get: (lead) => store.contactById(lead.contactId)?.name || '' },
      { key: 'product', label: 'Продукт', get: (lead) => `${lead.product || ''}${lead.subproduct ? ` / ${lead.subproduct}` : ''}` },
      { key: 'employee', label: 'Ответственный', get: (lead) => store.employeeById(lead.employeeId)?.name || '' },
      { key: 'budget', label: 'Бюджет', type: 'number', numeric: true, get: (lead) => lead.preliminaryBudget ?? null },
      { key: 'createdAt', label: 'Создан', type: 'date', get: (lead) => lead.createdAt ? new Date(lead.createdAt).toISOString().slice(0, 10) : '' },
      { key: 'deal', label: 'Сделка', get: (lead) => lead.convertedDealId ? store.dealById(lead.convertedDealId)?.name || 'Сделка создана' : '' },
    ];
    const results = el('div');
    const filtered = () => filterRecords(store.leads.filter((lead) => (!state.status || lead.status === state.status)
      && (!state.stage || lead.stage === state.stage) && (!state.employeeId || lead.employeeId === state.employeeId)
      && (!state.search || fuzzyIncludes(`${lead.name} ${store.companyById(lead.companyId)?.name || ''} ${store.contactById(lead.contactId)?.name || ''} ${store.employeeById(lead.employeeId)?.name || ''} ${lead.product || ''}`, state.search))), columns, state.filters);
    const table = (rows) => el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
      registryHead(columns, state, (key) => { toggleSort(state, key); renderRows(); }),
      el('tbody', {}, rows.length ? sortRecords(rows, columns, state).map((lead) => el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/leads?id=${lead.id}` }, lead.name || 'Без названия')),
        el('td', {}, el('span.status-pill', {}, lead.status || '—')), el('td', {}, stageLabel(lead.stage)),
        el('td', {}, store.companyById(lead.companyId)?.name || '—'), el('td', {}, store.contactById(lead.contactId)?.name || '—'),
        el('td', {}, `${lead.product || '—'}${lead.subproduct ? ` / ${lead.subproduct}` : ''}`),
        el('td', {}, store.employeeById(lead.employeeId)?.name || '—'),
        el('td.num', {}, lead.preliminaryBudget || lead.preliminaryBudget === 0 ? money(lead.preliminaryBudget) : '—'),
        el('td', {}, lead.createdAt ? formatDate(new Date(lead.createdAt).toISOString().slice(0, 10)) : '—'),
        el('td', {}, lead.convertedDealId ? el('a.record-link', { href: `#/pipeline?id=${lead.convertedDealId}` }, 'Сделка создана') : '—')))
        : el('tr', {}, el('td', { colspan: columns.length }, 'По фильтрам ничего не найдено')))));
    function renderRows() {
      const rows = filtered();
      clear(results).append(el('div.registry-summary', {}, el('span.filter-count', {}, `${rows.length} из ${store.leads.length}`),
        el('span', {}, 'Нажмите на заголовок для сортировки')),
        store.leads.length ? table(rows) : emptyState('Лидов пока нет', 'Создайте первое обращение или импортируйте данные.', canWrite(store.user) && actionButton('Создать лид', () => openLeadForm(), { primary: true })));
    }
    const search = el('input.input', { type: 'search', value: state.search, placeholder: 'Название, контрагент, контакт или ответственный',
      dataset: { focusKey: 'lead-search' }, oninput: (event) => { state.search = event.target.value; renderRows(); } });
    const status = el('select.select', { onchange: (event) => { state.status = event.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все статусы'), ['Новый', 'В работе', 'Квалифицирован', 'Дисквалифицирован', 'Закрыт'].map((value) => el('option', { value, selected: state.status === value }, value)));
    const stage = el('select.select', { onchange: (event) => { state.stage = event.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все стадии L0–L5'), LEAD_STAGES.map((item) => el('option', { value: item.id, selected: state.stage === item.id }, item.label)));
    const employee = el('select.select', { onchange: (event) => { state.employeeId = event.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все сотрудники'), store.employees.map((item) => el('option', { value: item.id, selected: state.employeeId === item.id }, item.name)));
    root.append(pageHead('Лиды', 'Отдельный реестр обращений и квалификации L0–L5',
      actionButton('Экспорт XLSX', () => exportXlsx('leads', sortRecords(filtered(), columns, state)), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый лид', () => openLeadForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, status, stage, employee), advancedFilters(columns, state.filters, renderRows), results);
    renderRows();
  }

  function renderDetail() {
    const lead = store.leadById(id);
    if (!lead) { root.append(emptyState('Лид не найден', 'Возможно, запись была удалена.', el('a.btn.btn-ghost', { href: '#/leads' }, 'К списку лидов'))); return; }
    const company = store.companyById(lead.companyId);
    const contact = store.contactById(lead.contactId);
    const deal = store.dealById(lead.convertedDealId);
    const convert = async () => {
      try { const created = await store.convertLeadToDeal(id); toast('Сделка создана. Поля перенесены один раз.', { icon: 'check' }); navigate(`#/pipeline?id=${created.id}`); }
      catch (error) { toast(error.message, { icon: 'alert' }); }
    };
    append(root, [el('a.back-link', { href: '#/leads' }, '← Все лиды'),
      pageHead(lead.name || 'Лид без названия', `${stageLabel(lead.stage)} · создан ${new Date(lead.createdAt).toLocaleString('ru-RU')}`,
        actionButton('Экспорт XLSX', () => exportXlsx('leads', [lead], `Лид-${lead.name}.xlsx`), { iconName: 'download' }),
        canWrite(store.user) && actionButton('Редактировать', () => openLeadForm(lead), { iconName: 'pencil' }),
        canWrite(store.user) && lead.status === 'Квалифицирован' && !deal && actionButton('Перевести в сделку', convert, { primary: true, iconName: 'arrowR' })),
      lead.status === 'Дисквалифицирован' && el('div.notice.warning', {}, 'Дисквалифицированный лид нельзя открыть повторно. Для нового обращения создайте отдельный лид.'),
      deal && el('div.notice', {}, 'Лид связан со сделкой справочно. После переноса поля не синхронизируются. ', el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name)),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Квалификация')),
        facts([
          ['Статус', lead.status], ['Стадия', stageLabel(lead.stage)], ['Источник', lead.source || '—'],
          ['Контрагент', company ? el('a.record-link', { href: `#/companies?id=${company.id}` }, company.name) : '—'],
          ['Контакт', contact ? el('a.record-link', { href: `#/contacts?id=${contact.id}` }, contact.name) : '—'],
          ['Ответственный', store.employeeById(lead.employeeId)?.name || '—'],
          ['Партнёр', store.companyById(lead.partnerId)?.name || '—'], ['Продукт', lead.product || '—'],
          ['Подпродукт', lead.subproduct || '—'], ['Предварительный бюджет', lead.preliminaryBudget ? money(lead.preliminaryBudget) : '—'],
          ['Причина закрытия / дисквалификации', lead.closeReason || '—'],
        ]), el('div.record-description', {}, lead.description || 'Описание задачи не заполнено.')),
      relatedRecords('lead', id),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Системный реестр изменений стадии')),
        el('p.field-hint', {}, 'Записи создаются автоматически, не редактируются и не удаляются.'),
        historyTable(store.leadStageHistoryFor(id), LEAD_STAGES)),
      avandokEmpty(),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить лид', async () => {
        if (!await confirmDialog({ title: 'Удалить лид?', message: 'Системный журнал стадий останется в аудите данных.' })) return;
        await store.deleteLead(id); navigate('#/leads');
      }, { iconName: 'trash' }))]);
  }

  render();
  const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
