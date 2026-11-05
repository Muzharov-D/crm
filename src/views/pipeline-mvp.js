import { el, clear, keepingFocus, append } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { DEAL_STAGES, dealTotals, fiscalYearAt, dictionaryOptions, productForSubproduct } from '../lib/spec.js';
import { composeDealName } from '../lib/mvp.js';
import { canWrite } from '../lib/access.js';
import { isOpen } from '../lib/forecast.js';
import {
  openDealForm, openPaymentForm, openContactForm, openEmployeeForm, openActivityForm, openTaskForm,
} from '../ui/mvp-forms.js';
import {
  pageHead, actionButton, emptyState, facts, historyTable, avandokEmpty, money, eventsTable,
} from '../ui/mvp-bits.js';
import { field, textInput, searchSelect } from '../ui/forms.js';
import { customFieldInputs } from '../ui/custom-fields.js';
import { exportXlsx, importPipelineXlsx } from '../lib/xlsx.js';
import { formatDate, fuzzyIncludes } from '../lib/util.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

const stageLabel = (id) => store.stages().find((s) => s.id === id)?.label || DEAL_STAGES.find((s) => s.id === id)?.label || id;
const byName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const recordOptions = (rows, empty = 'Не выбрано') => [
  { value: '', label: empty }, ...byName(rows).map((row) => ({ value: row.id, label: row.name })),
];
const dictionarySelectOptions = (key, current = '', parent = null) => {
  const options = dictionaryOptions(store.settings, key, { parent });
  if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: current });
  return options.map((o) => el('option', { value: o.value, selected: o.value === current }, o.label));
};
const dateTime = (stamp) => stamp ? new Date(stamp).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function pipelineMvpView({ params, navigate }) {
  const root = el('div.view');
  const id = params.get('id');
  const state = { search: '', product: '', status: '', category: '', showClosed: false, layout: 'board' };
  const render = keepingFocus(() => { clear(root); id ? detail() : list(); });

  function filteredDeals() {
    return store.deals.filter((d) => (state.showClosed || isOpen(d)) && (!state.product || d.product === state.product)
      && (!state.status || d.status === state.status) && (!state.category || d.probabilityCategory === state.category)
      && (!state.search || fuzzyIncludes(`${d.name} ${store.companyById(d.companyId)?.name || ''}`, state.search)));
  }

  function list() {
    const results = el('div.deal-search-results');
    const renderResults = () => {
      const deals = filteredDeals();
      clear(results).append(!store.deals.length
        ? emptyState('Сделок пока нет', 'Создайте сделку напрямую, переведите квалифицированный лид или импортируйте текущий пайплайн XLSX.')
        : state.layout === 'board' ? board(deals) : table(deals));
    };
    const search = el('input.input', {
      type: 'search', value: state.search, placeholder: 'Сделка или контрагент',
      'aria-label': 'Поиск сделок', dataset: { focusKey: 'deal-list-search' },
      oninput: (e) => { state.search = e.target.value; renderResults(); },
    });
    const product = el('select.select', { onchange: (e) => { state.product = e.target.value; render(); } },
      el('option', { value: '' }, 'Все продукты'), [...new Set(store.deals.map((d) => d.product).filter(Boolean))].map((v) => el('option', { value: v, selected: state.product === v }, v)));
    const status = el('select.select', { onchange: (e) => { state.status = e.target.value; render(); } },
      el('option', { value: '' }, 'Все статусы'), [...new Set(store.deals.map((d) => d.status).filter(Boolean))].map((v) => el('option', { value: v, selected: state.status === v }, v)));
    const category = el('select.select', { onchange: (e) => { state.category = e.target.value; render(); } },
      el('option', { value: '' }, 'Все категории'), ['Высокая', 'Средняя', 'Низкая'].map((v) => el('option', { value: v, selected: state.category === v }, v)));
    const closed = el('label.check-label', {}, el('input', { type: 'checkbox', checked: state.showClosed, onchange: (e) => { state.showClosed = e.target.checked; render(); } }), ' Показывать закрытые');
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (e) => {
      const selected = e.target.files[0]; if (!selected) return;
      try {
        await store.saveSnapshot('XLSX импорт пайплайна');
        const result = await importPipelineXlsx(selected);
        toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`, { icon: 'check' });
      } catch (error) {
        console.error(error); toast(`Не удалось импортировать XLSX: ${error.message}`, { icon: 'alert' });
      }
    } });
    root.append(
      pageHead('Сделки', 'Одна сделка = один договор и один контрагент. Суммы рассчитываются из платежей.',
        canWrite(store.user) && file, canWrite(store.user) && actionButton('Импорт XLSX', () => file.click(), { iconName: 'upload' }),
        actionButton('Экспорт XLSX', () => exportXlsx('deals', filteredDeals()), { iconName: 'download' }),
        canWrite(store.user) && actionButton('Новая сделка', () => openDealForm(), { primary: true, iconName: 'plus' })),
      el('div.filter-bar', {}, search, product, status, category, closed,
        el('div.segmented', {},
          actionButton('Канбан', () => { state.layout = 'board'; render(); }, { attrs: { 'aria-pressed': state.layout === 'board' } }),
          actionButton('Список', () => { state.layout = 'list'; render(); }, { attrs: { 'aria-pressed': state.layout === 'list' } }))),
      results,
    );
    renderResults();
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
      column.addEventListener('drop', async (e) => {
        e.preventDefault(); column.classList.remove('drag-over'); if (!canWrite(store.user)) return;
        const dealId = e.dataTransfer.getData('text/deal-id');
        if (dealId) await store.moveDeal(dealId, stage.id, { preserveOutcome: true });
      });
      return column;
    }));
  }

  function card(deal) {
    const node = el('article.deal-card.mvp-deal-card', { draggable: canWrite(store.user) ? 'true' : 'false' },
      el('a.record-link', { href: `#/pipeline?id=${deal.id}` }, deal.name),
      el('p.muted', {}, store.companyById(deal.companyId)?.name || 'Контрагент не указан'),
      el('strong', {}, money(dealTotals(deal.id, store.payments).total)),
      el('div.deal-card-meta', {}, deal.status || '—', deal.outcome && ` · ${deal.outcome}`),
      el('select.select', { 'aria-label': `Стадия сделки ${deal.name}`, disabled: !canWrite(store.user), onchange: (e) => store.moveDeal(deal.id, e.target.value, { preserveOutcome: true }) },
        DEAL_STAGES.map((s) => el('option', { value: s.id, selected: s.id === deal.stage }, s.label))));
    node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/deal-id', deal.id); e.dataTransfer.effectAllowed = 'move'; });
    return node;
  }

  function table(deals) {
    return el('div.table-wrap', {}, el('table.data-table', {},
      el('thead', {}, el('tr', {}, ['Название', 'Контрагент', 'Стадия', 'Статус', 'Исход', 'Продукт', 'Сумма', 'Текущий ФГ', 'Следующий ФГ', 'Следующий шаг'].map((h) => el('th', {}, h)))),
      el('tbody', {}, deals.length ? deals.map((d) => {
        const t = dealTotals(d.id, store.payments);
        return el('tr', {},
          el('td', {}, el('a.record-link', { href: `#/pipeline?id=${d.id}` }, d.name)), el('td', {}, store.companyById(d.companyId)?.name || '—'),
          el('td', {}, stageLabel(d.stage)), el('td', {}, d.status || '—'), el('td', {}, d.outcome || 'Открыта'),
          el('td', {}, `${d.product || '—'}${d.subproduct ? ` / ${d.subproduct}` : ''}`), el('td.num', {}, money(t.total)),
          el('td.num', {}, money(t.currentFY)), el('td.num', {}, money(t.nextFY)), el('td', {}, d.nextStepText || '—'));
      }) : el('tr', {}, el('td', { colspan: 10 }, 'По фильтрам ничего не найдено')))));
  }

  function lifecycle(deal) {
    const stages = store.stages();
    const current = Math.max(0, stages.findIndex((stage) => stage.id === deal.stage));
    return el('section.detail-section.deal-lifecycle-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Жизненный цикл'),
        el('span.muted', {}, `${current + 1} из ${stages.length}`)),
      el('ol.deal-lifecycle', {}, stages.map((stage, index) => {
        const status = index < current ? 'done' : index === current ? 'current' : 'next';
        return el('li', { className: `lifecycle-${status}` },
          el('button.lifecycle-step', {
            type: 'button', disabled: !canWrite(store.user), dataset: { stage: stage.id, focusKey: `lifecycle-${stage.id}` },
            'aria-current': index === current ? 'step' : null,
            'aria-label': `${index + 1}. ${stage.label}`,
            onclick: async () => {
              if (stage.id === deal.stage) return;
              try { await store.moveDeal(deal.id, stage.id, { preserveOutcome: true }); }
              catch (error) { toast(error.message || 'Не удалось изменить стадию', { icon: 'alert' }); }
            },
          }, el('span.lifecycle-index', {}, index < current ? '✓' : String(index + 1)),
            el('span.lifecycle-label', {}, stage.label)));
      })));
  }

  function nextSteps(deal) {
    const tasks = store.tasks.filter((task) => task.dealId === deal.id)
      .sort((a, b) => Number(a.done) - Number(b.done) || String(a.due).localeCompare(String(b.due)) || a.createdAt - b.createdAt);
    const presets = {
      dealId: deal.id, companyId: deal.companyId || null,
      contactId: deal.contactId || null, leadId: deal.sourceLeadId || null,
    };
    return el('section.detail-section.next-steps-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, `Следующие шаги · ${tasks.filter((task) => !task.done).length}`),
        canWrite(store.user) && actionButton('Добавить задачу', () => openTaskForm(null, { presets }), { primary: true, iconName: 'plus' })),
      tasks.length ? el('div.next-steps-list', {}, tasks.map((task) => el('article', { className: `next-step${task.done ? ' done' : ''}` },
        el('input.next-step-check', {
          type: 'checkbox', checked: task.done, disabled: !canWrite(store.user),
          'aria-label': `${task.done ? 'Вернуть в работу' : 'Завершить'}: ${task.title}`,
          dataset: { focusKey: `deal-task-${task.id}` },
          onchange: (event) => store.toggleTask(task.id, event.target.checked),
        }),
        el('div.next-step-main', {},
          el('button.next-step-title', { type: 'button', onclick: () => openTaskForm(task) }, task.title),
          el('div.next-step-meta', {},
            el('span', {}, store.employeeById(task.employeeId)?.name || 'Сотрудник не назначен'),
            el('span', {}, `Срок: ${formatDate(task.due) || '—'}`),
            el('span.status-pill', {}, task.status || (task.done ? 'Выполнено' : 'К выполнению')))))))
        : el('div.next-steps-empty', {}, el('strong', {}, 'Следующий шаг пока не назначен'),
          el('p', {}, 'Добавьте задачу со сроком и ответственным — она появится здесь и в общем реестре задач.')));
  }

  function dealEvents(deal) {
    const events = store.activitiesFor({ dealId: deal.id });
    const presets = {
      dealId: deal.id, companyId: deal.companyId || null,
      contactId: deal.contactId || null, leadId: deal.sourceLeadId || null,
    };
    return el('section.detail-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, `События · ${events.length}`),
        canWrite(store.user) && actionButton('Добавить событие', () => openActivityForm(null, { presets }), { primary: true, iconName: 'plus' })),
      eventsTable(events),
      el('p.field-hint', {}, 'Здесь фиксируются только свершившиеся события. Будущие действия создаются в следующих шагах.'));
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
    const save = async (contacts) => {
      try { await store.updateDeal(deal.id, { contacts }); }
      catch (error) { toast(error.message || 'Не удалось изменить участников', { icon: 'alert' }); }
    };
    const participantOptions = (current, requiredRole) => [
      el('option', { value: '' }, 'Не выбран'),
      ...rows.filter((r) => r.role === requiredRole || r.contactId === current)
        .map((r) => el('option', { value: r.contactId, selected: r.contactId === current }, store.contactById(r.contactId)?.name || 'Контакт')),
    ];
    const economic = el('select.select', { disabled: !canWrite(store.user), onchange: (e) => store.updateDeal(deal.id, { economicBuyerContactId: e.target.value || null }) }, participantOptions(deal.economicBuyerContactId, 'Экономический покупатель'));
    const champion = el('select.select', { disabled: !canWrite(store.user), onchange: (e) => store.updateDeal(deal.id, { championContactId: e.target.value || null }) }, participantOptions(deal.championContactId, 'Чемпион'));
    const availableContacts = () => store.contacts.filter((c) => !(deal.contacts || []).some((r) => r.contactId === c.id)
      && (!deal.companyId || c.companyId === deal.companyId));
    const addParticipant = async (contactId, role = '', influence = '') => {
      if (!contactId) { toast('Выберите контакт или создайте новый', { icon: 'info' }); return; }
      const current = store.dealById(deal.id)?.contacts || [];
      if (current.some((row) => row.contactId === contactId)) return;
      await save([...current, { contactId, role, influence }]);
    };
    const contact = searchSelect(recordOptions(availableContacts(), 'Выберите контакт'), '', {
      placeholder: 'ФИО контакта', notFound: 'Такого контакта нет в системе',
      onCreate: (query) => openContactForm(null, {
        compact: true, presets: { name: query, companyId: deal.companyId || null },
        onSaved: (created) => addParticipant(created.id, role.value, influence.value),
      }),
    });
    const role = el('select.select', { 'aria-label': 'Роль участника сделки' }, dictionarySelectOptions('teamRoles'));
    const influence = el('select.select', { 'aria-label': 'Влияние участника сделки' }, dictionarySelectOptions('influence'));
    const bodyRows = rows.length ? rows.map((r) => {
      const roleInput = el('select.select', { disabled: !canWrite(store.user),
        onchange: (e) => save(rows.map((x) => x.contactId === r.contactId ? { ...x, role: e.target.value } : x)) }, dictionarySelectOptions('teamRoles', r.role || ''));
      const influenceSelect = el('select.select', { disabled: !canWrite(store.user),
        onchange: (e) => save(rows.map((x) => x.contactId === r.contactId ? { ...x, influence: e.target.value } : x)) },
        dictionarySelectOptions('influence', r.influence || ''));
      return el('tr', {}, el('td', {}, store.contactById(r.contactId)?.name || '—'), el('td', {}, roleInput), el('td', {}, influenceSelect),
        el('td', {}, canWrite(store.user) && actionButton('Удалить', () => save(rows.filter((x) => x.contactId !== r.contactId)), { iconName: 'trash' })));
    }) : [el('tr', {}, el('td', { colspan: 4 }, 'Участники не добавлены'))];
    return el('section.detail-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Участники со стороны клиента')),
      el('div.table-wrap', {}, el('table.data-table.compact', {},
        el('thead', {}, el('tr', {}, ['Контакт', 'Роль', 'Влияние', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.three', {}, contact.wrap, role, influence,
        actionButton('Добавить участника', () => addParticipant(contact.select.value, role.value, influence.value), { iconName: 'plus' })),
      canWrite(store.user) && el('p.field-hint', {}, 'Введите ФИО. Если контакта нет, появится кнопка создания мини-карточки; после сохранения он будет добавлен в сделку.'),
      el('div.form-grid', {},
        el('div.field', {}, el('label.field-label', {}, 'Экономический покупатель'), economic),
        el('div.field', {}, el('label.field-label', {}, 'Чемпион'), champion)));
  }

  function salesTeamEditor(deal) {
    const rows = store.salesTeamFor(deal.id);
    const save = async (team) => {
      try { await store.setSalesTeam(deal.id, team.filter((row) => !row.dealId || row.dealId === deal.id)); }
      catch (error) { toast(error.message || 'Не удалось изменить команду', { icon: 'alert' }); }
    };
    const addMember = async (kind, memberId, memberRole = '') => {
      if (!memberId) { toast('Выберите запись или создайте новую', { icon: 'info' }); return; }
      const current = store.salesTeamFor(deal.id);
      const exists = kind === 'employee'
        ? current.some((row) => row.employeeId === memberId)
        : current.some((row) => row.contactId === memberId);
      if (exists) return;
      await save([...store.salesTeam, {
        dealId: deal.id,
        ...(kind === 'employee' ? { employeeId: memberId } : { contactId: memberId }),
        role: memberRole,
        primary: kind === 'employee' && !current.some((row) => row.employeeId && row.primary),
      }]);
    };
    const availableEmployees = () => store.activeEmployees().filter((employee) => !store.salesTeamFor(deal.id).some((row) => row.employeeId === employee.id));
    const availableContacts = () => store.contacts.filter((contact) => !store.salesTeamFor(deal.id).some((row) => row.contactId === contact.id));
    const role = el('select.select', { 'aria-label': 'Роль участника команды продаж' }, dictionarySelectOptions('salesRoles'));
    const employee = searchSelect(recordOptions(availableEmployees(), 'Выберите сотрудника'), '', {
      placeholder: 'ФИО сотрудника', notFound: 'Такого сотрудника нет в системе',
      onCreate: (query) => openEmployeeForm(null, {
        presets: { name: query },
        onSaved: (created) => addMember('employee', created.id, role.value),
      }),
    });
    const contact = searchSelect(recordOptions(availableContacts(), 'Выберите контакт'), '', {
      placeholder: 'ФИО контакта или партнёра', notFound: 'Такого контакта нет в системе',
      onCreate: (query) => openContactForm(null, {
        compact: true, presets: { name: query, companyId: deal.companyId || null },
        onSaved: (created) => addMember('contact', created.id, role.value),
      }),
    });
    const memberType = el('select.select', {
      'aria-label': 'Тип участника команды продаж',
      onchange: () => {
        const isEmployee = memberType.value === 'employee';
        employee.wrap.hidden = !isEmployee; contact.wrap.hidden = isEmployee;
      },
    }, el('option', { value: 'employee' }, 'Сотрудник'), el('option', { value: 'contact' }, 'Контакт / партнёр'));
    contact.wrap.hidden = true;
    const bodyRows = rows.length ? rows.map((r) => {
      const roleInput = el('select.select', { disabled: !canWrite(store.user),
        onchange: (e) => save(store.salesTeam.map((x) => x.id === r.id ? { ...x, role: e.target.value } : x)) }, dictionarySelectOptions('salesRoles', r.role || ''));
      const primary = r.employeeId ? el('input', {
        type: 'radio', name: `primary-${deal.id}`, checked: r.primary, disabled: !canWrite(store.user),
        'aria-label': `Основной: ${store.employeeById(r.employeeId)?.name || 'сотрудник'}`,
        onchange: () => save(store.salesTeam.map((x) => x.dealId === deal.id ? { ...x, primary: x.id === r.id } : x)),
      }) : el('span.muted', {}, '—');
      const person = r.employeeId ? store.employeeById(r.employeeId) : store.contactById(r.contactId);
      return el('tr', {}, el('td', {}, person?.name || '—'),
        el('td', {}, r.employeeId ? 'Сотрудник' : 'Контакт / партнёр'), el('td', {}, roleInput), el('td', {}, primary),
        el('td', {}, canWrite(store.user) && actionButton('Удалить', () => save(store.salesTeam.filter((x) => x.id !== r.id)), { iconName: 'trash' })));
    }) : [el('tr', {}, el('td', { colspan: 5 }, 'Команда не назначена'))];
    return el('section.detail-section', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Команда продаж')),
      el('div.table-wrap', {}, el('table.data-table.compact', {},
        el('thead', {}, el('tr', {}, ['Участник', 'Тип', 'Роль', 'Основной', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, bodyRows))),
      canWrite(store.user) && el('div.inline-add-grid.sales-team-add', {}, memberType, employee.wrap, contact.wrap, role,
        actionButton('Добавить в команду', () => addMember(memberType.value, memberType.value === 'employee' ? employee.select.value : contact.select.value, role.value), { iconName: 'plus' })),
      el('p.field-hint', {}, 'Основным может быть только сотрудник. Контакты добавляются как партнёры или внешние участники; при наличии сотрудников ровно один из них основной.'));
  }

  function parametersEditor(deal) {
    const disabled = !canWrite(store.user);
    const focusKey = (key) => ({ focusKey: `deal-field-${key}` });
    const company = searchSelect(recordOptions(store.companies, 'Контрагент не выбран'), deal.companyId || '', { disabled, focusKey: focusKey('company').focusKey });
    const contactRows = () => store.contacts.filter((c) => !company.select.value || c.companyId === company.select.value);
    const contact = searchSelect(recordOptions(contactRows(), 'Без основного контакта'), deal.contactId || '', { disabled, focusKey: focusKey('contact').focusKey });
    const partner = searchSelect(recordOptions(store.companies.filter((c) => c.role === 'Партнёр-интегратор' || c.id === deal.partnerId), 'Без партнёра'), deal.partnerId || '', { disabled, focusKey: focusKey('partner').focusKey });
    const topic = textInput({ value: deal.topic || '', disabled, maxlength: 180, dataset: focusKey('topic') });
    const product = el('select.select', { disabled, dataset: focusKey('product') }, dictionarySelectOptions('products', deal.product || ''));
    const subproduct = el('select.select', { disabled, dataset: focusKey('subproduct') }, dictionarySelectOptions('subproducts', deal.subproduct || '', deal.product || null));
    const stage = el('select.select', { disabled, dataset: focusKey('stage') }, store.stages().map((s) => el('option', { value: s.id, selected: s.id === deal.stage }, s.label)));
    const status = el('select.select', { disabled, dataset: focusKey('status') }, dictionarySelectOptions('dealStatuses', deal.status || ''));
    const probability = el('select.select', { disabled, dataset: focusKey('probabilityCategory') }, dictionarySelectOptions('probabilityCategories', deal.probabilityCategory || ''));
    const competitors = el('select.select', { multiple: true, size: 3, disabled, dataset: focusKey('competitors') },
      byName(store.companies.filter((c) => c.role === 'Конкурент' || deal.competitorIds?.includes(c.id)))
        .map((c) => el('option', { value: c.id, selected: deal.competitorIds?.includes(c.id) }, c.name)));
    const risks = el('textarea.input.textarea', { rows: 2, disabled, dataset: focusKey('risks') }, deal.risks || '');
    const contractDate = textInput({ value: deal.contractDate || '', type: 'date', disabled, dataset: focusKey('contractDate') });
    const workStartDate = textInput({ value: deal.workStartDate || '', type: 'date', disabled, dataset: focusKey('workStartDate') });
    const clientEvent = textInput({ value: deal.clientEvent || '', disabled, dataset: focusKey('clientEvent') });
    const clientEventDate = textInput({ value: deal.clientEventDate || '', type: 'date', disabled, dataset: focusKey('clientEventDate') });
    const investment = el('select.select', { disabled, dataset: focusKey('clientInvestment') }, dictionarySelectOptions('clientInvestments', deal.clientInvestment || ''));
    const budget = el('select.select', { disabled, dataset: focusKey('budget') }, dictionarySelectOptions('budgets', deal.budget || ''));
    const purchase = el('select.select', { disabled, dataset: focusKey('purchaseType') }, dictionarySelectOptions('purchaseTypes', deal.purchaseType || ''));
    const nextText = textInput({ value: deal.nextStepText || '', disabled, dataset: focusKey('nextStepText') });
    const nextDate = textInput({ value: deal.nextStepDate || '', type: 'date', disabled, dataset: focusKey('nextStepDate') });
    const notes = el('textarea.input.textarea', { rows: 3, disabled, dataset: focusKey('notes') }, deal.notes || '');
    const custom = customFieldInputs('deals', deal);

    const naming = () => ({
      topic: topic.value.trim(),
      name: composeDealName({
        topic: topic.value, companyName: store.companyById(company.select.value)?.name,
        product: product.value, subproduct: subproduct.value,
      }, deal.name),
    });
    const save = async (patch) => {
      if (disabled) return;
      try { await store.updateDeal(deal.id, { ...patch, ...naming() }); }
      catch (error) { toast(error.message || 'Не удалось сохранить изменения', { icon: 'alert' }); }
    };
    const bind = (control, key, read = () => control.value) => control.addEventListener('change', () => save({ [key]: read() }));

    company.select.addEventListener('change', () => {
      const selected = store.contactById(contact.select.value);
      const validContact = selected && (!company.select.value || selected.companyId === company.select.value) ? selected.id : null;
      const contacts = (deal.contacts || []).filter((row) => {
        const person = store.contactById(row.contactId);
        return person && (!company.select.value || person.companyId === company.select.value);
      });
      contact.setOptions(recordOptions(contactRows(), 'Без основного контакта'), validContact || '');
      save({ companyId: company.select.value || null, contactId: validContact, contacts });
    });
    contact.select.addEventListener('change', () => save({ contactId: contact.select.value || null }));
    partner.select.addEventListener('change', () => save({ partnerId: partner.select.value || null }));
    bind(topic, 'topic');
    product.addEventListener('change', () => {
      if (productForSubproduct(store.settings, subproduct.value) !== product.value) subproduct.value = '';
      subproduct.replaceChildren(...dictionarySelectOptions('subproducts', subproduct.value, product.value || null));
      save({ product: product.value, subproduct: subproduct.value });
    });
    bind(subproduct, 'subproduct');
    bind(stage, 'stage'); bind(status, 'status'); bind(probability, 'probabilityCategory');
    competitors.addEventListener('change', () => save({ competitorIds: [...competitors.selectedOptions].map((option) => option.value) }));
    bind(risks, 'risks'); bind(contractDate, 'contractDate'); bind(workStartDate, 'workStartDate');
    bind(clientEvent, 'clientEvent'); bind(clientEventDate, 'clientEventDate');
    bind(investment, 'clientInvestment'); bind(budget, 'budget'); bind(purchase, 'purchaseType');
    bind(nextText, 'nextStepText'); bind(nextDate, 'nextStepDate'); bind(notes, 'notes');
    if (custom) {
      for (const node of custom.nodes) {
        node.addEventListener('change', () => save({ custom: custom.get() }));
        node.addEventListener('click', (event) => {
          if (event.target.closest('.switch')) queueMicrotask(() => save({ custom: custom.get() }));
        });
      }
    }

    return el('section.detail-section.deal-parameters', {},
      el('div.section-head', {}, el('h2.section-title', {}, 'Параметры сделки'),
        el('span.autosave-hint', {}, disabled ? 'Только просмотр' : 'Автосохранение: выбор — сразу, текст — при выходе из поля')),
      el('div.deal-update-line', {}, el('span', {}, 'Апдейт'), el('strong', { dataset: { focusKey: 'deal-updated-at' } }, dateTime(deal.updatedAt))),
      el('div.form-grid.deal-inline-grid', {},
        field('Тема', topic), field('Контрагент', company.wrap), field('Основной контакт', contact.wrap),
        field('Продукт', product), field('Подпродукт', subproduct), field('Стадия', stage),
        field('Независимый статус', status), field('Категория вероятности', probability), field('Партнёр', partner.wrap),
        field('Дата договора', contractDate), field('Дата старта работ', workStartDate),
        field('Событие заказчика', clientEvent), field('Дата события заказчика', clientEventDate),
        field('Что клиент вложил', investment), field('Бюджет', budget), field('Тип покупки', purchase),
        field('Следующий шаг (текст)', nextText), field('Дата следующего шага', nextDate)),
      field('Конкуренты-контрагенты', competitors, { hint: 'Ctrl/Cmd — выбрать несколько. Изменение сохраняется сразу.' }),
      field('Риски', risks), field('Комментарий', notes),
      custom ? el('div.deal-custom-fields', {}, el('h3.related-subtitle', {}, 'Пользовательские поля'), custom.nodes) : null,
      el('details.deal-system-details', {}, el('summary', {}, 'Исход и системные сведения'),
        facts([
          ['Исход', deal.outcome || 'Открыта'], ['Дата закрытия', deal.closedAt ? dateTime(deal.closedAt) : '—'],
          ['Причина закрытия', deal.closeReason || '—'], ['Кто выиграл', deal.winner || '—'],
          ['Связанный лид', deal.sourceLeadId ? el('a.record-link', { href: `#/leads?id=${deal.sourceLeadId}` }, 'Открыть лид (справочно)') : 'Сделка создана напрямую'],
          ['Себестоимость / маржинальность', 'Зарезервировано для следующего этапа'],
        ])));
  }

  function detail() {
    const deal = store.dealById(id);
    if (!deal) { root.append(emptyState('Сделка не найдена', '', el('a.btn.btn-ghost', { href: '#/pipeline' }, 'К списку'))); return; }
    const totals = dealTotals(id, store.payments);
    append(root, [
      el('a.back-link', { href: '#/pipeline' }, '← Все сделки'),
      pageHead(deal.name, `${stageLabel(deal.stage)} · ${deal.status || 'Статус не указан'}`,
        actionButton('Экспорт XLSX', () => exportXlsx('deals', [deal], `Сделка-${deal.name}.xlsx`), { iconName: 'download' }),
        canWrite(store.user) && actionButton('Исход / закрытие', () => openDealForm(deal), { primary: true, iconName: 'pencil' })),
      el('div.stat-strip', {}, el('div', {}, el('span', {}, 'Общая сумма'), el('strong', {}, money(totals.total))),
        el('div', {}, el('span', {}, `Текущий ФГ${String(fiscalYearAt()).slice(-2)}`), el('strong', {}, money(totals.currentFY))),
        el('div', {}, el('span', {}, `Следующий ФГ${String(fiscalYearAt() + 1).slice(-2)}`), el('strong', {}, money(totals.nextFY))),
        el('div', {}, el('span', {}, 'Вероятность стадии'), el('strong', {}, DEAL_STAGES.find((s) => s.id === deal.stage)?.probability == null ? 'Не задана' : `${Math.round(DEAL_STAGES.find((s) => s.id === deal.stage).probability * 100)}%`))),
      lifecycle(deal),
      nextSteps(deal),
      parametersEditor(deal),
      dealEvents(deal),
      paymentsEditor(deal),
      participantsEditor(deal),
      salesTeamEditor(deal),
      el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Системный реестр изменений стадии')),
        el('p.field-hint', {}, 'Все переходы сохраняются, включая возвраты и регрессы. Ограничения в 50 записей нет.'),
        historyTable(store.dealStageHistoryFor(id), DEAL_STAGES)),
      avandokEmpty(),
      canWrite(store.user) && el('div.danger-zone', {}, actionButton('Удалить сделку', async () => {
        if (!await confirmDialog({ title: 'Удалить сделку?', message: 'Записи журнала стадий сохранятся для аудита.' })) return;
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
