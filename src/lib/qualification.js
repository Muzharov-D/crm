/**
 * Evidence-based deal qualification and forecast probability.
 *
 * The model follows the supplied ABR workbook: named facts count in full,
 * a leading "?" counts as half, an empty answer counts as zero. Quality
 * adjusts the stage probability and risk flags reduce it. No UI or storage
 * dependencies live here, so the calculation is identical in forms, boards,
 * forecasts and tests.
 */

export const QUALIFICATION_FIELDS = [
  { key: 'clientTeam', label: 'Команда клиента', weight: 20, hint: 'Владелец процесса, ИТ, ИБ — имена и роли' },
  { key: 'economicBuyer', label: 'Кто платит', weight: 20, hint: 'Имя и должность владельца бюджета' },
  { key: 'champion', label: 'Кто продвигает', weight: 15, hint: 'Что человек уже сделал для продвижения сделки' },
  { key: 'externalDeadline', label: 'Внешний срок', weight: 15, hint: 'Дата и причина, почему результат нужен именно тогда' },
];

export const INVESTMENT_OPTIONS = [
  { value: '', label: 'Не указано' },
  { value: 'none', label: 'Ничего' },
  { value: 'time', label: 'Время команды' },
  { value: 'data', label: 'Данные и доступы' },
  { value: 'environment', label: 'Стенд или среда' },
  { value: 'paid-pilot', label: 'Оплатил пилот' },
];

export const BUDGET_OPTIONS = [
  { value: '', label: 'Не указано' },
  { value: 'approved', label: 'Утверждён' },
  { value: 'declared', label: 'Заявлен' },
  { value: 'none', label: 'Нет' },
];

export const PURCHASE_OPTIONS = [
  { value: '', label: 'Не указано' },
  { value: 'unknown', label: 'Ещё не знают' },
  { value: 'direct', label: 'Прямая закупка' },
  { value: 'competition', label: 'Конкурс' },
  { value: 'tender', label: 'Тендер' },
  { value: '44-fz', label: '44-ФЗ' },
  { value: '223-fz', label: '223-ФЗ' },
  { value: 'internal', label: 'Внутренняя процедура' },
];

export const MANAGER_CONFIDENCE_OPTIONS = [
  { value: '', label: 'Не задана' },
  { value: 'high', label: 'Высокая · 75%' },
  { value: 'medium', label: 'Средняя · 40%' },
  { value: 'low', label: 'Низкая · 10%' },
];

export const FORECAST_MODES = [
  { value: 'stage', label: 'По этапу', hint: 'Вероятность этапа или индивидуальная уверенность в сделке' },
  { value: 'manager', label: 'По ставке менеджера', hint: 'Высокая 75%, средняя 40%, низкая 10%; иначе вероятность этапа' },
  { value: 'model', label: 'По модели', hint: 'Вероятность этапа × качество × риски' },
];

const INVESTMENT_SCORE = { none: 0, time: 0.5, data: 0.75, environment: 1, 'paid-pilot': 1 };
const BUDGET_SCORE = { approved: 1, declared: 0.5, none: 0 };
const PURCHASE_SCORE = { unknown: 0, direct: 1, competition: 1, tender: 1, '44-fz': 1, '223-fz': 1, internal: 1 };
const MANAGER_PROBABILITY = { high: 0.75, medium: 0.4, low: 0.1 };
const REFERENCE_SCORES = [15, 30, 45, 60, 75, 75, 80, 85];
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const text = (v, max = 1000) => typeof v === 'string' ? v.slice(0, max) : '';
const allowed = (value, options) => options.some((o) => o.value === value) ? value : '';

export function normalizeQualification(raw = {}) {
  const q = raw && typeof raw === 'object' ? raw : {};
  return {
    clientTeam: text(q.clientTeam),
    economicBuyer: text(q.economicBuyer),
    champion: text(q.champion),
    externalDeadline: text(q.externalDeadline),
    clientInvestment: allowed(q.clientInvestment || '', INVESTMENT_OPTIONS),
    budget: allowed(q.budget || '', BUDGET_OPTIONS),
    purchaseType: allowed(q.purchaseType || '', PURCHASE_OPTIONS),
    competitors: text(q.competitors),
    nextStepDate: typeof q.nextStepDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.nextStepDate) ? q.nextStepDate : '',
    managerConfidence: allowed(q.managerConfidence || '', MANAGER_CONFIDENCE_OPTIONS),
  };
}

/** A named fact = 1, an explicit assumption ("?Петров") = 0.5, blank = 0. */
export function factScore(value) {
  const s = text(value).trim();
  if (!s) return 0;
  return s.startsWith('?') ? 0.5 : 1;
}

export function qualityScore(raw) {
  const q = normalizeQualification(raw);
  const facts = QUALIFICATION_FIELDS.reduce((sum, f) => sum + f.weight * factScore(q[f.key]), 0);
  const investment = 15 * (INVESTMENT_SCORE[q.clientInvestment] || 0);
  const budget = 10 * (BUDGET_SCORE[q.budget] || 0);
  const purchase = 5 * (PURCHASE_SCORE[q.purchaseType] || 0);
  return Math.round(clamp(facts + investment + budget + purchase, 0, 100));
}

function stagePosition(stageId, stages) {
  const open = stages.filter((s) => s.id !== 'won' && s.id !== 'lost');
  const index = open.findIndex((s) => s.id === stageId);
  return index < 0 ? 0 : index;
}

function stageProbability(stageId, stages) {
  const stage = stages.find((s) => s.id === stageId);
  return clamp(Number(stage?.probability) || 0, 0, 1);
}

/**
 * Risk rules are tied to the position in the funnel, not to how busy the
 * seller was. Penalties mirror the workbook: light 4%, medium 8%, critical
 * 15%, and the combined risk factor never falls below 40%.
 */
export function qualificationMetrics(deal, { stages = [], now = Date.now() } = {}) {
  const q = normalizeQualification(deal?.qualification);
  const score = qualityScore(q);
  const position = stagePosition(deal?.stage, stages);
  const referenceScore = REFERENCE_SCORES[Math.min(position, REFERENCE_SCORES.length - 1)];
  const qualityFactor = clamp(1 + (score - referenceScore) * 0.006, 0.55, 1.15);
  const flags = [];
  const add = (severity, label, action) => flags.push({ severity, label, action });

  if (Number(deal?.updatedAt) && now - Number(deal.updatedAt) > 45 * 86400000) {
    add('critical', 'Больше 45 дней без обновления', 'Обновить факты и согласовать следующий шаг');
  }
  if (position >= 3 && !q.purchaseType) {
    add('medium', 'Не указан тип покупки', 'Выяснить закупочную процедуру');
  }
  if (position >= 4) {
    if (!q.clientTeam) add('medium', 'Неизвестна команда клиента', 'Попросить назначить владельца и проектную команду');
    if (!q.champion) add('medium', 'Нет подтверждённого сторонника', 'Найти человека, который продвигает решение');
  }
  if (position >= 5) {
    if (!q.economicBuyer) add('critical', 'Неизвестен экономический покупатель', 'Назвать человека, который защищает бюджет');
    if (!q.externalDeadline) add('medium', 'Нет внешнего срока', 'Зафиксировать событие, ограничивающее сроки');
    if (!q.purchaseType || q.purchaseType === 'unknown') add('critical', 'Закупочная процедура неясна', 'Согласовать путь закупки и его этапы');
  }
  if (position >= 6 && q.budget === 'declared') {
    add('light', 'Бюджет только заявлен', 'Получить подтверждение бюджета');
  }
  if (position >= 4 && !q.competitors) {
    add('light', 'Не указаны конкуренты', 'Выяснить, с чем сравнивают решение');
  }
  if (!q.nextStepDate && deal?.stage !== 'won' && deal?.stage !== 'lost') {
    add('light', 'Нет даты следующего шага', 'Согласовать действие и дату с клиентом');
  }

  const severityPenalty = { critical: 0.15, medium: 0.08, light: 0.04 };
  const penalty = flags.reduce((sum, f) => sum + severityPenalty[f.severity], 0);
  const riskFactor = clamp(1 - penalty, 0.4, 1);
  const base = stageProbability(deal?.stage, stages);
  const rawProbability = base * qualityFactor * riskFactor;
  const probability = deal?.stage === 'won' ? 1 : deal?.stage === 'lost' ? 0 : clamp(rawProbability, 0.01, 0.95);
  const managerProbability = MANAGER_PROBABILITY[q.managerConfidence] ?? null;
  const divergence = managerProbability === null ? null : Math.abs(managerProbability - probability);
  if (divergence !== null && divergence > 0.25) {
    add('light', 'Ставка менеджера расходится с моделью', 'Обсудить факты и пересмотреть ставку');
  }

  return {
    score, referenceScore, qualityFactor, riskFactor, probability,
    managerProbability, divergence, flags,
  };
}

export function forecastModeLabel(mode) {
  return FORECAST_MODES.find((m) => m.value === mode)?.label || FORECAST_MODES[0].label;
}
