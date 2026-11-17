import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite, canAdmin } from '../lib/access.js';
import { openContactForm, openLeadForm, openDealForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState, relatedRecords, avandokEmpty, inlineField } from '../ui/mvp-bits.js';
import { exportXlsx, importRegistryXlsx } from '../lib/xlsx.js';
import { fuzzyIncludes, formatDate } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { registryHead, sortRecords, toggleSort, advancedFilters, filterRecords } from '../ui/registry.js';

export function contactsMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = {
    search: '', companyId: '', employeeId: '', sortKey: 'name', sortDirection: 'asc', filters: [],
  };
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });

  function list() {
    const columns = [
      { key: 'name', label: 'ФИО', get: (contact) => contact.name || '' },
      { key: 'title', label: 'Должность', get: (contact) => contact.title || '' },
      { key: 'company', label: 'Контрагент', get: (contact) => store.companyById(contact.companyId)?.name || '' },
      { key: 'phone', label: 'Телефон', get: (contact) => contact.phone || '' },
      { key: 'email', label: 'Email', get: (contact) => contact.email || '' },
      { key: 'employee', label: 'Ответственный', get: (contact) => store.employeeById(contact.employeeId)?.name || '' },
      { key: 'leads', label: 'Лиды', type: 'number', numeric: true, get: (contact) => store.leadsFor({ contactId: contact.id }).length },
      { key: 'deals', label: 'Сделки', type: 'number', numeric: true, get: (contact) => store.dealsFor({ contactId: contact.id }).length },
      { key: 'createdAt', label: 'Создан', type: 'date', get: (contact) => contact.createdAt ? new Date(contact.createdAt).toISOString().slice(0, 10) : '' },
    ];
    const results = el('div');
    const filtered = () => filterRecords(store.contacts.filter((contact) =>
      (!state.companyId || contact.companyId === state.companyId)
      && (!state.employeeId || contact.employeeId === state.employeeId)
      && (!state.search || fuzzyIncludes(`${contact.name} ${contact.title} ${contact.phone} ${contact.email} ${store.companyById(contact.companyId)?.name || ''} ${store.employeeById(contact.employeeId)?.name || ''}`, state.search))), columns, state.filters);
    const table = (rows) => el('div.table-wrap.registry-table-wrap', {}, el('table.data-table', {},
      registryHead(columns, state, (key) => { toggleSort(state, key); renderRows(); }),
      el('tbody', {}, rows.length ? sortRecords(rows, columns, state).map((contact) => el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/contacts?id=${contact.id}` }, contact.name)),
        el('td', {}, contact.title || '—'),
        el('td', {}, store.companyById(contact.companyId)?.name || '—'),
        el('td', {}, contact.phone || '—'), el('td', {}, contact.email || '—'),
        el('td', {}, store.employeeById(contact.employeeId)?.name || '—'),
        el('td.num', {}, store.leadsFor({ contactId: contact.id }).length),
        el('td.num', {}, store.dealsFor({ contactId: contact.id }).length),
        el('td', {}, contact.createdAt ? formatDate(new Date(contact.createdAt).toISOString().slice(0, 10)) : '—')))
        : el('tr', {}, el('td', { colspan: columns.length }, 'По фильтрам ничего не найдено')))));
    function renderRows() {
      const rows = filtered();
      clear(results).append(el('div.registry-summary', {}, el('span.filter-count', {}, `${rows.length} из ${store.contacts.length}`),
        el('span', {}, 'Нажмите на заголовок для сортировки')),
        store.contacts.length ? table(rows) : emptyState('Контактов пока нет', 'Добавьте человека, с которым ведётся работа.',
          canWrite(store.user) && actionButton('Создать контакт', () => openContactForm(), { primary: true })));
    }
    const search = el('input.input', {
      type: 'search', value: state.search, placeholder: 'ФИО, должность, телефон, email или контрагент',
      dataset: { focusKey: 'contact-search' },
      oninput: (event) => { state.search = event.target.value; renderRows(); },
    });
    const company = el('select.select', { onchange: (event) => { state.companyId = event.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все контрагенты'),
      store.companies.map((row) => el('option', { value: row.id, selected: state.companyId === row.id }, row.name)));
    const employee = el('select.select', { onchange: (event) => { state.employeeId = event.target.value; renderRows(); } },
      el('option', { value: '' }, 'Все ответственные'),
      store.employees.map((row) => el('option', { value: row.id, selected: state.employeeId === row.id }, row.name)));
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (event) => {
      const selected = event.target.files[0]; if (!selected) return;
      try {
        await store.saveSnapshot('XLSX импорт контактов');
        const result = await importRegistryXlsx('contacts', selected);
        toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`, { icon: 'check' });
      } catch (error) {
        console.error(error); toast(`Не удалось импортировать XLSX: ${error.message}`, { icon: 'alert' });
      }
    } });
    root.append(pageHead('Контакты', 'Люди и их принадлежность к контрагентам. Роли задаются в командах и сделках.',
      canWrite(store.user) && file,
      canWrite(store.user) && actionButton('Импорт XLSX', () => file.click(), { iconName: 'upload' }),
      actionButton('Экспорт XLSX', () => exportXlsx('contacts', sortRecords(filtered(), columns, state)), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый контакт', () => openContactForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, company, employee), advancedFilters(columns, state.filters, renderRows), results);
    renderRows();
  }

  function detail() {
    const contact = store.contactById(id);
    if (!contact) {
      root.append(emptyState('Контакт не найден', 'Возможно, запись была удалена.', el('a.btn.btn-ghost', { href: '#/contacts' }, 'К списку')));
      return;
    }
    const company = store.companyById(contact.companyId);
    const memberships = store.companyTeam.filter((row) => row.contactId === id);
    const participants = store.deals.filter((deal) => deal.contacts?.some((row) => row.contactId === id));
    const disabled = !canWrite(store.user);
    let draft = {};
    const save = async (patch) => {
      if (disabled) return null;
      draft = { ...draft, ...patch };
      const pending = draft; draft = {};
      try { return await store.updateContact(id, pending); }
      catch (error) { toast(error.message || 'Не удалось сохранить изменения', { icon: 'alert' }); render(); return null; }
    };
    const queue = (patch) => { draft = { ...draft, ...patch }; };
    const flush = () => Object.keys(draft).length ? save({}) : Promise.resolve(null);
    const records = (rows, empty) => [{ value: '', label: empty }, ...rows.slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((row) => ({ value: row.id, label: row.name }))];
    const inline = (label, key, config = {}) => inlineField({
      label, key, value: contact[key] ?? '', disabled, save, queue, focusPrefix: 'contact-field', ...config,
    }).node;
    const createLinked = async (kind) => {
      await flush();
      const latest = store.contactById(id);
      const presets = { contactId: id, companyId: latest?.companyId || null };
      if (kind === 'lead') openLeadForm(null, { presets }); else openDealForm(null, { presets });
    };
    const sidebar = el('aside.deal-sidebar.entity-sidebar', {}, el('section.deal-side-section', {},
      el('h2.deal-side-title', {}, 'Параметры контакта'),
      inline('Ответственный', 'employeeId', { options: records(store.activeEmployees([contact.employeeId]), 'Не назначен'), parse: (value) => value || null }),
      inline('Контрагент', 'companyId', { options: records(store.companies, 'Без контрагента'), parse: (value) => value || null }),
      el('p.autosave-hint', {}, disabled ? 'Только просмотр' : 'Выбор сохраняется сразу, текст — при выходе из поля.')));
    const main = el('div.deal-workspace-main', {},
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Основная информация')),
        el('div.form-grid.deal-inline-grid', {},
          inline('ФИО', 'name', { required: true, parse: (value) => value.trim() }),
          inline('Должность', 'title', { parse: (value) => value.trim() }),
          inline('Телефон', 'phone', { type: 'tel', parse: (value) => value.trim() }),
          inline('Email', 'email', { type: 'email', parse: (value) => value.trim() })),
        inline('Комментарий', 'notes', { type: 'textarea', rows: 5 })),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Роли в командах и сделках')),
        memberships.length || participants.length ? el('div.link-list', {},
          memberships.map((row) => {
            const linkedCompany = store.companyById(row.companyId);
            return linkedCompany && el('a.person-row', { href: `#/companies?id=${linkedCompany.id}` },
              el('span.grow', {}, `Команда · ${linkedCompany.name}`), el('span.muted', {}, `${row.role || '—'} · ${row.influence || '—'}`));
          }),
          participants.map((deal) => {
            const participant = deal.contacts.find((row) => row.contactId === id);
            return el('a.person-row', { href: `#/pipeline?id=${deal.id}` }, el('span.grow', {}, `Сделка · ${deal.name}`),
              el('span.muted', {}, `${participant.role || '—'} · ${participant.position || participant.influence || '—'}`));
          }))
          : el('p.muted', {}, 'Роль контакта появится после добавления в команду контрагента или участники сделки.')),
      relatedRecords('contact', id), avandokEmpty());
    root.append(el('a.back-link', { href: '#/contacts' }, '← Все контакты'),
      pageHead(contact.name, `${contact.title || 'Должность не указана'}${company ? ` · ${company.name}` : ''}`,
        canWrite(store.user) && actionButton('Лид', () => createLinked('lead'), { iconName: 'plus' }),
        canWrite(store.user) && actionButton('Сделка', () => createLinked('deal'), { primary: true, iconName: 'plus' })),
      el('div.deal-workspace.entity-workspace', {}, sidebar, main),
      canAdmin(store.user) && el('div.danger-zone', {}, actionButton('Удалить контакт', async () => {
        if (!await confirmDialog({ title: 'Удалить контакт?', message: 'Связи в других записях будут сняты.' })) return;
        await store.deleteContact(id); navigate('#/contacts');
      }, { iconName: 'trash' })));
  }

  render();
  const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
