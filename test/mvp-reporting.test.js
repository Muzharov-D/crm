import { describe, expect, it } from 'vitest';
import {
  DEAL_STAGES, cohortConversion, currentStageConversion, dealTotals,
  fiscalQuarterAt, fiscalQuarterBounds, fiscalYearAt, fiscalYearQuarterForDate,
  normalizePayment, paymentBelongs, productForSubproduct, stageRegressions,
} from '../src/lib/spec.js';
import {
  companiesWithoutPartnerDeals, filterDeals, funnelReport, paymentForecast,
  planKey, probabilityBreakdown, topOpenDeals,
} from '../src/lib/reporting.js';

describe('financial year April–March', () => {
  it('places FY27 between April 2026 and March 2027', () => {
    expect(fiscalYearAt(new Date('2026-03-31T12:00:00'))).toBe(2026);
    expect(fiscalYearAt(new Date('2026-04-01T12:00:00'))).toBe(2027);
    expect(fiscalYearAt(new Date('2027-03-31T12:00:00'))).toBe(2027);
    expect(fiscalYearQuarterForDate('2026-04-01')).toEqual({ fiscalYear: 2027, quarter: 'Q1' });
    expect(fiscalYearQuarterForDate('2027-01-15')).toEqual({ fiscalYear: 2027, quarter: 'Q4' });
  });

  it('uses exact fiscal quarter boundaries', () => {
    expect(fiscalQuarterAt(new Date('2026-06-30T12:00:00'))).toBe('Q1');
    expect(fiscalQuarterAt(new Date('2026-07-01T12:00:00'))).toBe('Q2');
    expect(fiscalQuarterAt(new Date('2026-10-01T12:00:00'))).toBe('Q3');
    expect(fiscalQuarterAt(new Date('2027-01-01T12:00:00'))).toBe('Q4');
    expect(fiscalQuarterBounds(2027, 'Q1')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(fiscalQuarterBounds(2027, 'Q4')).toEqual({ from: '2027-01-01', to: '2027-03-31' });
  });

  it('derives total, current FY and next FY only from payment rows', () => {
    const payments = [
      { dealId: 'd', amount: 100, fiscalYear: 2027, quarter: 'Q1' },
      { dealId: 'd', amount: 200, fiscalYear: 2027, quarter: 'Q4' },
      { dealId: 'd', amount: 400, fiscalYear: 2028, quarter: 'Q1' },
      { dealId: 'other', amount: 999, fiscalYear: 2027, quarter: 'Q1' },
    ];
    expect(dealTotals('d', payments, new Date('2026-10-30T12:00:00'))).toEqual({
      total: 700, currentFY: 300, nextFY: 400,
    });
    expect(paymentBelongs(payments[0], 2027, 'Q1')).toBe(true);
    expect(normalizePayment({ amount: -10, fiscalYear: 2027, quarter: 'Q2' }).amount).toBe(0);
  });
});

describe('cohorts, current conversion and regressions', () => {
  const history = [
    { dealId: 'a', previousStage: '', newStage: 's1', at: 1000 },
    { dealId: 'a', previousStage: 's1', newStage: 's5', at: 2000 },
    { dealId: 'a', previousStage: 's5', newStage: 's2', at: 3000 },
    { dealId: 'b', previousStage: '', newStage: 's1', at: 4000 },
    { dealId: 'b', previousStage: 's1', newStage: 's2', at: 5000 },
  ];

  it('uses first entry into the cohort and furthest stage ever reached', () => {
    const result = cohortConversion([{ id: 'a', stage: 's2' }, { id: 'b', stage: 's2' }], history, {
      stages: DEAL_STAGES, fromStage: 's1', toStage: 's5', ownerKey: 'dealId',
    });
    expect(result).toMatchObject({ total: 2, reached: 1, rate: 0.5 });
    expect(stageRegressions(history, DEAL_STAGES, 'dealId')).toEqual({ transitions: 1, records: 1 });
  });

  it('reports current adjacent-stage counts without inventing a denominator', () => {
    const rows = currentStageConversion(DEAL_STAGES.slice(0, 3), [
      { stage: 's1' }, { stage: 's1' }, { stage: 's2' },
    ]);
    expect(rows[0]).toMatchObject({ count: 2, rate: null });
    expect(rows[1]).toMatchObject({ count: 1, previousCount: 2, rate: 0.5 });
    expect(rows[2]).toMatchObject({ count: 0, previousCount: 1, rate: 0 });
  });
});

describe('unified reports', () => {
  const deals = [
    { id: 'a', stage: 's5', value: 1000, product: 'Платформа', subproduct: 'CRM', partnerId: 'p', nextStepDate: '2026-11-01' },
    { id: 'b', stage: 's6', value: 2000, product: 'ИИ', subproduct: 'Ассистент', partnerId: '', nextStepDate: '2026-12-01' },
    { id: 'c', stage: 's2', value: 500, outcome: 'Проиграна', product: 'Платформа', partnerId: '' },
  ];

  it('applies product, next-step and employee filters together', () => {
    expect(filterDeals(deals, {
      product: 'Платформа', nextFrom: '2026-10-01', nextTo: '2026-11-30', employeeId: 'e',
    }, [{ dealId: 'a', employeeId: 'e' }]).map((row) => row.id)).toEqual(['a']);
    expect(productForSubproduct({}, 'CRM')).toBe('Платформа');
  });

  it('finds companies without deals through the selected partner', () => {
    expect(companiesWithoutPartnerDeals([
      { id: 'p' }, { id: 'with' }, { id: 'without' },
    ], [{ companyId: 'with', partnerId: 'p' }], 'p').map((row) => row.id)).toEqual(['without']);
  });

  it('calculates plan, weighted forecast and GAP by fiscal quarter and payment type', () => {
    const rows = paymentForecast(deals, [
      { dealId: 'a', fiscalYear: 2027, quarter: 'Q3', type: 'Лицензия', amount: 1000 },
      { dealId: 'c', fiscalYear: 2027, quarter: 'Q3', type: 'Лицензия', amount: 9000 },
    ], 2027, 'Q3', () => 500);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ raw: 1000, weighted: 350, plan: 500, gap: -150 });
    expect(planKey({ fiscalYear: 2027, quarter: 'Q3', type: 'Лицензия' })).toBe('2027|Q3|Лицензия||');
  });

  it('keeps funnel, probability breakdown and top-20 tied to the same model', () => {
    expect(funnelReport(deals).find((row) => row.stage.id === 's5')).toMatchObject({ count: 1, raw: 1000, weighted: 350 });
    expect(probabilityBreakdown([{ ...deals[0], probabilityCategory: 'Высокая' }])[0])
      .toMatchObject({ count: 1, raw: 1000, weighted: 350 });
    const many = Array.from({ length: 25 }, (_, value) => ({ id: `${value}`, value, stage: 's2' }));
    expect(topOpenDeals(many)).toHaveLength(20);
    expect(topOpenDeals(many)[0].value).toBe(24);
  });
});
