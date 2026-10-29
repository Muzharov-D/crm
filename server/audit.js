import crypto from 'node:crypto';

export const AUDIT_KEY = 'crm:audit:v1';
export const AUDIT_LIMIT = 500;

const COLLECTIONS = {
  'crm:companies:v1': ['компания', 'компании'],
  'crm:contacts:v1': ['контакт', 'контакты'],
  'crm:deals:v1': ['сделка', 'сделки'],
  'crm:activities:v1': ['запись', 'записи'],
  'crm:tasks:v1': ['задача', 'задачи'],
  'crm:templates:v1': ['шаблон', 'шаблоны'],
  'crm:attachments:v1': ['документ', 'документы'],
  'crm:settings:v1': ['настройка', 'настройки'],
  'crm:trash:v1': ['корзина', 'корзины'],
};

const FIELD_LABELS = {
  name: 'название', value: 'сумма', stage: 'этап', expectedClose: 'дата закрытия',
  contactId: 'контакт', companyId: 'компания', notes: 'заметки', tags: 'метки',
  qualification: 'квалификация АБР', confidence: 'уверенность', due: 'срок',
  done: 'выполнение', title: 'заголовок', email: 'email', phone: 'телефон',
  forecastMode: 'режим прогноза', stages: 'этапы воронки', currency: 'валюта',
};

const parse = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};
const recordName = (r) => r?.name || r?.title || r?.summary || r?.id || 'без названия';
const fieldLabel = (key) => FIELD_LABELS[key] || key;
const changedFields = (before, after) => [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  .filter((key) => !['updatedAt', 'stageHistory'].includes(key))
  .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
  .map(fieldLabel);

function collectionEvents(key, current, next, actor) {
  const kind = COLLECTIONS[key]?.[0] || 'запись';
  if (key === 'crm:settings:v1' || (!Array.isArray(current) && !Array.isArray(next))) {
    const fields = changedFields(current || {}, next || {});
    if (!fields.length) return [];
    return [{ actor, action: 'updated', kind, name: 'Настройки CRM', fields }];
  }
  const before = new Map((Array.isArray(current) ? current : []).filter((r) => r?.id).map((r) => [r.id, r]));
  const after = new Map((Array.isArray(next) ? next : []).filter((r) => r?.id).map((r) => [r.id, r]));
  const events = [];
  for (const [id, record] of after) {
    if (!before.has(id)) {
      events.push({ actor, action: 'created', kind, name: recordName(record), recordId: id, fields: [] });
      continue;
    }
    const fields = changedFields(before.get(id), record);
    if (fields.length) events.push({ actor, action: 'updated', kind, name: recordName(record), recordId: id, fields });
  }
  for (const [id, record] of before) {
    if (!after.has(id)) events.push({ actor, action: 'deleted', kind, name: recordName(record), recordId: id, fields: [] });
  }
  return events;
}

export function auditForKV({ key, currentRaw, nextRaw, actor }) {
  const current = parse(currentRaw);
  const next = parse(nextRaw);
  return collectionEvents(key, current, next, actor);
}

export async function appendAudit(storage, events, { at = Date.now() } = {}) {
  if (!events?.length) return;
  const stamped = events.map((event) => ({
    id: crypto.randomUUID(), at, ...event,
  }));
  await storage.kvUpdate(AUDIT_KEY, (raw) => {
    const existing = parse(raw);
    return JSON.stringify([...stamped, ...(Array.isArray(existing) ? existing : [])].slice(0, AUDIT_LIMIT));
  });
}
