import { el, clear, keepingFocus, append } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { DEAL_STAGES, dealTotals, fiscalYearAt, dictionaryOptions, productForSubproduct } from '../lib/spec.js';
import { composeDealName } from '../lib/mvp.js';
import { canWrite, canAdmin } from '../lib/access.js';
import { isOpen } from '../lib/forecast.js';
import { openDealForm, openPaymentForm, openContactForm, openEmployeeForm } from '../ui/mvp-forms.js';
import { openDealClosureForm } from '../ui/deal-forms.js';
import { pageHead, actionButton, emptyState, facts, avandokEmpty, money } from '../ui/mvp-bits.js';
import { field, textInput, searchSelect } from '../ui/forms.js';
import { customFieldInputs } from '../ui/custom-fields.js';
import { exportXlsx, importPipelineXlsx } from '../lib/xlsx.js';
import { formatDate, fuzzyIncludes, todayISO, uid } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { isFinalStage, isOpenTask } from '../lib/deal-workflow.js';
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
    taskFormOpen: false, taskDraft: null, taskOperationId: null,
    editingTaskId: null, taskEditDraft: null, editOperationId: null, showCompletedTasks: false,
    timelineDraft: '', timelineOperationId: uid(), timelineError: '',
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
    { key: 'nextStep', label: 'Следующий шаг', get: (deal) => store.activeDealTask(deal.id)?.title || 'Не задан' },
    { key: 'stepOwner', label: 'Ответственный за шаг', get: (deal) => store.activeDealTask(deal.id)?.employeeId ? personName(store.activeDealTask(deal.id).employeeId) : '' },
    { key: 'due', label: 'Срок шага', type: 'date', get: (deal) => store.activeDealTask(deal.id)?.due || '' },
    { key: 'overdue', label: 'Просрочка, дней', type: 'number', numeric: true, get: (deal) => store.activeDealTask(deal.id)?.overdueDays || 0 },
    { key: 'updatedAt', label: 'Обновлена', type: 'date', get: (deal) => deal.updatedAt ? new Date(deal.updatedAt).toISOString().slice(0, 10) : '' },
  ];

  function filteredDeals() {
    return filterRecords(store.deals.filter((deal) => (state.showClosed || isOpen(deal))
      && (!state.product || deal.product === state.product) && (!state.status || deal.status === state.status)
      && (!state.category || deal.probabilityCategory === state.category)
      && (!state.search || fuzzyIncludes(`${deal.name} ${store.companyById(deal.companyId)?.name || ''} ${personName(deal.employeeId)} ${store.activeDealTask(deal.id)?.title || ''}`, state.search))), dealColumns(), state.filters);
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
    const step = store.activeDealTask(deal.id);
    const node = el('article.deal-card.mvp-deal-card', { draggable: canWrite(store.user) ? 'true' : 'false' },
      el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name),
      el('p.muted', {}, store.companyById(deal.companyId)?.name || 'Контрагент не указан'),
      el('strong', {}, amountOf(deal) === null ? 'Сумма не оценена' : money(amountOf(deal))),
      el('div.deal-card-meta', {}, `${deal.status || '—'} · ${personName(deal.employeeId)}`),
      step && el('div.deal-card-meta', {}, `${step.title} · ${formatDate(step.due)}${step.overdueDays ? ` · просрочка ${step.overdueDays} дн.` : ''}`),
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
        const step = store.activeDealTask(deal.id);
        return el('tr', {},
          el('td', {}, el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name), el('span.registry-secondary', {}, deal.topic || 'Тема не указана')),
          el('td', {}, store.companyById(deal.companyId)?.name || '—'), el('td', {}, stageLabel(deal.stage)),
          el('td', {}, el('span.status-pill', {}, deal.status || '—')), el('td', {}, personName(deal.employeeId)),
          el('td', {}, `${deal.product || '—'}${deal.subproduct ? ` / ${deal.subproduct}` : ''}`),
          el('td.num', {}, amountOf(deal) === null ? '—' : money(amountOf(deal))),
          el('td', {}, event?.summary || '—'), el('td', {}, formatDate(event?.date) || '—'),
          el('td', {}, step?.title || 'Не задан'), el('td', {}, personName(step?.employeeId)), el('td', {}, formatDate(step?.due) || '—'),
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
    const forecast = el('select.select', { disabled, dataset: focus('includeInForecastFY') },
      el('option', { value: '', selected: deal.includeInForecastFY === '' }, 'Не выбрано'),
      el('option', { value: 'yes', selected: deal.includeInForecastFY === 'yes' }, 'Да'),
      el('option', { value: 'no', selected: deal.includeInForecastFY === 'no' }, 'Нет'));
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
    bind(forecast, 'includeInForecastFY');
    return el('aside.deal-sidebar', {},
      el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Параметры сделки'),
        field('Ответственный', owner), field('Тема', topic), field('Продукт', product), field('Подпродукт', subproduct), field('Статус', status), field('Стадия', stage),
        field('Количество пользователей', users), field('Источник', source), field('Канал', channel)),
      el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Связи'),
        field('Основной контакт', contact.wrap), field('Контрагент', company.wrap)),
      el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Оценка и прогноз'),
        field('Способ оценки', mode),
        field(deal.amountMode === 'payments' ? 'Сумма платежей, без НДС' : 'Ручная оценка, без НДС', manual,
          { hint: deal.amountMode === 'payments' ? 'Переключение на ручную оценку сохраняет прежнюю ручную сумму для возврата.' : 'Пусто — оценка не задана. Явный ноль сохраняется как ноль.' }),
        field('Включать в прогноз ФГ', forecast),
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

  function taskEditor(deal, task = null) {
    const editing = Boolean(task);
    const draft = editing ? state.taskEditDraft : state.taskDraft;
    const title = textInput({ value: draft.title, required: true, maxlength: 500,
      placeholder: 'Что сделать', 'aria-label': 'Что сделать',
      dataset: { focusKey: editing ? `deal-task-edit-title-${task.id}` : 'deal-task-new-title' } });
    const employee = el('select.select', { required: true, 'aria-label': 'Ответственный',
      dataset: { focusKey: editing ? `deal-task-edit-owner-${task.id}` : 'deal-task-new-owner' } },
      store.activeEmployees([draft.employeeId]).map((row) => el('option', { value: row.id, selected: row.id === draft.employeeId }, row.name)));
    const due = textInput({ value: draft.due, type: 'date', required: true, 'aria-label': 'Срок задачи',
      dataset: { focusKey: editing ? `deal-task-edit-due-${task.id}` : 'deal-task-new-due' } });
    const sync = () => {
      const target = editing ? state.taskEditDraft : state.taskDraft;
      Object.assign(target, { title: title.value, employeeId: employee.value, due: due.value });
    };
    title.addEventListener('input', sync); employee.addEventListener('change', sync); due.addEventListener('change', sync);
    const cancel = () => {
      if (editing) { state.editingTaskId = null; state.taskEditDraft = null; state.editOperationId = null; }
      else { state.taskFormOpen = false; state.taskDraft = null; state.taskOperationId = null; }
      render();
    };
    const form = el('form.deal-task-editor', {},
      title, employee, due,
      el('div.deal-task-editor-actions', {},
        el('button.btn.btn-primary', { type: 'submit' }, editing ? 'Сохранить' : 'Добавить'),
        el('button.btn.btn-ghost', { type: 'button', onclick: cancel }, 'Отмена')));
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); sync();
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try {
        if (editing) {
          await store.updateDealTask(task.id, { title: draft.title.trim(), employeeId: draft.employeeId, due: draft.due }, {
            expectedRevision: draft.baseRevision, operationId: state.editOperationId,
          });
          state.editingTaskId = null; state.taskEditDraft = null; state.editOperationId = null;
          toast('Задача обновлена', { icon: 'check' });
        } else {
          await store.addDealTask(deal.id, { title: draft.title.trim(), employeeId: draft.employeeId, due: draft.due,
            companyId: deal.companyId || null, contactId: deal.contactId || null, leadId: deal.sourceLeadId || null }, {
            expectedRevision: draft.baseRevision, operationId: state.taskOperationId,
          });
          state.taskFormOpen = false; state.taskDraft = null; state.taskOperationId = null;
          toast('Задача добавлена', { icon: 'check' });
        }
        render();
      } catch (error) {
        button.disabled = false;
        toast(error.message || 'Не удалось сохранить задачу. Введённые данные остались в форме.', { icon: 'alert' });
      }
    });
    return form;
  }

  function taskRow(deal, task) {
    const disabled = !canWrite(store.user);
    const complete = actionButton('Выполнить', async () => {
      const button = complete; button.disabled = true;
      try {
        await store.completeDealTask(task.id, { expectedRevision: deal.revision });
        toast('Задача выполнена', { icon: 'check' });
      } catch (error) { button.disabled = false; toast(error.message || 'Не удалось выполнить задачу', { icon: 'alert' }); }
    }, { attrs: { 'aria-label': `Выполнить задачу: ${task.title}`, 'data-task-complete': task.id, disabled } });
    const menu = el('details.deal-task-menu', {},
      el('summary', { 'aria-label': `Действия с задачей: ${task.title}` }, '•••'),
      el('div.deal-task-menu-popover', {},
        actionButton('Изменить', () => {
          state.editingTaskId = task.id;
          state.taskEditDraft = { title: task.title, employeeId: task.employeeId || store.currentEmployee()?.id || '', due: task.due, baseRevision: deal.revision };
          state.editOperationId = uid(); state.taskFormOpen = false; render();
        }, { iconName: 'pencil' }),
        !task.isNextStep && actionButton('Сделать следующим шагом', async () => {
          try { await store.setDealNextStep(task.id, { expectedRevision: deal.revision, operationId: `next-${task.id}-${task.revision}` }); }
          catch (error) { toast(error.message || 'Не удалось перенести метку', { icon: 'alert' }); }
        }, { iconName: 'check' }),
        actionButton('Отменить задачу', async () => {
          try { await store.cancelDealTask(task.id, { expectedRevision: deal.revision }); toast('Задача отменена', { icon: 'check' }); }
          catch (error) { toast(error.message || 'Не удалось отменить задачу', { icon: 'alert' }); }
        }, { iconName: 'trash' })));
    return el('article.deal-task-row', { dataset: { taskId: task.id, nextStep: String(task.isNextStep) } },
      el('div.deal-task-complete', {}, complete),
      el('div.deal-task-title', {}, task.isNextStep && el('span.deal-next-label', {}, 'Следующий шаг'),
        el('strong', {}, task.title)),
      el('div.deal-task-owner', {}, personName(task.employeeId)),
      el('div.deal-task-due', {}, el('span', { className: task.overdueDays ? 'negative' : '' }, formatDate(task.due) || '—'),
        task.overdueDays > 0 && el('span.negative', {}, `Просрочка ${task.overdueDays} дн.`)),
      el('div.deal-task-actions', {}, !disabled && menu));
  }

  function closedTaskRow(task) {
    return el('article.deal-task-row.closed', { dataset: { taskId: task.id } },
      el('div.deal-task-complete', {}, el('span.muted', {}, task.status === 'Отменена' ? 'Отменена' : 'Выполнено')),
      el('div.deal-task-title', {}, task.isNextStep && el('span.deal-next-label', {}, 'Следующий шаг'), el('strong', {}, task.title)),
      el('div.deal-task-owner', {}, personName(task.employeeId)),
      el('div.deal-task-due', {}, el('span', {}, formatDate(task.due) || '—'),
        (task.doneAt || task.cancelledAt) && el('span.muted', {}, dateTime(task.doneAt || task.cancelledAt))),
      el('div.deal-task-actions'));
  }

  function tasksBlock(deal) {
    const all = store.dealTasksFor(deal.id);
    const open = all.filter(isOpenTask);
    const closed = all.filter((task) => !isOpenTask(task));
    const next = store.activeDealTask(deal.id);
    return el('section.detail-section.deal-tasks-section', { id: `deal-tasks-${deal.id}` },
      el('div.section-head', {}, el('h2.section-title', {}, `Задачи · ${open.length}`),
        canWrite(store.user) && actionButton('+ Задача', () => {
          state.taskFormOpen = true; state.editingTaskId = null;
          state.taskDraft = { title: '', employeeId: store.currentEmployee()?.id || '', due: todayISO(), baseRevision: deal.revision };
          state.taskOperationId = uid(); render();
          queueMicrotask(() => root.querySelector('[data-focus-key="deal-task-new-title"]')?.focus());
        }, { primary: true, iconName: 'plus' })),
      !next && el('p.deal-task-hint', {}, 'Следующий шаг не задан'),
      state.taskFormOpen && taskEditor(deal),
      open.length ? el('div.deal-task-list', {}, open.map((task) => state.editingTaskId === task.id ? taskEditor(deal, task) : taskRow(deal, task)))
        : !state.taskFormOpen && el('p.muted', {}, 'Открытых задач нет. Добавьте основной шаг или независимую задачу для команды.'),
      closed.length > 0 && el('div.deal-completed-tasks', {},
        el('button.btn.btn-ghost.deal-completed-toggle', { type: 'button', 'aria-expanded': String(state.showCompletedTasks),
          onclick: () => { state.showCompletedTasks = !state.showCompletedTasks; render(); } },
          `${state.showCompletedTasks ? 'Скрыть' : 'Показать'} завершённые · ${closed.length}`),
        state.showCompletedTasks && el('div.deal-task-list', {}, closed.map(closedTaskRow))));
  }

  function legacyEventDetails(event) {
    const rows = [];
    if (event.previousStage !== event.newStage) rows.push(el('div', {}, `Стадия: ${stageLabel(event.previousStage)} → ${stageLabel(event.newStage)}`));
    if (event.stepAction) rows.push(el('div', {}, `Прежнее действие со шагом: ${stepActionLabels[event.stepAction] || event.stepAction}`));
    if (event.changeReason) rows.push(el('div', {}, `Причина: ${event.changeReason}`));
    for (const taskId of new Set([event.closedStepId, event.newStepId].filter(Boolean))) {
      const task = store.tasks.find((row) => row.id === taskId || row.legacyStepId === taskId);
      if (task) rows.push(el('div', {}, `Связанный шаг: ${task.title} · ${personName(task.employeeId)} · ${formatDate(task.due) || '—'} · ${stepStatus[task.status] || task.status}`));
    }
    for (const change of event.stepChanges || []) {
      rows.push(el('div', {}, `${({ action: 'Действие', title: 'Действие', due: 'Срок', employeeId: 'Ответственный' })[change.field] || change.field}: ${change.field === 'employeeId' ? `${personName(change.previousValue)} → ${personName(change.newValue)}` : change.field === 'due' ? `${formatDate(change.previousValue)} → ${formatDate(change.newValue)}` : `${change.previousValue || '—'} → ${change.newValue || '—'}`}`));
    }
    if (event.notes) rows.push(el('div.record-description', {}, event.notes));
    return rows.length ? el('details.deal-timeline-details', {}, el('summary', {}, 'Подробности'), el('div', {}, rows)) : null;
  }

  function timelineTab(deal) {
    const events = store.activitiesFor({ dealId: deal.id }).sort((a, b) => (b.eventAt || b.createdAt || 0) - (a.eventAt || a.createdAt || 0));
    const text = el('textarea.input.textarea.deal-record-input', {
      rows: 3, required: true, maxlength: 4000, placeholder: 'Что произошло?',
      'aria-label': 'Что произошло?', dataset: { focusKey: 'deal-timeline-composer' },
    }, state.timelineDraft);
    text.addEventListener('input', () => { state.timelineDraft = text.value; state.timelineError = ''; });
    const error = el('p.form-error', { role: 'alert', hidden: !state.timelineError }, state.timelineError);
    const composer = el('form.deal-record-composer', {},
      text,
      el('div.deal-record-composer-foot', {}, el('span.muted', {}, `Автор: ${store.currentEmployee()?.name || store.user?.username || 'Текущая учётная запись'} · дата и стадия фиксируются автоматически`),
        el('button.btn.btn-primary', { type: 'submit' }, 'Добавить запись')), error);
    composer.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.timelineDraft = text.value;
      if (!composer.reportValidity()) return;
      if (!state.timelineDraft.trim()) { state.timelineError = 'Введите текст записи'; error.textContent = state.timelineError; error.hidden = false; return; }
      const button = composer.querySelector('button[type="submit"]'); button.disabled = true;
      try {
        await store.addDealRecord(deal.id, { summary: state.timelineDraft.trim() }, {
          expectedRevision: deal.revision, operationId: state.timelineOperationId,
        });
        state.timelineDraft = ''; state.timelineOperationId = uid(); state.timelineError = '';
        toast('Запись добавлена', { icon: 'check' }); render();
      } catch (err) {
        state.timelineError = err.message || 'Не удалось сохранить запись. Текст остался в поле.';
        render();
        queueMicrotask(() => root.querySelector('[data-focus-key="deal-timeline-composer"]')?.focus());
      }
    });
    return el('div.deal-tab-panel', {},
      el('section.detail-section.deal-record-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Новая запись')), composer),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Хронология · ${events.length}`)),
        el('p.field-hint', {}, 'Новые записи сверху. Операции с задачами добавляются автоматически; системные изменения полей остаются на вкладке «Системная».'),
        events.length ? el('div.deal-timeline', {},
          el('div.deal-timeline-header', {}, el('span', {}, 'Дата и время'), el('span', {}, 'Автор'), el('span', {}, 'Запись')),
          events.map((item) => el('article.deal-timeline-event', {},
            el('time.deal-timeline-date', {}, dateTime(item.eventAt || item.createdAt)),
            el('div.deal-timeline-author', {}, personName(item.employeeId)),
            el('div.deal-timeline-record', {}, el('p.deal-timeline-summary', {}, item.summary || item.notes)),
            legacyEventDetails(item))))
          : emptyState('Записей пока нет', 'Опишите результат встречи, звонка или договорённость в поле выше.')));
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
    const probability = (payment) => el('select.select', {
      disabled: !canWrite(store.user), 'aria-label': `Вероятность платежа ${payment.quarter} ФГ${payment.fiscalYear}`,
      dataset: { focusKey: `payment-probability-${payment.id}` },
      onchange: async (event) => {
        try { await store.updatePayment(payment.id, { probability: event.target.value }); }
        catch (error) { toast(error.message || 'Не удалось изменить вероятность платежа', { icon: 'alert' }); }
      },
    }, ['', 'Высокая', 'Средняя', 'Низкая'].map((value) => el('option', {
      value, selected: (payment.probability || '') === value,
    }, value || 'Не выбрана')));
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Реестр платежей · ${rows.length}`),
      canWrite(store.user) && actionButton('Добавить платёж', () => openPaymentForm(null, { presets: { dealId: deal.id } }), { primary: true, iconName: 'plus' })),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['ФГ', 'Квартал', 'Сумма без НДС', 'Тип', 'Статус', 'Вероятность', 'Оплата', 'Акт', ''].map((label) => el('th', {}, label)))),
        el('tbody', {}, rows.length ? rows.map((payment) => el('tr', {}, el('td', {}, `ФГ${String(payment.fiscalYear).slice(-2)}`), el('td', {}, payment.quarter),
          el('td.num', {}, money(payment.amount)), el('td', {}, payment.type), el('td', {}, payment.status), el('td', {}, probability(payment)),
          el('td', {}, formatDate(payment.paymentDate) || '—'), el('td', {}, formatDate(payment.actDate) || '—'),
          el('td.row-actions', {}, canWrite(store.user) && actionButton('Изменить', () => openPaymentForm(payment), { iconName: 'pencil' }),
            canAdmin(store.user) && actionButton('Удалить', async () => { if (await confirmDialog({ title: 'Удалить платёж?' })) await store.deletePayment(payment.id); }, { iconName: 'trash' }))))
          : el('tr', {}, el('td', { colspan: 9 }, 'Добавьте платёжные строки. В режиме «Сумма платежей» они определяют сумму сделки.'))))),
      el('p.field-hint', {}, 'ФГ апрель–март: Q1 апрель–июнь, Q2 июль–сентябрь, Q3 октябрь–декабрь, Q4 январь–март. Вероятность редактируется прямо в таблице.'));
  }

  function participantsEditor(deal) {
    const rows = deal.contacts || [];
    const saveRows = async (patch) => {
      try { await store.updateDeal(deal.id, patch); }
      catch (error) { toast(error.message || 'Не удалось изменить участников', { icon: 'alert' }); }
    };
    const availableContacts = () => store.contacts.filter((contact) => !(deal.contacts || []).some((row) => row.contactId === contact.id)
      && (!deal.companyId || contact.companyId === deal.companyId));
    const addParticipant = async (contactId, role = '', influence = '', position = '') => {
      if (!contactId) { toast('Выберите контакт или создайте новый', { icon: 'info' }); return; }
      const current = store.dealById(deal.id)?.contacts || [];
      if (current.some((row) => row.contactId === contactId)) return;
      await saveRows({ contacts: [...current, { contactId, role, influence, position }] });
    };
    const contact = searchSelect(recordOptions(availableContacts(), 'Выберите контакт'), '', {
      placeholder: 'ФИО контакта', notFound: 'Такого контакта нет в системе',
      onCreate: (query) => openContactForm(null, { compact: true, presets: { name: query, companyId: deal.companyId || null },
        onSaved: (created) => addParticipant(created.id, role.value, influence.value, position.value) }),
    });
    const role = el('select.select', { 'aria-label': 'Роль участника сделки' }, dictionarySelectOptions('teamRoles'));
    const influence = el('select.select', { 'aria-label': 'Влияние участника сделки' }, dictionarySelectOptions('influence'));
    const position = textInput({ placeholder: 'Должность', 'aria-label': 'Должность нового участника', maxlength: 160 });
    const bodyRows = rows.length ? rows.map((row) => {
      const roleInput = el('select.select', { disabled: !canWrite(store.user),
        dataset: { focusKey: `deal-participant-role-${row.contactId}` },
        onchange: (event) => {
          saveRows({ contacts: rows.map((item) => item.contactId === row.contactId
            ? { ...item, role: event.target.value } : item) });
        },
      }, dictionarySelectOptions('teamRoles', row.role || ''));
      const influenceSelect = el('select.select', { disabled: !canWrite(store.user),
        dataset: { focusKey: `deal-participant-influence-${row.contactId}` },
        onchange: (event) => {
          saveRows({ contacts: rows.map((item) => item.contactId === row.contactId
            ? { ...item, influence: event.target.value } : item) });
        },
      }, dictionarySelectOptions('influence', row.influence || ''));
      const positionInput = textInput({ value: row.position || '', disabled: !canWrite(store.user), maxlength: 160,
        placeholder: 'Должность', 'aria-label': `Должность: ${store.contactById(row.contactId)?.name || 'участник'}`,
        dataset: { focusKey: `deal-participant-position-${row.contactId}` },
        onchange: (event) => {
          saveRows({ contacts: rows.map((item) => item.contactId === row.contactId
            ? { ...item, position: event.target.value.trim() } : item) });
        },
      });
      return el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/contacts?id=${row.contactId}` }, store.contactById(row.contactId)?.name || '—')),
        el('td', {}, roleInput), el('td', {}, influenceSelect), el('td', {}, positionInput),
        el('td', {}, canWrite(store.user) && actionButton('Убрать', () => saveRows({ contacts: rows.filter((item) => item.contactId !== row.contactId) }))));
    }) : [el('tr', {}, el('td', { colspan: 5 }, 'Участники не добавлены'))];
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Участники со стороны клиента')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Контакт', 'Роль', 'Влияние', 'Должность', ''].map((label) => el('th', {}, label)))), el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.participants-add', {}, contact.wrap, role, influence, position,
        actionButton('Добавить участника', () => addParticipant(contact.select.value, role.value, influence.value, position.value), { iconName: 'plus' })),
      canWrite(store.user) && el('p.field-hint', {}, 'Экономический покупатель и чемпион задаются в колонке «Роль». Если контакта нет, создайте мини-карточку — после сохранения он будет добавлен в сделку.'));
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
        el('td', {}, canWrite(store.user) && actionButton('Убрать', () => saveTeam(store.salesTeam.filter((item) => item.id !== row.id)))));
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
        canWrite(store.user) && actionButton('Добавить запись', async () => {
          await flush(); state.tab = 'timeline'; render();
          queueMicrotask(() => root.querySelector('[data-focus-key="deal-timeline-composer"]')?.focus());
        }, { primary: true, iconName: 'plus' })),
      el('div.stat-strip', {}, el('div', {}, el('span', {}, 'Общая сумма'), el('strong', {}, amountOf(deal) === null ? 'Не оценена' : money(amountOf(deal)))),
        el('div', {}, el('span', {}, `Текущий ФГ${String(fiscalYearAt()).slice(-2)}`), el('strong', {}, money(totals.currentFY))),
        el('div', {}, el('span', {}, `Следующий ФГ${String(fiscalYearAt() + 1).slice(-2)}`), el('strong', {}, money(totals.nextFY))),
        el('div', {}, el('span', {}, 'Следующий шаг'), el('strong', {}, store.activeDealTask(deal.id)?.due ? formatDate(store.activeDealTask(deal.id).due) : 'Не задан'))),
      lifecycle(deal),
      tasksBlock(deal),
      el('div.deal-workspace', {}, sidebar(deal, save, queue), el('div.deal-workspace-content', {}, tablist, panel)),
      canAdmin(store.user) && el('div.danger-zone', {}, actionButton('Удалить сделку', async () => {
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
