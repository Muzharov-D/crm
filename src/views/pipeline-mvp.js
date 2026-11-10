import { el, clear, keepingFocus, append } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { DEAL_STAGES, dealTotals, fiscalYearAt, dictionaryOptions, productForSubproduct } from '../lib/spec.js';
import { composeDealName } from '../lib/mvp.js';
import { canWrite } from '../lib/access.js';
import { isOpen } from '../lib/forecast.js';
import { openDealForm, openPaymentForm, openContactForm, openEmployeeForm, openTaskForm } from '../ui/mvp-forms.js';
import { openDealClosureForm, openDealEventForm } from '../ui/deal-forms.js';
import { pageHead, actionButton, emptyState, facts, avandokEmpty, money } from '../ui/mvp-bits.js';
import { field, textInput, searchSelect } from '../ui/forms.js';
import { customFieldInputs } from '../ui/custom-fields.js';
import { exportXlsx, importPipelineXlsx } from '../lib/xlsx.js';
import { formatDate, fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { isFinalStage } from '../lib/deal-workflow.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

const stageLabel = (id) => store.stages().find((stage) => stage.id === id)?.label
  || DEAL_STAGES.find((stage) => stage.id === id)?.label || id || '—';
const byName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const recordOptions = (rows, empty = 'Не выбрано') => [
  { value: '', label: empty }, ...byName(rows).map((row) => ({ value: row.id, label: row.name })),
];
const dictionarySelectOptions = (key, current = '', parent = null) => {
  const options = dictionaryOptions(store.settings, key, { parent });
  if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: current });
  return options.map((option) => el('option', { value: option.value, selected: option.value === current }, option.label));
};
const dateTime = (stamp) => stamp ? new Date(stamp).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const amountOf = (deal) => deal.value ?? (deal.amountMode === 'payments' ? dealTotals(deal.id, store.payments).total : null);
const personName = (id) => store.employeeById(id)?.name || '—';
const stepStatus = { active: 'Активен', completed: 'Выполнен', cancelled: 'Отменён' };
const stepActionLabels = {
  keep: 'Без изменения шага', 'complete-next': 'Выполнен и назначен следующий', complete: 'Выполнен без нового шага',
  change: 'Изменён', 'cancel-replace': 'Отменён и заменён', cancel: 'Отменён без нового шага', create: 'Создан',
};

export function pipelineMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = {
    search: '', product: '', status: '', category: '', showClosed: false, layout: 'list',
    sortKey: 'updatedAt', sortDirection: 'desc', filters: [], tab: 'main',
  };
  const render = keepingFocus(() => { clear(root); if (id) detail(); else list(); });

  const dealColumns = () => [
    { key: 'name', label: 'Сделка', get: (deal) => deal.name || '' },
    { key: 'company', label: 'Контрагент', get: (deal) => store.companyById(deal.companyId)?.name || '' },
    { key: 'stage', label: 'Стадия', get: (deal) => stageLabel(deal.stage) },
    { key: 'status', label: 'Статус', get: (deal) => deal.status || '' },
    { key: 'owner', label: 'Ответственный', get: (deal) => deal.employeeId ? personName(deal.employeeId) : '' },
    { key: 'product', label: 'Продукт', get: (deal) => `${deal.product || ''}${deal.subproduct ? ` / ${deal.subproduct}` : ''}` },
    { key: 'amount', label: 'Сумма', type: 'number', numeric: true, get: amountOf },
    { key: 'lastEvent', label: 'Последнее событие', get: (deal) => store.lastDealEvent(deal.id)?.summary || '' },
    { key: 'lastEventDate', label: 'Дата события', type: 'date', get: (deal) => store.lastDealEvent(deal.id)?.date || '' },
    { key: 'nextStep', label: 'Активный следующий шаг', get: (deal) => store.activeDealStep(deal.id)?.action || '' },
    { key: 'stepOwner', label: 'Ответственный за шаг', get: (deal) => store.activeDealStep(deal.id)?.employeeId ? personName(store.activeDealStep(deal.id).employeeId) : '' },
    { key: 'due', label: 'Срок шага', type: 'date', get: (deal) => store.activeDealStep(deal.id)?.due || '' },
    { key: 'overdue', label: 'Просрочка, дней', type: 'number', numeric: true, get: (deal) => store.activeDealStep(deal.id)?.overdueDays || 0 },
    { key: 'updatedAt', label: 'Обновлена', type: 'date', get: (deal) => deal.updatedAt ? new Date(deal.updatedAt).toISOString().slice(0, 10) : '' },
  ];

  function filteredDeals() {
    return filterRecords(store.deals.filter((deal) => (state.showClosed || isOpen(deal))
      && (!state.product || deal.product === state.product) && (!state.status || deal.status === state.status)
      && (!state.category || deal.probabilityCategory === state.category)
      && (!state.search || fuzzyIncludes(`${deal.name} ${store.companyById(deal.companyId)?.name || ''} ${personName(deal.employeeId)} ${store.activeDealStep(deal.id)?.action || ''}`, state.search))), dealColumns(), state.filters);
  }

  function list() {
    const results = el('div.deal-search-results');
    const renderResults = () => {
      const deals = filteredDeals();
      clear(results).append(el('div.registry-summary', {}, el('span', {}, `${deals.length} из ${store.deals.length}`),
        el('span', {}, 'Сумма учитывает ручную оценку или реестр платежей')),
        !store.deals.length ? emptyState('Сделок пока нет', 'Создайте сделку напрямую, переведите квалифицированный лид или импортируйте текущий пайплайн XLSX.')
          : state.layout === 'board' ? board(sortRecords(deals, dealColumns(), state)) : table(deals, renderResults));
    };
    const search = el('input.input', {
      type: 'search', value: state.search, placeholder: 'Сделка, контрагент, ответственный или следующий шаг',
      'aria-label': 'Поиск сделок', dataset: { focusKey: 'deal-list-search' },
      oninput: (event) => { state.search = event.target.value; renderResults(); },
    });
    const product = el('select.select', { onchange: (event) => { state.product = event.target.value; renderResults(); } },
      el('option', { value: '' }, 'Все продукты'), [...new Set(store.deals.map((deal) => deal.product).filter(Boolean))].map((value) => el('option', { value, selected: state.product === value }, value)));
    const status = el('select.select', { onchange: (event) => { state.status = event.target.value; renderResults(); } },
      el('option', { value: '' }, 'Все статусы'), [...new Set(store.deals.map((deal) => deal.status).filter(Boolean))].map((value) => el('option', { value, selected: state.status === value }, value)));
    const category = el('select.select', { onchange: (event) => { state.category = event.target.value; renderResults(); } },
      el('option', { value: '' }, 'Все категории'), ['Высокая', 'Средняя', 'Низкая'].map((value) => el('option', { value, selected: state.category === value }, value)));
    const closed = el('label.check-label', {}, el('input', { type: 'checkbox', checked: state.showClosed,
      onchange: (event) => { state.showClosed = event.target.checked; renderResults(); } }), ' Показывать закрытые');
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (event) => {
      const selected = event.target.files[0]; if (!selected) return;
      try {
        await store.saveSnapshot('XLSX импорт пайплайна');
        const result = await importPipelineXlsx(selected);
        toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`, { icon: 'check' });
      } catch (error) { console.error(error); toast(`Не удалось импортировать XLSX: ${error.message}`, { icon: 'alert' }); }
    } });
    const layoutButtons = el('div.segmented', {},
      actionButton('Канбан', () => { state.layout = 'board'; syncLayout(); renderResults(); }, { attrs: { 'aria-pressed': 'false', 'data-layout': 'board' } }),
      actionButton('Список', () => { state.layout = 'list'; syncLayout(); renderResults(); }, { attrs: { 'aria-pressed': 'true', 'data-layout': 'list' } }));
    const syncLayout = () => layoutButtons.querySelectorAll('[data-layout]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === state.layout)));
    root.append(
      pageHead('Сделки', 'Ручная оценка или сумма платежей, единый следующий шаг и полная история изменений.',
        canWrite(store.user) && file, canWrite(store.user) && actionButton('Импорт XLSX', () => file.click(), { iconName: 'upload' }),
        actionButton('Экспорт XLSX', () => exportXlsx('deals', sortRecords(filteredDeals(), dealColumns(), state)), { iconName: 'download' }),
        canWrite(store.user) && actionButton('Новая сделка', () => openDealForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, product, status, category, closed, layoutButtons),
      advancedFilters(dealColumns(), state.filters, renderResults), results,
    );
    syncLayout(); renderResults();
  }

  function changeStage(deal, stage) {
    if (stage === deal.stage) return;
    if (isFinalStage(stage) || isFinalStage(deal.stage)) {
      openDealClosureForm(deal, { stage: isFinalStage(stage) ? stage : deal.stage });
      return;
    }
    store.moveDeal(deal.id, stage, { expectedRevision: deal.revision })
      .catch((error) => toast(error.message || 'Не удалось изменить стадию', { icon: 'alert' }));
  }

  function board(deals) {
    return el('div.pipeline-board.mvp-board', {}, store.stages().map((stage) => {
      const rows = deals.filter((deal) => deal.stage === stage.id);
      const total = rows.reduce((sum, deal) => sum + (amountOf(deal) || 0), 0);
      const column = el('section.pipeline-column', { dataset: { stage: stage.id } },
        el('div.pipeline-column-head', {}, el('span', {}, stage.label), el('span.muted', {}, `${rows.length} · ${money(total)}`)), rows.map((deal) => card(deal)));
      column.addEventListener('dragover', (event) => { if (canWrite(store.user)) { event.preventDefault(); column.classList.add('drag-over'); } });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', (event) => {
        event.preventDefault(); column.classList.remove('drag-over'); if (!canWrite(store.user)) return;
        const deal = store.dealById(event.dataTransfer.getData('text/deal-id')); if (deal) changeStage(deal, stage.id);
      });
      return column;
    }));
  }

  function card(deal) {
    const step = store.activeDealStep(deal.id);
    const node = el('article.deal-card.mvp-deal-card', { draggable: canWrite(store.user) ? 'true' : 'false' },
      el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name),
      el('p.muted', {}, store.companyById(deal.companyId)?.name || 'Контрагент не указан'),
      el('strong', {}, amountOf(deal) === null ? 'Сумма не оценена' : money(amountOf(deal))),
      el('div.deal-card-meta', {}, `${deal.status || '—'} · ${personName(deal.employeeId)}`),
      step && el('div.deal-card-meta', {}, `${step.action} · ${formatDate(step.due)}${step.overdueDays ? ` · просрочка ${step.overdueDays} дн.` : ''}`),
      el('select.select', { 'aria-label': `Стадия сделки ${deal.name}`, disabled: !canWrite(store.user),
        onchange: (event) => { const target = event.target.value; event.target.value = deal.stage; changeStage(deal, target); } },
        store.stages().map((stage) => el('option', { value: stage.id, selected: stage.id === deal.stage }, stage.label))));
    node.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/deal-id', deal.id); event.dataTransfer.effectAllowed = 'move'; });
    return node;
  }

  function table(deals, refresh) {
    const columns = dealColumns();
    const rows = sortRecords(deals, columns, state);
    return el('div.table-wrap.registry-table-wrap', {}, el('table.data-table.deal-registry-table', {},
      registryHead(columns, state, (key) => { toggleSort(state, key); refresh(); }),
      el('tbody', {}, rows.length ? rows.map((deal) => {
        const event = store.lastDealEvent(deal.id);
        const step = store.activeDealStep(deal.id);
        return el('tr', {},
          el('td', {}, el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name), el('span.registry-secondary', {}, deal.topic || 'Тема не указана')),
          el('td', {}, store.companyById(deal.companyId)?.name || '—'), el('td', {}, stageLabel(deal.stage)),
          el('td', {}, el('span.status-pill', {}, deal.status || '—')), el('td', {}, personName(deal.employeeId)),
          el('td', {}, `${deal.product || '—'}${deal.subproduct ? ` / ${deal.subproduct}` : ''}`),
          el('td.num', {}, amountOf(deal) === null ? '—' : money(amountOf(deal))),
          el('td', {}, event?.summary || '—'), el('td', {}, formatDate(event?.date) || '—'),
          el('td', {}, step?.action || '—'), el('td', {}, personName(step?.employeeId)), el('td', {}, formatDate(step?.due) || '—'),
          el('td', { className: step?.overdueDays ? 'num negative' : 'num' }, step?.overdueDays || '—'),
          el('td', {}, deal.updatedAt ? formatDate(new Date(deal.updatedAt).toISOString().slice(0, 10)) : '—'));
      }) : el('tr', {}, el('td', { colspan: columns.length }, 'По фильтрам ничего не найдено')))));
  }

  function lifecycle(deal) {
    const stages = store.stages();
    const current = Math.max(0, stages.findIndex((stage) => stage.id === deal.stage));
    return el('section.detail-section.deal-lifecycle-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Жизненный цикл'), el('span.muted', {}, `${current + 1} из ${stages.length}`)),
      el('ol.deal-lifecycle', {}, stages.map((stage, index) => {
        const status = index < current ? 'done' : index === current ? 'current' : 'next';
        return el('li', { className: `lifecycle-${status}` }, el('button.lifecycle-step', {
          type: 'button', disabled: !canWrite(store.user), dataset: { stage: stage.id, focusKey: `lifecycle-${stage.id}` },
          'aria-current': index === current ? 'step' : null, 'aria-label': `${index + 1}. ${stage.label}`,
          onclick: () => changeStage(deal, stage.id),
        }, el('span.lifecycle-index', {}, index < current ? '✓' : String(index + 1)), el('span.lifecycle-label', {}, stage.label)));
      })));
  }

  function sidebar(deal, save, queue) {
    const disabled = !canWrite(store.user);
    const focus = (key) => ({ focusKey: `deal-field-${key}` });
    const topic = textInput({ value: deal.topic || '', disabled, maxlength: 180, dataset: focus('topic') });
    const product = el('select.select', { disabled, dataset: focus('product') }, dictionarySelectOptions('products', deal.product || ''));
    const subproduct = el('select.select', { disabled, dataset: focus('subproduct') }, dictionarySelectOptions('subproducts', deal.subproduct || '', deal.product || null));
    const status = el('select.select', { disabled: disabled || isFinalStage(deal.stage), dataset: focus('status') }, dictionarySelectOptions('dealStatuses', deal.status || ''));
    const stage = el('select.select', { disabled, dataset: focus('stage') }, store.stages().map((row) => el('option', { value: row.id, selected: row.id === deal.stage }, row.label)));
    const users = textInput({ value: deal.userCount ?? '', type: 'number', min: 0, step: 1, disabled, dataset: focus('userCount') });
    const source = el('select.select', { disabled, dataset: focus('source') }, dictionarySelectOptions('dealSources', deal.source || ''));
    const channel = el('select.select', { disabled, dataset: focus('channel') }, dictionarySelectOptions('dealChannels', deal.channel || ''));
    const company = searchSelect(recordOptions(store.companies, 'Выберите контрагента'), deal.companyId || '', { disabled, placeholder: 'Найти контрагента', focusKey: 'deal-field-company' });
    const contactRows = () => store.contacts.filter((row) => !company.select.value || row.companyId === company.select.value || row.id === deal.contactId);
    const contact = searchSelect(recordOptions(contactRows(), 'Без основного контакта'), deal.contactId || '', { disabled, placeholder: 'Найти контакт', focusKey: 'deal-field-contact' });
    const owner = el('select.select', { disabled, dataset: focus('employeeId') },
      el('option', { value: '' }, 'Не назначен'), store.activeEmployees([deal.employeeId]).map((row) => el('option', { value: row.id, selected: row.id === deal.employeeId }, row.name)));
    const mode = el('select.select', { disabled, dataset: focus('amountMode') },
      el('option', { value: 'manual', selected: deal.amountMode !== 'payments' }, 'Ручная оценка'),
      el('option', { value: 'payments', selected: deal.amountMode === 'payments' }, 'Сумма платежей'));
    const manual = textInput({ value: deal.manualValue ?? '', type: 'number', min: 0, step: '0.01', disabled: disabled || deal.amountMode === 'payments', dataset: focus('manualValue') });
    const bind = (control, key, read = () => control.value, text = false) => {
      if (text) control.addEventListener('input', () => queue({ [key]: read() }));
      control.addEventListener('change', () => save({ [key]: read() }));
    };
    bind(topic, 'topic', () => topic.value.trim(), true);
    product.addEventListener('change', () => {
      if (productForSubproduct(store.settings, subproduct.value) !== product.value) subproduct.value = '';
      subproduct.replaceChildren(...dictionarySelectOptions('subproducts', subproduct.value, product.value || null));
      save({ product: product.value, subproduct: subproduct.value });
    });
    bind(subproduct, 'subproduct'); bind(status, 'status');
    bind(users, 'userCount', () => users.value === '' ? 0 : Math.max(0, Math.floor(Number(users.value) || 0)));
    bind(source, 'source'); bind(channel, 'channel');
    stage.addEventListener('change', () => { const target = stage.value; stage.value = deal.stage; changeStage(deal, target); });
    company.select.addEventListener('change', () => {
      const selected = store.contactById(contact.select.value);
      const contactId = selected && (!company.select.value || selected.companyId === company.select.value) ? selected.id : null;
      const contacts = (deal.contacts || []).filter((row) => {
        const person = store.contactById(row.contactId);
        return person && (!company.select.value || person.companyId === company.select.value);
      });
      contact.setOptions(recordOptions(contactRows(), 'Без основного контакта'), contactId || '');
      save({ companyId: company.select.value || null, contactId, contacts });
    });
    contact.select.addEventListener('change', () => save({ contactId: contact.select.value || null }));
    bind(owner, 'employeeId', () => owner.value || null);
    mode.addEventListener('change', () => store.setDealAmount(deal.id, { mode: mode.value })
      .catch((error) => toast(error.message || 'Не удалось изменить способ оценки', { icon: 'alert' })));
    bind(manual, 'manualValue', () => manual.value === '' ? null : Math.max(0, Number(manual.value) || 0), true);
    return el('aside.deal-sidebar', {},
      el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Параметры сделки'),
        field('Тема', topic), field('Продукт', product), field('Подпродукт', subproduct), field('Статус', status), field('Стадия', stage),
        field('Количество пользователей', users), field('Источник', source), field('Канал', channel)),
      el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Связи'),
        field('Основной контакт', contact.wrap), field('Контрагент', company.wrap)),
      el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Ответственность и оценка'),
        field('Ответственный', owner), field('Способ оценки', mode),
        field(deal.amountMode === 'payments' ? 'Сумма платежей, без НДС' : 'Ручная оценка, без НДС', manual,
          { hint: deal.amountMode === 'payments' ? 'Переключение на ручную оценку сохраняет прежнюю ручную сумму для возврата.' : 'Пусто — оценка не задана. Явный ноль сохраняется как ноль.' }),
        el('div.deal-effective-amount', {}, el('span', {}, 'Эффективная сумма'), el('strong', {}, amountOf(deal) === null ? 'Не оценена' : money(amountOf(deal)))),
        el('div.deal-update-line', {}, el('span', {}, 'Апдейт'), el('strong', {}, dateTime(deal.updatedAt))),
        el('p.autosave-hint', {}, disabled ? 'Только просмотр' : 'Выбор сохраняется сразу, текст — при выходе из поля или переключении вкладки.')));
  }

  function mainTab(deal, save, queue) {
    const disabled = !canWrite(store.user);
    const focus = (key) => ({ focusKey: `deal-field-${key}` });
    const contractDate = textInput({ value: deal.contractDate || '', type: 'date', disabled, dataset: focus('contractDate') });
    const workStartDate = textInput({ value: deal.workStartDate || '', type: 'date', disabled, dataset: focus('workStartDate') });
    const expectedClose = textInput({ value: deal.expectedClose || '', type: 'date', disabled, dataset: focus('expectedClose') });
    const clientEvent = textInput({ value: deal.clientEvent || '', disabled, dataset: focus('clientEvent') });
    const clientEventDate = textInput({ value: deal.clientEventDate || '', type: 'date', disabled, dataset: focus('clientEventDate') });
    const investment = el('select.select', { disabled, dataset: focus('clientInvestment') }, dictionarySelectOptions('clientInvestments', deal.clientInvestment || ''));
    const budget = el('select.select', { disabled, dataset: focus('budget') }, dictionarySelectOptions('budgets', deal.budget || ''));
    const purchase = el('select.select', { disabled, dataset: focus('purchaseType') }, dictionarySelectOptions('purchaseTypes', deal.purchaseType || ''));
    const probability = el('select.select', { disabled, dataset: focus('probabilityCategory') }, dictionarySelectOptions('probabilityCategories', deal.probabilityCategory || ''));
    const partner = searchSelect(recordOptions(store.companies.filter((row) => row.role === 'Партнёр-интегратор' || row.id === deal.partnerId), 'Без партнёра'), deal.partnerId || '', { disabled, focusKey: 'deal-field-partner' });
    const notes = el('textarea.input.textarea', { rows: 4, disabled, dataset: focus('notes') }, deal.notes || '');
    const custom = customFieldInputs('deals', deal);
    const bind = (control, key, text = false) => {
      if (text) control.addEventListener('input', () => queue({ [key]: control.value }));
      control.addEventListener('change', () => save({ [key]: control.value }));
    };
    for (const [control, key] of [[contractDate, 'contractDate'], [workStartDate, 'workStartDate'], [expectedClose, 'expectedClose'],
      [clientEventDate, 'clientEventDate'], [investment, 'clientInvestment'], [budget, 'budget'], [purchase, 'purchaseType'], [probability, 'probabilityCategory']]) bind(control, key);
    bind(clientEvent, 'clientEvent', true); bind(notes, 'notes', true);
    partner.select.addEventListener('change', () => save({ partnerId: partner.select.value || null }));
    if (custom) for (const node of custom.nodes) {
      node.addEventListener('change', () => save({ custom: custom.get() }));
      node.addEventListener('click', (event) => { if (event.target.closest('.switch')) queueMicrotask(() => save({ custom: custom.get() })); });
    }
    return el('div.deal-tab-panel', {},
      el('section.detail-section.deal-main-parameters', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Основная информация')),
        el('div.form-grid.deal-inline-grid', {},
          field('Дата договора', contractDate), field('Дата старта работ', workStartDate), field('Плановая дата закрытия', expectedClose),
          field('Событие заказчика', clientEvent), field('Дата события заказчика', clientEventDate), field('Партнёр', partner.wrap),
          field('Что клиент вложил', investment), field('Бюджет', budget), field('Тип покупки', purchase), field('Категория вероятности', probability)),
        field('Комментарий', notes), custom ? el('div.deal-custom-fields', {}, el('h3.related-subtitle', {}, 'Пользовательские поля'), custom.nodes) : null),
      participantsEditor(deal), salesTeamEditor(deal), paymentsEditor(deal), avandokEmpty());
  }

  function competitorsTab(deal, save, queue) {
    const disabled = !canWrite(store.user);
    const selected = () => byName(store.companies.filter((company) => deal.competitorIds?.includes(company.id)));
    const available = () => byName(store.companies.filter((company) => company.role === 'Конкурент' && !deal.competitorIds?.includes(company.id)));
    const picker = searchSelect(recordOptions(available(), 'Выберите конкурента'), '', { disabled, placeholder: 'Поиск компании-конкурента', focusKey: 'deal-competitor-search' });
    picker.select.addEventListener('change', () => {
      if (picker.select.value) save({ competitorIds: [...new Set([...(deal.competitorIds || []), picker.select.value])] });
    });
    const risks = el('textarea.input.textarea.deal-risks-input', { rows: 8, disabled, dataset: { focusKey: 'deal-field-risks' },
      placeholder: 'Опишите риски по срокам, бюджету, решению, закупке и команде клиента…' }, deal.risks || '');
    risks.addEventListener('input', () => queue({ risks: risks.value }));
    risks.addEventListener('change', () => save({ risks: risks.value }));
    return el('div.deal-tab-panel', {},
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Конкуренты · ${selected().length}`)),
        !disabled && field('Добавить конкурента', picker.wrap, { hint: 'Обычный клик добавляет компанию. Ctrl/Cmd не нужен.' }),
        selected().length ? el('div.competitor-list', {}, selected().map((company) => el('article.competitor-row', {},
          el('div.grow.min0', {}, el('a.record-link', { href: `#/companies?id=${company.id}` }, company.name),
            el('span.registry-secondary', {}, company.industry || 'Компания из справочника контрагентов')),
          !disabled && actionButton('Убрать из сделки', () => save({ competitorIds: (deal.competitorIds || []).filter((companyId) => companyId !== company.id) }), { iconName: 'trash' }))))
          : el('div.next-steps-empty', {}, el('strong', {}, 'Конкуренты не выбраны'), el('p', {}, 'Добавьте одну или несколько компаний через поиск.')),
        el('p.field-hint', {}, 'Удаляется только связь со сделкой. Компания и её данные остаются в справочнике.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Риски')), field('Риски сделки', risks)));
  }

  function stepCard(step, { compact = false } = {}) {
    if (!step) return null;
    return el('article.deal-step-card', { className: `deal-step-card ${step.status}` },
      el('div.deal-step-head', {}, el('strong', {}, step.action), el('span.status-pill', {}, stepStatus[step.status] || step.status)),
      el('div.next-step-meta', {}, el('span', {}, personName(step.employeeId)), el('span', {}, `Срок: ${formatDate(step.due) || '—'}`),
        step.originalDue && step.originalDue !== step.due && el('span', {}, `Первоначальный срок: ${formatDate(step.originalDue)}`),
        step.status === 'active' && step.overdueDays > 0 && el('span.negative', {}, `Просрочка ${step.overdueDays} дн.`)),
      !compact && el('div.registry-secondary', {}, `Создан: ${dateTime(step.createdAt)} · ${personName(step.createdBy)}`),
      step.closedAt && el('div.registry-secondary', {}, `Закрыт: ${dateTime(step.closedAt)} · ${personName(step.closedBy)}`),
      step.closeReason && el('div.record-description', {}, `Причина отмены: ${step.closeReason}`),
      !compact && step.changes?.length > 0 && el('div.step-change-list', {}, step.changes.slice().reverse().map((change) => el('div.step-change', {},
        `${dateTime(change.at)} · ${({ action: 'действие', due: 'срок', employeeId: 'ответственный' })[change.field] || change.field}: ${change.field === 'employeeId' ? `${personName(change.previousValue)} → ${personName(change.newValue)}` : change.field === 'due' ? `${formatDate(change.previousValue)} → ${formatDate(change.newValue)}` : `${change.previousValue || '—'} → ${change.newValue || '—'}`}${change.reason ? ` · Причина: ${change.reason}` : ''}`))));
  }

  function timelineTab(deal) {
    const active = store.activeDealStep(deal.id);
    const events = store.activitiesFor({ dealId: deal.id }).sort((a, b) => (b.eventAt || b.createdAt || 0) - (a.eventAt || a.createdAt || 0));
    const steps = store.dealStepsFor(deal.id);
    const tasks = store.tasks.filter((task) => task.dealId === deal.id)
      .sort((a, b) => Number(a.done) - Number(b.done) || String(a.due).localeCompare(String(b.due)) || a.createdAt - b.createdAt);
    const presets = { dealId: deal.id, companyId: deal.companyId || null, contactId: deal.contactId || null, leadId: deal.sourceLeadId || null };
    return el('div.deal-tab-panel', {},
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Активный следующий шаг'),
        canWrite(store.user) && el('div.view-actions', {},
          active && actionButton('Внести результат', () => openDealEventForm(deal, { complete: true }), { primary: true, iconName: 'check' }),
          actionButton('Добавить событие', () => openDealEventForm(deal), { primary: !active, iconName: 'plus' }))),
        active ? stepCard(active) : el('div.notice.warning', {}, isFinalStage(deal.stage)
          ? 'У закрытой сделки нет активного следующего шага. Новые события добавляются только в хронологию.'
          : 'Активного шага нет. При сохранении события назначьте действие, срок и ответственного.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Хронология · ${events.length}`)),
        el('p.field-hint', {}, 'События и связанные изменения шагов не редактируются и не удаляются. Уточнение создаётся новым событием.'),
        events.length ? el('div.deal-timeline', {}, events.map((event) => {
          const closed = store.dealSteps.find((step) => step.id === event.closedStepId);
          const created = store.dealSteps.find((step) => step.id === event.newStepId);
          return el('article.deal-timeline-event', {},
            el('div.deal-timeline-meta', {}, el('strong', {}, personName(event.employeeId)), el('span', {}, dateTime(event.eventAt || event.createdAt)),
              event.previousStage !== event.newStage && el('span', {}, `${stageLabel(event.previousStage)} → ${stageLabel(event.newStage)}`)),
            el('p.deal-timeline-summary', {}, event.summary || event.notes),
            event.stepAction && el('span.status-pill', {}, stepActionLabels[event.stepAction] || event.stepAction),
            event.changeReason && el('p.registry-secondary', {}, `Причина: ${event.changeReason}`),
            closed && event.stepAction !== 'change' && el('div.deal-linked-step', {}, el('span', {}, 'Закрытый шаг'), stepCard(closed, { compact: true })),
            event.stepChanges?.length > 0 && el('div.deal-linked-step', {}, el('span', {}, 'Было → стало'), stepCard(closed)),
            created && el('div.deal-linked-step', {}, el('span', {}, 'Новый следующий шаг'), stepCard(created, { compact: true })));
        })) : emptyState('Событий пока нет', 'Первое событие зафиксирует результат работы и свяжет его со следующим шагом.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `История следующих шагов · ${steps.length}`)),
        steps.length ? el('div.deal-step-history', {}, steps.map((step) => stepCard(step))) : el('p.muted', {}, 'Записей пока нет.')),
      el('section.detail-section.next-steps-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Отдельные задачи · ${tasks.length}`),
        canWrite(store.user) && actionButton('Добавить задачу', () => openTaskForm(null, { presets }), { iconName: 'plus' })),
        el('p.field-hint', {}, 'Задачи сохранены как самостоятельный реестр и не заменяют единый активный следующий шаг сделки.'),
        tasks.length ? el('div.next-steps-list', {}, tasks.map((task) => el('article', { className: `next-step${task.done ? ' done' : ''}` },
          el('input.next-step-check', { type: 'checkbox', checked: task.done, disabled: !canWrite(store.user),
            'aria-label': `${task.done ? 'Вернуть в работу' : 'Завершить'}: ${task.title}`,
            onchange: (event) => store.toggleTask(task.id, event.target.checked) }),
          el('div.next-step-main', {}, el('button.next-step-title', { type: 'button', onclick: () => openTaskForm(task) }, task.title),
            el('div.next-step-meta', {}, el('span', {}, personName(task.employeeId)), el('span', {}, `Срок: ${formatDate(task.due) || '—'}`),
              el('span.status-pill', {}, task.status || (task.done ? 'Выполнено' : 'К выполнению')))))))
          : el('p.muted', {}, 'Связанных задач нет.')));
  }

  function systemTab(deal) {
    const stages = store.dealStageHistoryFor(deal.id).slice().reverse();
    const fields = store.dealFieldHistoryFor(deal.id);
    return el('div.deal-tab-panel', {},
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Результат и системные сведения')),
        facts([
          ['Стадия', stageLabel(deal.stage)], ['Статус', deal.status || '—'], ['Исход', deal.outcome || 'Открыта'],
          ['Фактическая дата закрытия', formatDate(deal.closedOn) || '—'], ['Операция закрытия', deal.closedAt ? dateTime(deal.closedAt) : '—'],
          ['Причина закрытия', deal.closeReason || '—'], ['Комментарий закрытия', deal.closeReasonNote || '—'], ['Кто выиграл', deal.winner || '—'],
          ['Ревизия', deal.revision || 1], ['Создана', dateTime(deal.createdAt)], ['Обновлена', dateTime(deal.updatedAt)],
          ['Связанный лид', deal.sourceLeadId ? el('a.record-link', { href: `#/leads?id=${deal.sourceLeadId}` }, 'Открыть лид') : 'Сделка создана напрямую'],
        ])),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Журнал стадий · ${stages.length}`)),
        el('p.field-hint', {}, 'Новые записи сверху. Сохраняются пользователь, предыдущая и новая стадия.'),
        el('div.table-wrap.registry-table-wrap', {}, el('table.data-table.compact', {},
          el('thead', {}, el('tr', {}, ['Дата и время', 'Пользователь', 'Предыдущая стадия', 'Новая стадия'].map((label) => el('th', {}, label)))),
          el('tbody', {}, stages.length ? stages.map((row) => el('tr', {}, el('td', {}, dateTime(row.at)),
            el('td', {}, row.actorName || personName(row.actorId)), el('td', {}, stageLabel(row.previousStage)), el('td', {}, stageLabel(row.newStage))))
            : el('tr', {}, el('td', { colspan: 4 }, 'Записей пока нет')))))),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Журнал полей · ${fields.length}`)),
        el('p.field-hint', {}, 'Фиксируются только успешные изменения, включая заполнение, очистку, автосохранение и пересчёт по платежам.'),
        el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
          el('thead', {}, el('tr', {}, ['Дата и время', 'Пользователь / процесс', 'Поле', 'Старое значение', 'Новое значение', 'Причина'].map((label) => el('th', {}, label)))),
          el('tbody', {}, fields.length ? fields.map((row) => el('tr', {}, el('td', {}, dateTime(row.at)), el('td', {}, row.actorName || 'Системный процесс'),
            el('td', {}, row.label || row.field), el('td', {}, row.previousDisplay || '—'), el('td', {}, row.newDisplay || '—'), el('td', {}, row.reason || '—')))
            : el('tr', {}, el('td', { colspan: 6 }, 'Записей пока нет')))))));
  }

  function paymentsEditor(deal) {
    const rows = store.paymentsFor(deal.id).sort((a, b) => a.fiscalYear - b.fiscalYear || a.quarter.localeCompare(b.quarter));
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Реестр платежей · ${rows.length}`),
      canWrite(store.user) && actionButton('Добавить платёж', () => openPaymentForm(null, { presets: { dealId: deal.id } }), { primary: true, iconName: 'plus' })),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['ФГ', 'Квартал', 'Сумма без НДС', 'Тип', 'Статус', 'Оплата', 'Акт', ''].map((label) => el('th', {}, label)))),
        el('tbody', {}, rows.length ? rows.map((payment) => el('tr', {}, el('td', {}, `ФГ${String(payment.fiscalYear).slice(-2)}`), el('td', {}, payment.quarter),
          el('td.num', {}, money(payment.amount)), el('td', {}, payment.type), el('td', {}, payment.status), el('td', {}, formatDate(payment.paymentDate) || '—'), el('td', {}, formatDate(payment.actDate) || '—'),
          el('td.row-actions', {}, canWrite(store.user) && actionButton('Изменить', () => openPaymentForm(payment), { iconName: 'pencil' }),
            canWrite(store.user) && actionButton('Удалить', async () => { if (await confirmDialog({ title: 'Удалить платёж?' })) await store.deletePayment(payment.id); }, { iconName: 'trash' }))))
          : el('tr', {}, el('td', { colspan: 8 }, 'Добавьте платёжные строки. В режиме «Сумма платежей» они определяют сумму сделки.'))))),
      el('p.field-hint', {}, 'ФГ апрель–март: Q1 апрель–июнь, Q2 июль–сентябрь, Q3 октябрь–декабрь, Q4 январь–март. Пересчёт журналируется отдельно.'));
  }

  function participantsEditor(deal) {
    const rows = deal.contacts || [];
    const saveRows = async (patch) => {
      try { await store.updateDeal(deal.id, patch); }
      catch (error) { toast(error.message || 'Не удалось изменить участников', { icon: 'alert' }); }
    };
    const participantOptions = (current, requiredRole) => [el('option', { value: '' }, 'Не выбран'),
      ...rows.filter((row) => row.role === requiredRole || row.contactId === current)
        .map((row) => el('option', { value: row.contactId, selected: row.contactId === current }, store.contactById(row.contactId)?.name || 'Контакт'))];
    const economic = el('select.select', { disabled: !canWrite(store.user),
      onchange: (event) => saveRows({ economicBuyerContactId: event.target.value || null }) }, participantOptions(deal.economicBuyerContactId, 'Экономический покупатель'));
    const champion = el('select.select', { disabled: !canWrite(store.user),
      onchange: (event) => saveRows({ championContactId: event.target.value || null }) }, participantOptions(deal.championContactId, 'Чемпион'));
    const availableContacts = () => store.contacts.filter((contact) => !(deal.contacts || []).some((row) => row.contactId === contact.id)
      && (!deal.companyId || contact.companyId === deal.companyId));
    const addParticipant = async (contactId, role = '', influence = '') => {
      if (!contactId) { toast('Выберите контакт или создайте новый', { icon: 'info' }); return; }
      const current = store.dealById(deal.id)?.contacts || [];
      if (current.some((row) => row.contactId === contactId)) return;
      await saveRows({ contacts: [...current, { contactId, role, influence }] });
    };
    const contact = searchSelect(recordOptions(availableContacts(), 'Выберите контакт'), '', {
      placeholder: 'ФИО контакта', notFound: 'Такого контакта нет в системе',
      onCreate: (query) => openContactForm(null, { compact: true, presets: { name: query, companyId: deal.companyId || null },
        onSaved: (created) => addParticipant(created.id, role.value, influence.value) }),
    });
    const role = el('select.select', { 'aria-label': 'Роль участника сделки' }, dictionarySelectOptions('teamRoles'));
    const influence = el('select.select', { 'aria-label': 'Влияние участника сделки' }, dictionarySelectOptions('influence'));
    const bodyRows = rows.length ? rows.map((row) => {
      const roleInput = el('select.select', { disabled: !canWrite(store.user),
        onchange: (event) => saveRows({ contacts: rows.map((item) => item.contactId === row.contactId ? { ...item, role: event.target.value } : item) }) }, dictionarySelectOptions('teamRoles', row.role || ''));
      const influenceSelect = el('select.select', { disabled: !canWrite(store.user),
        onchange: (event) => saveRows({ contacts: rows.map((item) => item.contactId === row.contactId ? { ...item, influence: event.target.value } : item) }) }, dictionarySelectOptions('influence', row.influence || ''));
      return el('tr', {}, el('td', {}, store.contactById(row.contactId)?.name || '—'), el('td', {}, roleInput), el('td', {}, influenceSelect),
        el('td', {}, canWrite(store.user) && actionButton('Удалить', () => saveRows({ contacts: rows.filter((item) => item.contactId !== row.contactId) }), { iconName: 'trash' })));
    }) : [el('tr', {}, el('td', { colspan: 4 }, 'Участники не добавлены'))];
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Участники со стороны клиента')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Контакт', 'Роль', 'Влияние', ''].map((label) => el('th', {}, label)))), el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.three', {}, contact.wrap, role, influence,
        actionButton('Добавить участника', () => addParticipant(contact.select.value, role.value, influence.value), { iconName: 'plus' })),
      canWrite(store.user) && el('p.field-hint', {}, 'Если контакта нет, создайте мини-карточку — после сохранения он будет добавлен в сделку.'),
      el('div.form-grid', {}, el('div.field', {}, el('label.field-label', {}, 'Экономический покупатель'), economic),
        el('div.field', {}, el('label.field-label', {}, 'Чемпион'), champion)));
  }

  function salesTeamEditor(deal) {
    const rows = store.salesTeamFor(deal.id);
    const saveTeam = async (team) => {
      try { await store.setSalesTeam(deal.id, team.filter((row) => !row.dealId || row.dealId === deal.id)); }
      catch (error) { toast(error.message || 'Не удалось изменить команду', { icon: 'alert' }); }
    };
    const addMember = async (kind, memberId, memberRole = '') => {
      if (!memberId) { toast('Выберите запись или создайте новую', { icon: 'info' }); return; }
      const current = store.salesTeamFor(deal.id);
      const exists = kind === 'employee' ? current.some((row) => row.employeeId === memberId) : current.some((row) => row.contactId === memberId);
      if (exists) return;
      await saveTeam([...store.salesTeam, { dealId: deal.id, ...(kind === 'employee' ? { employeeId: memberId } : { contactId: memberId }),
        role: memberRole, primary: kind === 'employee' && !current.some((row) => row.employeeId && row.primary) }]);
    };
    const availableEmployees = () => store.activeEmployees().filter((employee) => !store.salesTeamFor(deal.id).some((row) => row.employeeId === employee.id));
    const availableContacts = () => store.contacts.filter((contact) => !store.salesTeamFor(deal.id).some((row) => row.contactId === contact.id));
    const role = el('select.select', { 'aria-label': 'Роль участника команды продаж' }, dictionarySelectOptions('salesRoles'));
    const employee = searchSelect(recordOptions(availableEmployees(), 'Выберите сотрудника'), '', { placeholder: 'ФИО сотрудника', notFound: 'Такого сотрудника нет в системе',
      onCreate: (query) => openEmployeeForm(null, { presets: { name: query }, onSaved: (created) => addMember('employee', created.id, role.value) }) });
    const contact = searchSelect(recordOptions(availableContacts(), 'Выберите контакт'), '', { placeholder: 'ФИО контакта или партнёра', notFound: 'Такого контакта нет в системе',
      onCreate: (query) => openContactForm(null, { compact: true, presets: { name: query, companyId: deal.companyId || null }, onSaved: (created) => addMember('contact', created.id, role.value) }) });
    const memberType = el('select.select', { 'aria-label': 'Тип участника команды продаж', onchange: () => {
      const isEmployee = memberType.value === 'employee'; employee.wrap.hidden = !isEmployee; contact.wrap.hidden = isEmployee;
    } }, el('option', { value: 'employee' }, 'Сотрудник'), el('option', { value: 'contact' }, 'Контакт / партнёр'));
    contact.wrap.hidden = true;
    const bodyRows = rows.length ? rows.map((row) => {
      const roleInput = el('select.select', { disabled: !canWrite(store.user),
        onchange: (event) => saveTeam(store.salesTeam.map((item) => item.id === row.id ? { ...item, role: event.target.value } : item)) }, dictionarySelectOptions('salesRoles', row.role || ''));
      const primary = row.employeeId ? el('input', { type: 'radio', name: `primary-${deal.id}`, checked: row.primary, disabled: !canWrite(store.user),
        'aria-label': `Основной: ${personName(row.employeeId)}`,
        onchange: () => saveTeam(store.salesTeam.map((item) => item.dealId === deal.id ? { ...item, primary: item.id === row.id } : item)) }) : el('span.muted', {}, '—');
      const person = row.employeeId ? store.employeeById(row.employeeId) : store.contactById(row.contactId);
      return el('tr', {}, el('td', {}, person?.name || '—'), el('td', {}, row.employeeId ? 'Сотрудник' : 'Контакт / партнёр'), el('td', {}, roleInput), el('td', {}, primary),
        el('td', {}, canWrite(store.user) && actionButton('Удалить', () => saveTeam(store.salesTeam.filter((item) => item.id !== row.id)), { iconName: 'trash' })));
    }) : [el('tr', {}, el('td', { colspan: 5 }, 'Команда не назначена'))];
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Команда продаж')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Участник', 'Тип', 'Роль', 'Основной', ''].map((label) => el('th', {}, label)))), el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.sales-team-add', {}, memberType, employee.wrap, contact.wrap, role,
        actionButton('Добавить в команду', () => addMember(memberType.value, memberType.value === 'employee' ? employee.select.value : contact.select.value, role.value), { iconName: 'plus' })),
      el('p.field-hint', {}, 'Основным может быть только сотрудник. Контакты добавляются как партнёры или внешние участники.'));
  }

  function detail() {
    const deal = store.dealById(id);
    if (!deal) { root.append(emptyState('Сделка не найдена', '', el('a.btn.btn-ghost', { href: '#/pipeline' }, 'К списку'))); return; }
    const totals = dealTotals(id, store.payments);
    let draft = {};
    const naming = (patch) => ({
      ...patch,
      ...('topic' in patch || 'companyId' in patch || 'product' in patch || 'subproduct' in patch ? {
        name: composeDealName({
          topic: 'topic' in patch ? patch.topic : deal.topic,
          companyName: store.companyById('companyId' in patch ? patch.companyId : deal.companyId)?.name,
          product: 'product' in patch ? patch.product : deal.product,
          subproduct: 'subproduct' in patch ? patch.subproduct : deal.subproduct,
        }, deal.name),
      } : {}),
    });
    const save = async (patch) => {
      if (!canWrite(store.user)) return null;
      draft = { ...draft, ...patch };
      const pending = naming(draft); draft = {};
      try { return await store.updateDeal(deal.id, pending); }
      catch (error) { toast(error.message || 'Не удалось сохранить изменения', { icon: 'alert' }); return null; }
    };
    const queue = (patch) => { draft = { ...draft, ...patch }; };
    const flush = () => Object.keys(draft).length ? save({}) : Promise.resolve(null);
    const panel = el('div.deal-workspace-main');
    const tabs = [['main', 'Основная'], ['timeline', 'Хронология'], ['competitors', 'Конкуренты и риски'], ['system', 'Системная']];
    const tablist = el('div.deal-tabs', { role: 'tablist', 'aria-label': 'Разделы сделки' }, tabs.map(([key, label]) => el('button.deal-tab', {
      type: 'button', role: 'tab', id: `deal-tab-${key}`, 'aria-controls': `deal-panel-${key}`,
      'aria-selected': String(state.tab === key), tabindex: state.tab === key ? 0 : -1, dataset: { tab: key, focusKey: `deal-tab-${key}` },
      onclick: async () => { state.tab = key; await flush(); render(); },
      onkeydown: (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); const index = tabs.findIndex(([tab]) => tab === key);
        const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0];
        root.querySelector(`[data-tab="${next}"]`)?.click();
      },
    }, label)));
    const renderPanel = () => {
      clear(panel);
      const content = state.tab === 'timeline' ? timelineTab(deal) : state.tab === 'competitors' ? competitorsTab(deal, save, queue)
        : state.tab === 'system' ? systemTab(deal) : mainTab(deal, save, queue);
      content.id = `deal-panel-${state.tab}`; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', `deal-tab-${state.tab}`);
      panel.append(content);
    };
    renderPanel();
    append(root, [
      el('a.back-link', { href: '#/pipeline' }, '← Все сделки'),
      pageHead(deal.name, `${stageLabel(deal.stage)} · ${deal.status || 'Статус не указан'} · ${personName(deal.employeeId)}`,
        actionButton('Экспорт XLSX', () => exportXlsx('deals', [deal], `Сделка-${deal.name}.xlsx`), { iconName: 'download' }),
        canWrite(store.user) && actionButton(isFinalStage(deal.stage) ? 'Исправить закрытие' : 'Закрытие сделки', () => openDealClosureForm(deal), { iconName: 'pencil' }),
        canWrite(store.user) && actionButton('Добавить событие', () => openDealEventForm(deal), { primary: true, iconName: 'plus' })),
      el('div.stat-strip', {}, el('div', {}, el('span', {}, 'Общая сумма'), el('strong', {}, amountOf(deal) === null ? 'Не оценена' : money(amountOf(deal)))),
        el('div', {}, el('span', {}, `Текущий ФГ${String(fiscalYearAt()).slice(-2)}`), el('strong', {}, money(totals.currentFY))),
        el('div', {}, el('span', {}, `Следующий ФГ${String(fiscalYearAt() + 1).slice(-2)}`), el('strong', {}, money(totals.nextFY))),
        el('div', {}, el('span', {}, 'Активный шаг'), el('strong', {}, store.activeDealStep(deal.id)?.due ? formatDate(store.activeDealStep(deal.id).due) : 'Нет'))),
      lifecycle(deal),
      el('div.deal-workspace', {}, sidebar(deal, save, queue), el('div.deal-workspace-content', {}, tablist, panel)),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить сделку', async () => {
        if (!await confirmDialog({ title: 'Удалить сделку?', message: 'Сделка и связанные рабочие данные будут перемещены в корзину. Резервные копии журналов сохранятся.' })) return;
        await store.deleteDeal(id); navigate('#/pipeline');
      }, { iconName: 'trash' })),
    ]);
  }

  render();
  const onChange = () => render();
  store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
