import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite } from '../lib/access.js';
import { dictionaryOptions, dealTotals } from '../lib/spec.js';
import { openCompanyForm, openContactForm, openDealForm, openLeadForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState, facts, relatedRecords, avandokEmpty, money } from '../ui/mvp-bits.js';
import { exportXlsx, importRegistryXlsx } from '../lib/xlsx.js';
import { fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

export function companiesMvpView({ params, navigate }) {
  const root = el('div.view'); const id = params.get('id');
  const state = { search: '', role: '' };
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });
  function list() {
    const search = el('input.input', { type: 'search', placeholder: 'Название или ИНН', oninput: (e) => { state.search = e.target.value; rows(); } });
    const role = el('select.select', { onchange: (e) => { state.role = e.target.value; rows(); } },
      dictionaryOptions(store.settings, 'companyRoles', { empty: 'Все роли' }).map((o) => el('option', { value: o.value, selected: state.role === o.value }, o.label)));
    const body = el('tbody'); const count = el('span.filter-count');
    const filtered = () => store.companies.filter((c) => (!state.role || c.role === state.role) && (!state.search || fuzzyIncludes(`${c.name} ${c.inn}`, state.search)));
    function rows() {
      const data = filtered().sort((a, b) => a.name.localeCompare(b.name, 'ru')); count.textContent = `${data.length} из ${store.companies.length}`;
      clear(body).append(...(data.length ? data.map((c) => el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/companies?id=${c.id}` }, c.name)), el('td', {}, c.inn || '—'),
        el('td', {}, c.role || '—'), el('td', {}, store.companyById(c.parentCompanyId)?.name || '—'),
        el('td.num', {}, store.contactsOf(c.id).length), el('td.num', {}, store.leadsFor({ companyId: c.id }).length),
        el('td.num', {}, store.dealsFor({ companyId: c.id }).length),
        el('td.num', {}, money(store.dealsFor({ companyId: c.id }).reduce((sum, d) => sum + dealTotals(d.id, store.payments).total, 0)))))
        : [el('tr', {}, el('td', { colspan: 8 }, 'По фильтрам ничего не найдено'))]));
    }
    rows();
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (e) => {
      const selected = e.target.files[0]; if (!selected) return;
      try { await store.saveSnapshot('XLSX импорт контрагентов'); const result = await importRegistryXlsx('companies', selected); toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`, { icon: 'check' }); }
      catch (error) { console.error(error); toast(`Не удалось импортировать XLSX: ${error.message}`, { icon: 'alert' }); }
    } });
    root.append(pageHead('Контрагенты', 'Клиенты, партнёры-интеграторы и конкуренты',
      canWrite(store.user) && file, canWrite(store.user) && actionButton('Импорт XLSX', () => file.click(), { iconName: 'upload' }),
      actionButton('Экспорт XLSX', () => exportXlsx('companies', filtered()), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый контрагент', () => openCompanyForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, role, count),
      store.companies.length ? el('div.table-wrap', {}, el('table.data-table', {},
        el('thead', {}, el('tr', {}, ['Название', 'ИНН', 'Роль', 'Головная структура', 'Контакты', 'Лиды', 'Сделки', 'Сумма'].map((h) => el('th', {}, h)))), body))
        : emptyState('Контрагентов пока нет', 'Добавьте клиента, партнёра или конкурента.'));
  }

  function teamEditor(company) {
    const body = el('tbody');
    const save = async (rows) => store.setCompanyTeam(company.id, rows);
    const rowNodes = () => {
      const rows = store.companyTeamFor(company.id);
      clear(body).append(...(rows.length ? rows.map((r) => {
        const contact = el('select.select', { onchange: (e) => save(store.companyTeam.map((x) => x.id === r.id ? { ...x, contactId: e.target.value } : x)) },
          store.contacts.filter((c) => c.companyId === company.id || c.id === r.contactId)
            .map((c) => el('option', { value: c.id, selected: c.id === r.contactId }, c.name)));
        const role = el('select.select', { onchange: (e) => save(store.companyTeam.map((x) => x.id === r.id ? { ...x, role: e.target.value } : x)) },
          dictionaryOptions(store.settings, 'teamRoles').map((o) => el('option', { value: o.value, selected: o.value === r.role }, o.label)));
        const influence = el('select.select', { onchange: (e) => save(store.companyTeam.map((x) => x.id === r.id ? { ...x, influence: e.target.value } : x)) },
          dictionaryOptions(store.settings, 'influence').map((o) => el('option', { value: o.value, selected: o.value === r.influence }, o.label)));
        const comment = el('input.input', { value: r.comment || '', onchange: (e) => save(store.companyTeam.map((x) => x.id === r.id ? { ...x, comment: e.target.value } : x)) });
        return el('tr', {}, el('td', {}, contact), el('td', {}, role), el('td', {}, influence), el('td', {}, comment),
          canWrite(store.user) && el('td', {}, actionButton('Удалить', () => save(store.companyTeam.filter((x) => x.id !== r.id)), { iconName: 'trash' })));
      }) : [el('tr', {}, el('td', { colspan: 5 }, 'Команда контрагента пока не заполнена'))]));
      for (const select of body.querySelectorAll('select')) select.disabled = !canWrite(store.user);
      for (const input of body.querySelectorAll('input')) input.disabled = !canWrite(store.user);
    };
    rowNodes();
    const contact = el('select.select', {}, el('option', { value: '' }, 'Контакт'), store.contacts.filter((c) => c.companyId === company.id).map((c) => el('option', { value: c.id }, c.name)));
    const role = el('select.select', {}, dictionaryOptions(store.settings, 'teamRoles').map((o) => el('option', { value: o.value }, o.label)));
    const influence = el('select.select', {}, dictionaryOptions(store.settings, 'influence').map((o) => el('option', { value: o.value }, o.label)));
    const comment = el('input.input', { placeholder: 'Комментарий' });
    const add = () => { if (!contact.value) return; save([...store.companyTeam, { companyId: company.id, contactId: contact.value, role: role.value, influence: influence.value, comment: comment.value }]); };
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Команда контрагента')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Контакт', 'Тип / роль', 'Влияние', 'Комментарий', ''].map((h) => el('th', {}, h)))), body)),
      canWrite(store.user) && el('div.inline-add-grid', {}, contact, role, influence, comment, actionButton('Добавить', add, { iconName: 'plus' })));
  }

  function detail() {
    const company = store.companyById(id);
    if (!company) { root.append(emptyState('Контрагент не найден', '', el('a.btn.btn-ghost', { href: '#/companies' }, 'К списку'))); return; }
    const parent = store.companyById(company.parentCompanyId);
    const contacts = store.contactsOf(id); const leads = store.leadsFor({ companyId: id }); const deals = store.dealsFor({ companyId: id });
    root.append(el('a.back-link', { href: '#/companies' }, '← Все контрагенты'),
      pageHead(company.name, company.role || 'Роль не указана',
        canWrite(store.user) && actionButton('Редактировать', () => openCompanyForm(company), { iconName: 'pencil' }),
        canWrite(store.user) && actionButton('Лид', () => openLeadForm(null, { presets: { companyId: id } }), { iconName: 'plus' }),
        canWrite(store.user) && actionButton('Сделка', () => openDealForm(null, { presets: { companyId: id } }), { primary: true, iconName: 'plus' })),
      el('section.detail-section', {}, facts([['ИНН', company.inn || '—'], ['Роль', company.role || '—'],
        ['Головная структура', parent ? el('a.record-link', { href: `#/companies?id=${parent.id}` }, parent.name) : '—'],
        ['Отрасль', company.industry || '—'], ['Сайт', company.website || '—'], ['Комментарий', company.notes || '—']])),
      teamEditor(company),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Контакты · ${contacts.length}`),
        canWrite(store.user) && actionButton('Добавить контакт', () => openContactForm(null, { presets: { companyId: id } }), { iconName: 'plus' })),
        contacts.length ? el('div.link-list', {}, contacts.map((c) => el('a.person-row', { href: `#/contacts?id=${c.id}` },
          el('span.grow', {}, c.name), el('span.muted', {}, c.title || '')))) : el('p.muted', {}, 'Контактов пока нет.')),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, `Лиды и сделки`)),
        el('div.link-list', {}, leads.map((l) => el('a.person-row', { href: `#/leads?id=${l.id}` }, el('span.grow', {}, `Лид · ${l.name}`), el('span.muted', {}, l.status))),
          deals.map((d) => el('a.person-row', { href: `#/pipeline?id=${d.id}` }, el('span.grow', {}, `Сделка · ${d.name}`), el('span.muted', {}, money(dealTotals(d.id, store.payments).total))))),
        !leads.length && !deals.length && el('p.muted', {}, 'Связанных лидов и сделок пока нет.')),
      relatedRecords('company', id), avandokEmpty(),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить контрагента', async () => {
        if (!await confirmDialog({ title: 'Удалить контрагента?', message: 'Связанные записи сохранятся, связь с контрагентом будет снята.' })) return;
        await store.deleteCompany(id); navigate('#/companies');
      }, { iconName: 'trash' })));
  }
  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
