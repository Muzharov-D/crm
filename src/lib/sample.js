/**
 * Sample dataset for "explore with sample data": a believable founder-led
 * pipeline - companies, contacts, deals across every stage, meeting history,
 * and follow-ups - shaped exactly like an export so store.importAll()
 * installs it and wipes it through the normal, already-hardened path.
 *
 * Dates are generated relative to today so the board, follow-ups, and
 * forecast always look alive no matter when the sample is loaded.
 */

import { uid, todayISO, addDays } from './util.js';

export function sampleDataset(store) {
  const now = Date.now();
  const today = todayISO();
  const day = 86400000;
  const ago = (d) => now - d * day;

  const co = {
    northwind: uid(), lumen: uid(), atlas: uid(),
    ferrous: uid(), quill: uid(), harbor: uid(),
  };
  const companies = [
    { id: co.northwind, name: 'Норд-Автоматика', industry: 'Производство', website: 'nord-avtomatika.ru', size: '200-500', notes: 'Пилот прошёл хорошо, дольше всего тянут закупки.', createdAt: ago(85) },
    { id: co.lumen, name: 'МедЛюмен', industry: 'Медицина', website: 'medlumen.ru', size: '50-200', notes: 'Перед внедрением обязательна проверка по защите персональных данных.', createdAt: ago(70) },
    { id: co.atlas, name: 'Атлас-Транс', industry: 'Логистика', website: 'atlas-trans.ru', size: '500+', notes: '', createdAt: ago(60) },
    { id: co.ferrous, name: 'Феррум Финанс', industry: 'Финансы', website: 'ferrum-finance.ru', size: '10-50', notes: 'Порекомендовала Дарья из «Атлас-Транс».', createdAt: ago(38) },
    { id: co.quill, name: 'Перо Аналитика', industry: 'Разработка ПО', website: 'pero-analytics.ru', size: '10-50', notes: '', createdAt: ago(24) },
    { id: co.harbor, name: 'Гавань Снаб', industry: 'Розничная торговля', website: 'gavan-snab.ru', size: '50-200', notes: 'Бюджет сезонный: решения принимают в IV квартале.', createdAt: ago(12) },
  ];

  const ct = {
    mei: uid(), tomas: uid(), dana: uid(), priya: uid(),
    jordan: uid(), sam: uid(), alex: uid(), noor: uid(), lena: uid(),
  };
  const contacts = [
    { id: ct.mei, name: 'Марина Тихонова', title: 'Директор по производству', email: 'm.tikhonova@nord-avtomatika.ru', phone: '+7 921 407-21-42', companyId: co.northwind, source: 'Конференция', status: 'active', tags: ['ЛПР'], notes: 'Принимает решение. Предпочитает короткие звонки, а не письма.', createdAt: ago(85) },
    { id: ct.tomas, name: 'Тимур Рахимов', title: 'Начальник цеха', email: 't.rakhimov@nord-avtomatika.ru', phone: '+7 921 418-07-78', companyId: co.northwind, source: 'Рекомендация', status: 'active', tags: ['чемпион'], notes: 'Продвигает нас на производстве, подключает Марину.', createdAt: ago(80) },
    { id: ct.dana, name: 'Дарья Воронцова', title: 'Руководитель отдела закупок', email: 'd.vorontsova@atlas-trans.ru', phone: '+7 916 230-11-17', companyId: co.atlas, source: 'Холодный контакт', status: 'customer', tags: ['чемпион', 'расширение'], notes: 'Подписала пилот на автопарке. Продление обсуждаем в I квартале.', createdAt: ago(60) },
    { id: ct.priya, name: 'Павел Ершов', title: 'Технический директор', email: 'p.ershov@medlumen.ru', phone: '+7 903 561-01-63', companyId: co.lumen, source: 'Сайт', status: 'active', notes: 'Отвечает за техническую часть, сначала хочет проверку безопасности.', createdAt: ago(70) },
    { id: ct.jordan, name: 'Юрий Белов', title: 'Финансовый директор', email: 'y.belov@ferrum-finance.ru', phone: '+7 925 118-01-86', companyId: co.ferrous, source: 'Рекомендация', status: 'active', notes: '', createdAt: ago(38) },
    { id: ct.sam, name: 'Сергей Осипов', title: 'Основатель', email: 'sergey@pero-analytics.ru', phone: '+7 911 702-01-29', companyId: co.quill, source: 'Соцсети', status: 'lead', notes: 'Ответил на пост о запуске, интересуется ценами.', createdAt: ago(24) },
    { id: ct.alex, name: 'Алексей Морозов', title: 'Руководитель склада', email: 'a.morozov@gavan-snab.ru', phone: '+7 926 335-01-95', companyId: co.harbor, source: 'Входящая заявка', status: 'lead', notes: 'Оставил заявку на демо. Созвона ещё не было.', createdAt: ago(12) },
    { id: ct.noor, name: 'Нина Гаврилова', title: 'Директор по ИТ', email: 'n.gavrilova@medlumen.ru', phone: '+7 903 561-01-51', companyId: co.lumen, source: 'Сайт', status: 'active', notes: 'Ведёт чек-лист по безопасности.', createdAt: ago(55) },
    { id: ct.lena, name: 'Елена Киселёва', title: 'Операционный директор', email: 'e.kiseleva@pochta-demo.ru', phone: '+7 999 204-01-09', companyId: null, source: 'Конференция', status: 'lead', tags: ['с конференции'], notes: 'Познакомились на конференции «Цифровой бизнес». Компания определится после слияния.', createdAt: ago(6) },
  ];

  // Deals across every stage: two closed months back (one won, one lost),
  // one won this month, and open deals spread over the coming months.
  // Each carries the journey that got it there, so time-in-stage, the
  // stalled markers, and per-stage velocity all have something to show.
  // Two of them are subscriptions - one won, one in play - so recurring
  // revenue, the MRR tile, and the spread forecast are visible too. Two
  // carry a buying committee, so roles and the missing-decision-maker
  // nudge have something to show as well.
  const hist = (...pairs) => pairs.map(([stage, d]) => ({ stage, at: ago(d) }));
  const deals = [
    { id: uid(), name: 'Атлас-Транс — пилот на автопарке', value: 180000, billing: 'monthly', term: 6, stage: 'won', contactId: ct.dana, companyId: co.atlas, expectedClose: addDays(today, -40), notes: 'Подписали пилот на 6 месяцев.', closeReason: 'Подошёл продукт', closeReasonNote: 'Цифры экономии топлива по итогам теста убедили лучше любой презентации.', createdAt: ago(58), updatedAt: ago(40), closedAt: ago(40), stageHistory: hist(['new', 58], ['qualified', 53], ['proposal', 48], ['negotiation', 44], ['won', 40]) },
    { id: uid(), name: 'Перо Аналитика — стартовый тариф', value: 290000, stage: 'lost', contactId: ct.sam, companyId: co.quill, expectedClose: addDays(today, -25), notes: 'Решили делать своими силами, вернуться через полгода.', closeReason: 'Нет бюджета', closeReasonNote: 'Время своих разработчиков им ничего не стоит, а наше стоит денег.', createdAt: ago(24), updatedAt: ago(20), closedAt: ago(20), stageHistory: hist(['new', 24], ['qualified', 22], ['lost', 20]) },
    { id: uid(), name: 'Феррум Финанс — модуль отчётности', value: 450000, stage: 'won', contactId: ct.jordan, companyId: co.ferrous, expectedClose: addDays(today, -2), notes: '', closeReason: 'Рекомендация', closeReasonNote: 'Дарья из «Атлас-Транс» порекомендовала нас сама.', createdAt: ago(30), updatedAt: ago(2), closedAt: ago(2), stageHistory: hist(['new', 30], ['qualified', 26], ['proposal', 15], ['negotiation', 7], ['won', 2]) },
    { id: uid(), name: 'Норд-Автоматика — внедрение на производстве', value: 2500000, stage: 'negotiation', contactId: ct.mei, contacts: [{ contactId: ct.mei, role: 'decision-maker' }, { contactId: ct.tomas, role: 'champion' }], companyId: co.northwind, expectedClose: addDays(today, 18), notes: 'Договор у юристов. Цель — подписать до конца месяца.', createdAt: ago(75), updatedAt: ago(3), closedAt: null, stageHistory: hist(['new', 75], ['qualified', 62], ['proposal', 40], ['negotiation', 11]) },
    { id: uid(), name: 'МедЛюмен — лицензия платформы', value: 180000, billing: 'monthly', term: 12, stage: 'proposal', contactId: ct.priya, contacts: [{ contactId: ct.priya, role: 'influencer' }, { contactId: ct.noor, role: 'blocker' }], companyId: co.lumen, expectedClose: addDays(today, 35), notes: 'КП отправлено, всё упирается в проверку безопасности.', createdAt: ago(50), updatedAt: ago(5), closedAt: null, stageHistory: hist(['new', 50], ['qualified', 44], ['proposal', 33]) },
    { id: uid(), name: 'Атлас-Транс — весь автопарк', value: 3900000, stage: 'qualified', contactId: ct.dana, companyId: co.atlas, expectedClose: addDays(today, 60), notes: 'Сначала нужны итоги пилота. Дарья за.', tags: ['расширение'], createdAt: ago(20), updatedAt: ago(4), closedAt: null, stageHistory: hist(['new', 20], ['qualified', 13]) },
    { id: uid(), name: 'Гавань Снаб — стартовый тариф', value: 580000, stage: 'new', contactId: ct.alex, companyId: co.harbor, expectedClose: addDays(today, 45), notes: '', createdAt: ago(10), updatedAt: ago(10), closedAt: null, stageHistory: hist(['new', 10]) },
    { id: uid(), name: 'МедЛюмен — внедрение и обучение', value: 480000, stage: 'qualified', contactId: ct.noor, companyId: co.lumen, expectedClose: addDays(today, 40), notes: 'Зависит от сделки по платформе.', tags: ['расширение'], createdAt: ago(28), updatedAt: ago(6), closedAt: null, stageHistory: hist(['new', 28], ['qualified', 21]) },
    { id: uid(), name: 'Елена Киселёва — платформа после слияния', value: 1500000, stage: 'new', contactId: ct.lena, companyId: null, expectedClose: addDays(today, 75), notes: 'Ждём, пока завершится слияние.', createdAt: ago(5), updatedAt: ago(5), closedAt: null, stageHistory: hist(['new', 5]) },
  ];
  const deal = (name) => deals.find((d) => d.name.startsWith(name))?.id ?? null;

  const activities = [
    { id: uid(), type: 'meeting', date: addDays(today, -75), summary: 'Вводное демо с Мариной и Тимуром', notes: 'Хорошо ложится на задачу сборочной линии. Тимур будет продвигать нас внутри.', contactId: ct.mei, companyId: co.northwind, dealId: deal('Норд-Автоматика'), createdAt: ago(75) },
    { id: uid(), type: 'call', date: addDays(today, -46), summary: 'Созвон с Дарьей по условиям пилота', notes: '10 машин, 6 месяцев. Критерий успеха — экономия топлива 8%.', contactId: ct.dana, companyId: co.atlas, dealId: deal('Атлас-Транс — пилот'), createdAt: ago(46) },
    { id: uid(), type: 'email', date: addDays(today, -33), summary: 'Отправили КП Павлу', notes: 'Приложили документы по защите персональных данных и ответы на опросник по безопасности.', contactId: ct.priya, companyId: co.lumen, dealId: deal('МедЛюмен — лицензия'), createdAt: ago(33) },
    { id: uid(), type: 'meeting', date: addDays(today, -14), summary: 'Выезд на производство «Норд-Автоматики»', notes: 'Интеграция со второй линией возможна. Марина хочет запуск до высокого сезона.', contactId: ct.tomas, companyId: co.northwind, dealId: deal('Норд-Автоматика'), createdAt: ago(14) },
    { id: uid(), type: 'call', date: addDays(today, -7), summary: 'Старт проверки безопасности с Ниной', notes: 'В чек-листе 40 пунктов, большинство уже закрыто. По двум нужен ответ разработчиков.', contactId: ct.noor, companyId: co.lumen, dealId: deal('МедЛюмен — лицензия'), createdAt: ago(7) },
    { id: uid(), type: 'email', date: addDays(today, -6), summary: 'Вопросы Сергея по ценам', notes: 'Спрашивал о скидке при оплате за год. Ответили, ответа пока нет.', contactId: ct.sam, companyId: co.quill, dealId: null, createdAt: ago(6) },
    { id: uid(), type: 'meeting', date: addDays(today, -3), summary: 'Переговоры по договору с «Норд-Автоматикой»', notes: 'Осталось два спорных пункта: лимит ответственности и условия оплаты. Юристы смотрят.', contactId: ct.mei, companyId: co.northwind, dealId: deal('Норд-Автоматика'), createdAt: ago(3) },
    { id: uid(), type: 'note', date: addDays(today, -2), summary: 'Модуль отчётности для «Феррум Финанс» выигран', notes: 'Юрий подписал. Стартовая встреча с их аналитиком назначена.', contactId: ct.jordan, companyId: co.ferrous, dealId: deal('Феррум'), createdAt: ago(2) },
    { id: uid(), type: 'call', date: addDays(today, -1), summary: 'Квалификационный звонок с Алексеем', notes: 'Бюджет в этом квартале есть. Нужно согласование с операционным директором.', contactId: ct.alex, companyId: co.harbor, dealId: deal('Гавань'), createdAt: ago(1) },
  ];

  const tasks = [
    { id: uid(), title: 'Напомнить юристам «Норд-Автоматики» о правках в договор', due: addDays(today, -1), done: false, doneAt: null, contactId: ct.mei, dealId: deal('Норд-Автоматика'), createdAt: ago(3) },
    { id: uid(), title: 'Отправить ответы разработчиков по чек-листу «МедЛюмена»', due: today, done: false, doneAt: null, contactId: ct.noor, dealId: deal('МедЛюмен — лицензия'), createdAt: ago(7) },
    { id: uid(), title: 'Назначить демо с Алексеем и операционным директором', due: addDays(today, 2), done: false, doneAt: null, contactId: ct.alex, dealId: deal('Гавань'), createdAt: ago(1) },
    { id: uid(), title: 'Вернуться к Сергею по ценам', due: addDays(today, 3), done: false, doneAt: null, contactId: ct.sam, dealId: null, createdAt: ago(6) },
    { id: uid(), title: 'Подготовить презентацию с итогами пилота для «Атлас-Транс»', due: addDays(today, 9), done: false, doneAt: null, contactId: ct.dana, dealId: deal('Атлас-Транс — весь'), createdAt: ago(4) },
    { id: uid(), title: 'Связаться с Еленой после новостей о слиянии', due: addDays(today, 21), done: false, doneAt: null, contactId: ct.lena, dealId: null, repeat: { every: 1, unit: 'month' }, createdAt: ago(5) },
    { id: uid(), title: 'Отправить Павлу документы по безопасности', due: addDays(today, -33), done: true, doneAt: ago(33), contactId: ct.priya, dealId: deal('МедЛюмен — лицензия'), createdAt: ago(35) },
    { id: uid(), title: 'Назначить стартовую встречу с «Феррум Финанс»', due: addDays(today, -1), done: true, doneAt: ago(1), contactId: ct.jordan, dealId: deal('Феррум'), createdAt: ago(2) },
  ];

  const templates = [
    { id: uid(), name: 'Если контакт затих', subject: 'Актуально ли для {{company}}?', body: 'Здравствуйте, {{firstName}}.\n\nНекоторое время назад мы общались, и хочу уточнить: вопрос ещё актуален?\n\nМожем продолжить с того места, где остановились, в любое удобное для вас время.\n', createdAt: ago(30) },
    { id: uid(), name: 'Итоги встречи', subject: 'Итоги и следующие шаги: {{dealName}}', body: 'Здравствуйте, {{firstName}}.\n\nСпасибо за встречу. Коротко о том, к чему пришли и что дальше:\n\n- \n- \n\nЕсли что-то не учтено, просто ответьте на это письмо.\n', createdAt: ago(30) },
  ];

  return {
    app: 'crm',
    version: 1,
    // The demo deals reference the default funnel, so the sample ships it -
    // a custom stage list would leave every deal in the first column.
    settings: { ...store.settings, sampleData: true, onboarded: true, stages: null },
    companies,
    contacts,
    deals,
    activities,
    tasks,
    templates,
  };
}

/** One-tap exit from sample mode: everything gone, defaults back, wizard reopens. */
export async function wipeSampleData(store) {
  await store.importAll({
    app: 'crm',
    version: 1,
    settings: { ...store.settings, sampleData: false, onboarded: false },
    companies: [],
    contacts: [],
    deals: [],
    activities: [],
    tasks: [],
  }, { reason: 'wipe' });
}
