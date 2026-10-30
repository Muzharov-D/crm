import { todayISO, formatDate } from './util.js';

const clean = (value) => String(value || '').trim().toLocaleLowerCase('ru-RU');
const digits = (value) => String(value || '').replace(/\D/g, '');
const openDeal = (deal) => !deal.outcome;
const openLead = (lead) => !['Дисквалифицирован', 'Закрыт', 'Конвертирован'].includes(lead.status);

function duplicateGroups(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Actionable data-quality findings. A finding always points to records the
 * user can open and fix; there is no opaque "quality score".
 */
export function dataQuality({ companies = [], contacts = [], deals = [], leads = [], tasks = [] }, today = todayISO()) {
  const companyDuplicates = [
    ...duplicateGroups(companies, (c) => clean(c.inn) && `inn:${clean(c.inn)}`),
    ...duplicateGroups(companies, (c) => clean(c.name) && `name:${clean(c.name)}`),
  ];
  const contactDuplicates = [
    ...duplicateGroups(contacts, (c) => clean(c.email) && `email:${clean(c.email)}`),
    ...duplicateGroups(contacts, (c) => digits(c.phone).length >= 10 && `phone:${digits(c.phone).slice(-10)}`),
  ];
  const dealsWithoutNextStep = deals.filter((d) => openDeal(d) && !String(d.nextStepText || '').trim()
    && !tasks.some((t) => t.dealId === d.id && !t.done && t.status !== 'Выполнено'));
  const leadsWithoutOwner = leads.filter((l) => openLead(l) && !l.employeeId);
  const overdueTasks = tasks.filter((t) => !t.done && t.status !== 'Выполнено' && t.due && t.due < today);
  const dealsWithoutCompany = deals.filter((d) => openDeal(d) && !d.companyId);

  return {
    companyDuplicates, contactDuplicates, dealsWithoutNextStep,
    leadsWithoutOwner, overdueTasks, dealsWithoutCompany,
    get total() {
      return companyDuplicates.length + contactDuplicates.length + dealsWithoutNextStep.length
        + leadsWithoutOwner.length + overdueTasks.length + dealsWithoutCompany.length;
    },
  };
}

/** Operational notification feed, ordered by severity and due date. */
export function operationalAlerts(data, settings = {}, today = todayISO()) {
  const quality = dataQuality(data, today);
  const alerts = [];
  for (const task of quality.overdueTasks) {
    alerts.push({
      id: `task-${task.id}`, tone: 'critical', title: task.title,
      detail: `Просрочено · срок ${formatDate(task.due)}`, hash: '#/followups', at: task.due,
    });
  }
  const staleDays = Number(settings.staleDays) > 0 ? Number(settings.staleDays) : 14;
  const threshold = Date.parse(`${today}T23:59:59`) - staleDays * 86400000;
  for (const deal of (data.deals || []).filter(openDeal)) {
    const rawAt = deal.stageUpdatedAt || deal.updatedAt || deal.createdAt || 0;
    const at = typeof rawAt === 'number' ? rawAt : Date.parse(rawAt);
    if (at && at < threshold) {
      alerts.push({
        id: `stale-${deal.id}`, tone: 'warning', title: deal.name,
        detail: `Сделка не менялась более ${staleDays} дней`, hash: `#/pipeline?id=${deal.id}`, at: deal.stageUpdatedAt || deal.updatedAt,
      });
    }
  }
  for (const deal of quality.dealsWithoutNextStep.slice(0, 5)) {
    alerts.push({
      id: `next-${deal.id}`, tone: 'info', title: deal.name,
      detail: 'Нет следующего шага или открытой задачи', hash: `#/pipeline?id=${deal.id}`, at: deal.updatedAt,
    });
  }
  for (const lead of quality.leadsWithoutOwner.slice(0, 3)) {
    alerts.push({
      id: `owner-${lead.id}`, tone: 'info', title: lead.name,
      detail: 'У лида не назначен ответственный', hash: `#/leads?id=${lead.id}`, at: lead.updatedAt,
    });
  }
  return alerts.slice(0, 20);
}
