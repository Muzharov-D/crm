import { describe, it, expect } from 'vitest';
import {
  STAGES, OPEN_STAGES, stageInfo, isOpen, probabilityOf, weightedValue,
  pipelineValue, weightedPipeline, weightedValue, stageSummary, forecastByMonth,
  winRate, wonInMonth, avgSalesCycle,
  resolveStages, openStages, firstStageId, MAX_OPEN_STAGES,
  daysInStage, isStalled, stalledDeals, stageVelocity,
  closeReasonBreakdown, winRateBy, avgClosedValue, reasonsForStage,
  matchesCloseWindow, goalProgress, pipelineCoverage,
  normalizeConfidence, confidenceLabel,
} from '../src/lib/forecast.js';

const deal = (overrides = {}) => ({
  id: 'd1', name: 'Test deal', value: 10000, stage: 's5',
  expectedClose: '2026-09-15', createdAt: Date.now(), updatedAt: Date.now(),
  closedAt: null, ...overrides,
});

describe('stages', () => {
  it('defines the ten canonical stages', () => {
    expect(STAGES).toHaveLength(10);
    expect(OPEN_STAGES.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']);
  });

  it('stageInfo falls back to the first stage for unknown ids', () => {
    expect(stageInfo('s5').probability).toBe(0.35);
    expect(stageInfo('bogus').id).toBe('s1');
  });

  it('isOpen is false only for won and lost', () => {
    expect(isOpen(deal({ stage: 's1' }))).toBe(true);
    expect(isOpen(deal({ stage: 'won' }))).toBe(false);
    expect(isOpen(deal({ stage: 'lost' }))).toBe(false);
  });
});

describe('canonical stages', () => {
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];

  it('always resolves the fixed S1–S10 funnel, ignoring legacy custom settings', () => {
    for (const settings of [{}, { stages: [] }, { stages: [{ id: 'demo', probability: 0.4 }] }]) {
      expect(resolveStages(settings).map((stage) => stage.id)).toEqual(ids);
    }
    expect(openStages(resolveStages())).toHaveLength(MAX_OPEN_STAGES);
    expect(firstStageId(resolveStages())).toBe('s1');
  });

  it('keeps the prescribed probabilities, including an unweighted S1', () => {
    expect(resolveStages().map((stage) => stage.probability)).toEqual([
      null, 0.05, 0.15, 0.25, 0.35, 0.45, 0.85, 1, 1, 1,
    ]);
  });
});

describe('probabilityOf', () => {
  it('uses stage defaults without overrides', () => {
    expect(probabilityOf(deal({ stage: 's2' }))).toBe(0.05);
  });

  it('honors overrides and clamps them to [0, 1]', () => {
    expect(probabilityOf(deal({ stage: 's2' }), { s2: 0.4 })).toBe(0.4);
    expect(probabilityOf(deal({ stage: 's2' }), { s2: 7 })).toBe(1);
    expect(probabilityOf(deal({ stage: 's2' }), { s2: -2 })).toBe(0);
  });

  it('falls through to the stage default on a junk override, not to 0', () => {
    // A hand-edited export can carry anything; Number() would read these
    // as 0 (or 1) and quietly zero the stage out of the weighted forecast.
    for (const junk of [null, '', ' ', true, [], {}, 'high']) {
      expect(probabilityOf(deal({ stage: 's2' }), { s2: junk })).toBe(0.05);
    }
    expect(probabilityOf(deal({ stage: 's2' }), { s2: '0.4' })).toBe(0.4);
    expect(probabilityOf(deal({ stage: 's2' }), { s2: 0 })).toBe(0);
  });

  it('pins won to 1 and lost to 0 regardless of overrides', () => {
    expect(probabilityOf(deal({ stage: 'won' }), { won: 0.5 })).toBe(1);
    expect(probabilityOf(deal({ stage: 'lost' }), { lost: 0.5 })).toBe(0);
  });

  it('uses per-deal confidence only in the optional manager forecast', () => {
    const d = deal({ stage: 's2', confidence: 0.9 });
    expect(probabilityOf(d)).toBe(0.05);
    expect(probabilityOf(d, { s2: 0.4 })).toBe(0.4);
    expect(probabilityOf(d, {}, STAGES, 'manager')).toBe(0.9);
    expect(probabilityOf(deal({ stage: 's2', confidence: 0 }), {}, STAGES, 'manager')).toBe(0);
  });

  it('null, junk, and out-of-range confidence fall back or clamp', () => {
    expect(probabilityOf(deal({ stage: 's2', confidence: null }))).toBe(0.05);
    expect(probabilityOf(deal({ stage: 's2', confidence: 'high' }))).toBe(0.05);
    expect(probabilityOf(deal({ stage: 's2', confidence: 3 }))).toBe(0.05);
    expect(probabilityOf(deal({ stage: 's2', confidence: 3 }), {}, STAGES, 'manager')).toBe(1);
  });

  it('cannot unsettle a closed deal', () => {
    expect(probabilityOf(deal({ stage: 'won', confidence: 0.2 }))).toBe(1);
    expect(probabilityOf(deal({ stage: 'lost', confidence: 0.9 }))).toBe(0);
  });
});

describe('confidence helpers', () => {
  it('normalizeConfidence takes numbers and numeric strings, else null', () => {
    expect(normalizeConfidence(0.7)).toBe(0.7);
    expect(normalizeConfidence('0.25')).toBe(0.25);
    expect(normalizeConfidence(1.4)).toBe(1);
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence('')).toBeNull();
    expect(normalizeConfidence('maybe')).toBeNull();
  });

  it('confidenceLabel names the categories and spells out custom values', () => {
    expect(confidenceLabel(0.9)).toBe('Точно · 90%');
    expect(confidenceLabel(0)).toBe('Не учитывать · 0%');
    expect(confidenceLabel(0.45)).toBe('45%');
    expect(confidenceLabel(null)).toBeNull();
  });
});

describe('pipeline totals', () => {
  const deals = [
    deal({ id: 'a', value: 10000, stage: 's5' }),      // weighted 5000
    deal({ id: 'b', value: 4000, stage: 's1' }),             // weighted 400
    deal({ id: 'c', value: 99999, stage: 'won' }),            // closed - excluded
    deal({ id: 'd', value: 5555, stage: 'lost' }),            // closed - excluded
  ];

  it('pipelineValue sums only open deals', () => {
    expect(pipelineValue(deals)).toBe(14000);
  });

  it('weightedPipeline applies stage probabilities', () => {
    expect(weightedPipeline(deals)).toBe(3500);
  });

  it('weightedValue rounds to cents', () => {
    expect(weightedValue(deal({ value: 333.33, stage: 's5' }))).toBe(116.67);
  });

  it('stageSummary reports counts and totals in canonical order', () => {
    const summary = stageSummary(deals);
    expect(summary.map((s) => s.stage)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']);
    const proposal = summary.find((s) => s.stage === 's5');
    expect(proposal).toMatchObject({ count: 1, value: 10000, weighted: 3500 });
    const qualified = summary.find((s) => s.stage === 's2');
    expect(qualified).toMatchObject({ count: 0, value: 0, weighted: 0 });
  });
});

describe('forecastByMonth', () => {
  const from = '2026-08';

  it('buckets open deals by expected close month', () => {
    const rows = forecastByMonth([
      deal({ value: 10000, stage: 's5', expectedClose: '2026-09-10' }),
      deal({ id: 'd2', value: 6000, stage: 's6', expectedClose: '2026-09-28' }),
    ], { months: 3, from });
    expect(rows.map((r) => r.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    const sept = rows[1];
    expect(sept.best).toBe(16000);
    expect(sept.weighted).toBe(3500 + 2700);
    expect(sept.count).toBe(2);
    expect(rows[0].count).toBe(0);
  });

  it('rolls overdue expected closes into the first month instead of dropping them', () => {
    const rows = forecastByMonth([
      deal({ expectedClose: '2026-05-01', stage: 's5', value: 8000 }),
    ], { months: 2, from });
    expect(rows[0].best).toBe(8000);
    expect(rows[0].weighted).toBe(2800);
  });

  it('buckets deals with no close date into the first month', () => {
    const rows = forecastByMonth([deal({ expectedClose: null, value: 2000, stage: 's1' })],
      { months: 2, from });
    expect(rows[0].best).toBe(2000);
  });

  it('drops open deals beyond the horizon from the chart rows', () => {
    const rows = forecastByMonth([deal({ expectedClose: '2027-06-01' })], { months: 3, from });
    expect(rows.every((r) => r.best === 0 && r.count === 0)).toBe(true);
  });

  it('counts won deals in their close month and ignores lost ones', () => {
    const closedAt = new Date(2026, 7, 20).getTime(); // Aug 20, 2026
    const rows = forecastByMonth([
      deal({ stage: 'won', value: 7500, closedAt, expectedClose: '2026-08-01' }),
      deal({ id: 'x', stage: 'lost', value: 5000, closedAt, expectedClose: '2026-08-01' }),
    ], { months: 2, from });
    expect(rows[0].won).toBe(7500);
    expect(rows[0].best).toBe(0);      // won is not "still in play"
    expect(rows[0].count).toBe(1);     // the lost deal vanishes entirely
  });

  it('leaves a deal won before the horizon out, whatever its close date says', () => {
    const rows = forecastByMonth([
      deal({
        stage: 'won',
        value: 50000,
        closedAt: new Date(2026, 1, 10).getTime(),   // won in February
        expectedClose: '2026-09-15',                 // stale target date
      }),
    ], { months: 3, from });
    expect(rows.every((r) => r.won === 0 && r.count === 0)).toBe(true);
  });

  it('applies probability overrides', () => {
    const rows = forecastByMonth([deal({ stage: 's5', value: 10000, expectedClose: '2026-08-20' })],
      { months: 1, from, overrides: { s5: 0.8 } });
    expect(rows[0].weighted).toBe(8000);
  });

  it('spreads an open recurring deal across the months it bills', () => {
    const rows = forecastByMonth([
      deal({
        value: 2000, billing: 'monthly', term: 12,
        stage: 's5', expectedClose: '2026-09-10',
      }),
    ], { months: 3, from });
    expect(rows.map((r) => r.best)).toEqual([0, 2000, 2000]);
    expect(rows.map((r) => r.weighted)).toEqual([0, 700, 700]);
    // Counted once, in the first month of its own that the horizon shows.
    expect(rows.map((r) => r.count)).toEqual([0, 1, 0]);
  });

  it('keeps a recurring deal won before the horizon billing inside it', () => {
    const rows = forecastByMonth([
      deal({
        stage: 'won', value: 2000, billing: 'monthly', term: 12,
        closedAt: new Date(2026, 5, 10).getTime(),   // won in June
        expectedClose: '2026-06-01',
      }),
    ], { months: 3, from });
    expect(rows.map((r) => r.won)).toEqual([2000, 2000, 2000]);
    expect(rows.map((r) => r.count)).toEqual([1, 0, 0]);
  });

  it('leaves a recurring deal whose term ran out before the horizon out', () => {
    const rows = forecastByMonth([
      deal({
        stage: 'won', value: 2000, billing: 'monthly', term: 3,
        closedAt: new Date(2026, 1, 10).getTime(),   // Feb + 3 months
      }),
    ], { months: 3, from });
    expect(rows.every((r) => r.won === 0 && r.count === 0)).toBe(true);
  });

  it('bills an annual deal once a year, not every month', () => {
    const rows = forecastByMonth([
      deal({
        value: 24000, billing: 'annual', term: 24,
        stage: 's5', expectedClose: '2026-08-05',
      }),
    ], { months: 4, from });
    expect(rows.map((r) => r.best)).toEqual([24000, 0, 0, 0]);
  });
});

describe('recurring revenue in the pipeline figures', () => {
  it('values an open recurring deal at its whole contract', () => {
    const monthly = deal({ value: 2000, billing: 'monthly', term: 12, stage: 's5' });
    expect(pipelineValue([monthly])).toBe(24000);
    expect(weightedValue(monthly)).toBe(8400);
    expect(weightedPipeline([monthly])).toBe(8400);
    expect(stageSummary([monthly]).find((row) => row.stage === 's5').value).toBe(24000);
  });

  it('leaves a one-time deal exactly as it was', () => {
    const once = deal({ value: 24000, stage: 's5' });
    expect(pipelineValue([once])).toBe(24000);
    expect(weightedValue(once)).toBe(8400);
  });

  it('counts won recurring revenue in the month it bills, not all at once', () => {
    const signedInJune = deal({
      stage: 'won', value: 2000, billing: 'monthly', term: 12,
      closedAt: new Date(2026, 5, 15).getTime(),
    });
    expect(wonInMonth([signedInJune], '2026-06')).toBe(2000);
    expect(wonInMonth([signedInJune], '2026-08')).toBe(2000);
    expect(wonInMonth([signedInJune], '2027-07')).toBe(0);
  });

  it('still books a one-time win whole in its close month', () => {
    const won = deal({ stage: 'won', value: 7500, closedAt: new Date(2026, 7, 3).getTime() });
    expect(wonInMonth([won], '2026-08')).toBe(7500);
    expect(wonInMonth([won], '2026-09')).toBe(0);
  });

  it('measures a recurring win against the monthly goal by what it bills', () => {
    const deals = [deal({
      stage: 'won', value: 4000, billing: 'monthly', term: 12,
      closedAt: new Date(2026, 7, 2).getTime(),
    })];
    const p = goalProgress(deals, 8000, '2026-08', new Date(2026, 7, 15));
    expect(p.won).toBe(4000);
    expect(p.pct).toBe(0.5);
  });
});

describe('revenue goal', () => {
  const won = (value, day) => deal({ stage: 'won', value, closedAt: new Date(2026, 7, day).getTime() });
  const deals = [won(3000, 2), won(1000, 9), deal({ stage: 's5', value: 50000 })];
  const mid = new Date(2026, 7, 15);       // Aug 15 of 31

  it('is inert without a goal', () => {
    const p = goalProgress(deals, 0, '2026-08', mid);
    expect(p).toMatchObject({ goal: 0, won: 4000, pct: null, pace: null });
  });

  it('measures progress and pace against the day of the month', () => {
    const p = goalProgress(deals, 10000, '2026-08', mid);
    expect(p.won).toBe(4000);
    expect(p.remaining).toBe(6000);
    expect(p.pct).toBeCloseTo(0.4);
    expect(p.expected).toBeCloseTo(10000 * (15 / 31));
    expect(p.pace).toBe('behind');
    expect(p.gap).toBeCloseTo(10000 * (15 / 31) - 4000);
  });

  it('is on track early in the month and met once cleared', () => {
    expect(goalProgress(deals, 10000, '2026-08', new Date(2026, 7, 3)).pace).toBe('on-track');
    expect(goalProgress(deals, 4000, '2026-08', mid)).toMatchObject({ pace: 'met', remaining: 0 });
  });

  it('treats a past month as fully elapsed and a future one as untouched', () => {
    expect(goalProgress(deals, 10000, '2026-07', mid).elapsed).toBe(1);
    expect(goalProgress(deals, 10000, '2026-09', mid)).toMatchObject({ elapsed: 0, pace: 'on-track' });
  });

  it('covers the remaining goal with weighted pipeline', () => {
    expect(pipelineCoverage(12000, 6000)).toBe(2);
    expect(pipelineCoverage(12000, 0)).toBeNull();   // nothing left to cover
    expect(pipelineCoverage(0, 5000)).toBe(0);
  });
});

describe('close-date windows', () => {
  const today = '2026-08-20';
  const d = (expectedClose, stage = 's5') => deal({ expectedClose, stage });

  it('any matches everything, including deals with no close date', () => {
    expect(matchesCloseWindow(d(null), 'any', today)).toBe(true);
    expect(matchesCloseWindow(d(null), undefined, today)).toBe(true);
  });

  it('dated windows never match a deal without a close date', () => {
    for (const w of ['month', 'quarter', 'overdue']) {
      expect(matchesCloseWindow(d(null), w, today)).toBe(false);
    }
  });

  it('matches the current month and quarter', () => {
    expect(matchesCloseWindow(d('2026-08-31'), 'month', today)).toBe(true);
    expect(matchesCloseWindow(d('2026-09-01'), 'month', today)).toBe(false);
    expect(matchesCloseWindow(d('2026-07-01'), 'quarter', today)).toBe(true);
    expect(matchesCloseWindow(d('2026-09-30'), 'quarter', today)).toBe(true);
    expect(matchesCloseWindow(d('2026-06-30'), 'quarter', today)).toBe(false);
    expect(matchesCloseWindow(d('2026-10-01'), 'quarter', today)).toBe(false);
  });

  it('overdue is only for open deals past their date', () => {
    expect(matchesCloseWindow(d('2026-08-19'), 'overdue', today)).toBe(true);
    expect(matchesCloseWindow(d('2026-08-20'), 'overdue', today)).toBe(false);
    expect(matchesCloseWindow(d('2026-08-19', 'won'), 'overdue', today)).toBe(false);
  });
});

describe('win/loss analysis', () => {
  const closed = [
    deal({ id: 'w1', stage: 'won', value: 10000, closeReason: 'Product fit' }),
    deal({ id: 'w2', stage: 'won', value: 20000, closeReason: 'Product fit' }),
    deal({ id: 'w3', stage: 'won', value: 6000, closeReason: '' }),
    deal({ id: 'l1', stage: 'lost', value: 4000, closeReason: 'Price' }),
    deal({ id: 'l2', stage: 'lost', value: 8000, closeReason: 'Competitor' }),
    deal({ id: 'o1', stage: 's5', value: 99999, closeReason: 'Ignored' }),
  ];

  it('groups reasons by frequency and counts what has none', () => {
    const won = closeReasonBreakdown(closed, 'won');
    expect(won.rows).toEqual([{ reason: 'Product fit', count: 2, value: 30000 }]);
    expect(won.unrecorded).toBe(1);
    expect(won.total).toBe(3);

    const lost = closeReasonBreakdown(closed, 'lost');
    expect(lost.rows.map((r) => r.reason).sort()).toEqual(['Competitor', 'Price']);
    expect(lost.unrecorded).toBe(0);
  });

  it('averages closed value per outcome', () => {
    expect(avgClosedValue(closed)).toEqual({ won: 12000, lost: 6000 });
    expect(avgClosedValue([])).toEqual({ won: null, lost: null });
  });

  it('computes win rate per group and skips unlabeled deals', () => {
    const labels = { w1: 'Referral', w2: 'Referral', w3: 'Referral', l1: 'Referral', l2: '' };
    const rows = winRateBy(closed, (d) => labels[d.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'Referral', won: 3, lost: 1, total: 4, wonValue: 36000 });
    expect(rows[0].rate).toBeCloseTo(0.75);
  });

  it('ignores open deals entirely', () => {
    expect(winRateBy([deal({ stage: 's5' })], () => 'X')).toEqual([]);
  });

  it('offers outcome-appropriate starter reasons', () => {
    expect(reasonsForStage('won')).toContain('Рекомендация');
    expect(reasonsForStage('lost')).toContain('Конкурент');
  });
});

describe('time in stage', () => {
  const day = 86_400_000;
  const now = new Date(2026, 7, 20).getTime();
  const stuck = deal({
    id: 'stuck', stage: 's5',
    stageHistory: [{ stage: 's1', at: now - 40 * day }, { stage: 's5', at: now - 21 * day }],
  });
  const fresh = deal({
    id: 'fresh', stage: 's1',
    stageHistory: [{ stage: 's1', at: now - 2 * day }],
  });

  it('reads the current stage entry from history', () => {
    expect(daysInStage(stuck, now)).toBe(21);
    expect(daysInStage(fresh, now)).toBe(2);
  });

  it('falls back to updatedAt when a deal has no history', () => {
    expect(daysInStage(deal({ stageHistory: undefined, updatedAt: now - 3 * day }), now)).toBe(3);
  });

  it('flags only open deals past the threshold', () => {
    expect(isStalled(stuck, 14, now)).toBe(true);
    expect(isStalled(fresh, 14, now)).toBe(false);
    expect(isStalled({ ...stuck, stage: 'won' }, 14, now)).toBe(false);
    expect(isStalled(stuck, 0, now)).toBe(false);          // 0 turns it off
    expect(stalledDeals([fresh, stuck], 14, now).map((d) => d.id)).toEqual(['stuck']);
  });

  it('averages days per stage over completed transitions only', () => {
    const v = stageVelocity([
      deal({ stageHistory: [
        { stage: 's1', at: now - 30 * day }, { stage: 's2', at: now - 20 * day },
        { stage: 's5', at: now - 5 * day },
      ] }),
      deal({ stageHistory: [
        { stage: 's1', at: now - 40 * day }, { stage: 's2', at: now - 20 * day },
      ] }),
    ]);
    const byStage = Object.fromEntries(v.map((r) => [r.stage, r]));
    expect(byStage.s1).toMatchObject({ days: 15, count: 2 });   // (10 + 20) / 2
    expect(byStage.s2).toMatchObject({ days: 15, count: 1 });
    expect(byStage.s5).toMatchObject({ days: null, count: 0 });
    expect(v.map((r) => r.stage)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']);
  });
});

describe('closed-deal stats', () => {
  it('winRate is null with no closed deals, exact otherwise', () => {
    expect(winRate([deal()]).rate).toBeNull();
    const { won, lost, rate } = winRate([
      deal({ stage: 'won' }), deal({ stage: 'won' }), deal({ stage: 'lost' }),
    ]);
    expect(won).toBe(2);
    expect(lost).toBe(1);
    expect(rate).toBeCloseTo(2 / 3);
  });

  it('wonInMonth sums by close month', () => {
    const aug = new Date(2026, 7, 10).getTime();
    const july = new Date(2026, 6, 10).getTime();
    const deals = [
      deal({ stage: 'won', value: 1000, closedAt: aug }),
      deal({ stage: 'won', value: 500, closedAt: july }),
      deal({ stage: 's5', value: 9999 }),
    ];
    expect(wonInMonth(deals, '2026-08')).toBe(1000);
    expect(wonInMonth(deals, '2026-07')).toBe(500);
    expect(wonInMonth(deals, '2026-06')).toBe(0);
  });

  it('avgSalesCycle averages created-to-closed days over won deals', () => {
    const day = 86_400_000;
    const t0 = new Date(2026, 0, 1).getTime();
    expect(avgSalesCycle([deal()])).toBeNull();
    expect(avgSalesCycle([
      deal({ stage: 'won', createdAt: t0, closedAt: t0 + 10 * day }),
      deal({ stage: 'won', createdAt: t0, closedAt: t0 + 20 * day }),
    ])).toBe(15);
  });
});
