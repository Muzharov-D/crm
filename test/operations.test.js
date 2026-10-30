import { describe, it, expect } from 'vitest';
import { dataQuality, operationalAlerts } from '../src/lib/operations.js';

const today = '2026-10-30';
const data = {
  companies: [
    { id: 'c1', name: 'Альфа', inn: '7701234567' },
    { id: 'c2', name: 'Альфа', inn: '' },
    { id: 'c3', name: 'Бета', inn: '7701234567' },
  ],
  contacts: [
    { id: 'p1', name: 'Иван', email: 'IVAN@EXAMPLE.RU', phone: '' },
    { id: 'p2', name: 'Иван И', email: 'ivan@example.ru', phone: '' },
  ],
  deals: [
    { id: 'd1', name: 'Без шага', outcome: '', nextStepText: '', updatedAt: Date.parse('2026-09-01') },
    { id: 'd2', name: 'Закрыта', outcome: 'Выиграна', nextStepText: '' },
  ],
  leads: [{ id: 'l1', name: 'Новый лид', status: 'Новый', employeeId: null }],
  tasks: [{ id: 't1', title: 'Позвонить', due: '2026-10-29', done: false }],
};

 describe('operational data quality', () => {
  it('finds concrete duplicate groups and missing next steps', () => {
    const quality = dataQuality(data, today);
    expect(quality.companyDuplicates).toHaveLength(2);
    expect(quality.contactDuplicates).toHaveLength(1);
    expect(quality.dealsWithoutNextStep.map((d) => d.id)).toEqual(['d1']);
    expect(quality.leadsWithoutOwner.map((l) => l.id)).toEqual(['l1']);
    expect(quality.overdueTasks.map((t) => t.id)).toEqual(['t1']);
    expect(quality.total).toBe(7);
  });

  it('does not count completed tasks or closed deals as work', () => {
    const quality = dataQuality({ ...data, companies: [], contacts: [], leads: [], tasks: [{ id: 'done', due: '2020-01-01', done: true }] }, today);
    expect(quality.overdueTasks).toHaveLength(0);
    expect(quality.dealsWithoutNextStep.map((d) => d.id)).toEqual(['d1']);
  });

  it('builds actionable alerts with stale-deal detection', () => {
    const alerts = operationalAlerts(data, { staleDays: 14 }, today);
    expect(alerts.some((a) => a.id === 'task-t1' && a.tone === 'critical')).toBe(true);
    expect(alerts.some((a) => a.id === 'stale-d1' && a.hash === '#/pipeline?id=d1')).toBe(true);
    expect(alerts.some((a) => a.id === 'next-d1')).toBe(true);
    expect(alerts.some((a) => a.id === 'owner-l1')).toBe(true);
  });
});
