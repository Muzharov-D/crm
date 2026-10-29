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
    && (!filters.partnerId || filters.withoutPartnerDeals || d.partnerId === filters.partnerId)
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

export function topOpenDeals(deals, limit = 20) {
  return deals.filter(isOpen).sort((a, b) => b.value - a.value).slice(0, limit);
}

export function planKey({ fiscalYear, quarter, type, product = '', subproduct = '' }) {
  return [fiscalYear, quarter, type, product, subproduct].join('|');
}

export function totalsFor(deal, payments) { return dealTotals(deal.id, payments); }
