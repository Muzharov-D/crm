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

const stageLabel = (id) => LEAD_STAGES.find((s) => s.id === id)?.label || id;

export function leadsMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = { search: '', status: '', stage: '', employeeId: '' };
  const render = keepingFocus(() => {
    clear(root);
    if (id) renderDetail(); else renderList();
  });

  function renderList() {
    const search = el('input.input', { type: 'search', value: state.search, placeholder: 'Название, контрагент или контакт', oninput: (e) => { state.search = e.target.value; renderRows(); } });
    const status = el('select.select', { onchange: (e) => { state.status = e.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все статусы'), ['Новый', 'В работе', 'Квалифицирован', 'Дисквалифицирован', 'Закрыт'].map((v) => el('option', { value: v, selected: state.status === v }, v)));
    const stage = el('select.select', { onchange: (e) => { state.stage = e.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все стадии L0–L5'), LEAD_STAGES.map((s) => el('option', { value: s.id, selected: state.stage === s.id }, s.label)));
    const employee = el('select.select', { onchange: (e) => { state.employeeId = e.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все сотрудники'), store.employees.map((e) => el('option', { value: e.id, selected: state.employeeId === e.id }, e.name)));
    const body = el('tbody');
    const count = el('span.filter-count');
    const filtered = () => store.leads.filter((l) => (!state.status || l.status === state.status) && (!state.stage || l.stage === state.stage)
      && (!state.employeeId || l.employeeId === state.employeeId)
      && (!state.search || fuzzyIncludes(`${l.name} ${store.companyById(l.companyId)?.name || ''} ${store.contactById(l.contactId)?.name || ''}`, state.search)));
    function renderRows() {
      const rows = filtered().sort((a, b) => b.createdAt - a.createdAt);
      count.textContent = `${rows.length} из ${store.leads.length}`;
      clear(body).append(...(rows.length ? rows.map((l) => el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/leads?id=${l.id}` }, l.name || 'Без названия')),
        el('td', {}, el('span.status-pill', {}, l.status)), el('td', {}, stageLabel(l.stage)),
        el('td', {}, store.companyById(l.companyId)?.name || '—'), el('td', {}, store.contactById(l.contactId)?.name || '—'),
        el('td', {}, `${l.product || '—'}${l.subproduct ? ` / ${l.subproduct}` : ''}`),
        el('td', {}, store.employeeById(l.employeeId)?.name || '—'), el('td.num', {}, l.preliminaryBudget ? money(l.preliminaryBudget) : '—'),
        el('td', {}, formatDate(new Date(l.createdAt).toISOString().slice(0, 10))),
        el('td', {}, l.convertedDealId ? el('a.record-link', { href: `#/pipeline?id=${l.convertedDealId}` }, 'Сделка создана') : '—')))
        : [el('tr', {}, el('td', { colspan: 10 }, 'По фильтрам ничего не найдено'))]));
    }
    renderRows();
    root.append(pageHead('Лиды', 'Отдельный реестр обращений и квалификации L0–L5',
      actionButton('Экспорт XLSX', () => exportXlsx('leads', filtered()), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый лид', () => openLeadForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, status, stage, employee, count),
      store.leads.length ? el('div.table-wrap', {}, el('table.data-table', {},
        el('thead', {}, el('tr', {}, ['Название', 'Статус', 'Стадия', 'Контрагент', 'Контакт', 'Продукт', 'Ответственный', 'Бюджет', 'Создан', 'Сделка'].map((h) => el('th', {}, h)))), body))
        : emptyState('Лидов пока нет', 'Создайте первое обращение или импортируйте данные.', canWrite(store.user) && actionButton('Создать лид', () => openLeadForm(), { primary: true })));
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
