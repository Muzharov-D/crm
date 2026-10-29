import { describe, expect, it } from 'vitest';
import {
  factScore, qualityScore, normalizeQualification, qualificationMetrics,
} from '../src/lib/qualification.js';
import { DEFAULT_OPEN_STAGES, ABR_OPEN_STAGES, TERMINAL_STAGES, probabilityOf } from '../src/lib/forecast.js';

const stages = [...DEFAULT_OPEN_STAGES, ...TERMINAL_STAGES];
const abrStages = [...ABR_OPEN_STAGES, ...TERMINAL_STAGES];
const complete = {
  clientTeam: 'Иванов, владелец процесса',
  economicBuyer: 'Петрова, финансовый директор',
  champion: 'Сидоров вынес решение на комитет',
  externalDeadline: '2027-03-31, окончание текущего договора',
  clientInvestment: 'paid-pilot', budget: 'approved', purchaseType: 'tender',
  competitors: 'Конкурент А', nextStepDate: '2026-11-15', managerConfidence: 'medium',
};

describe('ABR qualification model', () => {
  it('scores named facts, assumptions and blanks like the workbook', () => {
    expect(factScore('Петров')).toBe(1);
    expect(factScore(' ?Петров ')).toBe(0.5);
    expect(factScore('')).toBe(0);
    expect(factScore(null)).toBe(0);
  });

  it('gives a complete deal 100 quality points', () => {
    expect(qualityScore(complete)).toBe(100);
  });

  it('weights investment, budget and purchase evidence', () => {
    expect(qualityScore({ clientInvestment: 'data', budget: 'declared', purchaseType: 'direct' })).toBe(21);
    expect(qualityScore({ clientInvestment: 'none', budget: 'none', purchaseType: 'unknown' })).toBe(0);
  });

  it('normalizes unknown lists and invalid dates safely', () => {
    const q = normalizeQualification({ budget: 'perhaps', purchaseType: 'other', nextStepDate: 'tomorrow' });
    expect(q.budget).toBe('');
    expect(q.purchaseType).toBe('');
    expect(q.nextStepDate).toBe('');
  });

  it('keeps model probability inside the workbook limits', () => {
    const deal = { stage: 'new', qualification: complete, updatedAt: Date.now() };
    const m = qualificationMetrics(deal, { stages });
    expect(m.score).toBe(100);
    expect(m.probability).toBeGreaterThanOrEqual(0.01);
    expect(m.probability).toBeLessThanOrEqual(0.95);
  });

  it('pins terminal probabilities', () => {
    expect(qualificationMetrics({ stage: 'won', qualification: complete }, { stages }).probability).toBe(1);
    expect(qualificationMetrics({ stage: 'lost', qualification: complete }, { stages }).probability).toBe(0);
  });

  it('adds late-funnel risks and never lets risk factor below 40%', () => {
    const deal = { stage: 's7', qualification: {}, updatedAt: Date.now() - 90 * 86400000 };
    const m = qualificationMetrics(deal, { stages: abrStages });
    expect(m.flags.length).toBeGreaterThan(4);
    expect(m.riskFactor).toBe(0.4);
  });

  it('flags divergence between manager confidence and model', () => {
    const deal = { stage: 'new', qualification: { ...complete, managerConfidence: 'high' }, updatedAt: Date.now() };
    const m = qualificationMetrics(deal, { stages });
    expect(m.divergence).toBeGreaterThan(0.25);
    expect(m.flags.some((f) => f.label.includes('расходится'))).toBe(true);
  });

  it('supports model and manager forecast modes without changing legacy mode', () => {
    const deal = { stage: 'proposal', qualification: complete, updatedAt: Date.now() };
    expect(probabilityOf(deal, {}, stages)).toBe(0.5);
    expect(probabilityOf(deal, {}, stages, 'manager')).toBe(0.4);
    expect(probabilityOf(deal, {}, stages, 'model')).not.toBe(0.5);
  });
});
