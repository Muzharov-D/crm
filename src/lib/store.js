/**
 * Data layer on top of Puter.
 *
 * Everything lives in KV, one key per collection - small, hot, single-key
 * reads and no kv.list() scans. A founder-scale CRM (hundreds of contacts,
 * not hundreds of thousands) fits comfortably inside KV value limits, and
 * whole-collection writes keep the code simple and the export format exact:
 *
 *   crm:settings:v1    { currency, theme, onboarded, sampleData, stageProbabilities,
 *                        stages, customFields }
 *   crm:companies:v1   [{ id, name, industry, website, size, notes, tags,
 *                         custom: { [fieldId]: value }, createdAt }]
 *   crm:contacts:v1    [{ id, name, title, email, phone, companyId, source,
 *                         status: lead|active|customer|lost, notes, tags,
 *                         custom: { [fieldId]: value }, createdAt }]
 *   crm:deals:v1       [{ id, name, value, stage, contactId (primary), companyId,
 *                         contacts: [{ contactId, role }] (primary first),
 *                         expectedClose, notes, tags, createdAt, updatedAt,
 *                         closedAt, closeReason, closeReasonNote,
 *                         confidence: 0..1 | null (per-deal forecast override),
 *                         billing: one-time|monthly|annual,
 *                         term: months | null (recurring deals only),
 *                         custom: { [fieldId]: value },
 *                         stageHistory: [{ stage, at }] }]
 *   crm:activities:v1  [{ id, type: meeting|call|email|note, date, summary,
 *                         notes, contactId, companyId, dealId, createdAt }]
 *   crm:tasks:v1       [{ id, title, due, dueTime, done, doneAt, contactId,
 *                         dealId, createdAt, templateId (email to send),
 *                         repeat: { every, unit: day|week|month } | null,
 *                         spawnedId }]
 *   crm:templates:v1   [{ id, name, subject, body, createdAt }]
 *   crm:attachments:v1 [{ id, name, path, size, type, contactId, companyId,
 *                         dealId, uploadedAt }]  (bytes live in puter.fs)
 *   crm:trash:v1       [{ id, kind, at, name, record, refs }]  (30-day undo)
 *   crm:backup:v1      { at, reason, data }  (pre-import safety snapshot)
 *
 * Mutations update memory first and emit 'change' (instant UI), then await
 * the KV write. A write that cannot reach KV is not lost: it is staged in
 * the local outbox (lib/outbox.js) and replayed when the connection comes
 * back, so the record survives a reload. Reads fall back to the same local
 * copy, which is what lets a cold start work with no network at all.
 */

import { uid, todayISO, isValidISODate } from './util.js';
import { normalizeRepeat, nextRepeatDue } from './repeat.js';
import { normalizeTags, splitTags, cleanTag } from './tags.js';
import { deleteStoredFile, isAppFilePath } from './files.js';
import {
  resolveStages, firstStageId, isTerminalStage, stageEnteredAt, DEFAULT_STALE_DAYS,
  normalizeConfidence,
} from './forecast.js';
import { normalizeBilling, normalizeTerm } from './recurring.js';
import {
  normalizeDealContacts, dealContactIds, replacePrimary, withoutContact, repointContact,
  withContact,
} from './deal-contacts.js';
import {
  customFieldsOf, normalizeCustomFields, normalizeFieldList, normalizeCustomValues,
  isCustomKind, dropFieldValues, coerceFieldValue, retypeReport,
} from './fields.js';
import { normalizePlaybooks, playbookTasks } from './playbooks.js';
import { createOutbox, idbStorage } from './outbox.js';
import { normalizeViews, normalizeViewList, MAX_VIEWS } from './views.js';
import { DEFAULT_COLD_DAYS } from './attention.js';
import { normalizeQualification } from './qualification.js';
import { canWrite, readOnlyError } from './access.js';
import { DEFAULT_DICTIONARIES, dealTotals, normalizePayment } from './spec.js';
import {
  canonicalDealStage, canonicalLeadStage, normalizeEmployee, normalizeLead, normalizeCompanyTeam,
  normalizeSalesTeam, migrateDealHistory, migrateLeadHistory, migratePayments,
  newStageEntry, normalizeTaskLinks, normalizeActivityLinks,
} from './mvp.js';
import { CONTACT_STATUSES, ACTIVITY_TYPES } from './statuses.js';
import {
  parseMoney, parseDateLoose, matchStatus, matchStage, matchBilling, parseTerm,
  customCellValues,
} from './csv.js';

const KV = {
  settings: 'crm:settings:v1',
  companies: 'crm:companies:v1',
  contacts: 'crm:contacts:v1',
  deals: 'crm:deals:v1',
  employees: 'crm:employees:v1',
  leads: 'crm:leads:v1',
  payments: 'crm:payments:v1',
  companyTeam: 'crm:company-team:v1',
  salesTeam: 'crm:sales-team:v1',
  dealStageHistory: 'crm:deal-stage-history:v1',
  leadStageHistory: 'crm:lead-stage-history:v1',
  activities: 'crm:activities:v1',
  tasks: 'crm:tasks:v1',
  templates: 'crm:templates:v1',
  attachments: 'crm:attachments:v1',
  trash: 'crm:trash:v1',
  backup: 'crm:backup:v1',
};

/** Not a collection: the signed-in user, kept locally for offline starts. */
const KV_USER = 'crm:user:v1';

/** The collection key behind a record-type name, for the shared paths. */
const KV_BY_KIND = {
  contacts: KV.contacts,
  companies: KV.companies,
  deals: KV.deals,
};

/** How long a deleted record stays restorable. */
export const TRASH_TTL = 30 * 86400000;
/** Bound on trash size, so a bulk cleanup can't balloon the KV value.
    Public so bulk delete can warn when a selection outruns restorability. */
export const TRASH_MAX = 200;

/** A stored KV value as data: a JSON string, an object, or nothing. */
function parseStored(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function isLiveTrashEntry(e) {
  return e && typeof e === 'object' && e.record && typeof e.kind === 'string'
    && Number.isFinite(e.at) && Date.now() - e.at < TRASH_TTL;
}

/** The attachment records carried by a set of trash entries losing their slot. */
function attachmentRecordsOf(entries) {
  return entries
    .filter((e) => e?.kind === 'attachment' && e.record?.path)
    .map((e) => e.record);
}

export { CONTACT_STATUSES } from './statuses.js';
export { normalizeRepeat, nextRepeatDue, repeatLabel } from './repeat.js';

export const LEAD_SOURCES = [
  'Рекомендация', 'Сайт', 'Холодный контакт', 'Конференция', 'Соцсети', 'Входящая заявка', 'Другое',
];

export { ACTIVITY_TYPES, activityTypeInfo } from './statuses.js';

const DEFAULT_SETTINGS = {
  currency: 'RUB',
  theme: 'light',
  onboarded: false,
  sampleData: false,
  dictionaries: structuredClone(DEFAULT_DICTIONARIES),
  salesPlans: {},
  specVersion: '2.1',
  // Per-stage win-probability overrides ({ qualified: 0.3, ... }); stage
  // defaults from forecast.js apply where a stage has no entry.
  stageProbabilities: {},
  // The user's open stages ({ id, label, probability }), or null for the
  // default funnel. Won and Lost are always appended and never stored.
  stages: null,
  // Saved follow-up cadences ({ id, name, trigger, steps }), or null for
  // none. See lib/playbooks.js.
  playbooks: null,
  // Saved filter sets per list ({ contacts: [], companies: [], deals: [] }),
  // or null for none. See lib/views.js.
  views: null,
  // Per-record-type field definitions, or null for none. See lib/fields.js;
  // null rather than a shared {} so no two Store instances can end up
  // mutating the same default object.
  customFields: null,
  // Days a deal may sit in one stage before the board flags it (0 = never).
  staleDays: DEFAULT_STALE_DAYS,
  // Forecast weighting: stage defaults, manager confidence, or the ABR model.
  forecastMode: 'stage',
  // Preferred pipeline layout: 'board' or 'list'.
  dealView: 'board',
  // Preferred follow-up layout: 'list' (the default), 'week', or 'month'.
  followupView: 'list',
  // Monthly revenue target in the app currency (0 = no goal set).
  revenueGoal: 0,
  // Weekly touch target: { all, meeting, call, email, note }, each 0 for
  // "no target". See lib/activity.js - the leading number to the revenue
  // goal's lagging one.
  touchTargets: null,
  // Days of silence before a lead or deal is flagged (0 = never).
  coldDays: DEFAULT_COLD_DAYS,
  // Browser notifications for follow-ups (needs the OS permission too).
  notifications: false,
  // Offer to schedule the next step after completing a follow-up, logging
  // an activity, or moving a deal, when the record has nothing else booked.
  nextStepNudges: true,
  // Days between automatic backups to Puter FS (0 = off). See lib/backups.js.
  autoBackupDays: 7,
  // AI assist (paste to create, draft an email, catch me up) on Puter's
  // built-in models. See lib/ai.js: false turns every control off, and so
  // does a platform without puter.ai.
  aiAssist: true,
};

/* ---------- import normalization ----------
   Identity for well-formed data; coerces the fields views sort and
   render on, so a hand-edited export can't crash the app. */

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
/**
 * Only a number, or a string that spells one, counts. Number() would take
 * null, '', true, and [] for 0 - and 0 is a finite timestamp, so a
 * hand-edited export with "createdAt": null would date the record to 1970
 * instead of falling back to now.
 */
const num = (v, fallback = 0) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v !== 'string' || !v.trim()) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const idOrNull = (v) => (typeof v === 'string' && v ? v : null);
const isoDate = (v, fallback) => (isValidISODate(v) ? v : fallback);

/** Due date, then time of day - an untimed task is "sometime that day". */
const byDue = (a, b) =>
  a.due.localeCompare(b.due) || (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99');

function normalizeAll(list, normalize) {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r === 'object').map(normalize);
}

function normalizeCompany(c) {
  return {
    ...c, id: str(c.id) || uid(), name: str(c.name), industry: str(c.industry),
    website: str(c.website), size: str(c.size), notes: str(c.notes),
    inn: str(c.inn), role: str(c.role), parentCompanyId: idOrNull(c.parentCompanyId),
    tags: normalizeTags(c.tags), custom: normalizeCustomValues(c.custom),
    createdAt: num(c.createdAt, Date.now()),
  };
}

function normalizeContact(c) {
  return {
    ...c, id: str(c.id) || uid(), name: str(c.name), title: str(c.title),
    email: str(c.email), phone: str(c.phone), companyId: idOrNull(c.companyId),
    source: str(c.source),
    status: CONTACT_STATUSES.some((s) => s.value === c.status) ? c.status : 'lead',
    notes: str(c.notes), tags: normalizeTags(c.tags),
    custom: normalizeCustomValues(c.custom),
    createdAt: num(c.createdAt, Date.now()),
  };
}

function normalizeDeal(d, { stageIds, fallbackStage } = {}) {
  const createdAt = num(d.createdAt, Date.now());
  const updatedAt = num(d.updatedAt, createdAt);
  const rawStage = str(d.stage);
  let outcome = str(d.outcome);
  if (rawStage === 'won') outcome = 'Выиграна';
  if (rawStage === 'lost') outcome = 'Проиграна';
  let stage = canonicalDealStage(rawStage);
  if (rawStage === 'lost') {
    const previous = (Array.isArray(d.stageHistory) ? d.stageHistory : [])
      .map((h) => canonicalDealStage(h?.newStage || h?.stage)).filter(Boolean);
    stage = previous.at(-1) || 's1';
  }
  if (outcome === 'Выиграна' && !['s8', 's9', 's10'].includes(stage)) stage = 's8';
  if (!stage || (stageIds && !stageIds.has(stage))) stage = fallbackStage || 's1';
  const closed = !!outcome;
  const billing = normalizeBilling(d.billing);
  const contacts = normalizeDealContacts(d.contacts, idOrNull(d.contactId));
  return {
    ...d, id: str(d.id) || uid(), name: str(d.name), value: num(d.value),
    billing, term: normalizeTerm(d.term, billing),
    stage, status: str(d.status) || 'Новая', outcome,
    probabilityCategory: str(d.probabilityCategory),
    product: str(d.product), subproduct: str(d.subproduct),
    contacts, contactId: contacts[0]?.contactId ?? null,
    companyId: idOrNull(d.companyId), partnerId: idOrNull(d.partnerId),
    competitorIds: Array.isArray(d.competitorIds) ? d.competitorIds.map(str).filter(Boolean) : [],
    risks: str(d.risks), sourceLeadId: idOrNull(d.sourceLeadId),
    contractDate: isoDate(d.contractDate, ''), workStartDate: isoDate(d.workStartDate, ''),
    economicBuyerContactId: idOrNull(d.economicBuyerContactId), championContactId: idOrNull(d.championContactId),
    clientEvent: str(d.clientEvent), clientEventDate: isoDate(d.clientEventDate, ''),
    clientInvestment: str(d.clientInvestment), budget: str(d.budget), purchaseType: str(d.purchaseType),
    nextStepText: str(d.nextStepText), nextStepDate: isoDate(d.nextStepDate, ''),
    expectedClose: isoDate(d.expectedClose, null), notes: str(d.notes),
    tags: normalizeTags(d.tags), custom: normalizeCustomValues(d.custom),
    closeReason: closed ? str(d.closeReason) : '', closeReasonNote: closed ? str(d.closeReasonNote) : '',
    winner: outcome === 'Проиграна' ? str(d.winner) : '',
    confidence: closed ? null : normalizeConfidence(d.confidence),
    qualification: normalizeQualification(d.qualification),
    createdAt, updatedAt, closedAt: closed ? num(d.closedAt, Date.now()) : null,
    cost: null, margin: null,
    stageHistory: normalizeStageHistory(d.stageHistory, { stage, createdAt, updatedAt }),
  };
}

/**
 * A deal is back in play: drop everything that described a close that no
 * longer stands.
 *
 * The close date was already cleared here; the recorded reason was not, and
 * it outlived the close in three visible ways. An open deal exported a
 * "Close reason" column. Closing it again pre-selected the old answer, so a
 * one-click Skip filed it unchanged. And a deal won, reopened, then lost
 * reported its *winning* reason in the Lost column of the forecast - the one
 * report whose whole job is telling the two apart.
 */
function clearCloseRecord(deal) {
  deal.outcome = '';
  deal.closedAt = null;
  deal.winner = '';
  deal.closeReason = '';
  deal.closeReasonNote = '';
}

/**
 * Custom-field values on a merge: the survivor keeps everything it has,
 * and fills its blanks from the record being merged away. The merge dialog
 * only asks about built-in fields, so without this a field only the
 * duplicate had answered went to the trash with it.
 */
function mergeCustomValues(survivor, merged) {
  const out = { ...normalizeCustomValues(survivor) };
  for (const [key, value] of Object.entries(normalizeCustomValues(merged))) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Keep a deal's primary contact and its contact list agreeing after a patch.
 *
 * `contacts` in a patch is the whole list - that is what the form sends,
 * with the primary select as its first entry. A patch carrying only
 * `contactId` is changing who the primary is, which swaps the first entry
 * and leaves the others where they are. `before` is the list as it stood
 * before the patch landed on the deal.
 */
function settleDealContacts(deal, patch, before) {
  const list = 'contacts' in patch ? patch.contacts
    : ('contactId' in patch ? replacePrimary(before, patch.contactId) : before);
  const primary = 'contacts' in patch && 'contactId' in patch ? patch.contactId : null;
  deal.contacts = normalizeDealContacts(list, primary);
  deal.contactId = deal.contacts[0]?.contactId ?? null;
}

/** Take a contact off a deal, promoting the next one when they led it. */
function detachDealContact(deal, contactId) {
  const next = withoutContact(deal.contacts, contactId);
  if (next.length === (deal.contacts?.length ?? 0)) return false;
  deal.contacts = next;
  deal.contactId = deal.contacts[0]?.contactId ?? null;
  return true;
}

/**
 * Keep billing and term consistent on a deal being written.
 *
 * A term is meaningful only while the deal recurs: switching a $2k/mo
 * 12-month deal back to one-time and leaving `term: 12` on it would export
 * a term column for a deal that has none, and switching back would silently
 * restore a contract length the user never re-confirmed. A deal that starts
 * recurring with no term gets the default one rather than NaN months.
 */
function settleBilling(deal) {
  deal.billing = normalizeBilling(deal.billing);
  deal.term = normalizeTerm(deal.term, deal.billing);
}

/* ---------- stage history ----------
   Every stage change appends { stage, at }. Deals from before the feature
   (and hand-edited exports) are backfilled with a single entry from
   createdAt, so time-in-stage has something honest to read. */

function normalizeStageHistory(raw, { stage, createdAt, updatedAt }) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== 'object' || typeof e.stage !== 'string' || !e.stage) continue;
    const mapped = canonicalDealStage(e.newStage || e.stage);
    if (mapped) out.push({ stage: mapped, at: num(e.at, createdAt) });
  }
  out.sort((a, b) => a.at - b.at);
  if (!out.length) out.push({ stage, at: createdAt });
  // The tail has to agree with the deal's stage or time-in-stage lies.
  if (out[out.length - 1].stage !== stage) out.push({ stage, at: updatedAt });
  return out;
}

function recordStageEntry(deal, stage, at, fromStage) {
  if (!Array.isArray(deal.stageHistory) || !deal.stageHistory.length) {
    deal.stageHistory = [{ stage: fromStage, at: num(deal.createdAt, at) }];
  }
  const hist = deal.stageHistory;
  if (hist.at(-1)?.stage === stage) return;
  // System history is append-only: regressions and quick corrections stay visible.
  hist.push({ stage, at });
}

function normalizeActivity(a) {
  return {
    ...a, id: str(a.id) || uid(),
    type: ACTIVITY_TYPES.some((t) => t.value === a.type) ? a.type : 'note',
    date: isoDate(a.date, todayISO()), summary: str(a.summary), notes: str(a.notes),
    contactId: idOrNull(a.contactId), companyId: idOrNull(a.companyId),
    dealId: idOrNull(a.dealId), ...normalizeActivityLinks(a), createdAt: num(a.createdAt, Date.now()),
  };
}

const clockTime = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');

function normalizeAttachment(a) {
  return {
    ...a, id: str(a.id) || uid(), name: str(a.name),
    // A path is the one field that names something outside this app's own
    // data, and an import brings it in verbatim. Anything but a file this
    // app wrote is dropped rather than stored, so the orphan purge can
    // never be pointed at a backup or a neighbouring app's file.
    path: isAppFilePath(a.path) ? a.path : '',
    size: num(a.size), type: str(a.type),
    contactId: idOrNull(a.contactId), companyId: idOrNull(a.companyId),
    dealId: idOrNull(a.dealId), uploadedAt: num(a.uploadedAt, Date.now()),
  };
}

function normalizeTemplate(t) {
  return {
    ...t, id: str(t.id) || uid(), name: str(t.name), subject: str(t.subject),
    body: str(t.body), createdAt: num(t.createdAt, Date.now()),
  };
}

function normalizeTask(t) {
  return {
    ...t, id: str(t.id) || uid(), title: str(t.title),
    due: isoDate(t.due, todayISO()), dueTime: clockTime(t.dueTime), done: !!t.done,
    doneAt: t.done ? num(t.doneAt, Date.now()) : null,
    contactId: idOrNull(t.contactId), dealId: idOrNull(t.dealId), ...normalizeTaskLinks(t),
    // The email a playbook step meant this follow-up to send. A hint for
    // the Email button on the row, not a link to anything: the template
    // can be deleted and the follow-up still stands.
    templateId: idOrNull(t.templateId),
    repeat: normalizeRepeat(t.repeat), spawnedId: idOrNull(t.spawnedId),
    createdAt: num(t.createdAt, Date.now()),
  };
}

class Store extends EventTarget {
  settings = { ...DEFAULT_SETTINGS };
  companies = [];
  contacts = [];
  deals = [];
  employees = [];
  leads = [];
  payments = [];
  companyTeam = [];
  salesTeam = [];
  dealStageHistory = [];
  leadStageHistory = [];
  activities = [];
  tasks = [];
  /** Reusable email templates, edited in Settings. */
  templates = [];
  /** Attachment metadata; the bytes live in puter.fs under attachments/. */
  attachments = [];
  /** Recently deleted records, newest first. See TRASH_TTL. */
  trash = [];
  /** One-slot snapshot taken before a destructive bulk operation. */
  backup = null;
  user = null;

  /** Per-key write chains: a later save of a collection waits for the earlier one. */
  #writes = new Map();

  /**
   * The durable local copy and the queue of writes KV hasn't taken. Swapped
   * for an in-memory one in tests through `useOutbox`.
   */
  #outbox = createOutbox({
    storage: idbStorage(),
    kv: {
      get: (key) => puter.kv.get(key),
      set: (key, payload) => puter.kv.set(key, payload),
    },
  });

  /**
   * What the UI needs to be honest about where the data is:
   *   offline  - the last KV call failed, so we are working locally
   *   queued   - writes owed to KV
   *   conflicts- queued writes blocked on a decision
   *   durable  - whether the local copy really survives a reload
   */
  offline = { offline: false, queued: 0, conflicts: 0, durable: true };

  /** Swap the outbox (tests, and the in-memory fallback). */
  useOutbox(outbox) {
    this.#outbox = outbox;
    this.offline = { ...this.offline, durable: outbox.durable !== false };
  }

  outbox() {
    return this.#outbox;
  }

  /** Refuse before optimistic memory changes: a viewer must not see a write
      appear to succeed locally and then fail when the outbox reaches KV. */
  #assertWritable() {
    if (!canWrite(this.user)) throw readOnlyError();
  }

  /** Bumped on every emit, so refresh() can tell when it raced a mutation. */
  #mutations = 0;

  /** KV writes not yet settled; refresh() must never swap out from under one. */
  #pendingWrites = 0;

  /** Memo for stages(): re-resolved only when the configured list changes. */
  #stageCache = { key: undefined, value: null };

  /**
   * The configured stage list (open stages then Won/Lost). Every view reads
   * stages from here rather than the module defaults, so renaming or
   * reordering in Settings reaches the whole app.
   */
  stages() {
    if (this.#stageCache.key !== this.settings.stages) {
      this.#stageCache = { key: this.settings.stages, value: resolveStages(this.settings) };
    }
    return this.#stageCache.value;
  }

  /** Stage a deal falls back to: the first open stage. */
  firstStage() {
    return firstStageId(this.stages());
  }

  #dealStageContext() {
    const stages = this.stages();
    return { stageIds: new Set(stages.map((s) => s.id)), fallbackStage: firstStageId(stages) };
  }

  #syncDealTotals() {
    for (const deal of this.deals) {
      deal.value = dealTotals(deal.id, this.payments).total;
    }
  }

  /** Normalize old exports and persist the v2.1 migration once, without data loss. */
  async #migrateV21({ persist = true } = {}) {
    const before = {
      settings: this.settings, companies: this.companies, contacts: this.contacts,
      deals: this.deals, employees: this.employees, leads: this.leads,
      payments: this.payments, companyTeam: this.companyTeam, salesTeam: this.salesTeam,
      dealStageHistory: this.dealStageHistory, leadStageHistory: this.leadStageHistory,
      activities: this.activities, tasks: this.tasks,
    };
    const serialized = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, JSON.stringify(v)]));
    if (Array.isArray(this.settings.stages) && !this.settings.stages.some((s) => canonicalDealStage(s?.id))) {
      this.settings.stages = null;
    }
    this.settings.dictionaries = {
      ...structuredClone(DEFAULT_DICTIONARIES), ...(this.settings.dictionaries || {}),
    };
    this.settings.specVersion = '2.1';
    this.settings.salesPlans ||= {};
    const stageCtx = this.#dealStageContext();
    this.companies = normalizeAll(this.companies, normalizeCompany);
    this.contacts = normalizeAll(this.contacts, normalizeContact);
    this.deals = normalizeAll(this.deals, (d) => normalizeDeal(d, stageCtx));
    this.employees = normalizeAll(this.employees, normalizeEmployee);
    this.leads = normalizeAll(this.leads, normalizeLead);
    this.companyTeam = normalizeAll(this.companyTeam, normalizeCompanyTeam);
    this.salesTeam = normalizeSalesTeam(this.salesTeam);
    this.activities = normalizeAll(this.activities, normalizeActivity);
    this.tasks = normalizeAll(this.tasks, normalizeTask);
    this.payments = migratePayments(this.deals, this.payments);
    this.dealStageHistory = migrateDealHistory(this.deals, this.dealStageHistory);
    this.leadStageHistory = migrateLeadHistory(this.leads, this.leadStageHistory);
    this.#syncDealTotals();
    this.#lastContact = null;
    this.#links = null;
    if (!persist || !canWrite(this.user)) return;
    const writes = [];
    for (const key of Object.keys(before)) {
      if (serialized[key] !== JSON.stringify(this[key])) writes.push(this.#save(KV[key], this[key]));
    }
    await Promise.all(writes);
  }

  async init() {
    // What the last session couldn't deliver: read before anything else, so
    // a queued write is known about before the first read decides whether
    // to trust KV or this device.
    await this.#outbox.ready().catch(() => {});
    this.offline = {
      ...this.offline,
      queued: this.#outbox.pendingCount(),
      conflicts: (await this.#outbox.conflicts().catch(() => [])).length,
      durable: this.#outbox.durable !== false,
    };
    const [settings, companies, contacts, deals, employees, leads, payments, companyTeam, salesTeam, dealStageHistory, leadStageHistory, activities, tasks, templates, attachments, trash, backup] = await Promise.all([
      this.#read(KV.settings),
      this.#read(KV.companies),
      this.#read(KV.contacts),
      this.#read(KV.deals),
      this.#read(KV.employees),
      this.#read(KV.leads),
      this.#read(KV.payments),
      this.#read(KV.companyTeam),
      this.#read(KV.salesTeam),
      this.#read(KV.dealStageHistory),
      this.#read(KV.leadStageHistory),
      this.#read(KV.activities),
      this.#read(KV.tasks),
      this.#read(KV.templates),
      this.#read(KV.attachments),
      this.#read(KV.trash),
      this.#read(KV.backup),
    ]);
    // Shape-check what comes back: one corrupt KV value must not brick the
    // whole app at boot (every view calls .filter/.sort on these), and the
    // trash and backup below already get the same treatment.
    const list = (v) => (Array.isArray(v) ? v : []);
    const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    this.settings = { ...DEFAULT_SETTINGS, ...record(settings) };
    this.companies = list(companies);
    this.contacts = list(contacts);
    this.deals = list(deals);
    this.employees = list(employees);
    this.leads = list(leads);
    this.payments = list(payments);
    this.companyTeam = list(companyTeam);
    this.salesTeam = list(salesTeam);
    this.dealStageHistory = list(dealStageHistory);
    this.leadStageHistory = list(leadStageHistory);
    this.activities = list(activities);
    this.tasks = list(tasks);
    this.templates = list(templates);
    this.attachments = list(attachments);
    this.backup = backup && typeof backup === 'object' ? backup : null;
    // Expired entries are dropped on the way in, so the trash empties
    // itself without a scheduler. An expired attachment entry takes its
    // stored file with it - that was the 30-day deal - unless something
    // else still answers for the file, which #reclaimFiles settles.
    const rawTrash = Array.isArray(trash) ? trash : [];
    const kept = rawTrash.filter(isLiveTrashEntry);
    this.trash = kept;
    if (kept.length !== rawTrash.length) {
      this.#reclaimFiles(attachmentRecordsOf(rawTrash.filter((e) => !kept.includes(e))));
      this.#save(KV.trash, this.trash).catch(() => {});
    }
    this.#purgeOrphanAttachments();
    // The collections above were replaced wholesale, so anything derived
    // from the old ones is answering about data that is gone.
    this.#lastContact = null;
    this.#links = null;
    // The signed-in user, remembered locally: an offline start can't ask
    // the platform who this is, and "Puter user" in the sidebar of your own
    // CRM reads like a different account.
    try {
      this.user = await puter.auth.getUser();
      await this.#outbox.mirror(KV_USER, JSON.stringify(this.user)).catch(() => {});
    } catch {
      this.user = parseStored(await this.#outbox.localValue(KV_USER).catch(() => null));
    }
    await this.#migrateV21();
  }

  /**
   * Pull in what another session wrote - the phone that logged calls all
   * week while this laptop tab sat in the background. Every mutation here
   * writes whole collections from memory, so that stale tab's first edit
   * would otherwise hand KV a copy of last week and erase the phone's work
   * without an error anywhere.
   *
   * Strictly read-and-compare: nothing is written, and the swap is skipped
   * whenever it could lose something this session knows - a write still in
   * flight, or a mutation landing while the reads were out. A skipped
   * refresh costs nothing; the next foreground moment tries again.
   * Two sessions both actively writing can still race - that needs a
   * server to referee - but the stale-tab case is the one that eats real
   * work, and it ends here. Returns whether anything changed.
   */
  refresh() {
    // Focus and visibility fire together on an ordinary tab switch; one
    // round of reads answers both.
    this.#refreshing ??= this.#refresh().finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  #refreshing = null;

  async #refresh() {
    // A write of ours still owed to KV means KV is behind this device, not
    // ahead of it: swapping now would drop the very change that is queued.
    if (this.#pendingWrites || this.#outbox.hasPending()) return false;
    const stamp = this.#mutations;
    let values;
    try {
      values = await Promise.all([
        KV.settings, KV.companies, KV.contacts, KV.deals, KV.employees, KV.leads,
        KV.payments, KV.companyTeam, KV.salesTeam, KV.dealStageHistory, KV.leadStageHistory,
        KV.activities, KV.tasks, KV.templates, KV.attachments, KV.trash, KV.backup,
      ].map((key) => this.#readRemote(key)));
    } catch {
      // Offline: nothing was read, so nothing is swapped, and what is on
      // screen stays exactly as it is.
      this.#markOffline(true);
      return false;
    }
    this.#markOffline(false);
    const [settings, companies, contacts, deals, employees, leads, payments, companyTeam, salesTeam, dealStageHistory, leadStageHistory, activities, tasks, templates, attachments, trash, backup] = values;
    if (this.#pendingWrites || this.#mutations !== stamp) return false;
    const list = (v) => (Array.isArray(v) ? v : []);
    const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    let changed = false;
    const swap = (name, value) => {
      if (JSON.stringify(this[name]) === JSON.stringify(value)) return;
      this[name] = value;
      changed = true;
    };
    swap('settings', { ...DEFAULT_SETTINGS, ...record(settings) });
    swap('companies', list(companies));
    swap('contacts', list(contacts));
    swap('deals', list(deals));
    swap('employees', list(employees));
    swap('leads', list(leads));
    swap('payments', list(payments));
    swap('companyTeam', list(companyTeam));
    swap('salesTeam', list(salesTeam));
    swap('dealStageHistory', list(dealStageHistory));
    swap('leadStageHistory', list(leadStageHistory));
    swap('activities', list(activities));
    swap('tasks', list(tasks));
    swap('templates', list(templates));
    swap('attachments', list(attachments));
    const rawTrash = list(trash);
    const liveTrash = rawTrash.filter(isLiveTrashEntry);
    swap('trash', liveTrash);
    swap('backup', backup && typeof backup === 'object' ? backup : null);
    await this.#migrateV21({ persist: false });
    if (changed) this.#emit();
    // An entry that aged out between boot and now is dropped here exactly
    // as init drops it - and its stored file has to go with it for the
    // same reason. Without this the 30 days could run out on a tab that
    // was already open: the entry vanished from memory, the next mutation
    // wrote the shortened trash to KV, and the only record of that path
    // went with it, stranding the bytes in FS where nothing could name
    // them again. Run after every swap has landed, so the live manifest
    // and the snapshot both get their say on what stays.
    this.#reclaimFiles(attachmentRecordsOf(rawTrash.filter((e) => !liveTrash.includes(e))));
    return changed;
  }

  /**
   * Attachments whose owner exists neither live nor in the trash belong
   * to a record that is gone for good - drop them, and reclaim the bytes
   * nothing else answers for. While the owner sits in the trash the files
   * wait, so restoring it brings its attachments back intact.
   *
   * The bytes go through #reclaimFiles like every other reclaim, because
   * the safety snapshot can still name the same path: delete the record,
   * empty the trash, and this purge would take the file of an attachment
   * "Restore previous data" was about to bring back - a live row with a
   * broken download and no way to undo it.
   */
  #purgeOrphanAttachments() {
    if (!this.attachments.length) return;
    const owners = new Set();
    for (const list of [this.contacts, this.companies, this.deals]) {
      for (const r of list) owners.add(r.id);
    }
    for (const e of this.trash) if (e.record?.id) owners.add(e.record.id);
    const kept = this.attachments.filter((a) =>
      owners.has(a.contactId) || owners.has(a.companyId) || owners.has(a.dealId));
    if (kept.length === this.attachments.length) return;
    const dropped = this.attachments.filter((a) => !kept.includes(a));
    // Dropped from the manifest first, so the records on their way out
    // cannot vouch for their own files.
    this.attachments = kept;
    this.#reclaimFiles(dropped);
    this.#save(KV.attachments, this.attachments).catch(() => {});
  }

  /**
   * Read a collection: KV when it answers, the durable local copy when it
   * doesn't. A successful read also refreshes that local copy, which is
   * both the offline boot data and the base a queued write is checked
   * against.
   */
  async #read(key) {
    try {
      return await this.#readRemote(key);
    } catch {
      this.#markOffline(true);
      return parseStored(await this.#outbox.localValue(key).catch(() => null));
    }
  }

  /**
   * Strictly KV: throws when it can't be reached, so refresh() can tell a
   * real remote answer from the local copy. Swapping the local copy in
   * would be pointless at best - and at worst it would replace a
   * collection in memory with the empty value of a key never written.
   */
  async #readRemote(key) {
    const raw = await puter.kv.get(key);
    await this.#outbox.mirror(key, raw).catch(() => {});
    return parseStored(raw);
  }

  /** Note that KV is (or isn't) answering, and tell the UI when it changes. */
  #markOffline(offline) {
    if (this.offline.offline === offline) return;
    this.offline = { ...this.offline, offline };
    this.#emitOffline();
  }

  #emitOffline() {
    this.dispatchEvent(new Event('offline'));
  }

  /** Re-read the outbox's own counters and announce them. */
  async #syncOfflineState({ conflicts = null } = {}) {
    const queued = this.#outbox.pendingCount();
    const blocked = conflicts ?? (await this.#outbox.conflicts().catch(() => [])).length;
    if (this.offline.queued === queued && this.offline.conflicts === blocked) return;
    this.offline = { ...this.offline, queued, conflicts: blocked };
    this.#emitOffline();
  }

  /**
   * Persist a collection. The local copy is written first and always, so
   * the record survives a reload whatever the network does; then KV is
   * asked, and a refusal queues the write rather than dropping it.
   *
   * This resolves either way - the data is safe in both cases, and the
   * difference is reported through the `offline` state rather than as a
   * failure the caller has to translate. A genuine programming error still
   * rejects, which is what the forms' catch is for.
   */
  #save(key, value) {
    const prev = this.#writes.get(key) || Promise.resolve();
    // Serialize now: the write carries the state at mutation time even if
    // another mutation lands while an earlier write is still in flight.
    const payload = JSON.stringify(value);
    this.#pendingWrites++;
    const next = prev.catch(() => {}).then(async () => {
      await this.#outbox.stage(key, payload).catch(() => {});
      try {
        await puter.kv.set(key, payload);
      } catch {
        await this.#outbox.queue(key, payload).catch(() => {});
        this.#markOffline(true);
        await this.#syncOfflineState({ conflicts: this.offline.conflicts });
        return;
      }
      await this.#outbox.confirm(key, payload).catch(() => {});
      this.#markOffline(false);
      await this.#syncOfflineState();
    });
    const settle = () => { this.#pendingWrites--; };
    next.then(settle, settle);
    this.#writes.set(key, next);
    return next;
  }

  /**
   * Replay whatever KV hasn't taken. Called at boot, when the browser says
   * it is back online, and from the Settings row. Returns the outbox
   * result so the caller can report conflicts.
   */
  async syncNow() {
    this.#assertWritable();
    const result = await this.#outbox.flush();
    // A conflict is KV answering, not KV missing: the outbox read the
    // remote value and found it moved on. Left out of this, the indicator
    // kept telling a reconnected user they were working offline - the one
    // thing this whole feature exists to be honest about - until some
    // other write happened to land.
    if (result.synced.length || result.conflicts.length) this.#markOffline(false);
    if (result.failed.length) this.#markOffline(true);
    await this.#syncOfflineState({ conflicts: result.conflicts.length });
    // A queued write that landed changes nothing on screen, but a resolved
    // conflict might: re-read once the queue is empty.
    if (result.synced.length && !this.#outbox.hasPending()) await this.refresh().catch(() => {});
    return result;
  }

  /** Settle one conflicted collection: 'mine' or 'theirs'. */
  async resolveConflict(key, choice) {
    this.#assertWritable();
    const done = await this.#outbox.resolve(key, choice);
    // A resolution that landed means KV answered - the indicator should
    // stop saying otherwise.
    if (done) this.#markOffline(false);
    await this.#syncOfflineState();
    if (done && choice === 'theirs') await this.refresh().catch(() => {});
    return done;
  }

  /** What is waiting, for the Settings row. */
  pendingWrites() {
    return this.#outbox.pending();
  }

  #emit() {
    this.#mutations++;
    this.#lastContact = null;
    this.#links = null;
    this.dispatchEvent(new Event('change'));
  }

  /** Memo for lastContact(); dropped on every mutation. */
  #lastContact = null;

  /** Memo for the id and owner lookups below; dropped on every mutation. */
  #links = null;

  /**
   * Records by id, and the deals and people hanging off each owner.
   *
   * These are the lookups the list views make once per row, and a
   * scan-per-row is what turns a search box into contacts times deals of
   * work on every keystroke. Built in one pass per change instead, the
   * same bargain lastContact() strikes.
   */
  #linkIndex() {
    if (!this.#links) {
      const push = (map, key, value) => {
        if (!key) return;
        const list = map.get(key);
        if (list) list.push(value);
        else map.set(key, [value]);
      };
      const idx = {
        contacts: new Map(), companies: new Map(), deals: new Map(),
        dealsByContact: new Map(), dealsByCompany: new Map(), contactsByCompany: new Map(),
      };
      for (const c of this.companies) idx.companies.set(c.id, c);
      for (const c of this.contacts) {
        idx.contacts.set(c.id, c);
        push(idx.contactsByCompany, c.companyId, c);
      }
      for (const d of this.deals) {
        idx.deals.set(d.id, d);
        // Every person on the deal, not only the primary: a lead's page
        // shows the deals they are on, whatever their role.
        for (const contactId of dealContactIds(d)) push(idx.dealsByContact, contactId, d);
        push(idx.dealsByCompany, d.companyId, d);
      }
      this.#links = idx;
    }
    return this.#links;
  }

  /**
   * Newest activity date per contact, company, and deal - built once per
   * change instead of scanned per row, so a list of 200 leads stays one
   * pass over the activities rather than 200.
   */
  lastContact() {
    if (!this.#lastContact) {
      const idx = { contacts: new Map(), companies: new Map(), deals: new Map() };
      const put = (map, id, date) => {
        if (id && date && (!map.has(id) || map.get(id) < date)) map.set(id, date);
      };
      for (const a of this.activities) {
        put(idx.contacts, a.contactId, a.date);
        put(idx.companies, a.companyId, a.date);
        put(idx.deals, a.dealId, a.date);
      }
      this.#lastContact = idx;
    }
    return this.#lastContact;
  }

  /** Last activity date on a contact (ISO), or null. */
  lastContactedAt(contactId) {
    return this.lastContact().contacts.get(contactId) || null;
  }

  /**
   * Last activity date touching a deal: its own history, or any of its
   * people's - a call logged against the champion still moved the deal,
   * and so did one logged against the person who signs.
   */
  lastTouchedDeal(deal) {
    if (!deal) return null;
    const idx = this.lastContact();
    let latest = idx.deals.get(deal.id) || null;
    for (const id of dealContactIds(deal)) {
      const at = idx.contacts.get(id) || null;
      if (at && (!latest || at > latest)) latest = at;
    }
    return latest;
  }

  /** Does this deal have an open follow-up - any next step at all? */
  hasOpenTask(dealId) {
    return this.tasks.some((t) => !t.done && t.dealId === dealId);
  }

  /* ---------- settings ---------- */

  async updateSettings(patch) {
    this.#assertWritable();
    this.settings = { ...this.settings, ...patch };
    this.#emit();
    await this.#save(KV.settings, this.settings);
  }

  /**
   * Replace the configured open stages (null restores the defaults). Deals
   * whose stage no longer exists move to `remap[oldStage]` when that is
   * still a real open stage, else to the first open stage - a removed stage
   * must never leave deals stranded off the board.
   *
   * A removed stage also takes its win-probability override with it. The
   * override is keyed by stage id, and Settings mints the same "new-stage"
   * id for every stage the Add button creates - so a stage set to 90% and
   * then removed handed its 90% to the next one added, which arrived
   * labelled "New stage" and quietly weighted every deal in it at the
   * setting of a stage that no longer exists.
   */
  async setStages(list, remap = {}) {
    this.#assertWritable();
    const settings = { ...this.settings, stages: list };
    const stages = resolveStages(settings);
    const ids = new Set(stages.map((s) => s.id));
    settings.stageProbabilities = Object.fromEntries(
      Object.entries(this.settings.stageProbabilities || {}).filter(([id]) => ids.has(id)));
    const openIds = new Set(stages.filter((s) => !isTerminalStage(s.id)).map((s) => s.id));
    const fallback = firstStageId(stages);
    const moved = [];
    for (const d of this.deals) {
      if (ids.has(d.stage)) continue;
      const target = remap[d.stage];
      const fromStage = d.stage;
      d.stage = openIds.has(target) ? target : fallback;
      d.updatedAt = Date.now();
      recordStageEntry(d, d.stage, d.updatedAt, fromStage);
      this.dealStageHistory.push(newStageEntry('dealId', d.id, fromStage, d.stage, d.updatedAt));
      moved.push(d);
    }
    this.settings = settings;
    this.#emit();
    const writes = [this.#save(KV.settings, this.settings)];
    if (moved.length) {
      writes.push(this.#save(KV.deals, this.deals));
      writes.push(this.#save(KV.dealStageHistory, this.dealStageHistory));
    }
    await Promise.all(writes);
    return moved.length;
  }

  /* ---------- custom fields ----------
     Definitions in settings, values on the records. The memo is the same
     bargain stages() strikes: list views ask for these once per row. */

  #fieldCache = { key: undefined, value: null };

  /** Every configured field list, shaped: { contacts, companies, deals }. */
  customFieldsAll() {
    if (this.#fieldCache.key !== this.settings.customFields) {
      this.#fieldCache = {
        key: this.settings.customFields,
        value: normalizeCustomFields(this.settings.customFields),
      };
    }
    return this.#fieldCache.value;
  }

  /** Fields for one record type; [] for a type that can't carry them. */
  customFields(kind) {
    return this.customFieldsAll()[kind] || [];
  }

  /**
   * Replace the field definitions for one record type.
   *
   * Removing a field takes its stored values with it - that is what the
   * confirmation in Settings is about. Changing a type converts what is
   * already stored, and refuses (throwing `custom-field-type`) when even
   * one value can't be read as the new type: dropping a value the user
   * typed is the one thing this must never do quietly.
   *
   * Returns { removed, converted } - how many values went, how many moved.
   */
  async setCustomFields(kind, list) {
    this.#assertWritable();
    if (!isCustomKind(kind)) return { removed: 0, converted: 0 };
    const before = customFieldsOf(this.settings, kind);
    const next = normalizeFieldList(list);
    const records = this[kind];
    const removedIds = before.filter((f) => !next.some((n) => n.id === f.id)).map((f) => f.id);
    const retyped = next
      .map((f) => ({ field: f, from: before.find((b) => b.id === f.id) }))
      .filter((r) => r.from && r.from.type !== r.field.type);

    for (const { field } of retyped) {
      if (retypeReport(records, field, field.type).blocked.length) {
        throw new Error('custom-field-type');
      }
    }

    let removed = 0;
    let converted = 0;
    for (const record of records) {
      if (removedIds.length && dropFieldValues(record, removedIds)) removed++;
      for (const { field } of retyped) {
        const raw = record.custom?.[field.id];
        if (raw === null || raw === undefined || raw === '') continue;
        const value = coerceFieldValue(field, raw);
        if (value === null) delete record.custom[field.id];
        else record.custom[field.id] = value;
        converted++;
      }
    }

    const all = { ...this.customFieldsAll(), [kind]: next };
    this.settings = { ...this.settings, customFields: all };
    this.#emit();
    const writes = [this.#save(KV.settings, this.settings)];
    if (removed || converted) writes.push(this.#save(KV_BY_KIND[kind], records));
    await Promise.all(writes);
    return { removed, converted };
  }

  /* ---------- companies ---------- */

  async addCompany(data) {
    this.#assertWritable();
    const company = {
      id: uid(), name: '', industry: '', website: '', size: '', notes: '',
      tags: [], custom: {}, createdAt: Date.now(), ...data,
    };
    company.custom = normalizeCustomValues(company.custom);
    Object.assign(company, normalizeCompany(company));
    this.companies.push(company);
    this.#emit();
    await this.#save(KV.companies, this.companies);
    return company;
  }

  async updateCompany(id, patch) {
    this.#assertWritable();
    const company = this.companyById(id);
    if (!company) return null;
    Object.assign(company, patch);
    Object.assign(company, normalizeCompany(company));
    this.#emit();
    await this.#save(KV.companies, this.companies);
    return company;
  }

  /**
   * Removing a company detaches it everywhere; people, deals, and history
   * stay. Returns the trash entry so the caller can offer Undo.
   */
  async deleteCompany(id) {
    this.#assertWritable();
    const company = this.companyById(id);
    if (!company) return null;
    const refs = {
      contacts: this.contacts.filter((r) => r.companyId === id).map((r) => r.id),
      childCompanies: this.companies.filter((r) => r.parentCompanyId === id).map((r) => r.id),
      deals: this.deals.filter((r) => r.companyId === id).map((r) => r.id),
      partnerDeals: this.deals.filter((r) => r.partnerId === id).map((r) => r.id),
      competitorDeals: this.deals.filter((r) => r.competitorIds?.includes(id)).map((r) => r.id),
      leads: this.leads.filter((r) => r.companyId === id).map((r) => r.id),
      partnerLeads: this.leads.filter((r) => r.partnerId === id).map((r) => r.id),
      activities: this.activities.filter((r) => r.companyId === id).map((r) => r.id),
      tasks: this.tasks.filter((r) => r.companyId === id).map((r) => r.id),
      companyTeam: this.companyTeam.filter((r) => r.companyId === id),
    };
    this.companies = this.companies.filter((r) => r.id !== id);
    for (const row of this.companies) if (row.parentCompanyId === id) row.parentCompanyId = null;
    for (const row of this.contacts) if (row.companyId === id) row.companyId = null;
    for (const row of this.deals) {
      if (row.companyId === id) row.companyId = null;
      if (row.partnerId === id) row.partnerId = null;
      if (row.competitorIds?.includes(id)) row.competitorIds = row.competitorIds.filter((x) => x !== id);
    }
    for (const row of this.leads) {
      if (row.companyId === id) row.companyId = null;
      if (row.partnerId === id) row.partnerId = null;
    }
    for (const row of this.activities) if (row.companyId === id) row.companyId = null;
    for (const row of this.tasks) if (row.companyId === id) row.companyId = null;
    this.companyTeam = this.companyTeam.filter((r) => r.companyId !== id);
    const entry = this.#toTrash('company', company, refs);
    this.#emit();
    await Promise.all([
      this.#save(KV.companies, this.companies), this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals), this.#save(KV.leads, this.leads),
      this.#save(KV.companyTeam, this.companyTeam), this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks), this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  companyById(id) {
    return (id && this.#linkIndex().companies.get(id)) || null;
  }

  /* ---------- contacts ---------- */

  async addContact(data) {
    this.#assertWritable();
    const contact = {
      id: uid(), name: '', title: '', email: '', phone: '', companyId: null,
      source: '', status: 'lead', notes: '', tags: [], custom: {},
      createdAt: Date.now(), ...data,
    };
    contact.custom = normalizeCustomValues(contact.custom);
    Object.assign(contact, normalizeContact(contact));
    this.contacts.push(contact);
    this.#emit();
    await this.#save(KV.contacts, this.contacts);
    return contact;
  }

  async updateContact(id, patch) {
    this.#assertWritable();
    const contact = this.contactById(id);
    if (!contact) return null;
    Object.assign(contact, patch);
    Object.assign(contact, normalizeContact(contact));
    this.#emit();
    await this.#save(KV.contacts, this.contacts);
    return contact;
  }

  /** Deals and history survive a deleted contact - money and record-keeping outlive people churn. */
  async deleteContact(id) {
    this.#assertWritable();
    const contact = this.contactById(id);
    if (!contact) return null;
    const refs = {
      deals: this.deals.filter((r) => dealContactIds(r).includes(id)).map((r) => r.id),
      economicBuyerDeals: this.deals.filter((r) => r.economicBuyerContactId === id).map((r) => r.id),
      championDeals: this.deals.filter((r) => r.championContactId === id).map((r) => r.id),
      leads: this.leads.filter((r) => r.contactId === id).map((r) => r.id),
      activities: this.activities.filter((r) => r.contactId === id).map((r) => r.id),
      tasks: this.tasks.filter((r) => r.contactId === id).map((r) => r.id),
      companyTeam: this.companyTeam.filter((r) => r.contactId === id),
    };
    this.contacts = this.contacts.filter((r) => r.id !== id);
    for (const row of this.deals) {
      detachDealContact(row, id);
      if (row.economicBuyerContactId === id) row.economicBuyerContactId = null;
      if (row.championContactId === id) row.championContactId = null;
    }
    for (const row of this.leads) if (row.contactId === id) row.contactId = null;
    for (const row of this.activities) if (row.contactId === id) row.contactId = null;
    for (const row of this.tasks) if (row.contactId === id) row.contactId = null;
    this.companyTeam = this.companyTeam.filter((r) => r.contactId !== id);
    const entry = this.#toTrash('contact', contact, refs);
    this.#emit();
    await Promise.all([
      this.#save(KV.contacts, this.contacts), this.#save(KV.deals, this.deals),
      this.#save(KV.leads, this.leads), this.#save(KV.companyTeam, this.companyTeam),
      this.#save(KV.activities, this.activities), this.#save(KV.tasks, this.tasks),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  contactById(id) {
    return (id && this.#linkIndex().contacts.get(id)) || null;
  }

  /** A fresh array each time: callers sort and filter what they are given. */
  contactsOf(companyId) {
    return [...(this.#linkIndex().contactsByCompany.get(companyId) || [])];
  }

  /* ---------- employees ---------- */

  employeeById(id) { return this.employees.find((e) => e.id === id) || null; }

  currentEmployee() {
    const username = this.user?.username;
    return this.employees.find((e) => e.username === username || e.name === username) || null;
  }

  async addEmployee(data) {
    this.#assertWritable();
    const employee = normalizeEmployee({ id: uid(), createdAt: Date.now(), ...data });
    this.employees.push(employee);
    this.#emit();
    await this.#save(KV.employees, this.employees);
    return employee;
  }

  async updateEmployee(id, patch) {
    this.#assertWritable();
    const employee = this.employeeById(id);
    if (!employee) return null;
    Object.assign(employee, patch);
    this.#emit();
    await this.#save(KV.employees, this.employees);
    return employee;
  }

  async deleteEmployee(id) {
    this.#assertWritable();
    const employee = this.employeeById(id);
    if (!employee) return null;
    this.employees = this.employees.filter((e) => e.id !== id);
    for (const lead of this.leads) if (lead.employeeId === id) lead.employeeId = null;
    for (const task of this.tasks) if (task.employeeId === id) task.employeeId = null;
    for (const activity of this.activities) if (activity.employeeId === id) activity.employeeId = null;
    this.salesTeam = this.salesTeam.filter((r) => r.employeeId !== id);
    this.salesTeam = normalizeSalesTeam(this.salesTeam);
    this.#emit();
    await Promise.all([
      this.#save(KV.employees, this.employees), this.#save(KV.leads, this.leads),
      this.#save(KV.tasks, this.tasks), this.#save(KV.activities, this.activities),
      this.#save(KV.salesTeam, this.salesTeam),
    ]);
    return employee;
  }

  /* ---------- leads L0–L5 ---------- */

  leadById(id) { return this.leads.find((l) => l.id === id) || null; }
  leadsFor({ companyId = null, contactId = null, employeeId = null } = {}) {
    return this.leads.filter((l) => (!companyId || l.companyId === companyId)
      && (!contactId || l.contactId === contactId) && (!employeeId || l.employeeId === employeeId));
  }

  async addLead(data) {
    this.#assertWritable();
    const now = Date.now();
    const lead = normalizeLead({ id: uid(), createdAt: now, updatedAt: now, ...data });
    this.leads.push(lead);
    this.leadStageHistory.push(newStageEntry('leadId', lead.id, '', lead.stage, lead.createdAt));
    this.#emit();
    await Promise.all([this.#save(KV.leads, this.leads), this.#save(KV.leadStageHistory, this.leadStageHistory)]);
    return lead;
  }

  async updateLead(id, patch) {
    this.#assertWritable();
    const lead = this.leadById(id);
    if (!lead) return null;
    if (lead.status === 'Дисквалифицирован' && patch.status && patch.status !== 'Дисквалифицирован') {
      throw new Error('Дисквалифицированный лид нельзя открыть повторно. Создайте новый лид.');
    }
    const fromStage = lead.stage;
    const fromStatus = lead.status;
    Object.assign(lead, patch, { updatedAt: Date.now() });
    lead.stage = canonicalLeadStage(lead.stage);
    let stageChanged = false;
    if (lead.stage !== fromStage) {
      this.leadStageHistory.push(newStageEntry('leadId', id, fromStage, lead.stage, lead.updatedAt));
      stageChanged = true;
    }
    if (['Дисквалифицирован', 'Закрыт'].includes(lead.status) && lead.status !== fromStatus) lead.closedAt = Date.now();
    if (!['Дисквалифицирован', 'Закрыт'].includes(lead.status)) lead.closedAt = null;
    this.#emit();
    const writes = [this.#save(KV.leads, this.leads)];
    if (stageChanged) writes.push(this.#save(KV.leadStageHistory, this.leadStageHistory));
    await Promise.all(writes);
    return lead;
  }

  moveLead(id, stage) { return this.updateLead(id, { stage }); }

  async convertLeadToDeal(id, overrides = {}) {
    this.#assertWritable();
    const lead = this.leadById(id);
    if (!lead) throw new Error('Лид не найден');
    if (lead.convertedDealId || this.deals.some((d) => d.sourceLeadId === id)) {
      throw new Error('Этот лид уже переведён в сделку');
    }
    if (lead.status !== 'Квалифицирован') throw new Error('В сделку можно перевести только квалифицированный лид');
    const deal = await this.addDeal({
      name: lead.name, product: lead.product, subproduct: lead.subproduct,
      contactId: lead.contactId, contacts: lead.contactId ? [{ contactId: lead.contactId, role: '', influence: '' }] : [],
      partnerId: lead.partnerId, companyId: lead.companyId, sourceLeadId: id,
      ...overrides,
    });
    lead.convertedDealId = deal.id;
    lead.status = 'Закрыт';
    lead.closedAt = Date.now();
    lead.updatedAt = Date.now();
    this.#emit();
    await this.#save(KV.leads, this.leads);
    return deal;
  }

  async deleteLead(id) {
    this.#assertWritable();
    const lead = this.leadById(id);
    if (!lead) return null;
    this.leads = this.leads.filter((l) => l.id !== id);
    for (const task of this.tasks) if (task.leadId === id) task.leadId = null;
    for (const activity of this.activities) if (activity.leadId === id) activity.leadId = null;
    this.#emit();
    await Promise.all([this.#save(KV.leads, this.leads), this.#save(KV.tasks, this.tasks), this.#save(KV.activities, this.activities)]);
    return lead;
  }

  leadStageHistoryFor(id) {
    return this.leadStageHistory.filter((h) => h.leadId === id).sort((a, b) => a.at - b.at);
  }

  /* ---------- deals ---------- */

  async addDeal(data) {
    this.#assertWritable();
    const now = Date.now();
    let deal = {
      id: uid(), name: '', value: 0, stage: this.firstStage(), status: 'Новая', outcome: '',
      contactId: null, companyId: null, expectedClose: null, notes: '', tags: [],
      closeReason: '', closeReasonNote: '', confidence: null,
      billing: 'one-time', term: null, custom: {}, contacts: [], qualification: normalizeQualification(),
      createdAt: now, updatedAt: now, closedAt: null, ...data,
    };
    deal = normalizeDeal(deal, this.#dealStageContext());
    this.deals.push(deal);
    this.dealStageHistory.push(newStageEntry('dealId', deal.id, '', deal.stage, deal.createdAt));
    // Compatibility for old imports: a legacy amount is still a real payment.
    this.payments = migratePayments([deal], this.payments);
    this.#syncDealTotals();
    this.#emit();
    await Promise.all([
      this.#save(KV.deals, this.deals), this.#save(KV.payments, this.payments),
      this.#save(KV.dealStageHistory, this.dealStageHistory),
    ]);
    return deal;
  }

  async updateDeal(id, patch) {
    this.#assertWritable();
    const deal = this.dealById(id);
    if (!deal) return null;
    // Old embeds and integrations may still send terminal stage ids.
    if (patch.stage === 'won') patch = { ...patch, stage: 's8', outcome: 'Выиграна' };
    if (patch.stage === 'lost') patch = { ...patch, stage: deal.stage, outcome: 'Проиграна' };
    if (patch.stage && !['won', 'lost'].includes(patch.stage)) {
      patch = { ...patch, stage: canonicalDealStage(patch.stage) || deal.stage };
    }
    const requestedOutcome = patch.outcome !== undefined ? patch.outcome : deal.outcome;
    const requestedWinner = patch.winner !== undefined ? patch.winner : deal.winner;
    if (requestedOutcome === 'Проиграна' && (patch.outcome !== undefined || patch.stage === 'lost')
        && !str(requestedWinner).trim()) {
      throw new Error('При проигрыше обязательно укажите, кто выиграл');
    }
    const fromStage = deal.stage;
    const fromOutcome = deal.outcome || '';
    const beforeContacts = deal.contacts;
    Object.assign(deal, patch, { updatedAt: Date.now() });
    if (deal.outcome === 'Выиграна' && !fromOutcome && !['s8', 's9', 's10'].includes(deal.stage)) deal.stage = 's8';
    deal.custom = normalizeCustomValues(deal.custom);
    deal.qualification = normalizeQualification(deal.qualification);
    settleDealContacts(deal, patch, beforeContacts);
    settleBilling(deal);
    let stageChanged = false;
    if (deal.stage !== fromStage) {
      recordStageEntry(deal, deal.stage, deal.updatedAt, fromStage);
      this.dealStageHistory.push(newStageEntry('dealId', id, fromStage, deal.stage, deal.updatedAt));
      stageChanged = true;
    }
    const isClosed = !!deal.outcome;
    if (isClosed && deal.outcome !== fromOutcome) deal.closedAt = num(patch.closedAt, deal.updatedAt);
    if (!isClosed) clearCloseRecord(deal);
    if (isClosed) deal.confidence = null;
    if (deal.outcome !== 'Проиграна') deal.winner = '';
    // Amount is always derived from the payment register.
    deal.value = dealTotals(id, this.payments).total;
    this.#emit();
    const writes = [this.#save(KV.deals, this.deals)];
    if (stageChanged) writes.push(this.#save(KV.dealStageHistory, this.dealStageHistory));
    await Promise.all(writes);
    return deal;
  }

  /** Board moves reopen a closed deal; closing itself is an independent outcome. */
  moveDeal(id, stage) {
    return this.updateDeal(id, ['won', 'lost'].includes(stage) ? { stage } : { stage, outcome: '' });
  }

  async deleteDeal(id) {
    this.#assertWritable();
    const deal = this.dealById(id);
    if (!deal) return null;
    const refs = {
      activities: this.activities.filter((r) => r.dealId === id).map((r) => r.id),
      tasks: this.tasks.filter((r) => r.dealId === id).map((r) => r.id),
      payments: this.payments.filter((r) => r.dealId === id),
      salesTeam: this.salesTeam.filter((r) => r.dealId === id),
    };
    this.deals = this.deals.filter((r) => r.id !== id);
    this.payments = this.payments.filter((r) => r.dealId !== id);
    this.salesTeam = this.salesTeam.filter((r) => r.dealId !== id);
    for (const row of this.activities) if (row.dealId === id) row.dealId = null;
    for (const row of this.tasks) if (row.dealId === id) row.dealId = null;
    const entry = this.#toTrash('deal', deal, refs);
    this.#emit();
    await Promise.all([
      this.#save(KV.deals, this.deals), this.#save(KV.payments, this.payments),
      this.#save(KV.salesTeam, this.salesTeam), this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks), this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  dealById(id) {
    return (id && this.#linkIndex().deals.get(id)) || null;
  }

  /** Deals linked to a contact, a company, or either. */
  dealsFor({ contactId, companyId } = {}) {
    const idx = this.#linkIndex();
    if (contactId && !companyId) return [...(idx.dealsByContact.get(contactId) || [])];
    if (companyId && !contactId) return [...(idx.dealsByCompany.get(companyId) || [])];
    if (!contactId && !companyId) return [];
    return this.deals.filter((d) => dealContactIds(d).includes(contactId) || d.companyId === companyId);
  }

  dealStageHistoryFor(id) {
    return this.dealStageHistory.filter((h) => h.dealId === id).sort((a, b) => a.at - b.at);
  }

  /* ---------- payments and teams ---------- */

  paymentsFor(dealId) { return this.payments.filter((p) => p.dealId === dealId); }

  async addPayment(data) {
    this.#assertWritable();
    if (!this.dealById(data.dealId)) throw new Error('Сделка для платежа не найдена');
    const payment = { ...data, id: uid(), createdAt: Date.now() };
    const row = normalizePayment(payment);
    this.payments.push(row);
    this.#syncDealTotals();
    this.#emit();
    await Promise.all([this.#save(KV.payments, this.payments), this.#save(KV.deals, this.deals)]);
    return row;
  }

  async updatePayment(id, patch) {
    this.#assertWritable();
    const payment = this.payments.find((p) => p.id === id);
    if (!payment) return null;
    if (patch.dealId && !this.dealById(patch.dealId)) throw new Error('Сделка для платежа не найдена');
    Object.assign(payment, patch);
    Object.assign(payment, normalizePayment(payment));
    this.#syncDealTotals();
    this.#emit();
    await Promise.all([this.#save(KV.payments, this.payments), this.#save(KV.deals, this.deals)]);
    return payment;
  }

  async deletePayment(id) {
    this.#assertWritable();
    const payment = this.payments.find((p) => p.id === id);
    if (!payment) return null;
    this.payments = this.payments.filter((p) => p.id !== id);
    this.#syncDealTotals();
    this.#emit();
    await Promise.all([this.#save(KV.payments, this.payments), this.#save(KV.deals, this.deals)]);
    return payment;
  }

  companyTeamFor(companyId) { return this.companyTeam.filter((r) => r.companyId === companyId); }

  async setCompanyTeam(companyId, rows) {
    this.#assertWritable();
    const kept = this.companyTeam.filter((r) => r.companyId !== companyId);
    const next = rows.map((r) => normalizeCompanyTeam({ ...r, id: r.id || uid(), companyId, createdAt: r.createdAt || Date.now() }));
    this.companyTeam = [...kept, ...next];
    this.#emit();
    await this.#save(KV.companyTeam, this.companyTeam);
    return next;
  }

  salesTeamFor(dealId) { return this.salesTeam.filter((r) => r.dealId === dealId); }

  async setSalesTeam(dealId, rows) {
    this.#assertWritable();
    const kept = this.salesTeam.filter((r) => r.dealId !== dealId);
    const next = normalizeSalesTeam(rows.filter((r) => !r.dealId || r.dealId === dealId)
      .map((r) => ({ ...r, id: r.id || uid(), dealId, createdAt: r.createdAt || Date.now() })), dealId);
    this.salesTeam = [...kept, ...next];
    this.#emit();
    await this.#save(KV.salesTeam, this.salesTeam);
    return next;
  }

  async updateDictionary(key, values) {
    this.#assertWritable();
    if (!(key in DEFAULT_DICTIONARIES) || !Array.isArray(values)) throw new Error('Неизвестный справочник');
    this.settings.dictionaries = { ...this.settings.dictionaries, [key]: values };
    this.#emit();
    await this.#save(KV.settings, this.settings);
    return this.settings.dictionaries[key];
  }

  lastDealEvent(dealId) {
    return this.activities.filter((a) => a.dealId === dealId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0] || null;
  }

  /* ---------- activities (meetings, calls, emails, notes) ---------- */

  async addActivity(data) {
    this.#assertWritable();
    if (data.date && data.date > todayISO()) throw new Error('Событие не может быть датировано будущим');
    const activity = {
      id: uid(), type: 'note', date: todayISO(), summary: '', notes: '',
      contactId: null, companyId: null, dealId: null, leadId: null,
      employeeId: this.currentEmployee()?.id || null, createdAt: Date.now(), ...data,
    };
    Object.assign(activity, normalizeActivity(activity));
    this.activities.push(activity);
    this.#emit();
    await this.#save(KV.activities, this.activities);
    return activity;
  }

  async updateActivity(id, patch) {
    this.#assertWritable();
    const activity = this.activities.find((a) => a.id === id);
    if (!activity) return null;
    const nextDate = patch.date || activity.date;
    if (nextDate > todayISO()) throw new Error('Событие не может быть датировано будущим');
    Object.assign(activity, patch);
    Object.assign(activity, normalizeActivity(activity));
    this.#emit();
    await this.#save(KV.activities, this.activities);
    return activity;
  }

  async deleteActivity(id) {
    this.#assertWritable();
    const activity = this.activities.find((a) => a.id === id);
    if (!activity) return null;
    this.activities = this.activities.filter((a) => a.id !== id);
    const entry = this.#toTrash('activity', activity);
    this.#emit();
    await Promise.all([
      this.#save(KV.activities, this.activities),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /** History for an entity, newest first (by activity date, then created order). */
  activitiesFor({ contactId, companyId, dealId, leadId, employeeId } = {}) {
    return this.activities
      .filter((a) =>
        (contactId && a.contactId === contactId) ||
        (companyId && a.companyId === companyId) ||
        (dealId && a.dealId === dealId) ||
        (leadId && a.leadId === leadId) || (employeeId && a.employeeId === employeeId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  /**
   * Everything on a deal's timeline: activity logged against the deal, plus
   * activity logged against one of its people that isn't already filed
   * under another deal. A call with the champion belongs on the deal they
   * champion; one they had about a different deal belongs on that one.
   */
  dealActivities(deal) {
    if (!deal) return [];
    const people = new Set(dealContactIds(deal));
    return this.activities
      .filter((a) => a.dealId === deal.id || (!a.dealId && people.has(a.contactId)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  recentActivities(limit = 8) {
    return [...this.activities]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /* ---------- tasks (follow-ups) ---------- */

  async addTask(data) {
    this.#assertWritable();
    const task = {
      id: uid(), title: '', due: todayISO(), dueTime: '', done: false, doneAt: null,
      contactId: null, dealId: null, companyId: null, leadId: null,
      employeeId: this.currentEmployee()?.id || null, startDate: todayISO(), status: 'К выполнению',
      templateId: null, repeat: null, spawnedId: null,
      createdAt: Date.now(), ...data,
    };
    Object.assign(task, normalizeTaskLinks(task));
    this.tasks.push(task);
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return task;
  }

  async updateTask(id, patch) {
    this.#assertWritable();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    Object.assign(task, patch);
    if ('status' in patch && !('done' in patch)) task.done = task.status === 'Выполнено';
    if ('done' in patch && !('status' in patch)) task.status = task.done ? 'Выполнено' : 'К выполнению';
    Object.assign(task, normalizeTaskLinks(task));
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return task;
  }

  /**
   * Check a follow-up off (or back on). Completing a repeating one mints
   * the next occurrence - due the interval from today, not from the old
   * due date, so an overdue "every 30 days" doesn't come back already
   * late. Unchecking within the same session takes the minted occurrence
   * back with it, as long as it hasn't been completed itself.
   */
  async toggleTask(id, done) {
    this.#assertWritable();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    if (done && !task.done && task.repeat) {
      const next = {
        id: uid(), title: task.title,
        due: nextRepeatDue(todayISO(), task.repeat), dueTime: task.dueTime,
        done: false, doneAt: null, status: 'К выполнению', contactId: task.contactId, dealId: task.dealId,
        companyId: task.companyId, leadId: task.leadId, employeeId: task.employeeId, startDate: todayISO(),
        // The email this step stands for is part of the cadence, not part
        // of one occurrence of it: a monthly "send the check-in" that lost
        // its template on the first tick offered the Email button once and
        // never again.
        templateId: task.templateId || null,
        repeat: task.repeat, spawnedId: null, createdAt: Date.now(),
      };
      this.tasks.push(next);
      task.spawnedId = next.id;
    } else if (!done && task.done && task.spawnedId) {
      const spawned = this.tasks.find((t) => t.id === task.spawnedId);
      if (spawned && !spawned.done) this.tasks = this.tasks.filter((t) => t.id !== spawned.id);
      task.spawnedId = null;
    }
    task.done = done;
    task.status = done ? 'Выполнено' : 'К выполнению';
    task.doneAt = done ? Date.now() : null;
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return task;
  }

  async deleteTask(id) {
    this.#assertWritable();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    const entry = this.#toTrash('task', task);
    this.#emit();
    await Promise.all([
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /** Open follow-ups, soonest due first (timed ones ahead of "sometime today"). */
  openTasks() {
    return this.tasks.filter((t) => !t.done).sort(byDue);
  }

  tasksFor({ contactId, dealId, companyId, leadId, employeeId } = {}) {
    return this.tasks
      .filter((t) => (contactId && t.contactId === contactId) || (dealId && t.dealId === dealId)
        || (companyId && t.companyId === companyId) || (leadId && t.leadId === leadId)
        || (employeeId && t.employeeId === employeeId))
      .sort((a, b) => Number(a.done) - Number(b.done) || byDue(a, b));
  }

  /* ---------- saved views ----------
     Filter sets per list, kept in settings. The list views own the
     filters; this only stores and orders them. */

  views(kind) {
    return normalizeViews(this.settings.views)[kind] || [];
  }

  /** Replace one list's views (capped and normalized on the way in). */
  async setViews(kind, list) {
    this.#assertWritable();
    const all = { ...normalizeViews(this.settings.views) };
    if (!(kind in all)) return [];
    all[kind] = normalizeViewList(kind, list).slice(0, MAX_VIEWS);
    this.settings = { ...this.settings, views: all };
    this.#emit();
    await this.#save(KV.settings, this.settings);
    return all[kind];
  }

  /* ---------- playbooks ----------
     Definitions in settings; applying one writes plain follow-ups. */

  playbooks() {
    return normalizePlaybooks(this.settings.playbooks);
  }

  /** Replace the saved playbooks. */
  async setPlaybooks(list) {
    this.#assertWritable();
    this.settings = { ...this.settings, playbooks: normalizePlaybooks(list) };
    this.#emit();
    await this.#save(KV.settings, this.settings);
    return this.playbooks();
  }

  /**
   * Apply a playbook to a lead or a deal: every step becomes a follow-up,
   * dated from `from`, in one write and one emit - so the whole thing is
   * one Undo rather than five toasts. Returns the tasks created.
   */
  async applyPlaybook(playbook, { contactId = null, dealId = null, from = todayISO() } = {}) {
    this.#assertWritable();
    const now = Date.now();
    const created = playbookTasks(playbook, from).map((step) => normalizeTask({
      id: uid(), title: step.title, due: step.due, done: false, doneAt: null,
      contactId, dealId, templateId: step.templateId || null, createdAt: now,
    }));
    if (!created.length) return [];
    this.tasks.push(...created);
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return created;
  }

  /**
   * Take back a batch of follow-ups that were just created - the Undo for
   * applying a playbook. Deliberately not the trash: these records are
   * seconds old and were never worked, so filing five of them under
   * Recently deleted would bury the deletes that matter.
   */
  async undoAddedTasks(ids) {
    this.#assertWritable();
    const wanted = new Set(ids);
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !wanted.has(t.id));
    if (this.tasks.length === before) return 0;
    this.#emit();
    await this.#save(KV.tasks, this.tasks);
    return before - this.tasks.length;
  }

  /* ---------- email templates ---------- */

  async addTemplate(data) {
    this.#assertWritable();
    const template = {
      id: uid(), name: '', subject: '', body: '', createdAt: Date.now(), ...data,
    };
    this.templates.push(template);
    this.#emit();
    await this.#save(KV.templates, this.templates);
    return template;
  }

  async updateTemplate(id, patch) {
    this.#assertWritable();
    const template = this.templates.find((t) => t.id === id);
    if (!template) return null;
    Object.assign(template, patch);
    this.#emit();
    await this.#save(KV.templates, this.templates);
    return template;
  }

  async deleteTemplate(id) {
    this.#assertWritable();
    const template = this.templates.find((t) => t.id === id);
    if (!template) return null;
    this.templates = this.templates.filter((t) => t.id !== id);
    const entry = this.#toTrash('template', template);
    this.#emit();
    await Promise.all([
      this.#save(KV.templates, this.templates),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  templateById(id) {
    return this.templates.find((t) => t.id === id) || null;
  }

  /* ---------- attachments ----------
     Metadata only; lib/files.js owns the bytes. Deleting one is a trash
     entry like any other - the stored file is reclaimed when the entry
     expires, overflows, or the trash is emptied, never before. */

  async addAttachment(data) {
    this.#assertWritable();
    const attachment = normalizeAttachment({ id: uid(), uploadedAt: Date.now(), ...data });
    this.attachments.push(attachment);
    this.#emit();
    await this.#save(KV.attachments, this.attachments);
    return attachment;
  }

  async deleteAttachment(id) {
    this.#assertWritable();
    const attachment = this.attachments.find((a) => a.id === id);
    if (!attachment) return null;
    this.attachments = this.attachments.filter((a) => a.id !== id);
    const entry = this.#toTrash('attachment', attachment);
    this.#emit();
    await Promise.all([
      this.#save(KV.attachments, this.attachments),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /** Files on one record, newest first. */
  attachmentsFor({ contactId, companyId, dealId, leadId, employeeId } = {}) {
    return this.attachments
      .filter((a) =>
        (contactId && a.contactId === contactId) ||
        (companyId && a.companyId === companyId) ||
        (dealId && a.dealId === dealId) ||
        (leadId && a.leadId === leadId) || (employeeId && a.employeeId === employeeId))
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  /* ---------- bulk operations ----------
     One pass, one emit, one KV write per touched collection - a hundred
     status changes must not mean a hundred round trips. Deletes reuse the
     trash exactly like single deletes: one entry per record, links
     detached, everything restorable (up to TRASH_MAX entries). */

  /** Apply `patch` to every listed contact. Returns how many changed. */
  async bulkUpdateContacts(ids, patch) {
    this.#assertWritable();
    const wanted = new Set(ids);
    let n = 0;
    for (const c of this.contacts) {
      if (!wanted.has(c.id)) continue;
      Object.assign(c, patch);
      n++;
    }
    if (!n) return 0;
    this.#emit();
    await this.#save(KV.contacts, this.contacts);
    return n;
  }

  /** Add one tag to every listed record of a collection. */
  async bulkTag(kind, ids, tag) {
    this.#assertWritable();
    const byKind = {
      contacts: [this.contacts, KV.contacts],
      companies: [this.companies, KV.companies],
      deals: [this.deals, KV.deals],
    };
    const [list, key] = byKind[kind] || [];
    const clean = cleanTag(tag);
    if (!list || !clean) return 0;
    const wanted = new Set(ids);
    let n = 0;
    for (const r of list) {
      if (!wanted.has(r.id)) continue;
      r.tags = normalizeTags([...(r.tags || []), clean]);
      n++;
    }
    if (!n) return 0;
    this.#emit();
    await this.#save(key, list);
    return n;
  }

  /** Move every listed deal and preserve every transition in the system journal. */
  async bulkMoveDeals(ids, stage) {
    this.#assertWritable();
    const wanted = new Set(ids);
    const now = Date.now();
    let n = 0;
    for (const d of this.deals) {
      if (!wanted.has(d.id)) continue;
      const fromStage = d.stage;
      const fromOutcome = d.outcome || '';
      const target = stage === 'won' ? 's8' : stage === 'lost' ? fromStage : canonicalDealStage(stage);
      if (!target) continue;
      const outcome = stage === 'won' ? 'Выиграна' : stage === 'lost' ? 'Проиграна' : '';
      if (fromStage === target && fromOutcome === outcome) continue;
      d.stage = target;
      d.outcome = outcome;
      d.updatedAt = now;
      if (fromStage !== target) {
        recordStageEntry(d, target, now, fromStage);
        this.dealStageHistory.push(newStageEntry('dealId', d.id, fromStage, target, now));
      }
      if (outcome && outcome !== fromOutcome) d.closedAt = now;
      if (!outcome) clearCloseRecord(d);
      if (outcome) d.confidence = null;
      if (outcome !== 'Проиграна') d.winner = '';
      n++;
    }
    if (!n) return 0;
    this.#emit();
    await Promise.all([
      this.#save(KV.deals, this.deals),
      this.#save(KV.dealStageHistory, this.dealStageHistory),
    ]);
    return n;
  }

  /**
   * Delete every listed record of one kind ('contacts' | 'companies' |
   * 'deals') through the trash - one restorable entry each, links
   * detached the same way the single deletes do. Returns entries created.
   */
  async bulkDelete(kind, ids) {
    this.#assertWritable();
    const method = { contacts: 'deleteContact', companies: 'deleteCompany', deals: 'deleteDeal' }[kind];
    if (!method) return [];
    const entries = [];
    for (const id of new Set(ids)) {
      const entry = await this[method](id);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /* ---------- merge (duplicates) ----------
     Two records that are the same real-world thing become one: the
     survivor keeps its id (so nothing pointing at it moves), takes the
     chosen field values plus both tag sets, and every deal, activity,
     follow-up, and file on the merged-away record is re-pointed at it. The
     files matter as much as the rest: an attachment left pointing at a
     record that no longer exists is invisible at once, and the orphan
     purge reclaims its bytes for good once the trash entry ages out. The merged
     record goes to the trash exactly like a delete, so a bad merge is
     walk-backable for 30 days - links stay with the survivor on restore. */

  /**
   * Merge `mergedId` into `survivorId`. `patch` carries the field values
   * the user picked from the merged record. Returns the trash entry.
   */
  async mergeContacts(survivorId, mergedId, patch = {}) {
    this.#assertWritable();
    const survivor = this.contactById(survivorId);
    const merged = this.contactById(mergedId);
    if (!survivor || !merged || survivorId === mergedId) return null;
    const refs = {
      deals: this.deals.filter((d) => dealContactIds(d).includes(mergedId)).map((d) => d.id),
      activities: this.activities.filter((a) => a.contactId === mergedId).map((a) => a.id),
      tasks: this.tasks.filter((t) => t.contactId === mergedId).map((t) => t.id),
    };
    const entry = this.#toTrash('contact', merged, refs);
    this.contacts = this.contacts.filter((c) => c.id !== mergedId);
    Object.assign(survivor, patch);
    survivor.tags = normalizeTags([...(survivor.tags || []), ...(merged.tags || [])]);
    survivor.custom = mergeCustomValues(survivor.custom, merged.custom);
    // The book knew this person from whichever record came first.
    survivor.createdAt = Math.min(num(survivor.createdAt, Date.now()), num(merged.createdAt, Date.now()));
    for (const d of this.deals) {
      const next = repointContact(d.contacts, mergedId, survivorId);
      if (next !== d.contacts) {
        d.contacts = next;
        d.contactId = d.contacts[0]?.contactId ?? null;
      }
      if (d.economicBuyerContactId === mergedId) d.economicBuyerContactId = survivorId;
      if (d.championContactId === mergedId) d.championContactId = survivorId;
    }
    for (const lead of this.leads) if (lead.contactId === mergedId) lead.contactId = survivorId;
    for (const row of this.companyTeam) if (row.contactId === mergedId) row.contactId = survivorId;
    for (const a of this.activities) if (a.contactId === mergedId) a.contactId = survivorId;
    for (const t of this.tasks) if (t.contactId === mergedId) t.contactId = survivorId;
    for (const a of this.attachments) if (a.contactId === mergedId) a.contactId = survivorId;
    this.#emit();
    await Promise.all([
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.employees, this.employees),
      this.#save(KV.leads, this.leads),
      this.#save(KV.payments, this.payments),
      this.#save(KV.companyTeam, this.companyTeam),
      this.#save(KV.salesTeam, this.salesTeam),
      this.#save(KV.dealStageHistory, this.dealStageHistory),
      this.#save(KV.leadStageHistory, this.leadStageHistory),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.attachments, this.attachments),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  async mergeCompanies(survivorId, mergedId, patch = {}) {
    this.#assertWritable();
    const survivor = this.companyById(survivorId);
    const merged = this.companyById(mergedId);
    if (!survivor || !merged || survivorId === mergedId) return null;
    const refs = {
      contacts: this.contacts.filter((c) => c.companyId === mergedId).map((c) => c.id),
      deals: this.deals.filter((d) => d.companyId === mergedId).map((d) => d.id),
      activities: this.activities.filter((a) => a.companyId === mergedId).map((a) => a.id),
    };
    const entry = this.#toTrash('company', merged, refs);
    this.companies = this.companies.filter((c) => c.id !== mergedId);
    Object.assign(survivor, patch);
    survivor.tags = normalizeTags([...(survivor.tags || []), ...(merged.tags || [])]);
    survivor.custom = mergeCustomValues(survivor.custom, merged.custom);
    survivor.createdAt = Math.min(num(survivor.createdAt, Date.now()), num(merged.createdAt, Date.now()));
    for (const c of this.companies) if (c.parentCompanyId === mergedId) c.parentCompanyId = survivorId;
    for (const c of this.contacts) if (c.companyId === mergedId) c.companyId = survivorId;
    for (const d of this.deals) {
      if (d.companyId === mergedId) d.companyId = survivorId;
      if (d.partnerId === mergedId) d.partnerId = survivorId;
      if (d.competitorIds?.includes(mergedId)) {
        d.competitorIds = [...new Set(d.competitorIds.map((id) => id === mergedId ? survivorId : id))];
      }
    }
    for (const lead of this.leads) {
      if (lead.companyId === mergedId) lead.companyId = survivorId;
      if (lead.partnerId === mergedId) lead.partnerId = survivorId;
    }
    for (const row of this.companyTeam) if (row.companyId === mergedId) row.companyId = survivorId;
    const seenTeam = new Set();
    this.companyTeam = this.companyTeam.filter((row) => {
      const key = `${row.companyId}\0${row.contactId}`;
      if (seenTeam.has(key)) return false;
      seenTeam.add(key);
      return true;
    });
    for (const a of this.activities) if (a.companyId === mergedId) a.companyId = survivorId;
    for (const t of this.tasks) if (t.companyId === mergedId) t.companyId = survivorId;
    for (const a of this.attachments) if (a.companyId === mergedId) a.companyId = survivorId;
    this.#emit();
    await Promise.all([
      this.#save(KV.companies, this.companies),
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.employees, this.employees),
      this.#save(KV.leads, this.leads),
      this.#save(KV.payments, this.payments),
      this.#save(KV.companyTeam, this.companyTeam),
      this.#save(KV.salesTeam, this.salesTeam),
      this.#save(KV.dealStageHistory, this.dealStageHistory),
      this.#save(KV.leadStageHistory, this.leadStageHistory),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.attachments, this.attachments),
      this.#save(KV.trash, this.trash),
    ]);
    return entry;
  }

  /* ---------- tags ----------
     Tags live on the records, nowhere else - the "registry" below is
     derived, so there is no second list to fall out of step. */

  /** Every collection that can carry tags, named, with its KV key. */
  #taggedCollections() {
    return [
      ['contacts', this.contacts, KV.contacts],
      ['companies', this.companies, KV.companies],
      ['deals', this.deals, KV.deals],
    ];
  }

  /**
   * Every tag in use, with how many records wear it - usage first, so
   * autocomplete and filters lead with the labels that matter. Case
   * variants group under whichever spelling appeared first.
   *
   * `kind` ('contacts' | 'companies' | 'deals') narrows the count to one
   * collection. A list's tag filter asks for its own kind: the vocabulary
   * is shared across record types, so the whole-book list offered Companies
   * labels only leads wear, and every one of them was a filter that could
   * only ever empty the page.
   */
  allTags(kind = null) {
    const groups = new Map();
    for (const [name, list] of this.#taggedCollections()) {
      if (kind && kind !== name) continue;
      for (const r of list) {
        for (const tag of Array.isArray(r.tags) ? r.tags : []) {
          const key = tag.toLowerCase();
          const g = groups.get(key) || { name: tag, count: 0 };
          g.count++;
          groups.set(key, g);
        }
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /** Rewrite a tag on every record wearing it. Returns records touched. */
  async renameTag(from, to) {
    this.#assertWritable();
    const next = cleanTag(to);
    const key = String(from || '').toLowerCase();
    if (!next || !key) return 0;
    let touched = 0;
    const writes = [];
    for (const [, list, kvKey] of this.#taggedCollections()) {
      let changed = false;
      for (const r of list) {
        if (!Array.isArray(r.tags) || !r.tags.some((t) => t.toLowerCase() === key)) continue;
        // Replace in place, then dedupe - renaming "vip" to an existing
        // "VIP" must merge them, not leave the record wearing it twice.
        r.tags = normalizeTags(r.tags.map((t) => (t.toLowerCase() === key ? next : t)));
        touched++;
        changed = true;
      }
      if (changed) writes.push(this.#save(kvKey, list));
    }
    if (!touched) return 0;
    this.#emit();
    await Promise.all(writes);
    return touched;
  }

  /** Strip a tag from every record wearing it. Returns records touched. */
  async deleteTag(name) {
    this.#assertWritable();
    const key = String(name || '').toLowerCase();
    if (!key) return 0;
    let touched = 0;
    const writes = [];
    for (const [, list, kvKey] of this.#taggedCollections()) {
      let changed = false;
      for (const r of list) {
        if (!Array.isArray(r.tags) || !r.tags.some((t) => t.toLowerCase() === key)) continue;
        r.tags = r.tags.filter((t) => t.toLowerCase() !== key);
        touched++;
        changed = true;
      }
      if (changed) writes.push(this.#save(kvKey, list));
    }
    if (!touched) return 0;
    this.#emit();
    await Promise.all(writes);
    return touched;
  }

  /* ---------- trash ----------
     Deletes move the record - plus the ids it was detached from - into a
     30-day trash instead of vanishing. Restore puts the record back and
     re-attaches the references whose other half still exists. */

  #toTrash(kind, record, refs = {}) {
    const entry = {
      id: uid(),
      kind,
      at: Date.now(),
      name: str(record.name) || str(record.title) || str(record.summary) || 'Без названия',
      record: JSON.parse(JSON.stringify(record)),
      refs: JSON.parse(JSON.stringify(refs)),
    };
    this.trash.unshift(entry);
    if (this.trash.length > TRASH_MAX) {
      // Entries pushed off the end lose restorability; an attachment
      // entry takes its stored file with it rather than leaking bytes.
      // Truncate first, so the entries on their way out are not counted
      // among the holders that could keep their own files alive.
      const evicted = this.trash.slice(TRASH_MAX);
      this.trash.length = TRASH_MAX;
      this.#reclaimFiles(attachmentRecordsOf(evicted));
    }
    return entry;
  }

  /**
   * Put a restored contact back on the deals they were on. Additive, like
   * every other restore: they rejoin the list wherever it stands, and only
   * take the primary slot back if the deal has nobody in it - a deal whose
   * lead contact changed after the delete keeps the newer decision.
   */
  #relinkDealContacts(ids, contactId) {
    if (!Array.isArray(ids) || !ids.length) return false;
    const wanted = new Set(ids);
    let touched = false;
    for (const deal of this.deals) {
      if (!wanted.has(deal.id)) continue;
      const next = withContact(deal.contacts, contactId);
      if (next === deal.contacts) continue;
      deal.contacts = next;
      if (!deal.contactId) deal.contactId = deal.contacts[0]?.contactId ?? null;
      touched = true;
    }
    return touched;
  }

  /** Re-attach `field` on every listed record that is still unassigned. */
  #reattach(list, ids, field, value) {
    if (!Array.isArray(ids) || !ids.length) return false;
    const wanted = new Set(ids);
    let touched = false;
    for (const r of list) {
      if (wanted.has(r.id) && !r[field]) {
        r[field] = value;
        touched = true;
      }
    }
    return touched;
  }

  /**
   * Put a deleted record back. Links are restored only where the other
   * record still exists and has not been re-pointed since - undo should
   * never overwrite a decision made after the delete.
   */
  async restoreTrash(entryId) {
    this.#assertWritable();
    const index = this.trash.findIndex((t) => t.id === entryId);
    if (index < 0) return null;
    const entry = this.trash[index];
    const { record, refs = {} } = entry;
    const writes = new Set([KV.trash]);
    const add = (list, key) => {
      if (!list.some((r) => r.id === record.id)) list.push(record);
      writes.add(key);
    };
    const restoreRows = (rows, list, key, valid = () => true) => {
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!valid(row) || list.some((r) => r.id === row.id)) continue;
        list.push(JSON.parse(JSON.stringify(row)));
        writes.add(key);
      }
    };

    if (entry.kind === 'company') {
      add(this.companies, KV.companies);
      if (this.#reattach(this.contacts, refs.contacts, 'companyId', record.id)) writes.add(KV.contacts);
      if (this.#reattach(this.companies, refs.childCompanies, 'parentCompanyId', record.id)) writes.add(KV.companies);
      if (this.#reattach(this.deals, refs.deals, 'companyId', record.id)) writes.add(KV.deals);
      if (this.#reattach(this.deals, refs.partnerDeals, 'partnerId', record.id)) writes.add(KV.deals);
      for (const deal of this.deals) {
        if (refs.competitorDeals?.includes(deal.id) && !deal.competitorIds?.includes(record.id)) {
          deal.competitorIds = [...(deal.competitorIds || []), record.id];
          writes.add(KV.deals);
        }
      }
      if (this.#reattach(this.leads, refs.leads, 'companyId', record.id)) writes.add(KV.leads);
      if (this.#reattach(this.leads, refs.partnerLeads, 'partnerId', record.id)) writes.add(KV.leads);
      if (this.#reattach(this.activities, refs.activities, 'companyId', record.id)) writes.add(KV.activities);
      if (this.#reattach(this.tasks, refs.tasks, 'companyId', record.id)) writes.add(KV.tasks);
      restoreRows(refs.companyTeam, this.companyTeam, KV.companyTeam,
        (row) => !!this.contactById(row.contactId));
    } else if (entry.kind === 'contact') {
      add(this.contacts, KV.contacts);
      if (this.#relinkDealContacts(refs.deals, record.id)) writes.add(KV.deals);
      if (this.#reattach(this.deals, refs.economicBuyerDeals, 'economicBuyerContactId', record.id)) writes.add(KV.deals);
      if (this.#reattach(this.deals, refs.championDeals, 'championContactId', record.id)) writes.add(KV.deals);
      if (this.#reattach(this.leads, refs.leads, 'contactId', record.id)) writes.add(KV.leads);
      if (this.#reattach(this.activities, refs.activities, 'contactId', record.id)) writes.add(KV.activities);
      if (this.#reattach(this.tasks, refs.tasks, 'contactId', record.id)) writes.add(KV.tasks);
      restoreRows(refs.companyTeam, this.companyTeam, KV.companyTeam,
        (row) => !!this.companyById(row.companyId));
    } else if (entry.kind === 'deal') {
      // A stage removed while the deal sat in the trash must not leave it
      // stranded off the board - the rule setStages applies to live deals.
      if (!this.stages().some((s) => s.id === record.stage)) {
        const fromStage = record.stage;
        record.stage = this.firstStage();
        record.updatedAt = Date.now();
        recordStageEntry(record, record.stage, record.updatedAt, fromStage);
        this.dealStageHistory.push(newStageEntry('dealId', record.id, fromStage, record.stage, record.updatedAt));
        writes.add(KV.dealStageHistory);
      }
      add(this.deals, KV.deals);
      restoreRows(refs.payments, this.payments, KV.payments);
      restoreRows(refs.salesTeam, this.salesTeam, KV.salesTeam);
      if (this.#reattach(this.activities, refs.activities, 'dealId', record.id)) writes.add(KV.activities);
      if (this.#reattach(this.tasks, refs.tasks, 'dealId', record.id)) writes.add(KV.tasks);
    } else if (entry.kind === 'activity') {
      add(this.activities, KV.activities);
    } else if (entry.kind === 'task') {
      add(this.tasks, KV.tasks);
    } else if (entry.kind === 'template') {
      add(this.templates, KV.templates);
    } else if (entry.kind === 'attachment') {
      add(this.attachments, KV.attachments);
    } else {
      return null;
    }

    this.trash.splice(index, 1);
    this.#emit();
    const byKey = {
      [KV.companies]: this.companies, [KV.contacts]: this.contacts,
      [KV.deals]: this.deals, [KV.activities]: this.activities,
      [KV.leads]: this.leads, [KV.companyTeam]: this.companyTeam,
      [KV.payments]: this.payments, [KV.salesTeam]: this.salesTeam,
      [KV.dealStageHistory]: this.dealStageHistory,
      [KV.tasks]: this.tasks, [KV.templates]: this.templates,
      [KV.attachments]: this.attachments, [KV.trash]: this.trash,
    };
    await Promise.all([...writes].map((k) => this.#save(k, byKey[k])));
    return entry;
  }

  async emptyTrash() {
    this.#assertWritable();
    // Emptying is the user saying "gone for good" - attachment entries
    // give their stored files back now rather than at expiry. Cleared
    // first, so the entries about to go cannot vouch for their own files;
    // #reclaimFiles then spares whatever the live manifest or the safety
    // snapshot still points at.
    const dropped = attachmentRecordsOf(this.trash);
    this.trash = [];
    this.#reclaimFiles(dropped);
    this.#emit();
    await this.#save(KV.trash, this.trash);
  }

  /* ---------- safety snapshot ----------
     One slot, written before any bulk replace, so a bad import or a
     mistaken erase is one click from being undone. */

  hasData() {
    // Templates count: they are authored work an import replaces, and an
    // account holding only them still deserves the snapshot and the
    // weekly backup. Attachments don't - their metadata can't outlive the
    // records above, and the bytes live in FS untouched by any replace.
    return this.companies.length + this.contacts.length + this.deals.length
      + this.employees.length + this.leads.length + this.payments.length
      + this.companyTeam.length + this.salesTeam.length
      + this.activities.length + this.tasks.length + this.templates.length > 0;
  }

  /** Public so bulk operations outside importAll (CSV) can guard themselves. */
  async saveSnapshot(reason) {
    this.#assertWritable();
    // Rotating the one-slot snapshot is the moment the previous snapshot's
    // attachment manifest loses its last holder - reclaim what nothing
    // else still references, or the bytes sit in FS forever, invisible.
    const dropped = this.backup?.data?.attachments || [];
    await this.#saveBackup(reason);
    this.#reclaimFiles(dropped);
  }

  #saveBackup(reason) {
    // Deep copy, not the live collections: a CSV merge appends to and edits
    // those arrays in place, so an aliased snapshot would quietly grow into
    // a copy of the very import it is meant to undo.
    this.backup = { at: Date.now(), reason, data: JSON.parse(JSON.stringify(this.exportAll())) };
    return this.#save(KV.backup, this.backup);
  }

  /**
   * Delete the stored files of dropped attachment records that nothing
   * answers for anymore. A file must stay as long as anything can still
   * bring its metadata back - the live manifest, a trash entry awaiting
   * restore, or the safety snapshot - so the check runs against all three
   * at call time, after the drop has settled.
   *
   * Every path that reclaims bytes goes through here, because the same path
   * can legitimately be named twice. Restoring the safety snapshot over a
   * deleted attachment is the case that bit: the snapshot brings the record
   * back to the live manifest while the delete's trash entry still names the
   * same file, so emptying the trash was deleting the bytes of a live
   * attachment - a broken download and no way back.
   */
  #reclaimFiles(dropped) {
    if (!Array.isArray(dropped) || !dropped.length) return;
    const kept = new Set();
    for (const a of this.attachments) if (a?.path) kept.add(a.path);
    for (const e of this.trash) if (e?.kind === 'attachment' && e.record?.path) kept.add(e.record.path);
    for (const a of this.backup?.data?.attachments || []) if (a?.path) kept.add(a.path);
    const seen = new Set();
    for (const a of dropped) {
      const path = a?.path;
      if (!path || kept.has(path) || seen.has(path)) continue;
      seen.add(path);
      deleteStoredFile(path);
    }
  }

  /**
   * Swap the current data for the snapshot - and snapshot what was there,
   * so the restore itself can be undone if it was the wrong call.
   */
  async restoreBackup() {
    this.#assertWritable();
    const snapshot = this.backup;
    if (!snapshot?.data) return false;
    await this.importAll(snapshot.data, { reason: 'restore' });
    return true;
  }

  /* ---------- CSV merge ----------
     Additive, not a replace: rows are appended, and a row that matches an
     existing record by email (leads) or name (companies, deals) updates it
     in place instead of creating a twin. Blank cells never wipe a value
     that is already there. */

  #findCompanyByName(name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    return this.companies.find((c) => c.name.trim().toLowerCase() === wanted) || null;
  }

  /**
   * Import mapped rows. Returns { added, updated, skipped, companiesCreated }.
   * Every record goes through the same normalization as a JSON import, so a
   * malformed row cannot poison the stored data.
   */
  async importRecords(kind, rows, { update = true } = {}) {
    this.#assertWritable();
    const summary = { added: 0, updated: 0, skipped: 0, companiesCreated: 0 };
    const now = Date.now();
    const touched = new Set();
    const stages = this.stages();
    const stageCtx = this.#dealStageContext();

    /** Company by name, creating it if this is the first time we've seen it. */
    const companyFor = (name) => {
      const clean = String(name || '').trim();
      if (!clean) return null;
      const existing = this.#findCompanyByName(clean);
      if (existing) return existing;
      const company = normalizeCompany({ id: uid(), name: clean, createdAt: now });
      this.companies.push(company);
      summary.companiesCreated++;
      touched.add(KV.companies);
      return company;
    };

    /** Copy only the fields the row actually filled in. */
    const assignFilled = (target, patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') continue;
        target[key] = value;
      }
    };

    /** Row tags join a matched record's own - an import must not strip labels. */
    const mergeTags = (target, rowTags) => {
      if (rowTags.length) target.tags = normalizeTags([...(target.tags || []), ...rowTags]);
    };

    /* Custom-field cells follow the same rule as every other column: a
       blank (or unreadable) cell leaves what the record already holds. */
    const fields = this.customFields(kind);
    const mergeCustom = (target, values) => {
      if (!Object.keys(values).length) return;
      target.custom = normalizeCustomValues({ ...(target.custom || {}), ...values });
    };

    for (const row of Array.isArray(rows) ? rows : []) {
      const name = String(row?.name || '').trim();
      if (!name) { summary.skipped++; continue; }

      if (kind === 'companies') {
        const rowTags = splitTags(row.tags);
        const patch = {
          name,
          industry: row.industry, website: row.website, size: row.size, notes: row.notes,
        };
        const custom = customCellValues(fields, row);
        const existing = update ? this.#findCompanyByName(name) : null;
        if (existing) {
          assignFilled(existing, patch);
          mergeTags(existing, rowTags);
          mergeCustom(existing, custom);
          summary.updated++;
        } else {
          this.companies.push(normalizeCompany({
            id: uid(), createdAt: now, ...patch, tags: rowTags, custom,
          }));
          summary.added++;
        }
        touched.add(KV.companies);
        continue;
      }

      if (kind === 'contacts') {
        const email = String(row.email || '').trim();
        const company = companyFor(row.company);
        const rowTags = splitTags(row.tags);
        const patch = {
          name, email, phone: row.phone, title: row.title, source: row.source,
          notes: row.notes, companyId: company?.id || null,
          // A status we don't recognize stays blank: a matched lead keeps
          // the status it has (new rows fall back to 'lead' below) rather
          // than a "VIP" cell quietly downgrading a customer.
          status: matchStatus(row.status, ''),
        };
        const key = email.toLowerCase();
        const existing = update && key
          ? this.contacts.find((c) => c.email.trim().toLowerCase() === key)
          : null;
        const custom = customCellValues(fields, row);
        if (existing) {
          assignFilled(existing, patch);
          mergeTags(existing, rowTags);
          mergeCustom(existing, custom);
          summary.updated++;
        } else {
          this.contacts.push(normalizeContact({
            id: uid(), createdAt: now, ...patch, status: patch.status || 'lead',
            tags: rowTags, custom,
          }));
          summary.added++;
        }
        touched.add(KV.contacts);
        continue;
      }

      if (kind === 'deals') {
        const company = companyFor(row.company);
        const contactName = String(row.contact || '').trim().toLowerCase();
        // Only an unambiguous name links a contact; two Mei Tanakas mean
        // neither, rather than the wrong one.
        const matches = contactName
          ? this.contacts.filter((c) => c.name.trim().toLowerCase() === contactName)
          : [];
        const contact = matches.length === 1 ? matches[0] : null;
        // A blank or unrecognized stage cell stays blank so a matched deal
        // keeps the stage it has - otherwise a re-import with no Stage
        // column (or one naming stages this funnel doesn't have) would
        // drag every deal (won ones included) back to the top of the
        // funnel. New rows land on the first stage via normalizeDeal.
        const rawStage = String(row.stage || '').trim().toLowerCase();
        let stage = matchStage(row.stage, stages, '') || canonicalDealStage(rawStage);
        const legacyOutcome = stage === 'won' || rawStage === 'won' || rawStage === 'выиграна' ? 'Выиграна'
          : stage === 'lost' || rawStage === 'lost' || rawStage === 'проиграна' ? 'Проиграна' : '';
        if (legacyOutcome === 'Выиграна') stage = 's8';
        if (legacyOutcome === 'Проиграна') stage = '';
        const rowTags = splitTags(row.tags);
        const patch = {
          name,
          // A money cell with no digit in it ("TBD", "n/a") is blank, not
          // zero: parseMoney would read it as 0, and a re-import would wipe
          // a matched deal's real value with it. Dates already fail this
          // way (parseDateLoose returns null for junk); money follows suit.
          value: /\d/.test(String(row.value ?? '')) ? parseMoney(row.value) : '',
          // Same rule as every other cell: a blank (or unrecognizable)
          // billing cell leaves a matched deal on the plan it already has,
          // so a re-import of a file with no Billing column can't quietly
          // turn a book of subscriptions into one-time sales.
          billing: matchBilling(row.billing, ''),
          term: parseTerm(row.term),
          stage,
          ...(legacyOutcome ? { outcome: legacyOutcome } : stage ? { outcome: '' } : {}),
          companyId: company?.id || null,
          contactId: contact?.id || null,
          expectedClose: parseDateLoose(row.expectedClose),
          notes: row.notes,
        };
        const existing = update
          ? this.deals.find((d) => d.name.trim().toLowerCase() === name.toLowerCase())
          : null;
        if (existing) {
          // Read the stage before the patch lands: comparing after the
          // assignment always says "unchanged", which left the history
          // pointing at a stage the deal had already left.
          const fromStage = existing.stage;
          const fromOutcome = existing.outcome || '';
          assignFilled(existing, patch);
          if ('outcome' in patch) existing.outcome = patch.outcome;
          mergeTags(existing, rowTags);
          mergeCustom(existing, customCellValues(fields, row));
          // A row that switches a deal to monthly without naming a term
          // needs the default one, and one that switches it back to
          // one-time has to drop the term it no longer has.
          settleBilling(existing);
          existing.updatedAt = now;
          if (existing.stage !== fromStage) {
            recordStageEntry(existing, existing.stage, now, fromStage);
            this.dealStageHistory.push(newStageEntry('dealId', existing.id, fromStage, existing.stage, now));
          }
          if (existing.outcome && existing.outcome !== fromOutcome) {
            existing.closedAt = now;
            existing.confidence = null;
          } else if (!existing.outcome) {
            clearCloseRecord(existing);
          }
          summary.updated++;
        } else {
          const deal = normalizeDeal({
            id: uid(), createdAt: now, updatedAt: now, ...patch,
            value: patch.value === '' ? 0 : patch.value, tags: rowTags,
            custom: customCellValues(fields, row),
          }, stageCtx);
          this.deals.push(deal);
          summary.added++;
        }
        touched.add(KV.deals);
        continue;
      }

      summary.skipped++;
    }

    if (!touched.size) return summary;
    if (touched.has(KV.deals)) {
      this.payments = migratePayments(this.deals, this.payments);
      this.dealStageHistory = migrateDealHistory(this.deals, this.dealStageHistory);
      this.#syncDealTotals();
      touched.add(KV.payments);
      touched.add(KV.dealStageHistory);
    }
    this.#emit();
    const byKey = {
      [KV.companies]: this.companies,
      [KV.contacts]: this.contacts,
      [KV.deals]: this.deals,
      [KV.payments]: this.payments,
      [KV.dealStageHistory]: this.dealStageHistory,
    };
    await Promise.all([...touched].map((k) => this.#save(k, byKey[k])));
    return summary;
  }

  /* ---------- export / import ---------- */

  exportAll() {
    return {
      app: 'crm',
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      companies: this.companies,
      contacts: this.contacts,
      deals: this.deals,
      employees: this.employees,
      leads: this.leads,
      payments: this.payments,
      companyTeam: this.companyTeam,
      salesTeam: this.salesTeam,
      dealStageHistory: this.dealStageHistory,
      leadStageHistory: this.leadStageHistory,
      activities: this.activities,
      tasks: this.tasks,
      templates: this.templates,
      // The manifest only: the files themselves stay in Puter FS, and the
      // paths here say exactly where.
      attachments: this.attachments,
    };
  }

  /**
   * Replace everything with an export-shaped payload (also installs/wipes
   * sample data). Records are normalized on the way in - a hand-edited
   * export with a missing name or due date must not poison the stored data
   * and crash every view that sorts on those fields.
   */
  async importAll(data, { reason = 'import' } = {}) {
    this.#assertWritable();
    if (!data || data.app !== 'crm' || !Number.isInteger(data.version)) {
      throw new Error('Not a CRM export file');
    }
    // Snapshot first: everything below is a replace, and the user's only
    // other copy is whatever they remembered to export.
    const droppedBackup = this.backup?.data?.attachments || [];
    const outgoing = this.attachments;
    if (this.hasData()) await this.#saveBackup(reason);
    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    // Deals are checked against the *incoming* stage configuration, so an
    // export of a custom funnel imports with its stages intact.
    const stageCtx = this.#dealStageContext();
    this.companies = normalizeAll(data.companies, normalizeCompany);
    this.contacts = normalizeAll(data.contacts, normalizeContact);
    this.deals = normalizeAll(data.deals, (d) => normalizeDeal(d, stageCtx));
    this.employees = normalizeAll(data.employees, normalizeEmployee);
    this.leads = normalizeAll(data.leads, normalizeLead);
    this.companyTeam = normalizeAll(data.companyTeam, normalizeCompanyTeam);
    this.salesTeam = normalizeSalesTeam(data.salesTeam);
    this.payments = migratePayments(this.deals, data.payments);
    this.dealStageHistory = migrateDealHistory(this.deals, data.dealStageHistory);
    this.leadStageHistory = migrateLeadHistory(this.leads, data.leadStageHistory);
    this.activities = normalizeAll(data.activities, normalizeActivity);
    this.tasks = normalizeAll(data.tasks, normalizeTask);
    this.templates = normalizeAll(data.templates, normalizeTemplate);
    this.attachments = normalizeAll(data.attachments, normalizeAttachment);
    this.#syncDealTotals();
    // Two manifests may have just lost their holder: the previous
    // snapshot's (the slot rotated above) and the outgoing live one (now
    // in the new snapshot - or nowhere, when there was nothing to
    // snapshot). Reclaim what nothing references anymore. Checked after
    // the replace, so restoring the snapshot keeps every file it brings
    // back to life.
    this.#reclaimFiles([...droppedBackup, ...outgoing]);
    this.#emit();
    await Promise.all([
      this.#save(KV.settings, this.settings),
      this.#save(KV.companies, this.companies),
      this.#save(KV.contacts, this.contacts),
      this.#save(KV.deals, this.deals),
      this.#save(KV.employees, this.employees),
      this.#save(KV.leads, this.leads),
      this.#save(KV.payments, this.payments),
      this.#save(KV.companyTeam, this.companyTeam),
      this.#save(KV.salesTeam, this.salesTeam),
      this.#save(KV.dealStageHistory, this.dealStageHistory),
      this.#save(KV.leadStageHistory, this.leadStageHistory),
      this.#save(KV.activities, this.activities),
      this.#save(KV.tasks, this.tasks),
      this.#save(KV.templates, this.templates),
      this.#save(KV.attachments, this.attachments),
    ]);
  }
}

export const store = new Store();
export { Store };
