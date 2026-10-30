import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { DEAL_STAGES, LEAD_STAGES, fiscalYearAt, cohortConversion, stageRegressions, currentStageConversion, dictionary, dictionaryOptions } from '../lib/spec.js';
import { EMPTY_REPORT_FILTERS, filterDeals, funnelReport, paymentForecast, probabilityBreakdown, productBreakdown, topOpenDeals, planKey } from '../lib/reporting.js';
import { pageHead, actionButton, money } from '../ui/mvp-bits.js';
import { exportXlsx } from '../lib/xlsx.js';
import { canWrite } from '../lib/access.js';

const pct = (v) => v === null || v === undefined ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`;

export function reportsView() {
  const root = el('div.view');
  const state = { ...EMPTY_REPORT_FILTERS, fiscalYear: fiscalYearAt(), cohortFromStage: 's1', cohortToStage: 's7', leadFromStage: 'l1', leadToStage: 'l3', cohortFrom: '', cohortTo: '' };
  const render = keepingFocus(() => {
    clear(root);
    const deals = filterDeals(store.deals, state, store.salesTeam);
    const filters = filterPanel();
    const forecast = [...paymentForecast(deals, store.payments, state.fiscalYear, '', planFor), ...paymentForecast(deals, store.payments, state.fiscalYear + 1, '', planFor)];
    root.append(pageHead('Отчётность', 'План, прогноз и конверсия по единым фильтрам MVP v2.1',
      actionButton('Сделки XLSX', () => exportXlsx('deals', deals), { iconName: 'download' }),
      actionButton('Сбросить фильтры', () => { Object.assign(state, EMPTY_REPORT_FILTERS); render(); }, { iconName: 'reset' })), filters);
    root.append(forecastSection(forecast), productSection(deals), funnelSection(deals), conversionSection(deals), categorySection(deals), topSection(deals), cohortSection(deals));
  });

  function select(label, key, options) {
    return el('label.report-filter', {}, el('span', {}, label), el('select.select', { onchange: (e) => { state[key] = e.target.value; render(); } },
      options.map((o) => el('option', { value: o.value, selected: state[key] === o.value }, o.label))));
  }
  function filterPanel() {
    const productOptions = [{ value: '', label: 'Все продукты' }, ...dictionaryOptions(store.settings, 'products', { empty: null })];
    const subOptions = [{ value: '', label: 'Все подпродукты' }, ...dictionaryOptions(store.settings, 'subproducts', { empty: null, parent: state.product || null })];
    return el('section.report-filters', {},
      select('Продукт', 'product', productOptions), select('Подпродукт', 'subproduct', subOptions),
      select('Стадия', 'stage', [{ value: '', label: 'Все стадии' }, ...DEAL_STAGES.map((s) => ({ value: s.id, label: s.label }))]),
      select('Статус', 'status', dictionaryOptions(store.settings, 'dealStatuses', { empty: 'Все статусы' })),
      select('Категория вероятности', 'probabilityCategory', dictionaryOptions(store.settings, 'probabilityCategories', { empty: 'Все категории' })),
      select('Ответственный / команда', 'employeeId', [{ value: '', label: 'Все сотрудники' }, ...store.employees.map((e) => ({ value: e.id, label: e.name }))]),
      select('Партнёр', 'partnerId', [{ value: '', label: 'Все партнёры' }, ...store.companies.map((c) => ({ value: c.id, label: c.name }))]),
      el('label.report-filter', {}, el('span', {}, 'Следующий шаг от'), el('input.input', { type: 'date', value: state.nextFrom, onchange: (e) => { state.nextFrom = e.target.value; render(); } })),
      el('label.report-filter', {}, el('span', {}, 'Следующий шаг до'), el('input.input', { type: 'date', value: state.nextTo, onchange: (e) => { state.nextTo = e.target.value; render(); } })),
      el('label.report-filter', {}, el('span', {}, 'Финансовый год'), el('input.input', { type: 'number', min: 2000, max: 2200, value: state.fiscalYear, onchange: (e) => { state.fiscalYear = Number(e.target.value) || fiscalYearAt(); render(); } })),
      el('label.check-label.partner-mode', {}, el('input', { type: 'checkbox', checked: state.withoutPartnerDeals, disabled: !state.partnerId, onchange: (e) => { state.withoutPartnerDeals = e.target.checked; render(); } }), ' Исключить сделки выбранного партнёра'));
  }
  function planFor({ fiscalYear, quarter, type }) {
    const key = planKey({ fiscalYear, quarter, type, product: state.product, subproduct: state.subproduct });
    return Number(store.settings.salesPlans?.[key]) || 0;
  }
  function forecastSection(rows) {
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'План / взвешенный прогноз / GAP'),
      el('span.muted', {}, `ФГ${String(state.fiscalYear).slice(-2)} и ФГ${String(state.fiscalYear + 1).slice(-2)} · ${state.product || 'все продукты'}${state.subproduct ? ` / ${state.subproduct}` : ''}`)),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['ФГ', 'Квартал', 'Тип', 'План', 'Сырой прогноз', 'Взвешенный', 'GAP'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r) => {
          const key = planKey({ ...r, product: state.product, subproduct: state.subproduct });
          return el('tr', {}, el('td', {}, `ФГ${String(r.fiscalYear).slice(-2)}`), el('td', {}, r.quarter), el('td', {}, r.type),
            el('td.plan-cell', {}, el('input.input', { type: 'number', min: 0, step: '0.01', value: r.plan || '', disabled: !canWrite(store.user), 'aria-label': `План ФГ${r.fiscalYear} ${r.quarter} ${r.type}`,
              onchange: async (e) => { const plans = { ...(store.settings.salesPlans || {}), [key]: Math.max(0, Number(e.target.value) || 0) }; await store.updateSettings({ salesPlans: plans }); } })),
            el('td.num', {}, money(r.raw)), el('td.num', {}, money(r.weighted)), el(`td.num.${r.gap < 0 ? 'negative' : 'positive'}`, {}, money(r.gap)));
        })))),
      el('p.field-hint', {}, 'План сохраняется для выбранного ФГ, квартала, типа и текущего разреза продукта/подпродукта. S1 не имеет расчётного процента и не даёт взвешенной суммы.'));
  }
  function productSection(deals) {
    const rows = productBreakdown(deals, store.payments, state.fiscalYear,
      dictionary(store.settings, 'products'), dictionary(store.settings, 'subproducts'));
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Продукты и подпродукты'),
      el('span.muted', {}, `Платежи ФГ${String(state.fiscalYear).slice(-2)} · открытые сделки`)),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Продукт', 'Подпродукт', 'Сделок', 'Сырая сумма', 'Взвешенная сумма'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, el('td', {}, r.product), el('td', {}, r.subproduct),
          el('td.num', {}, r.deals.length), el('td.num', {}, money(r.raw)), el('td.num', {}, money(r.weighted))))))));
  }
  function funnelSection(deals) {
    const rows = funnelReport(deals);
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Воронка S1–S10')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Стадия', 'Количество', 'Сырая сумма', 'Взвешенная сумма'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, el('td', {}, r.stage.label), el('td.num', {}, r.count), el('td.num', {}, money(r.raw)), el('td.num', {}, money(r.weighted))))))));
  }
  function conversionSection(deals) {
    const rows = currentStageConversion(DEAL_STAGES, deals).slice(1);
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Конверсия текущего среза между соседними стадиями')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Переход', 'На предыдущей', 'На текущей', 'Конверсия'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r, i) => el('tr', {}, el('td', {}, `${DEAL_STAGES[i].id} → ${r.stage.id}`), el('td.num', {}, r.previousCount), el('td.num', {}, r.count), el('td.num', {}, pct(r.rate))))))));
  }
  function categorySection(deals) {
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Категории вероятности')),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['Категория', 'Сделок', 'Сырая сумма', 'Взвешенная сумма'].map((h) => el('th', {}, h)))),
        el('tbody', {}, probabilityBreakdown(deals).map((r) => el('tr', {}, el('td', {}, r.category), el('td.num', {}, r.count), el('td.num', {}, money(r.raw)), el('td.num', {}, money(r.weighted))))))));
  }
  function topSection(deals) {
    const rows = topOpenDeals(deals, store.payments, state.fiscalYear, 20);
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Топ-20 открытых сделок периода'),
      el('span.muted', {}, `ФГ${String(state.fiscalYear).slice(-2)} · сумма периода, затем категория вероятности`)),
      el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, ['#', 'Сделка', 'Контрагент', 'Стадия', 'Категория', 'Сумма периода', 'Следующий шаг'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.length ? rows.map((d, i) => el('tr', {}, el('td.num', {}, i + 1), el('td', {}, el('a.record-link', { href: `#/pipeline?id=${d.id}` }, d.name)),
          el('td', {}, store.companyById(d.companyId)?.name || '—'), el('td', {}, d.stage.toUpperCase()), el('td', {}, d.probabilityCategory || '—'), el('td.num', {}, money(d.periodValue)),
          el('td', {}, `${d.nextStepText || '—'}${d.nextStepDate ? ` · ${d.nextStepDate}` : ''}`))) : el('tr', {}, el('td', { colspan: 7 }, 'В выбранном ФГ нет открытых сделок с платежами'))))));
  }
  function cohortSection(deals) {
    const dealResult = cohortConversion(deals, store.dealStageHistory, { stages: DEAL_STAGES, fromStage: state.cohortFromStage, toStage: state.cohortToStage, from: state.cohortFrom, to: state.cohortTo, ownerKey: 'dealId' });
    const leadResult = cohortConversion(store.leads, store.leadStageHistory, { stages: LEAD_STAGES, fromStage: state.leadFromStage, toStage: state.leadToStage, from: state.cohortFrom, to: state.cohortTo, ownerKey: 'leadId' });
    const dealRegress = stageRegressions(store.dealStageHistory.filter((h) => deals.some((d) => d.id === h.dealId)), DEAL_STAGES, 'dealId');
    const leadRegress = stageRegressions(store.leadStageHistory, LEAD_STAGES, 'leadId');
    const stageSelect = (key, stages) => el('select.select', { onchange: (e) => { state[key] = e.target.value; render(); } }, stages.map((s) => el('option', { value: s.id, selected: state[key] === s.id }, s.label)));
    return el('section.detail-section', {}, el('div.section-head', {}, el('h2.section-title', {}, 'Когортная конверсия и регресс')),
      el('div.cohort-controls', {}, el('span', {}, 'Сделки: первый вход'), stageSelect('cohortFromStage', DEAL_STAGES), el('span', {}, '→ максимум'), stageSelect('cohortToStage', DEAL_STAGES),
        el('span', {}, 'Лиды:'), stageSelect('leadFromStage', LEAD_STAGES), el('span', {}, '→'), stageSelect('leadToStage', LEAD_STAGES),
        el('input.input', { type: 'date', value: state.cohortFrom, onchange: (e) => { state.cohortFrom = e.target.value; render(); } }),
        el('input.input', { type: 'date', value: state.cohortTo, onchange: (e) => { state.cohortTo = e.target.value; render(); } })),
      el('div.stat-strip', {}, el('div', {}, el('span', {}, 'Сделки в когорте'), el('strong', {}, dealResult.total)),
        el('div', {}, el('span', {}, 'Достигли цели'), el('strong', {}, `${dealResult.reached} · ${pct(dealResult.rate)}`)),
        el('div', {}, el('span', {}, 'Лиды в когорте'), el('strong', {}, leadResult.total)),
        el('div', {}, el('span', {}, 'Достигли цели'), el('strong', {}, `${leadResult.reached} · ${pct(leadResult.rate)}`)),
        el('div', {}, el('span', {}, 'Регресс сделок'), el('strong', {}, `${dealRegress.transitions} переходов / ${dealRegress.records} сделок`)),
        el('div', {}, el('span', {}, 'Регресс лидов'), el('strong', {}, `${leadRegress.transitions} переходов / ${leadRegress.records} лидов`))),
      el('p.field-hint', {}, 'Когорта строится по первому входу в стадию. Повторные входы не дублируют запись, откат не уменьшает максимальный прогресс; регресс показан отдельно.'));
  }
  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
