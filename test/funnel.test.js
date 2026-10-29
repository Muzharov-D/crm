import { describe, it, expect } from 'vitest';
import {
  FUNNEL_WINDOWS, enteredAt, enteredMonth, matchesFunnelWindow,
  lostFromStage, hasOpenHistory, funnelReport,
} from '../src/lib/funnel.js';
import { STAGES, resolveStages } from '../src/lib/forecast.js';

const at = (y, m, d) => new Date(y, m - 1, d).getTime();

/** A deal with the journey it took, oldest first. */
const deal = (id, stage, journey, over = {}) => ({
  id, name: id, value: 1000, stage,
  createdAt: journey[0]?.[1] ?? at(2026, 1, 1),
  updatedAt: journey[journey.length - 1]?.[1] ?? at(2026, 1, 1),
  stageHistory: journey.map(([s, when]) => ({ stage: s, at: when })),
  ...over,
});

describe('cohorts', () => {
  const now = new Date(2026, 7, 20);              // Aug 20, 2026 (Q3)

  it('offers all time plus the two quarters and the year', () => {
    expect(FUNNEL_WINDOWS.map((w) => w.value))
      .toEqual(['all', 'quarter', 'last-quarter', 'year']);
  });

  it('dates a deal by when it entered the funnel', () => {
    const d = deal('a', 's5', [['s1', at(2026, 5, 2)], ['s5', at(2026, 6, 9)]]);
    expect(enteredAt(d)).toBe(at(2026, 5, 2));
    expect(enteredMonth(d)).toBe('2026-05');
    // No history at all: fall back to the record's own clock.
    expect(enteredAt({ createdAt: at(2026, 3, 3) })).toBe(at(2026, 3, 3));
  });

  it('sorts deals into this quarter, last quarter, and the year', () => {
    const july = deal('july', 's1', [['s1', at(2026, 7, 4)]]);
    const may = deal('may', 's1', [['s1', at(2026, 5, 4)]]);
    const lastYear = deal('old', 's1', [['s1', at(2025, 11, 4)]]);

    expect(matchesFunnelWindow(july, 'quarter', now)).toBe(true);
    expect(matchesFunnelWindow(may, 'quarter', now)).toBe(false);
    expect(matchesFunnelWindow(may, 'last-quarter', now)).toBe(true);
    expect(matchesFunnelWindow(july, 'last-quarter', now)).toBe(false);
    expect(matchesFunnelWindow(may, 'year', now)).toBe(true);
    expect(matchesFunnelWindow(lastYear, 'year', now)).toBe(false);
    for (const d of [july, may, lastYear]) {
      expect(matchesFunnelWindow(d, 'all', now)).toBe(true);
    }
  });
});

describe('reading a journey', () => {
  it('names the stage a lost deal died in', () => {
    expect(lostFromStage(deal('a', 'lost', [
      ['s1', 1], ['s2', 2], ['lost', 3],
    ]))).toBe('s2');
    expect(lostFromStage(deal('b', 's5', [['s5', 1]]))).toBeNull();
    // A deal whose only history is the loss itself died nowhere we know.
    expect(lostFromStage(deal('c', 'lost', [['lost', 1]]))).toBeNull();
  });

  it('knows a deal that never visibly entered the funnel', () => {
    expect(hasOpenHistory(deal('a', 'won', [['won', 1]]))).toBe(false);
    expect(hasOpenHistory(deal('b', 'won', [['s1', 1], ['won', 2]]))).toBe(true);
    expect(hasOpenHistory(deal('c', 's5', [['s5', 1]]))).toBe(true);
  });
});

describe('funnelReport', () => {
  const stages = STAGES;

  it('counts entries, advances, and where deals died', () => {
    const report = funnelReport([
      deal('won1', 'won', [['s1', 1], ['s2', 2], ['s5', 3], ['won', 4]]),
      deal('lost1', 'lost', [['s1', 1], ['s2', 2], ['lost', 3]]),
      deal('open1', 's2', [['s1', 1], ['s2', 2]]),
      deal('open2', 's1', [['s1', 1]]),
    ], stages);

    const row = (id) => report.rows.find((r) => r.stage === id);
    expect(row('s1')).toMatchObject({ entered: 4, advanced: 3, lostHere: 0, open: 1 });
    expect(row('s2')).toMatchObject({ entered: 3, advanced: 1, lostHere: 1, open: 1 });
    expect(row('s5')).toMatchObject({ entered: 1, advanced: 1, lostHere: 0 });
    expect(row('s6')).toMatchObject({ entered: 0, advanced: 0, advanceRate: null });
    expect(row('s2').advanceRate).toBeCloseTo(1 / 3, 2);
    expect(row('s2').lossShare).toBe(1);
    expect(report.totals).toMatchObject({ deals: 4, won: 1, lost: 1, open: 2 });
    expect(report.totals.wonRate).toBe(0.25);
  });

  it('counts a stage only where a deal actually was', () => {
    // Created straight into Proposal: it never entered New or Qualified,
    // and counting it there would invent conversions nobody made.
    const report = funnelReport([deal('a', 's5', [['s5', 1]])], stages);
    const row = (id) => report.rows.find((r) => r.stage === id);
    expect(row('s1').entered).toBe(0);
    expect(row('s5')).toMatchObject({ entered: 1, advanced: 0, open: 1 });
  });

  it('leaves out deals that closed before stage tracking, and says so', () => {
    const report = funnelReport([
      deal('legacy', 'won', [['won', 1]]),
      deal('tracked', 'won', [['s1', 1], ['won', 2]]),
    ], stages);
    expect(report.untracked).toBe(1);
    expect(report.totals.deals).toBe(1);
    expect(report.totals.wonRate).toBe(1);
  });

  it('does not count a deal that moved backwards as having advanced', () => {
    const report = funnelReport([
      deal('a', 's2', [['s1', 1], ['s5', 2], ['s2', 3]]),
    ], stages);
    const row = (id) => report.rows.find((r) => r.stage === id);
    expect(row('s5')).toMatchObject({ entered: 1, advanced: 0, open: 1 });
    // It did advance past New - it reached Proposal at some point.
    expect(row('s1').advanced).toBe(1);
  });

  it('still reports a stage the funnel has since dropped', () => {
    const configured = resolveStages({
      stages: [{ id: 's1', label: 'New', probability: 0.1 }],
    });
    const report = funnelReport([
      deal('a', 'won', [['s1', 1], ['demo', 2], ['won', 3]]),
      deal('b', 'lost', [['s1', 1], ['demo', 2], ['lost', 3]]),
    ], configured);
    const gone = report.rows.find((r) => r.stage === 'demo');
    expect(gone).toMatchObject({ gone: true, entered: 2, label: 'demo' });
    expect(report.rows.find((r) => r.stage === 's1').gone).toBe(false);
    expect(gone.lostHere).toBe(1);
  });

  it('is quiet rather than wrong with nothing to report', () => {
    const report = funnelReport([], stages);
    expect(report.totals).toMatchObject({ deals: 0, won: 0, wonRate: null });
    expect(report.rows.every((r) => r.entered === 0)).toBe(true);
    expect(funnelReport(null, stages).rows).toHaveLength(10);
  });
});
