import { DEAL_STAGES, dealTotals, paymentBelongs } from './spec.js';
import { isOpen, probabilityOf } from './forecast.js';

export const EMPTY_REPORT_FILTERS = {
  product: '', subproduct: '', stage: '', status: '', probabilityCategory: '', employeeId: '',
  partnerId: '', nextFrom: '', nextTo: '', withoutPartnerDeals: false,
};

export function filterDeals(deals, filters = EMPTY_REPORT_FILTERS, salesTeam = []) {
  return deals.filter((d) => (!filters.product || d.product === filters.product)
    && (!filters.subproduct || d.subproduct === filters.subproduct)
    && (!filters.stage || d.stage === filters.stage)
    && (!filters.status || d.status === filters.status)
    && (!filters.probabilityCategory || d.probabilityCategory === filters.probabilityCategory)
    && (!filters.partnerId || (filters.withoutPartnerDeals
      ? d.partnerId !== filters.partnerId
      : d.partnerId === filters.partnerId))
    && (!filters.employeeId || salesTeam.some((r) => r.dealId === d.id && r.employeeId === filters.employeeId))
    && (!filters.nextFrom || (d.nextStepDate && d.nextStepDate >= filters.nextFrom))
    && (!filters.nextTo || (d.nextStepDate && d.nextStepDate <= filters.nextTo)));
}

export function companiesWithoutPartnerDeals(companies, deals, partnerId) {
  if (!partnerId) return [];
  const withDeals = new Set(deals.filter((d) => d.partnerId === partnerId).map((d) => d.companyId));
  return companies.filter((c) => c.id !== partnerId && !withDeals.has(c.id));
}

export function funnelReport(deals) {
  return DEAL_STAGES.map((stage) => {
    const rows = deals.filter((d) => d.stage === stage.id);
    return {
      stage, count: rows.length,
      raw: rows.reduce((sum, d) => sum + d.value, 0),
      weighted: rows.reduce((sum, d) => sum + d.value * probabilityOf(d, {}, DEAL_STAGES), 0),
    };
  });
}

export function paymentForecast(deals, payments, fiscalYear, quarter = '', planLookup = () => 0) {
  const dealMap = new Map(deals.filter(isOpen).map((d) => [d.id, d]));
  const types = ['Лицензия', 'Работа', 'Железо'];
  const quarters = quarter ? [quarter] : ['Q1', 'Q2', 'Q3', 'Q4'];
  return quarters.flatMap((q) => types.map((type) => {
    const rows = payments.filter((p) => dealMap.has(p.dealId) && p.type === type && paymentBelongs(p, fiscalYear, q));
    const raw = rows.reduce((sum, p) => sum + p.amount, 0);
    const weighted = rows.reduce((sum, p) => sum + p.amount * probabilityOf(dealMap.get(p.dealId), {}, DEAL_STAGES), 0);
    const plan = Number(planLookup({ fiscalYear, quarter: q, type })) || 0;
    return { fiscalYear, quarter: q, type, raw, weighted, plan, gap: weighted - plan };
  }));
}

export function probabilityBreakdown(deals) {
  return ['Высокая', 'Средняя', 'Низкая', 'Не указана'].map((category) => {
    const rows = deals.filter((d) => (d.probabilityCategory || 'Не указана') === category);
    return { category, count: rows.length, raw: rows.reduce((sum, d) => sum + d.value, 0),
      weighted: rows.reduce((sum, d) => sum + d.value * probabilityOf(d, {}, DEAL_STAGES), 0) };
  });
}

const probabilityRank = { 'Высокая': 0, 'Средняя': 1, 'Низкая': 2 };

/** Open deals ranked by their payment amount in the selected financial year. */
export function topOpenDeals(deals, payments = [], fiscalYear = null, limit = 20) {
  return deals.filter(isOpen).map((deal) => {
    const periodValue = fiscalYear
      ? payments.filter((p) => p.dealId === deal.id && paymentBelongs(p, fiscalYear))
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      : Number(deal.value) || 0;
    return { ...deal, periodValue };
  }).filter((deal) => !fiscalYear || deal.periodValue > 0)
    .sort((a, b) => b.periodValue - a.periodValue
      || (probabilityRank[a.probabilityCategory] ?? 3) - (probabilityRank[b.probabilityCategory] ?? 3)
      || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit);
}

/** Raw and weighted payment forecast for every product/subproduct dictionary value. */
export function productBreakdown(deals, payments, fiscalYear, products = [], subproducts = []) {
  const open = deals.filter(isOpen);
  const keys = new Set();
  const rows = [];
  const add = (product, subproduct) => {
    const key = `${product}\u0000${subproduct}`;
    if (keys.has(key)) return;
    keys.add(key);
    const selected = open.filter((d) => (d.product || 'Не указан') === product
      && (d.subproduct || 'Не указан') === subproduct);
    const ids = new Set(selected.map((d) => d.id));
    const paymentRows = payments.filter((p) => ids.has(p.dealId) && paymentBelongs(p, fiscalYear));
    rows.push({
      product, subproduct, deals: selected,
      raw: paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      weighted: paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0)
        * probabilityOf(open.find((d) => d.id === p.dealId), {}, DEAL_STAGES), 0),
    });
  };
  for (const product of products) {
    add(product, 'Не указан');
    for (const row of subproducts.filter((s) => s.parent === product)) add(product, row.value);
  }
  for (const deal of open) add(deal.product || 'Не указан', deal.subproduct || 'Не указан');
  return rows;
}

export function planKey({ fiscalYear, quarter, type, product = '', subproduct = '' }) {
  return [fiscalYear, quarter, type, product, subproduct].join('|');
}

export function totalsFor(deal, payments) { return dealTotals(deal.id, payments); }
