import { el, clear, keepingFocus, append } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { LEAD_STAGES, dictionaryOptions, productForSubproduct } from '../lib/spec.js';
import { canWrite, canAdmin } from '../lib/access.js';
import { openLeadForm, openContactForm } from '../ui/mvp-forms.js';
import { actionButton, pageHead, emptyState, facts, relatedRecords, avandokEmpty, money, inlineField, entityTabs, fieldHistoryTable } from '../ui/mvp-bits.js';
import { exportXlsx } from '../lib/xlsx.js';
import { formatDate, fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { field, searchSelect } from '../ui/forms.js';
import { toast } from '../ui/toast.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

const stageLabel = (id) => LEAD_STAGES.find((s) => s.id === id)?.label || id;

export function leadsMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = { search: '', status: '', stage: '', employeeId: '', sortKey: 'createdAt', sortDirection: 'desc', filters: [], tab: 'main' };
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
    const disabled = !canWrite(store.user);
    let draft = {};
    const save = async (patch) => {
      if (disabled) return null;
      draft = { ...draft, ...patch };
      const pending = draft; draft = {};
      try { return await store.updateLead(id, pending); }
      catch (error) { toast(error.message || 'Не удалось сохранить изменения', { icon: 'alert' }); return null; }
    };
    const queue = (patch) => { draft = { ...draft, ...patch }; };
    const flush = () => Object.keys(draft).length ? save({}) : Promise.resolve(null);
    const options = (key, current = '', empty = 'Не указано', parent = null) => {
      const base = dictionaryOptions(store.settings, key, { empty, parent });
      return base.concat(current && !base.some((option) => option.value === current) ? [{ value: current, label: current }] : []);
    };
    const records = (rows, empty) => [{ value: '', label: empty }, ...rows.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((row) => ({ value: row.id, label: row.name }))];
    const inline = (label, key, config = {}) => inlineField({ label, key, value: lead[key] ?? '', disabled, save, queue,
      focusPrefix: 'lead-field', ...config });
    const convert = async () => {
      try { await flush(); const created = await store.convertLeadToDeal(id); toast('Сделка создана. Поля перенесены один раз.', { icon: 'check' }); navigate(`#/pipeline?id=${created.id}`); }
      catch (error) { toast(error.message, { icon: 'alert' }); }
    };
    const changeStage = (stage) => {
      if (stage === lead.stage) return;
      store.moveLead(id, stage).catch((error) => toast(error.message || 'Не удалось изменить стадию', { icon: 'alert' }));
    };
    const lifecycle = () => {
      const current = Math.max(0, LEAD_STAGES.findIndex((stage) => stage.id === lead.stage));
      return el('section.detail-section.deal-lifecycle-section', {},
        el('div.section-head', {}, el('h2.section-title', {}, 'Жизненный цикл лида'), el('span.muted', {}, `${current + 1} из ${LEAD_STAGES.length}`)),
        el('ol.deal-lifecycle.lead-lifecycle', {}, LEAD_STAGES.map((stage, index) => {
          const status = index < current ? 'done' : index === current ? 'current' : 'next';
          return el('li', { className: `lifecycle-${status}` }, el('button.lifecycle-step', {
            type: 'button', disabled, dataset: { stage: stage.id, focusKey: `lead-lifecycle-${stage.id}` },
            'aria-current': index === current ? 'step' : null, onclick: () => changeStage(stage.id),
          }, el('span.lifecycle-index', {}, index < current ? '✓' : String(index)), el('span.lifecycle-label', {}, stage.label)));
        })));
    };
    const sidebar = () => {
      const name = inline('Тема (необязательно)', 'name', { parse: (value) => value.trim() });
      const status = inline('Статус', 'status', { options: options('leadStatuses', lead.status, null), disabled: disabled || lead.status === 'Дисквалифицирован' });
      const stage = inline('Стадия', 'stage', { options: LEAD_STAGES.map((row) => ({ value: row.id, label: row.label })) });
      const product = inline('Продукт', 'product', { options: options('products', lead.product) });
      const subproduct = inline('Подпродукт', 'subproduct', { options: options('subproducts', lead.subproduct, 'Не указано', lead.product || null) });
      product.control.addEventListener('change', () => {
        if (productForSubproduct(store.settings, subproduct.control.value) !== product.control.value) queue({ subproduct: '' });
      }, true);
      const partner = searchSelect(records(store.companies.filter((row) => row.role === 'Партнёр-интегратор' || row.id === lead.partnerId), 'Без партнёра'), lead.partnerId || '', { disabled, focusKey: 'lead-field-partner' });
      partner.select.addEventListener('change', () => save({ partnerId: partner.select.value || null }));
      return el('aside.deal-sidebar.entity-sidebar', {}, el('section.deal-side-section', {}, el('h2.deal-side-title', {}, 'Параметры лида'),
        name.node, status.node, stage.node, product.node, subproduct.node, field('Партнёр', partner.wrap),
        inline('Причина закрытия / дисквалификации', 'closeReason', { options: options('leadReasons', lead.closeReason) }).node,
        inline('Источник', 'source', { options: options('leadSources', lead.source) }).node,
        inline('Канал', 'channel', { options: options('dealChannels', lead.channel) }).node,
        inline('Предварительный бюджет, без НДС', 'preliminaryBudget', { type: 'number', parse: (value) => Math.max(0, Number(value) || 0) }).node,
        inline('Ответственный', 'employeeId', { options: records(store.activeEmployees([lead.employeeId]), 'Не назначен'), parse: (value) => value || null }).node,
        el('p.autosave-hint', {}, disabled ? 'Только просмотр' : 'Выбор сохраняется сразу, текст — при выходе из поля или переключении вкладки.')));
    };
    const mainTab = () => {
      const shown = {
        contactName: lead.contactName || contact?.name || '', contactTitle: lead.contactTitle || contact?.title || '',
        phone: lead.phone || contact?.phone || '', email: lead.email || contact?.email || '',
        companyName: lead.companyName || company?.name || '', inn: lead.inn || company?.inn || '',
      };
      const text = (label, key, config = {}) => inlineField({ label, key, value: shown[key], disabled, save, queue,
        focusPrefix: 'lead-field', parse: (value) => value.trim(), ...config }).node;
      const contactPicker = searchSelect(records(store.contacts, 'Без связанного контакта'), lead.contactId || '', { disabled, focusKey: 'lead-field-contact' });
      const companyPicker = searchSelect(records(store.companies, 'Без связанного контрагента'), lead.companyId || '', { disabled, focusKey: 'lead-field-company' });
      contactPicker.select.addEventListener('change', () => {
        const selected = store.contactById(contactPicker.select.value);
        save(selected ? { contactId: selected.id, contactName: '', contactTitle: '', phone: '', email: '' }
          : { contactId: null, contactName: shown.contactName, contactTitle: shown.contactTitle, phone: shown.phone, email: shown.email });
      });
      companyPicker.select.addEventListener('change', () => {
        const selected = store.companyById(companyPicker.select.value);
        save(selected ? { companyId: selected.id, companyName: '', inn: '' } : { companyId: null, companyName: shown.companyName, inn: shown.inn });
      });
      const createContact = async () => {
        await flush();
        const latest = store.leadById(id);
        if (!latest) return;
        const linkedContact = store.contactById(latest.contactId);
        openContactForm(null, { presets: {
          name: latest.contactName || linkedContact?.name || '',
          title: latest.contactTitle || linkedContact?.title || '',
          phone: latest.phone || linkedContact?.phone || '',
          email: latest.email || linkedContact?.email || '',
          companyId: latest.companyId || linkedContact?.companyId || null,
        }, onSaved: (created) => save({ contactId: created.id,
          contactName: '', contactTitle: '', phone: '', email: '' }) });
      };
      return el('div.deal-tab-panel', {},
        el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Контактная информация'),
          canWrite(store.user) && actionButton(contact ? 'Создать новый контакт' : 'Создать контакт', createContact, { iconName: 'plus' })),
          el('div.form-grid.deal-inline-grid', {}, text('ФИО', 'contactName'), text('Должность', 'contactTitle'),
            text('Телефон', 'phone', { type: 'tel' }), text('Email', 'email', { type: 'email' }),
            text('Название компании', 'companyName'), text('ИНН', 'inn')),
          el('div.form-grid.deal-inline-grid', {}, field('Связанный контакт', contactPicker.wrap), field('Связанный контрагент', companyPicker.wrap)),
          contact && el('p.field-hint', {}, 'Текущий контакт: ', el('a.record-link', { href: `#/contacts?id=${contact.id}` }, contact.name)),
          inlineField({ label: 'Описание задачи / комментарий', key: 'description', value: lead.description || '', type: 'textarea', rows: 5,
            disabled, save, queue, focusPrefix: 'lead-field' }).node),
        relatedRecords('lead', id), avandokEmpty());
    };
    const systemTab = () => {
      const stages = store.leadStageHistoryFor(id).slice().reverse();
      const fields = store.entityFieldHistoryFor('lead', id);
      return el('div.deal-tab-panel', {},
        el('section.detail-section', {}, facts([['Создан', new Date(lead.createdAt).toLocaleString('ru-RU')],
          ['Обновлён', new Date(lead.updatedAt || lead.createdAt).toLocaleString('ru-RU')],
          ['Закрыт', lead.closedAt ? new Date(lead.closedAt).toLocaleString('ru-RU') : '—'],
          ['Связанная сделка', deal ? el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name) : '—']])),
        el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Журнал стадий · ${stages.length}`)),
          el('p.field-hint', {}, 'Новые записи сверху. Журнал создаётся автоматически и не редактируется.'),
          el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Дата и время', 'Пользователь', 'Предыдущая стадия', 'Новая стадия'].map((label) => el('th', {}, label)))),
            el('tbody', {}, stages.length ? stages.map((row) => el('tr', {}, el('td', {}, new Date(row.at).toLocaleString('ru-RU')),
              el('td', {}, row.actorName || 'Системный процесс'), el('td', {}, stageLabel(row.previousStage) || '—'), el('td', {}, stageLabel(row.newStage))))
              : el('tr', {}, el('td', { colspan: 4 }, 'Записей пока нет')))))),
        el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Журнал полей · ${fields.length}`)), fieldHistoryTable(fields)));
    };
    const tabs = [['main', 'Основная'], ['system', 'Системная']];
    const panel = el('div.deal-workspace-main');
    const tablist = entityTabs('lead', tabs, state.tab, async (key) => { state.tab = key; await flush(); render(); });
    const content = state.tab === 'system' ? systemTab() : mainTab();
    content.id = `lead-panel-${state.tab}`; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', `lead-tab-${state.tab}`);
    panel.append(content);
    append(root, [el('a.back-link', { href: '#/leads' }, '← Все лиды'),
      pageHead(lead.name || 'Лид без темы', `${stageLabel(lead.stage)} · ${store.employeeById(lead.employeeId)?.name || 'Ответственный не назначен'}`,
        actionButton('Экспорт XLSX', () => exportXlsx('leads', [lead], `Лид-${lead.name || lead.id}.xlsx`), { iconName: 'download' }),
        canWrite(store.user) && lead.status === 'Квалифицирован' && !deal && actionButton('Перевести в сделку', convert, { primary: true, iconName: 'arrowR' })),
      lead.status === 'Дисквалифицирован' && el('div.notice.warning', {}, 'Дисквалифицированный лид нельзя открыть повторно. Для нового обращения создайте отдельный лид.'),
      deal && el('div.notice', {}, 'Лид связан со сделкой справочно. После переноса поля не синхронизируются. ', el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name)),
      lifecycle(), el('div.deal-workspace.entity-workspace', {}, sidebar(), el('div.deal-workspace-content', {}, tablist, panel)),
      canAdmin(store.user) && el('div.danger-zone', {}, actionButton('Удалить лид', async () => {
        if (!await confirmDialog({ title: 'Удалить лид?', message: 'Системный журнал стадий останется в аудите данных.' })) return;
        await store.deleteLead(id); navigate('#/leads');
      }, { iconName: 'trash' }))]);
  }

  render();
  const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
