import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { canWrite } from '../lib/access.js';
import { openContactForm, openLeadForm, openDealForm } from '../ui/mvp-forms.js';
import { pageHead, actionButton, emptyState, facts, relatedRecords, avandokEmpty } from '../ui/mvp-bits.js';
import { exportXlsx } from '../lib/xlsx.js';
import { fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';

export function contactsMvpView({ params, navigate }) {
  const root = el('div.view'); const id = params.get('id');
  let query = '';
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });
  function list() {
    const body = el('tbody');
    const search = el('input.input', { type: 'search', value: query, placeholder: 'ФИО, должность, телефон, email или контрагент', oninput: (e) => { query = e.target.value; rows(); } });
    const filtered = () => store.contacts.filter((c) => !query || fuzzyIncludes(`${c.name} ${c.title} ${c.phone} ${c.email} ${store.companyById(c.companyId)?.name || ''}`, query));
    function rows() {
      const data = filtered().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      clear(body).append(...(data.length ? data.map((c) => el('tr', {},
        el('td', {}, el('a.record-link', { href: `#/contacts?id=${c.id}` }, c.name)), el('td', {}, c.title || '—'),
        el('td', {}, store.companyById(c.companyId)?.name || '—'), el('td', {}, c.phone || '—'), el('td', {}, c.email || '—'),
        el('td.num', {}, store.leadsFor({ contactId: c.id }).length), el('td.num', {}, store.dealsFor({ contactId: c.id }).length)))
        : [el('tr', {}, el('td', { colspan: 7 }, 'По фильтру ничего не найдено'))]));
    } rows();
    root.append(pageHead('Контакты', 'Люди и их принадлежность к контрагентам. Роли задаются в командах и сделках.',
      actionButton('Экспорт XLSX', () => exportXlsx('contacts', filtered()), { iconName: 'download' }),
      canWrite(store.user) && actionButton('Новый контакт', () => openContactForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, el('span.filter-count', {}, `${filtered().length} из ${store.contacts.length}`)),
      store.contacts.length ? el('div.table-wrap', {}, el('table.data-table', {}, el('thead', {}, el('tr', {}, ['ФИО', 'Должность', 'Контрагент', 'Телефон', 'Email', 'Лиды', 'Сделки'].map((h) => el('th', {}, h)))), body))
        : emptyState('Контактов пока нет', 'Добавьте человека, с которым ведётся работа.'));
  }
  function detail() {
    const contact = store.contactById(id);
    if (!contact) { root.append(emptyState('Контакт не найден', '', el('a.btn.btn-ghost', { href: '#/contacts' }, 'К списку'))); return; }
    const company = store.companyById(contact.companyId);
    const memberships = store.companyTeam.filter((r) => r.contactId === id);
    const participants = store.deals.filter((d) => d.contacts?.some((r) => r.contactId === id));
    root.append(el('a.back-link', { href: '#/contacts' }, '← Все контакты'),
      pageHead(contact.name, contact.title || 'Должность не указана',
        canWrite(store.user) && actionButton('Редактировать', () => openContactForm(contact), { iconName: 'pencil' }),
        canWrite(store.user) && actionButton('Лид', () => openLeadForm(null, { presets: { contactId: id, companyId: contact.companyId } }), { iconName: 'plus' }),
        canWrite(store.user) && actionButton('Сделка', () => openDealForm(null, { presets: { contactId: id, companyId: contact.companyId } }), { primary: true, iconName: 'plus' })),
      el('section.detail-section', {}, facts([['ФИО', contact.name], ['Должность', contact.title || '—'], ['Телефон', contact.phone || '—'], ['Email', contact.email || '—'],
        ['Контрагент', company ? el('a.record-link', { href: `#/companies?id=${company.id}` }, company.name) : '—'], ['Комментарий', contact.notes || '—']])),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Роли в командах и сделках')),
        memberships.length || participants.length ? el('div.link-list', {},
          memberships.map((r) => { const c = store.companyById(r.companyId); return c && el('a.person-row', { href: `#/companies?id=${c.id}` }, el('span.grow', {}, `Команда · ${c.name}`), el('span.muted', {}, `${r.role || '—'} · ${r.influence || '—'}`)); }),
          participants.map((d) => { const p = d.contacts.find((r) => r.contactId === id); return el('a.person-row', { href: `#/pipeline?id=${d.id}` }, el('span.grow', {}, `Сделка · ${d.name}`), el('span.muted', {}, `${p.role || '—'} · ${p.influence || '—'}`)); }))
          : el('p.muted', {}, 'Роль контакта появится после добавления в команду контрагента или участники сделки.')),
      relatedRecords('contact', id), avandokEmpty(),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить контакт', async () => {
        if (!await confirmDialog({ title: 'Удалить контакт?', message: 'Связи в других записях будут сняты.' })) return;
        await store.deleteContact(id); navigate('#/contacts');
      }, { iconName: 'trash' })));
  }
  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
