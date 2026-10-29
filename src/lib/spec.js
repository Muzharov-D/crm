/** CRM MVP v2.1: canonical dictionaries, financial-year and cohort rules. */

export const DEAL_STAGES = [
  { id: 's1', label: 'S1 Интерес', probability: null },
  { id: 's2', label: 'S2 Квалифицирована', probability: 0.05 },
  { id: 's3', label: 'S3 Демо', probability: 0.15 },
  { id: 's4', label: 'S4 Пилот/Проверка', probability: 0.25 },
  { id: 's5', label: 'S5 Решение и КП', probability: 0.35 },
  { id: 's6', label: 'S6 Закупка', probability: 0.45 },
  { id: 's7', label: 'S7 Договор', probability: 0.85 },
  { id: 's8', label: 'S8 Выиграно', probability: 1 },
  { id: 's9', label: 'S9 Реализация', probability: 1 },
  { id: 's10', label: 'S10 Завершён', probability: 1 },
];

export const LEAD_STAGES = [
  { id: 'l0', label: 'L0 — Целевой рынок' },
  { id: 'l1', label: 'L1 — Целевой контакт' },
  { id: 'l2', label: 'L2 — Лид, проявивший интерес' },
  { id: 'l3', label: 'L3 — Квалифицированный лид' },
  { id: 'l4', label: 'L4 — Глубоко проработанный лид' },
  { id: 'l5', label: 'L5 — Лид-возможность' },
];

export const DICTIONARY_DEFINITIONS = [
  { key: 'companyRoles', label: 'Роль контрагента', values: ['Клиент', 'Партнёр-интегратор', 'Конкурент'] },
  { key: 'teamRoles', label: 'Роль в команде контрагента', values: ['Бизнес-заказчик', 'Владелец процесса', 'ИТ-служба', 'ИБ', 'Закупки', 'Юристы', 'Экономический покупатель', 'Чемпион'] },
  { key: 'influence', label: 'Влияние', values: ['За нас', 'Нейтрален', 'Против нас'] },
  { key: 'employeeRoles', label: 'Роль сотрудника', values: ['АБР.Продажи', 'Корус.Продажи', 'Пресейл', 'РП', 'Руководитель внедрения', 'CS (клиентский сервис)'] },
  { key: 'salesRoles', label: 'Роль в сделке (продажи)', values: ['Ответственный', 'Пресейл', 'Архитектор решения', 'Коммерческий директор'] },
  { key: 'leadStatuses', label: 'Статус лида', values: ['Новый', 'В работе', 'Квалифицирован', 'Дисквалифицирован', 'Закрыт'] },
  { key: 'leadSources', label: 'Источник лида', values: ['Сайт', 'Email', 'Вебинар', 'Соцмедиа', 'Специализированный СМИ', 'ИТ-СМИ', 'Конференция/форумы', 'Партнёрская рекомендация', 'Тендерная площадка', 'Холодный охват'] },
  { key: 'leadReasons', label: 'Причина (лид)', values: ['Нет бюджета', 'Не наш профиль', 'Взяли конкурента', 'Перенесли на будущее', 'Дубль обращения'] },
  { key: 'products', label: 'Продукт', values: ['Платформа', 'ИИ', 'Профиль'] },
  { key: 'subproducts', label: 'Подпродукт', values: [
    { value: 'Документы', parent: 'Платформа' }, { value: 'Репозиторий', parent: 'Платформа' },
    { value: 'Диск', parent: 'Платформа' }, { value: 'Трекер', parent: 'Платформа' },
    { value: 'Service Desk', parent: 'Платформа' }, { value: 'CRM', parent: 'Платформа' },
    { value: 'Архив', parent: 'Платформа' }, { value: 'Мобильный офис', parent: 'Платформа' },
    { value: 'CDP', parent: 'Профиль' }, { value: 'Лояльность', parent: 'Профиль' },
    { value: 'События', parent: 'Профиль' }, { value: 'Согласия', parent: 'Профиль' },
    { value: 'Ассистент', parent: 'ИИ' },
  ] },
  { key: 'dealStatuses', label: 'Статус сделки', values: ['Новая', 'Активно', 'Реализация (без договора)', 'Реализация (проект)', 'Завершена'] },
  { key: 'probabilityCategories', label: 'Вероятность (категория)', values: ['Высокая', 'Средняя', 'Низкая'] },
  { key: 'paymentTypes', label: 'Тип строки реестра платежей', values: ['Лицензия', 'Работа', 'Железо'] },
  { key: 'paymentStatuses', label: 'Статус строки реестра платежей', values: ['Прогноз', 'Акт', 'Оплата'] },
  { key: 'clientInvestments', label: 'Что клиент вложил', values: ['Ничего', 'Время команды', 'Данные и доступы', 'Стенд или среда', 'Оплатил пилот'] },
  { key: 'budgets', label: 'Бюджет', values: ['Утверждён', 'Заявлен', 'Нет'] },
  { key: 'purchaseTypes', label: 'Тип покупки', values: ['Ещё не знают', 'Прямая', 'Тендер', 'Через партнёра', 'Рамочный'] },
  { key: 'dealOutcomes', label: 'Исход сделки', values: ['Выиграна', 'Проиграна', 'Нет решения', 'Дисквалифицирована'] },
  { key: 'dealCloseReasons', label: 'Причина закрытия сделки', values: ['Проиграли конкуренту — функциональность', 'Проиграли конкуренту — цена', 'Отрицательное заключение ИБ', 'Формальные требования процедуры', 'ТЗ под конкурента', 'Сроки внедрения не устроили', 'Бюджет не выделен', 'Отложено на следующий цикл', 'Реорганизация/смена руководства', 'Нет владельца задачи', 'Выбрали собственную разработку', 'Отказались сами — условия неприемлемы'] },
  { key: 'taskStatuses', label: 'Статус задачи', values: ['К выполнению', 'В работе', 'Выполнено'] },
];

export const DEFAULT_DICTIONARIES = Object.fromEntries(
  DICTIONARY_DEFINITIONS.map((d) => [d.key, d.values.map((v) => typeof v === 'string' ? v : { ...v })]),
);

const clean = (v) => String(v ?? '').trim();

export function dictionary(settings, key) {
  const fallback = DEFAULT_DICTIONARIES[key] || [];
  const custom = settings?.dictionaries?.[key];
  if (!Array.isArray(custom)) return fallback.map((v) => typeof v === 'string' ? v : { ...v });
  const seen = new Set();
  const out = [];
  for (const raw of custom) {
    const value = clean(typeof raw === 'object' ? raw?.value : raw);
    const parent = clean(typeof raw === 'object' ? raw?.parent : '');
    if (!value || seen.has(`${parent}\u0000${value}`)) continue;
    seen.add(`${parent}\u0000${value}`);
    out.push(key === 'subproducts' ? { value, parent } : value);
  }
  return out;
}

export function dictionaryOptions(settings, key, { empty = 'Не указано', parent = null } = {}) {
  const values = dictionary(settings, key)
    .filter((v) => !parent || (typeof v === 'object' && v.parent === parent))
    .map((v) => ({ value: typeof v === 'string' ? v : v.value, label: typeof v === 'string' ? v : v.value }));
  return empty === null ? values : [{ value: '', label: empty }, ...values];
}

export function productForSubproduct(settings, value) {
  const found = dictionary(settings, 'subproducts').find((v) => v.value === value);
  return found?.parent || '';
}

export const fiscalYearAt = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + (d.getMonth() >= 3 ? 1 : 0);
};

export const fiscalQuarterAt = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const m = d.getMonth();
  return m >= 3 && m <= 5 ? 'Q1' : m >= 6 && m <= 8 ? 'Q2' : m >= 9 ? 'Q3' : 'Q4';
};

export function fiscalQuarterBounds(fiscalYear, quarter) {
  const year = Number(fiscalYear);
  const ranges = {
    Q1: [[year - 1, 3, 1], [year - 1, 5, 30]],
    Q2: [[year - 1, 6, 1], [year - 1, 8, 30]],
    Q3: [[year - 1, 9, 1], [year - 1, 11, 31]],
    Q4: [[year, 0, 1], [year, 2, 31]],
  };
  const range = ranges[quarter];
  if (!range || !Number.isInteger(year)) return null;
  const iso = ([y, m, d]) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { from: iso(range[0]), to: iso(range[1]) };
}

export function fiscalYearQuarterForDate(value) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return { fiscalYear: fiscalYearAt(), quarter: fiscalQuarterAt() };
  return { fiscalYear: fiscalYearAt(date), quarter: fiscalQuarterAt(date) };
}

export const paymentBelongs = (payment, fiscalYear, quarter = null) =>
  Number(payment?.fiscalYear) === Number(fiscalYear) && (!quarter || payment.quarter === quarter);

export function dealTotals(dealId, payments, now = new Date()) {
  const rows = payments.filter((p) => p.dealId === dealId);
  const current = fiscalYearAt(now);
  const sum = (list) => list.reduce((total, p) => total + (Number(p.amount) || 0), 0);
  return {
    total: sum(rows),
    currentFY: sum(rows.filter((p) => paymentBelongs(p, current))),
    nextFY: sum(rows.filter((p) => paymentBelongs(p, current + 1))),
  };
}

export function normalizePayment(raw = {}) {
  const current = fiscalYearQuarterForDate();
  const fiscalYear = Number(raw.fiscalYear);
  return {
    ...raw,
    id: clean(raw.id), dealId: clean(raw.dealId),
    fiscalYear: Number.isInteger(fiscalYear) && fiscalYear >= 2000 && fiscalYear <= 2200 ? fiscalYear : current.fiscalYear,
    quarter: ['Q1', 'Q2', 'Q3', 'Q4'].includes(raw.quarter) ? raw.quarter : current.quarter,
    amount: Number.isFinite(Number(raw.amount)) ? Math.max(0, Number(raw.amount)) : 0,
    type: clean(raw.type) || 'Лицензия', status: clean(raw.status) || 'Прогноз',
    paymentDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.paymentDate || '') ? raw.paymentDate : '',
    actDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.actDate || '') ? raw.actDate : '',
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

export function stageIndex(stageId, stages) {
  return stages.findIndex((s) => s.id === stageId);
}

/** Cohorts use the first entry into X and furthest stage ever reached. */
export function cohortConversion(records, history, {
  stages, fromStage, toStage, from = '', to = '', ownerKey,
}) {
  const byOwner = new Map(records.map((r) => [r.id, r]));
  const firstEntries = new Map();
  const furthest = new Map();
  for (const entry of history) {
    const owner = entry[ownerKey];
    if (!byOwner.has(owner)) continue;
    const index = stageIndex(entry.newStage, stages);
    if (index < 0) continue;
    furthest.set(owner, Math.max(furthest.get(owner) ?? -1, index));
    const key = `${owner}\u0000${entry.newStage}`;
    const at = Number(entry.at) || 0;
    if (!firstEntries.has(key) || at < firstEntries.get(key)) firstEntries.set(key, at);
  }
  const cohort = [];
  for (const record of records) {
    const at = firstEntries.get(`${record.id}\u0000${fromStage}`);
    if (at === undefined) continue;
    const iso = new Date(at).toISOString().slice(0, 10);
    if ((from && iso < from) || (to && iso > to)) continue;
    const target = stageIndex(toStage, stages);
    const won = record.outcome === 'Выиграна' && target >= stageIndex('s8', stages);
    cohort.push({ record, at, reached: (furthest.get(record.id) ?? -1) >= target || won });
  }
  const reached = cohort.filter((r) => r.reached).length;
  return { total: cohort.length, reached, rate: cohort.length ? reached / cohort.length : null, records: cohort };
}

export function stageRegressions(history, stages, ownerKey) {
  const owners = new Set();
  let transitions = 0;
  for (const entry of history) {
    const previous = stageIndex(entry.previousStage, stages);
    const next = stageIndex(entry.newStage, stages);
    if (previous >= 0 && next >= 0 && next < previous) {
      transitions++;
      owners.add(entry[ownerKey]);
    }
  }
  return { transitions, records: owners.size };
}

export function currentStageConversion(stages, rows) {
  return stages.map((stage, index) => {
    const count = rows.filter((r) => r.stage === stage.id).length;
    const previousCount = index > 0 ? rows.filter((r) => r.stage === stages[index - 1].id).length : 0;
    return { stage, count, previousCount, rate: index > 0 && previousCount ? count / previousCount : null };
  });
}
