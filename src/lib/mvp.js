/** MVP v2.1 entity normalization and lossless legacy migration helpers. */
import { uid, todayISO, isValidISODate } from './util.js';
import { LEAD_STAGES, DEAL_STAGES, normalizePayment, fiscalYearQuarterForDate } from './spec.js';

const text = (v) => String(v ?? '').trim();
const stamp = (v, fallback = Date.now()) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback;
const link = (v) => text(v) || null;
const date = (v, fallback = '') => isValidISODate(v) ? v : fallback;

export const LEGACY_DEAL_STAGES = {
  new: 's1', qualified: 's2', proposal: 's5', negotiation: 's6',
  s0: 's1', s1: 's1', s2: 's2', s3: 's3', s4: 's4', s5: 's5', s6: 's6', s7: 's7',
  s8: 's8', s9: 's9', s10: 's10',
};
export const canonicalDealStage = (stage) => LEGACY_DEAL_STAGES[text(stage).toLowerCase()] || '';
export const canonicalLeadStage = (stage) => {
  const id = text(stage).toLowerCase();
  return LEAD_STAGES.some((s) => s.id === id) ? id : 'l0';
};

export function normalizeEmployee(raw = {}) {
  return {
    ...raw, id: text(raw.id) || uid(), name: text(raw.name), role: text(raw.role),
    username: text(raw.username), notes: text(raw.notes), active: raw.active !== false, createdAt: stamp(raw.createdAt),
  };
}

export function normalizeLead(raw = {}) {
  const createdAt = stamp(raw.createdAt);
  const status = text(raw.status) || 'Новый';
  return {
    ...raw,
    id: text(raw.id) || uid(), name: text(raw.name), status,
    stage: canonicalLeadStage(raw.stage), source: text(raw.source),
    contactId: link(raw.contactId), companyId: link(raw.companyId), createdAt,
    closeReason: text(raw.closeReason), description: text(raw.description ?? raw.notes),
    product: text(raw.product), subproduct: text(raw.subproduct),
    employeeId: link(raw.employeeId), partnerId: link(raw.partnerId),
    preliminaryBudget: Math.max(0, Number(raw.preliminaryBudget) || 0),
    convertedDealId: link(raw.convertedDealId), updatedAt: stamp(raw.updatedAt, createdAt),
    closedAt: ['Дисквалифицирован', 'Закрыт'].includes(status) ? stamp(raw.closedAt, createdAt) : null,
  };
}

export function normalizeCompanyTeam(raw = {}) {
  return {
    ...raw, id: text(raw.id) || uid(), companyId: link(raw.companyId), contactId: link(raw.contactId),
    role: text(raw.role), influence: text(raw.influence), comment: text(raw.comment),
    createdAt: stamp(raw.createdAt),
  };
}

/** Exactly one primary employee whenever a deal has a sales team. */
export function normalizeSalesTeam(rows = [], dealId = null) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue;
    const employeeId = link(raw.employeeId);
    const rowDealId = link(raw.dealId || dealId);
    if (!employeeId || !rowDealId || seen.has(`${rowDealId}\0${employeeId}`)) continue;
    seen.add(`${rowDealId}\0${employeeId}`);
    out.push({
      ...raw, id: text(raw.id) || uid(), dealId: rowDealId, employeeId,
      role: text(raw.role), primary: !!raw.primary, createdAt: stamp(raw.createdAt),
    });
  }
  const byDeal = new Map();
  for (const row of out) {
    if (!byDeal.has(row.dealId)) byDeal.set(row.dealId, []);
    byDeal.get(row.dealId).push(row);
  }
  for (const team of byDeal.values()) {
    let found = false;
    for (const row of team) {
      row.primary = !!row.primary && !found;
      if (row.primary) found = true;
    }
    if (team.length && !found) team[0].primary = true;
  }
  return out;
}

export function normalizeDealStageHistory(raw = {}, deal = {}) {
  const ownerId = text(raw.dealId || deal.id);
  return {
    ...raw, id: text(raw.id) || uid(), dealId: ownerId,
    at: stamp(raw.at, stamp(deal.createdAt)),
    previousStage: canonicalDealStage(raw.previousStage) || '',
    newStage: canonicalDealStage(raw.newStage || raw.stage) || canonicalDealStage(deal.stage) || 's1',
  };
}

export function normalizeLeadStageHistory(raw = {}, lead = {}) {
  return {
    ...raw, id: text(raw.id) || uid(), leadId: text(raw.leadId || lead.id),
    at: stamp(raw.at, stamp(lead.createdAt)),
    previousStage: LEAD_STAGES.some((s) => s.id === raw.previousStage) ? raw.previousStage : '',
    newStage: canonicalLeadStage(raw.newStage || raw.stage || lead.stage),
  };
}

/** Convert legacy embedded history without truncating or deleting regressions. */
export function migrateDealHistory(deals, existing = []) {
  const out = existing.map((h) => normalizeDealStageHistory(h));
  const ids = new Set(out.map((h) => h.id));
  const entries = new Set(out.map((h) => `${h.dealId}\0${h.at}\0${h.newStage}`));
  for (const deal of deals) {
    let previousStage = '';
    const embedded = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
    const rows = embedded.length ? embedded : [{ stage: deal.stage, at: deal.createdAt }];
    rows.forEach((entry, index) => {
      const newStage = canonicalDealStage(entry.newStage || entry.stage);
      if (!newStage) return;
      const at = stamp(entry.at, deal.createdAt);
      const id = `legacy-deal-${deal.id}-${index}-${at}`;
      const entryKey = `${deal.id}\0${at}\0${newStage}`;
      if (!ids.has(id) && !entries.has(entryKey)) {
        out.push({ id, dealId: deal.id, at, previousStage, newStage });
        ids.add(id);
        entries.add(entryKey);
      }
      previousStage = newStage;
    });
    const tail = out.filter((h) => h.dealId === deal.id).sort((a, b) => a.at - b.at).at(-1);
    if (!tail || tail.newStage !== deal.stage) {
      const id = `current-deal-${deal.id}-${stamp(deal.updatedAt, deal.createdAt)}`;
      if (!ids.has(id)) {
        out.push({ id, dealId: deal.id, at: stamp(deal.updatedAt), previousStage: tail?.newStage || previousStage, newStage: deal.stage });
        ids.add(id);
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function migrateLeadHistory(leads, existing = []) {
  const out = existing.map((h) => normalizeLeadStageHistory(h));
  const ids = new Set(out.map((h) => h.id));
  for (const lead of leads) {
    const rows = out.filter((h) => h.leadId === lead.id).sort((a, b) => a.at - b.at);
    if (!rows.length) {
      const id = `initial-lead-${lead.id}`;
      if (!ids.has(id)) { out.push({ id, leadId: lead.id, at: lead.createdAt, previousStage: '', newStage: lead.stage }); ids.add(id); }
    } else if (rows.at(-1).newStage !== lead.stage) {
      const id = `current-lead-${lead.id}-${lead.updatedAt}`;
      if (!ids.has(id)) { out.push({ id, leadId: lead.id, at: lead.updatedAt, previousStage: rows.at(-1).newStage, newStage: lead.stage }); ids.add(id); }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Legacy contract amounts become one initial payment, never silently zeroed. */
export function migratePayments(deals, existing = [], now = new Date()) {
  const out = existing.map(normalizePayment);
  const covered = new Set(out.map((p) => p.dealId));
  for (const deal of deals) {
    const amount = Math.max(0, Number(deal.value) || 0);
    if (!amount || covered.has(deal.id)) continue;
    const basis = deal.expectedClose || (deal.closedAt ? todayISO(new Date(deal.closedAt)) : todayISO(new Date(deal.createdAt)));
    const fyq = fiscalYearQuarterForDate(basis || now);
    out.push(normalizePayment({
      id: `legacy-payment-${deal.id}`, dealId: deal.id, ...fyq, amount,
      type: 'Лицензия', status: deal.outcome === 'Выиграна' ? 'Оплата' : 'Прогноз',
      paymentDate: deal.outcome === 'Выиграна' && deal.closedAt ? todayISO(new Date(deal.closedAt)) : '',
      createdAt: deal.createdAt,
    }));
    covered.add(deal.id);
  }
  return out;
}

export function newStageEntry(ownerKey, ownerId, previousStage, newStage, at = Date.now()) {
  return { id: uid(), [ownerKey]: ownerId, at, previousStage: previousStage || '', newStage };
}

export function normalizeTaskLinks(raw = {}) {
  const status = text(raw.status) || (raw.done ? 'Выполнено' : 'К выполнению');
  const done = status === 'Выполнено' || !!raw.done;
  return {
    employeeId: link(raw.employeeId), companyId: link(raw.companyId), leadId: link(raw.leadId),
    startDate: date(raw.startDate, date(raw.due, todayISO())), status: done ? 'Выполнено' : status,
    done, doneAt: done ? stamp(raw.doneAt) : null,
  };
}

export function normalizeActivityLinks(raw = {}) {
  return { employeeId: link(raw.employeeId), leadId: link(raw.leadId) };
}

export const DEAL_STAGE_IDS = new Set(DEAL_STAGES.map((s) => s.id));
