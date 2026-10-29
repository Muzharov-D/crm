import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { DEAL_STAGES, dealTotals, fiscalYearAt } from '../lib/spec.js';
import { canWrite } from '../lib/access.js';
import { isOpen } from '../lib/forecast.js';
import { openDealForm, openPaymentForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState, facts, relatedRecords, historyTable, avandokEmpty, money } from '../ui/mvp-bits.js';
import { exportXlsx, importPipelineXlsx } from '../lib/xlsx.js';
import { formatDate, fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

const stageLabel = (id) => DEAL_STAGES.find((s) => s.id === id)?.label || id;

export function pipelineMvpView({ params, navigate }) {
  const root = el('div.view'); const id = params.get('id');
  const state = { search: '', product: '', status: '', category: '', showClosed: false, layout: 'board' };
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });

  function filteredDeals() {
    return store.deals.filter((d) => (state.showClosed || isOpen(d)) && (!state.product || d.product === state.product)
      && (!state.status || d.status === state.status) && (!state.category || d.probabilityCategory === state.category)
      && (!state.search || fuzzyIncludes(`${d.name} ${store.companyById(d.companyId)?.name || ''}`, state.search)));
  }

  function list() {
    const search = el('input.input', { type: 'search', value: state.search, placeholder: 'Сделка или контрагент', oninput: (e) => { state.search = e.target.value; render(); } });
    const product = el('select.select', { onchange: (e) => { state.product = e.target.value; render(); } },
      el('option', { value: '' }, 'Все продукты'), [...new Set(store.deals.map((d) => d.product).filter(Boolean))].map((v) => el('option', { value: v, selected: state.product === v }, v)));
    const status = el('select.select', { onchange: (e) => { state.status = e.target.value; render(); } },
      el('option', { value: '' }, 'Все статусы'), [...new Set(store.deals.map((d) => d.status).filter(Boolean))].map((v) => el('option', { value: v, selected: state.status === v }, v)));
    const category = el('select.select', { onchange: (e) => { state.category = e.target.value; render(); } },
      el('option', { value: '' }, 'Все категории'), ['Высокая', 'Средняя', 'Низкая'].map((v) => el('option', { value: v, selected: state.category === v }, v)));
    const closed = el('label.check-label', {}, el('input', { type: 'checkbox', checked: state.showClosed, onchange: (e) => { state.showClosed = e.target.checked; render(); } }), ' Показывать закрытые');
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (e) => {
      const selected = e.target.files[0]; if (!selected) return;
      try { await store.saveSnapshot('XLSX импорт пайплайна'); const result = await importPipelineXlsx(selected); toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`, { icon: 'check' }); }
      catch (error) { console.error(error); toast(`Не удалось импортировать XLSX: ${error.message}`, { icon: 'alert' }); }
    } });
    const deals = filteredDeals();
    root.append(pageHead('Сделки', 'Одна сделка = один договор и один контрагент. Суммы рассчитываются из платежей.',
      canWrite(store.user) && file, canWrite(store.user) && actionButton('Импорт XLSX', () => file.click(), { iconName: 'upload' }),
      actionButton('Экспорт XLSX', () => exportXlsx('deals', deals), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новая сделка', () => openDealForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, product, status, category, closed,
        el('div.segmented', {}, actionButton('Канбан', () => { state.layout = 'board'; render(); }, { attrs: { 'aria-pressed': state.layout === 'board' } }), actionButton('Список', () => { state.layout = 'list'; render(); }, { attrs: { 'aria-pressed': state.layout === 'list' } }))),
      !store.deals.length ? emptyState('Сделок пока нет', 'Создайте сделку напрямую, переведите квалифицированный лид или импортируйте текущий пайплайн XLSX.')
        : state.layout === 'board' ? board(deals) : table(deals));
  }

  function board(deals) {
    return el('div.pipeline-board.mvp-board', {}, DEAL_STAGES.map((stage) => {
      const rows = deals.filter((d) => d.stage === stage.id);
      const total = rows.reduce((sum, d) => sum + dealTotals(d.id, store.payments).total, 0);
      const column = el('section.pipeline-column', { dataset: { stage: stage.id } },
        el('div.pipeline-column-head', {}, el('span', {}, stage.label), el('span.muted', {}, `${rows.length} · ${money(total)}`)),
        el('p.stage-probability', {}, stage.probability === null ? 'Вероятность не задана' : `Расчётная вероятность ${Math.round(stage.probability * 100)}%`),
        rows.map((d) => card(d)));
      column.addEventListener('dragover', (e) => { if (canWrite(store.user)) { e.preventDefault(); column.classList.add('drag-over'); } });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', async (e) => { e.preventDefault(); column.classList.remove('drag-over'); if (!canWrite(store.user)) return; const dealId = e.dataTransfer.getData('text/deal-id'); if (dealId) await store.moveDeal(dealId, stage.id); });
      return column;
    }));
  }

  function card(deal) {
    const node = el('article.deal-card.mvp-deal-card', { draggable: canWrite(store.user) ? 'true' : 'false' },
      el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name),
      el('p.muted', {}, store.companyById(deal.companyId)?.name || 'Контрагент не указан'),
      el('strong', {}, money(dealTotals(deal.id, store.payments).total)),
      el('div.deal-card-meta', {}, deal.status || '—', deal.outcome && ` · ${deal.outcome}`),
      el('select.select', { 'aria-label': `Стадия сделки ${deal.name}`, disabled: !canWrite(store.user), onchange: (e) => store.moveDeal(deal.id, e.target.value) },
        DEAL_STAGES.map((s) => el('option', { value: s.id, selected: s.id === deal.stage }, s.label))));
    node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/deal-id', deal.id); e.dataTransfer.effectAllowed = 'move'; });
    return node;
  }

  function table(deals) {
    return el('div.table-wrap', {}, el('table.data-table', {}, el('thead', {}, el('tr', {}, ['Название', 'Контрагент', 'Стадия', 'Статус', 'Исход', 'Продукт', 'Сумма', 'Текущий ФГ', 'Следующий ФГ', 'Следующий шаг'].map((h) => el('th', {}, h)))),
      el('tbody', {}, deals.length ? deals.map((d) => { const t = dealTotals(d.id, store.payments); return el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/pipeline?id=${d.id}` }, d.name)), el('td', {}, store.companyById(d.companyId)?.name || '—'),
        el('td', {}, stageLabel(d.stage)), el('td', {}, d.status || '—'), el('td', {}, d.outcome || 'Открыта'),
        el('td', {}, `${d.product || '—'}${d.subproduct ? ` / ${d.subproduct}` : ''}`), el('td.num', {}, money(t.total)),
        el('td.num', {}, money(t.currentFY)), el('td.num', {}, money(t.nextFY)), el('td', {}, d.nextStepText || '—')); })
        : el('tr', {}, el('td', { colspan: 10 }, 'По фильтрам ничего не найдено')))));
  }

  function paymentsEditor(deal) {
    const rows = store.paymentsFor(deal.id).sort((a, b) => a.fiscalYear - b.fiscalYear || a.quarter.localeCompare(b.quarter));
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Реестр платежей · ${rows.length}`),
      canWrite(store.user) && actionButton('Добавить платёж', () => openPaymentForm(null, { presets: { dealId: deal.id } }), { primary: true, iconName: 'plus' })),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['ФГ', 'Квартал', 'Сумма без НДС', 'Тип', 'Статус', 'Оплата', 'Акт', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.length ? rows.map((p) => el('tr', {}, el('td', {}, `ФГ${String(p.fiscalYear).slice(-2)}`), el('td', {}, p.quarter), el('td.num', {}, money(p.amount)),
          el('td', {}, p.type), el('td', {}, p.status), el('td', {}, formatDate(p.paymentDate) || '—'), el('td', {}, formatDate(p.actDate) || '—'),
          el('td.row-actions', {}, canWrite(store.user) && actionButton('Изменить', () => openPaymentForm(p), { iconName: 'pencil' }),
            canWrite(store.user) && actionButton('Удалить', async () => { if (await confirmDialog({ title: 'Удалить платёж?' })) await store.deletePayment(p.id); }, { iconName: 'trash' }))))
          : el('tr', {}, el('td', { colspan: 8 }, 'Добавьте платёжные строки — сумма сделки появится автоматически.'))))),
      el('p.field-hint', {}, 'ФГ апрель–март: Q1 апрель–июнь, Q2 июль–сентябрь, Q3 октябрь–декабрь, Q4 январь–март.'));
  }

  function participantsEditor(deal) {
    const rows = deal.contacts || [];
    const save = (contacts) => store.updateDeal(deal.id, { contacts });
    const participantOptions = (current) => [
      el('option', { value: '' }, 'Не выбран'),
      ...rows.map((r) => el('option', { value: r.contactId, selected: r.contactId === current }, store.contactById(r.contactId)?.name || 'Контакт')),
    ];
    const economic = el('select.select', { disabled: !canWrite(store.user), onchange: (e) => store.updateDeal(deal.id, { economicBuyerContactId: e.target.value || null }) }, participantOptions(deal.economicBuyerContactId));
    const champion = el('select.select', { disabled: !canWrite(store.user), onchange: (e) => store.updateDeal(deal.id, { championContactId: e.target.value || null }) }, participantOptions(deal.championContactId));
    const contact = el('select.select', {}, el('option', { value: '' }, 'Контакт'), store.contacts.filter((c) => !rows.some((r) => r.contactId === c.id)).map((c) => el('option', { value: c.id }, c.name)));
    const role = el('input.input', { placeholder: 'Роль' });
    const influence = el('select.select', {}, ['За нас', 'Нейтрален', 'Против нас'].map((v) => el('option', { value: v }, v)));
    const bodyRows = rows.length ? rows.map((r) => {
      const roleInput = el('input.input', { value: r.role || '', disabled: !canWrite(store.user),
        onchange: (e) => save(rows.map((x) => x.contactId === r.contactId ? { ...x, role: e.target.value } : x)) });
      const influenceSelect = el('select.select', { disabled: !canWrite(store.user),
        onchange: (e) => save(rows.map((x) => x.contactId === r.contactId ? { ...x, influence: e.target.value } : x)) },
        ['', 'За нас', 'Нейтрален', 'Против нас'].map((v) => el('option', { value: v, selected: v === (r.influence || '') }, v || 'Не указано')));
      return el('tr', {}, el('td', {}, store.contactById(r.contactId)?.name || '—'), el('td', {}, roleInput), el('td', {}, influenceSelect),
        el('td', {}, canWrite(store.user) && actionButton('Удалить', () => save(rows.filter((x) => x.contactId !== r.contactId)), { iconName: 'trash' })));
    }) : [el('tr', {}, el('td', { colspan: 4 }, 'Участники не добавлены'))];
    return el('section.detail-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Участники со стороны клиента')),
      el('div.table-wrap', {}, el('table.data-table.compact', {},
        el('thead', {}, el('tr', {}, ['Контакт', 'Роль', 'Влияние', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.three', {}, contact, role, influence,
        actionButton('Добавить участника', () => { if (contact.value) save([...rows, { contactId: contact.value, role: role.value, influence: influence.value }]); }, { iconName: 'plus' })),
      el('div.form-grid', {},
        el('div.field', {}, el('label.field-label', {}, 'Экономический покупатель'), economic),
        el('div.field', {}, el('label.field-label', {}, 'Чемпион'), champion)));
  }

  function salesTeamEditor(deal) {
    const rows = store.salesTeamFor(deal.id);
    const save = (team) => store.setSalesTeam(deal.id, team.filter((row) => row.dealId === deal.id));
    const employee = el('select.select', {}, el('option', { value: '' }, 'Сотрудник'), store.employees.filter((e) => !rows.some((r) => r.employeeId === e.id)).map((e) => el('option', { value: e.id }, e.name)));
    const role = el('input.input', { placeholder: 'Роль в сделке' });
    const bodyRows = rows.length ? rows.map((r) => {
      const roleInput = el('input.input', { value: r.role || '', disabled: !canWrite(store.user),
        onchange: (e) => save(store.salesTeam.map((x) => x.id === r.id ? { ...x, role: e.target.value } : x)) });
      const primary = el('input', { type: 'radio', name: `primary-${deal.id}`, checked: r.primary, disabled: !canWrite(store.user),
        onchange: () => save(store.salesTeam.map((x) => x.dealId === deal.id ? { ...x, primary: x.id === r.id } : x)) });
      return el('tr', {}, el('td', {}, store.employeeById(r.employeeId)?.name || '—'), el('td', {}, roleInput), el('td', {}, primary),
        el('td', {}, canWrite(store.user) && actionButton('Удалить', () => save(store.salesTeam.filter((x) => x.id !== r.id)), { iconName: 'trash' })));
    }) : [el('tr', {}, el('td', { colspan: 4 }, 'Команда не назначена'))];
    return el('section.detail-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Команда продаж')),
      el('div.table-wrap', {}, el('table.data-table.compact', {},
        el('thead', {}, el('tr', {}, ['Сотрудник', 'Роль', 'Основной', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.three', {}, employee, role,
        actionButton('Добавить сотрудника', () => { if (employee.value) save([...store.salesTeam, { dealId: deal.id, employeeId: employee.value, role: role.value, primary: !rows.length }]); }, { iconName: 'plus' })),
      el('p.field-hint', {}, 'При наличии команды ровно один сотрудник отмечен как основной.'));
  }

  function detail() {
    const deal = store.dealById(id);
    if (!deal) { root.append(emptyState('Сделка не найдена', '', el('a.btn.btn-ghost', { href: '#/pipeline' }, 'К списку'))); return; }
    const totals = dealTotals(id, store.payments); const last = store.lastDealEvent(id); const company = store.companyById(deal.companyId);
    root.append(el('a.back-link', { href: '#/pipeline' }, '← Все сделки'),
      pageHead(deal.name, `${stageLabel(deal.stage)} · ${deal.status || 'Статус не указан'}`,
        actionButton('Экспорт XLSX', () => exportXlsx('deals', [deal], `Сделка-${deal.name}.xlsx`), { iconName: 'download' }),
        canWrite(store.user) && actionButton('Редактировать / закрыть', () => openDealForm(deal), { primary: true, iconName: 'pencil' })),
      el('div.stat-strip', {}, el('div', {}, el('span', {}, 'Общая сумма'), el('strong', {}, money(totals.total))),
        el('div', {}, el('span', {}, `Текущий ФГ${String(fiscalYearAt()).slice(-2)}`), el('strong', {}, money(totals.currentFY))),
        el('div', {}, el('span', {}, `Следующий ФГ${String(fiscalYearAt() + 1).slice(-2)}`), el('strong', {}, money(totals.nextFY))),
        el('div', {}, el('span', {}, 'Вероятность стадии'), el('strong', {}, DEAL_STAGES.find((s) => s.id === deal.stage)?.probability == null ? 'Не задана' : `${Math.round(DEAL_STAGES.find((s) => s.id === deal.stage).probability * 100)}%`))),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Параметры сделки')),
        facts([['Контрагент', company ? el('a.record-link', { href: `#/companies?id=${company.id}` }, company.name) : '—'],
          ['Продукт / подпродукт', `${deal.product || '—'} / ${deal.subproduct || '—'}`], ['Независимый статус', deal.status || '—'],
          ['Категория вероятности', deal.probabilityCategory || '—'], ['Партнёр', store.companyById(deal.partnerId)?.name || '—'],
          ['Конкуренты', deal.competitorIds?.map((cid) => store.companyById(cid)?.name).filter(Boolean).join(', ') || '—'], ['Риски', deal.risks || '—'],
          ['Дата договора', formatDate(deal.contractDate) || '—'], ['Дата старта работ', formatDate(deal.workStartDate) || '—'],
          ['Событие заказчика', `${deal.clientEvent || '—'}${deal.clientEventDate ? ` · ${formatDate(deal.clientEventDate)}` : ''}`],
          ['Что клиент вложил', deal.clientInvestment || '—'], ['Бюджет', deal.budget || '—'], ['Тип покупки', deal.purchaseType || '—'],
          ['Последнее событие', last ? `${formatDate(last.date)} · ${last.summary}` : 'Событий не зафиксировано'],
          ['Следующий шаг', deal.nextStepText || '—'], ['Дата следующего шага', formatDate(deal.nextStepDate) || '—'],
          ['Исход', deal.outcome || 'Открыта'], ['Дата закрытия', deal.closedAt ? new Date(deal.closedAt).toLocaleDateString('ru-RU') : '—'],
          ['Причина закрытия', deal.closeReason || '—'], ['Кто выиграл', deal.winner || '—'],
          ['Связанный лид', deal.sourceLeadId ? el('a.record-link', { href: `#/leads?id=${deal.sourceLeadId}` }, 'Открыть лид (справочно)') : 'Сделка создана напрямую'],
          ['Себестоимость / маржинальность', 'Зарезервировано для следующего этапа'],
        ])),
      paymentsEditor(deal), participantsEditor(deal), salesTeamEditor(deal), relatedRecords('deal', id),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Системный реестр изменений стадии')),
        el('p.field-hint', {}, 'Все переходы сохраняются, включая возвраты и регрессы. Ограничения в 50 записей нет.'),
        historyTable(store.dealStageHistoryFor(id), DEAL_STAGES)), avandokEmpty(),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить сделку', async () => {
        if (!await confirmDialog({ title: 'Удалить сделку?', message: 'Записи журнала стадий сохранятся для аудита.' })) return;
        await store.deleteDeal(id); navigate('#/pipeline');
      }, { iconName: 'trash' })));
  }

  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
