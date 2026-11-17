import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite, canAdmin } from '../lib/access.js';
import { dictionaryOptions, dealTotals, LEAD_STAGES } from '../lib/spec.js';
import { openCompanyForm, openContactForm, openDealForm, openLeadForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState, relatedRecords, avandokEmpty, money, inlineField, entityTabs, fieldHistoryTable } from '../ui/mvp-bits.js';
import { exportXlsx, importRegistryXlsx } from '../lib/xlsx.js';
import { fuzzyIncludes, formatDate } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

const leadStageLabel = (stage) => LEAD_STAGES.find((row) => row.id === stage)?.label || stage || '—';

export function companiesMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = {
    search: '', role: '', employeeId: '', sortKey: 'name', sortDirection: 'asc', filters: [], tab: 'main',
  };
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });

  function list() {
    const columns = [
      { key: 'name', label: 'Название', get: (company) => company.name || '' },
      { key: 'inn', label: 'ИНН', get: (company) => company.inn || '' },
      { key: 'role', label: 'Роль', get: (company) => company.role || '' },
      { key: 'industry', label: 'Отрасль', get: (company) => company.industry || '' },
      { key: 'parent', label: 'Головная структура', get: (company) => store.companyById(company.parentCompanyId)?.name || '' },
      { key: 'employee', label: 'Ответственный', get: (company) => store.employeeById(company.employeeId)?.name || '' },
      { key: 'contacts', label: 'Контакты', type: 'number', numeric: true, get: (company) => store.contactsOf(company.id).length },
      { key: 'leads', label: 'Лиды', type: 'number', numeric: true, get: (company) => store.leadsFor({ companyId: company.id }).length },
      { key: 'deals', label: 'Сделки', type: 'number', numeric: true, get: (company) => store.dealsFor({ companyId: company.id }).length },
      { key: 'amount', label: 'Сумма', type: 'number', numeric: true, get: (company) => store.dealsFor({ companyId: company.id }).reduce((sum, deal) => sum + dealTotals(deal.id, store.payments).total, 0) },
      { key: 'createdAt', label: 'Создан', type: 'date', get: (company) => company.createdAt ? new Date(company.createdAt).toISOString().slice(0, 10) : '' },
    ];
    const results = el('div');
    const filtered = () => filterRecords(store.companies.filter((company) =>
      (!state.role || company.role === state.role)
      && (!state.employeeId || company.employeeId === state.employeeId)
      && (!state.search || fuzzyIncludes(`${company.name} ${company.inn} ${company.industry} ${company.website} ${store.employeeById(company.employeeId)?.name || ''}`, state.search))), columns, state.filters);
    const table = (rows) => el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
      registryHead(columns, state, (key) => { toggleSort(state, key); renderRows(); }),
      el('tbody', {}, rows.length ? sortRecords(rows, columns, state).map((company) => el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/companies?id=${company.id}` }, company.name)),
        el('td', {}, company.inn || '—'), el('td', {}, company.role || '—'), el('td', {}, company.industry || '—'),
        el('td', {}, store.companyById(company.parentCompanyId)?.name || '—'),
        el('td', {}, store.employeeById(company.employeeId)?.name || '—'),
        el('td.num', {}, store.contactsOf(company.id).length),
        el('td.num', {}, store.leadsFor({ companyId: company.id }).length),
        el('td.num', {}, store.dealsFor({ companyId: company.id }).length),
        el('td.num', {}, money(store.dealsFor({ companyId: company.id }).reduce((sum, deal) => sum + dealTotals(deal.id, store.payments).total, 0))),
        el('td', {}, company.createdAt ? formatDate(new Date(company.createdAt).toISOString().slice(0, 10)) : '—')))
        : el('tr', {}, el('td', { colspan: columns.length }, 'По фильтрам ничего не найдено')))));
    function renderRows() {
      const rows = filtered();
      clear(results).append(el('div.registry-summary', {}, el('span.filter-count', {}, `${rows.length} из ${store.companies.length}`),
        el('span', {}, 'Нажмите на заголовок для сортировки')),
        store.companies.length ? table(rows) : emptyState('Контрагентов пока нет', 'Добавьте клиента, партнёра или конкурента.',
          canWrite(store.user) && actionButton('Создать контрагента', () => openCompanyForm(), { primary: true })));
    }
    const search = el('input.input', {
      type: 'search', value: state.search, placeholder: 'Название, ИНН, отрасль, сайт или ответственный',
      dataset: { focusKey: 'company-search' },
      oninput: (event) => { state.search = event.target.value; renderRows(); },
    });
    const role = el('select.select', { onchange: (event) => { state.role = event.target.value; renderRows(); } },
      dictionaryOptions(store.settings, 'companyRoles', { empty: 'Все роли' })
        .map((option) => el('option', { value: option.value, selected: state.role === option.value }, option.label)));
    const employee = el('select.select', { onchange: (event) => { state.employeeId = event.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все ответственные'),
      store.employees.map((row) => el('option', { value: row.id, selected: state.employeeId === row.id }, row.name)));
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (event) => {
      const selected = event.target.files[0]; if (!selected) return;
      try {
        await store.saveSnapshot('XLSX импорт контрагентов');
        const result = await importRegistryXlsx('companies', selected);
        toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`, { icon: 'check' });
      } catch (error) {
        console.error(error); toast(`Не удалось импортировать XLSX: ${error.message}`, { icon: 'alert' });
      }
    } });
    root.append(pageHead('Контрагенты', 'Клиенты, партнёры-интеграторы и конкуренты',
      canWrite(store.user) && file,
      canWrite(store.user) && actionButton('Импорт XLSX', () => file.click(), { iconName: 'upload' }),
      actionButton('Экспорт XLSX', () => exportXlsx('companies', sortRecords(filtered(), columns, state)), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый контрагент', () => openCompanyForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, role, employee), advancedFilters(columns, state.filters, renderRows), results);
    renderRows();
  }

  function teamEditor(company) {
    const body = el('tbody');
    const save = async (rows) => {
      try { await store.setCompanyTeam(company.id, rows); }
      catch (error) { toast(error.message || 'Не удалось изменить команду', { icon: 'alert' }); }
    };
    const rowNodes = () => {
      const rows = store.companyTeamFor(company.id);
      clear(body).append(...(rows.length ? rows.map((row) => {
        const contact = el('select.select', {
          dataset: { focusKey: `company-team-contact-${row.id}` },
          onchange: (event) => save(store.companyTeam.map((item) => item.id === row.id ? { ...item, contactId: event.target.value } : item)),
        }, store.contacts.filter((item) => item.companyId === company.id || item.id === row.contactId)
          .map((item) => el('option', { value: item.id, selected: item.id === row.contactId }, item.name)));
        const role = el('select.select', {
          dataset: { focusKey: `company-team-role-${row.id}` },
          onchange: (event) => save(store.companyTeam.map((item) => item.id === row.id ? { ...item, role: event.target.value } : item)),
        }, dictionaryOptions(store.settings, 'teamRoles').map((option) => el('option', { value: option.value, selected: option.value === row.role }, option.label)));
        const influence = el('select.select', {
          dataset: { focusKey: `company-team-influence-${row.id}` },
          onchange: (event) => save(store.companyTeam.map((item) => item.id === row.id ? { ...item, influence: event.target.value } : item)),
        }, dictionaryOptions(store.settings, 'influence').map((option) => el('option', { value: option.value, selected: option.value === row.influence }, option.label)));
        const comment = el('input.input', {
          value: row.comment || '', dataset: { focusKey: `company-team-comment-${row.id}` },
          onchange: (event) => save(store.companyTeam.map((item) => item.id === row.id ? { ...item, comment: event.target.value } : item)),
        });
        const remove = () => save(store.companyTeam.filter((item) => item.id !== row.id));
        return el('tr', {}, el('td', {}, contact), el('td', {}, role), el('td', {}, influence), el('td', {}, comment),
          canWrite(store.user) && el('td', {}, actionButton('Убрать', remove)));
      }) : [el('tr', {}, el('td', { colspan: 5 }, 'Команда контрагента пока не заполнена'))]));
      for (const select of body.querySelectorAll('select')) select.disabled = !canWrite(store.user);
      for (const input of body.querySelectorAll('input')) input.disabled = !canWrite(store.user);
    };
    rowNodes();
    const contact = el('select.select', {}, el('option', { value: '' }, 'Контакт'),
      store.contacts.filter((item) => item.companyId === company.id).map((item) => el('option', { value: item.id }, item.name)));
    const role = el('select.select', {}, dictionaryOptions(store.settings, 'teamRoles').map((option) => el('option', { value: option.value }, option.label)));
    const influence = el('select.select', {}, dictionaryOptions(store.settings, 'influence').map((option) => el('option', { value: option.value }, option.label)));
    const comment = el('input.input', { placeholder: 'Комментарий' });
    const add = () => {
      if (!contact.value) return;
      save([...store.companyTeam, { companyId: company.id, contactId: contact.value, role: role.value, influence: influence.value, comment: comment.value }]);
    };
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Команда контрагента')),
      el('div.table-wrap', {}, el('table.data-table.compact', {},
        el('thead', {}, el('tr', {}, ['Контакт', 'Тип / роль', 'Влияние', 'Комментарий', ''].map((label) => el('th', {}, label)))), body)),
      canWrite(store.user) && el('div.inline-add-grid', {}, contact, role, influence, comment, actionButton('Добавить', add, { iconName: 'plus' })));
  }

  function detail() {
    const company = store.companyById(id);
    if (!company) {
      root.append(emptyState('Контрагент не найден', 'Возможно, запись была удалена.', el('a.btn.btn-ghost', { href: '#/companies' }, 'К списку')));
      return;
    }
    const contacts = store.contactsOf(id);
    const leads = store.leadsFor({ companyId: id });
    const deals = store.dealsFor({ companyId: id });
    const children = store.companies.filter((row) => row.parentCompanyId === id);
    const parent = store.companyById(company.parentCompanyId);
    const disabled = !canWrite(store.user);
    let draft = {};
    const save = async (patch) => {
      if (disabled) return null;
      draft = { ...draft, ...patch };
      const pending = draft; draft = {};
      try { return await store.updateCompany(id, pending); }
      catch (error) { toast(error.message || 'Не удалось сохранить изменения', { icon: 'alert' }); render(); return null; }
    };
    const queue = (patch) => { draft = { ...draft, ...patch }; };
    const flush = () => Object.keys(draft).length ? save({}) : Promise.resolve(null);
    const records = (rows, empty) => [{ value: '', label: empty }, ...rows.slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((row) => ({ value: row.id, label: row.name }))];
    const inline = (label, key, config = {}) => inlineField({
      label, key, value: company[key] ?? '', disabled, save, queue, focusPrefix: 'company-field', ...config,
    }).node;
    const createLinked = async (kind) => {
      await flush();
      if (kind === 'lead') openLeadForm(null, { presets: { companyId: id } });
      else if (kind === 'deal') openDealForm(null, { presets: { companyId: id } });
      else openContactForm(null, { presets: { companyId: id } });
    };
    const sidebar = () => el('aside.deal-sidebar.entity-sidebar', {}, el('section.deal-side-section', {},
      el('h2.deal-side-title', {}, 'Параметры контрагента'),
      inline('Название', 'name', { required: true, parse: (value) => value.trim() }),
      inline('ИНН', 'inn', { parse: (value) => value.trim() }),
      inline('Отрасль', 'industry', { parse: (value) => value.trim() }),
      inline('Сайт', 'website', { type: 'url', parse: (value) => value.trim() }),
      inline('Ответственный', 'employeeId', { options: records(store.activeEmployees([company.employeeId]), 'Не назначен'), parse: (value) => value || null }),
      inline('Основной контакт', 'primaryContactId', {
        options: records(store.contacts.filter((row) => row.companyId === id || row.id === company.primaryContactId), 'Не выбран'),
        parse: (value) => value || null,
      }),
      inline('Роль контрагента', 'role', { options: dictionaryOptions(store.settings, 'companyRoles', { empty: 'Не указана' }) }),
      inline('Головная структура', 'parentCompanyId', {
        options: records(store.companies.filter((row) => row.id !== id), 'Нет головной структуры'), parse: (value) => value || null,
      }),
      el('p.autosave-hint', {}, disabled ? 'Только просмотр' : 'Выбор сохраняется сразу, текст — при выходе из поля или переключении вкладки.')));
    const mainTab = () => el('div.deal-tab-panel', {},
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Комментарий')),
        inline('Комментарий', 'notes', { type: 'textarea', rows: 4 })),
      teamEditor(company),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Структура компаний'),
        canWrite(store.user) && actionButton('Добавить дочернюю компанию', () => openCompanyForm(null, { presets: { parentCompanyId: id } }), { iconName: 'plus' })),
        parent || children.length ? el('div.link-list', {},
          parent && el('a.person-row', { href: `#/companies?id=${parent.id}` }, el('span.grow', {}, `Головная компания · ${parent.name}`), el('span.muted', {}, parent.inn || '')),
          children.map((child) => el('a.person-row', { href: `#/companies?id=${child.id}` },
            el('span.grow', {}, `Дочерняя компания · ${child.name}`), el('span.muted', {}, child.inn || ''))))
          : el('p.muted', {}, 'Головная и дочерние компании не указаны.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Контакты · ${contacts.length}`),
        canWrite(store.user) && actionButton('Добавить контакт', () => createLinked('contact'), { iconName: 'plus' })),
        contacts.length ? el('div.link-list', {}, contacts.map((contact) => el('a.person-row', { href: `#/contacts?id=${contact.id}` },
          el('span.grow', {}, contact.name), el('span.muted', {}, contact.title || '')))) : el('p.muted', {}, 'Контактов пока нет.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Лиды и сделки')),
        leads.length || deals.length ? el('div.link-list', {},
          leads.map((lead) => el('a.person-row', { href: `#/leads?id=${lead.id}` },
            el('span.grow', {}, `Лид · ${lead.name || 'Без темы'}`), el('span.muted', {}, `${leadStageLabel(lead.stage)} · ${lead.status}`))),
          deals.map((deal) => el('a.person-row', { href: `#/pipeline?id=${deal.id}` },
            el('span.grow', {}, `Сделка · ${deal.name}`), el('span.muted', {}, money(dealTotals(deal.id, store.payments).total)))))
          : el('p.muted', {}, 'Связанных лидов и сделок пока нет.')),
      relatedRecords('company', id), avandokEmpty());
    const systemTab = () => {
      const fields = store.entityFieldHistoryFor('company', id);
      const stages = [
        ...leads.flatMap((lead) => store.leadStageHistoryFor(lead.id).map((row) => ({
          ...row, entity: `Лид · ${lead.name || 'Без темы'}`, href: `#/leads?id=${lead.id}`,
          previous: leadStageLabel(row.previousStage), next: leadStageLabel(row.newStage),
        }))),
        ...deals.flatMap((deal) => store.dealStageHistoryFor(deal.id).map((row) => ({
          ...row, entity: `Сделка · ${deal.name}`, href: `#/pipeline?id=${deal.id}`,
          previous: store.stages().find((stage) => stage.id === row.previousStage)?.label || row.previousStage || '—',
          next: store.stages().find((stage) => stage.id === row.newStage)?.label || row.newStage || '—',
        }))),
      ].sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id)));
      return el('div.deal-tab-panel', {},
        el('section.detail-section', {}, el('div.fact-grid', {},
          el('div.fact', {}, el('dt', {}, 'Создан'), el('dd', {}, new Date(company.createdAt).toLocaleString('ru-RU'))),
          el('div.fact', {}, el('dt', {}, 'Обновлён'), el('dd', {}, new Date(company.updatedAt || company.createdAt).toLocaleString('ru-RU'))))),
        el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Журнал стадий связанных записей · ${stages.length}`)),
          el('p.field-hint', {}, 'Новые записи сверху. В журнал попадают стадии лидов и сделок этого контрагента.'),
          el('div.table-wrap', {}, el('table.data-table.compact', {},
            el('thead', {}, el('tr', {}, ['Дата и время', 'Пользователь', 'Запись', 'Предыдущая стадия', 'Новая стадия'].map((label) => el('th', {}, label)))),
            el('tbody', {}, stages.length ? stages.map((row) => el('tr', {},
              el('td', {}, new Date(row.at).toLocaleString('ru-RU')), el('td', {}, row.actorName || 'Системный процесс'),
              el('td', {}, el('a.record-link', { href: row.href }, row.entity)), el('td', {}, row.previous), el('td', {}, row.next)))
              : el('tr', {}, el('td', { colspan: 5 }, 'Записей пока нет')))))),
        el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Журнал полей · ${fields.length}`)), fieldHistoryTable(fields)));
    };
    const tabs = entityTabs('company', [['main', 'Основная'], ['system', 'Системная']], state.tab, async (key) => {
      state.tab = key; await flush(); render();
    });
    const panel = state.tab === 'system' ? systemTab() : mainTab();
    panel.id = `company-panel-${state.tab}`;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `company-tab-${state.tab}`);
    root.append(el('a.back-link', { href: '#/companies' }, '← Все контрагенты'),
      pageHead(company.name, `${company.role || 'Роль не указана'} · ${store.employeeById(company.employeeId)?.name || 'Ответственный не назначен'}`,
        canWrite(store.user) && actionButton('Лид', () => createLinked('lead'), { iconName: 'plus' }),
        canWrite(store.user) && actionButton('Сделка', () => createLinked('deal'), { primary: true, iconName: 'plus' })),
      el('div.deal-workspace.entity-workspace', {}, sidebar(), el('div.deal-workspace-content', {}, tabs, el('div.deal-workspace-main', {}, panel))),
      canAdmin(store.user) && el('div.danger-zone', {}, actionButton('Удалить контрагента', async () => {
        if (!await confirmDialog({ title: 'Удалить контрагента?', message: 'Связанные записи сохранятся, связь с контрагентом будет снята.' })) return;
        await store.deleteCompany(id); navigate('#/companies');
      }, { iconName: 'trash' })));
  }

  render();
  const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
