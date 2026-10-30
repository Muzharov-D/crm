import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  weightedPipeline, pipelineValue, wonInMonth, winRate, stageSummary, isTerminalStage,
  stalledDeals, daysInStage, goalProgress,
} from '../lib/forecast.js';
import { recurringSummary, pipelineMRR } from '../lib/recurring.js';
import { touchProgress } from '../lib/activity.js';
import { goingCold, noNextStep, noDecisionMaker } from '../lib/attention.js';
import {
  todayISO, monthKey, shiftMonthKey, compactMoney, sinceLabel, countLabel,
} from '../lib/util.js';
import {
  pageHead, emptyState, statTile, taskRow, activityRow, section, stageBadge, avatar,
} from '../ui/bits.js';
import { openContactForm, openDealForm, openTaskForm, openActivityForm } from '../ui/mvp-forms.js';
import { openOnboarding } from '../ui/onboarding.js';
import { forecastModeLabel } from '../lib/qualification.js';
import { blockEnabled, moduleEnabled } from '../lib/workspace.js';
import { dataQuality } from '../lib/operations.js';
import { canWrite } from '../lib/access.js';

/** Rows the attention list shows before it says how many it is holding back. */
const ATTENTION_MAX = 6;

/* Full month names for the won tile: "Выиграно в октябре", "+12 тыс. ₽ к сентябрю". */
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MONTHS_TO = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню',
  'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];

/** A YYYY-MM key in one of the case tables above, with the year only outside the current one. */
function monthIn(key, forms) {
  const [y, m] = key.split('-').map(Number);
  return `${forms[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** One drifting lead, with the two actions that revive it. */
function coldRow({ contact, lastAt }) {
  return el('div.cold-row', {},
    avatar(contact.name),
    el('a.grow.min0', { href: `#/contacts?id=${contact.id}` },
      el('div.person-name', {}, contact.name),
      el('div.person-sub', {}, lastAt
        ? `Последнее касание ${sinceLabel(lastAt).text}`
        : `Записей нет · добавлен ${sinceLabel(todayISO(new Date(contact.createdAt))).text}`)
    ),
    el('button.icon-btn', {
      html: icon('video', 17, 2),
      'aria-label': `Записать в историю: ${contact.name}`,
      title: 'Записать в историю',
      onclick: () => openActivityForm(null, {
        presets: { contactId: contact.id, companyId: contact.companyId },
      }),
    }),
    el('button.icon-btn', {
      html: icon('followups', 17, 2),
      'aria-label': `Добавить задачу: ${contact.name}`,
      title: 'Добавить задачу',
      onclick: () => openTaskForm(null, { presets: { contactId: contact.id } }),
    })
  );
}

export function dashboardView() {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const { currency, stageProbabilities: overrides } = store.settings;
    const mode = store.settings.forecastMode || 'stage';
    const stageList = store.stages();

    const hasAnything = store.deals.length || store.contacts.length || store.companies.length;
    if (!hasAnything) {
      body.append(emptyState({
        icon: 'dashboard',
        title: 'Начнём продавать',
        message: 'Добавьте людей, с которыми ведёте переговоры, и сделки в работе — и эта страница станет утренней сводкой: что на сегодня, что сдвинулось и сколько стоит воронка.',
        action: el('div.empty-actions', {},
          el('button.btn.btn-primary', { onclick: () => openContactForm() }, 'Добавить контакт'),
          el('button.btn.btn-ghost', { onclick: openOnboarding }, 'Показать, как всё устроено')
        ),
      }));
      return;
    }

    const today = todayISO();
    const thisMonth = monthKey();
    const open = store.deals.filter((d) => !isTerminalStage(d.stage));
    const prevMonth = shiftMonthKey(thisMonth, -1);
    const wonNow = wonInMonth(store.deals, thisMonth);
    const wonPrev = wonInMonth(store.deals, prevMonth);
    const rate = winRate(store.deals);
    const goal = goalProgress(store.deals, store.settings.revenueGoal, thisMonth);
    /* Recurring revenue: committed MRR from won contracts still inside
       their term, plus what is still in play. The tile only appears once
       there is a subscription to report - a book of one-time deals has
       nothing to say here and doesn't need a fifth empty number. */
    const recurring = recurringSummary(store.deals, thisMonth);
    const openRecurring = pipelineMRR(store.deals);
    const showRecurring = recurring.count > 0 || openRecurring.count > 0;
    /* Touches this week against the weekly target - the number a founder
       can still do something about today. Only with a target set: without
       one the count is a fact, not progress. */
    const touches = touchProgress(store.activities, store.settings.touchTargets, today);
    const quality = dataQuality(store, today);

    const openTasks = store.openTasks();
    const needsAttention = openTasks.filter((t) => t.due <= today);
    const upcoming = openTasks.filter((t) => t.due > today).slice(0, 3);
    const stalled = stalledDeals(store.deals, store.settings.staleDays).slice(0, 3);
    const coldDays = store.settings.coldDays;
    const cold = goingCold(store.contacts, (id) => store.lastContactedAt(id), { coldDays }).slice(0, 4);
    const nextless = noNextStep(store.deals, {
      lastTouchOf: (d) => store.lastTouchedDeal(d),
      hasOpenTask: (id) => store.hasOpenTask(id),
      coldDays,
    }).slice(0, 3);
    /* Deals with nobody named as the person who signs. Only worth raising
       once the book has people on its deals at all - on a fresh account
       every deal would qualify, which is noise, not attention. */
    const anyRole = store.deals.some((d) => (d.contacts || []).some((e) => e.role));
    const undecided = anyRole ? noDecisionMaker(store.deals).slice(0, 3) : [];

    /* Won delta vs last month - only when last month had something to compare
       to. The month is named the way the tile's own label names this one:
       "vs Jul", not "vs Jul 2026" beside "Won in Aug". The year comes back in
       January, where last month really is a different one - and dropping it
       the rest of the time keeps the line off a second row on a phone. */
    const delta = wonPrev > 0
      ? { good: wonNow >= wonPrev, text: `${wonNow >= wonPrev ? '+' : '-'}${compactMoney(Math.abs(wonNow - wonPrev), currency)} к ${monthIn(prevMonth, MONTHS_TO)}` }
      : null;

    const stages = stageSummary(open, overrides, stageList, mode).filter((s) => !isTerminalStage(s.stage));
    const maxStage = Math.max(...stages.map((s) => s.value), 1);

    append(body, [
      blockEnabled(store.settings, 'dashboardKpis') && el('div.stat-grid', {
        className: `stat-grid${showRecurring || touches.pace ? ' wide' : ''}`,
      },
        statTile({
          label: 'В воронке',
          value: compactMoney(pipelineValue(store.deals), currency),
          sub: `${countLabel(open.length, ['сделка', 'сделки', 'сделок'])} в работе`,
        }),
        // The unit lives in the label, not the value: a "/mo" suffix on the
        // number is the character that tipped "$3,000/mo" into an ellipsis
        // in a phone-width tile.
        showRecurring && statTile({
          label: 'Выручка в месяц',
          value: compactMoney(recurring.mrr, currency),
          sub: recurring.count
            ? `${compactMoney(recurring.arr, currency)} в год · ${countLabel(recurring.count, ['договор', 'договора', 'договоров'])}`
            : `в открытых сделках: ${compactMoney(openRecurring.mrr, currency)} в месяц`,
        }),
        statTile({
          label: 'Взвешенный прогноз',
          value: compactMoney(weightedPipeline(store.deals, overrides, stageList, mode), currency),
          sub: forecastModeLabel(mode),
        }),
        goal.pace
          // With a goal set, the won tile answers "against what?" - amount,
          // share of target, and whether that share is ahead of the calendar.
          ? statTile({
              label: `Выиграно в ${monthIn(thisMonth, MONTHS_IN)}`,
              value: compactMoney(wonNow, currency),
              progress: {
                pct: goal.pct,
                tone: goal.pace === 'met' ? 'good' : goal.pace === 'behind' ? 'warn' : '',
                label: `${Math.round(goal.pct * 100)}% плана ${compactMoney(goal.goal, currency)}`,
              },
              sub: el('span', {},
                `${Math.round(goal.pct * 100)}% из ${compactMoney(goal.goal, currency)} · `,
                el('span', {
                  className: `stat-pace ${goal.pace === 'behind' ? 'warn' : 'good'}`,
                }, goal.pace === 'met' ? 'план выполнен'
                  : goal.pace === 'on-track' ? 'в графике'
                  : `отставание ${compactMoney(goal.gap, currency)}`)
              ),
            })
          : statTile({
              label: `Выиграно в ${monthIn(thisMonth, MONTHS_IN)}`,
              value: compactMoney(wonNow, currency),
              delta,
              sub: delta ? null : 'закрыто в этом месяце',
            }),
        statTile({
          label: 'Доля выигранных',
          value: rate.rate === null ? '—' : `${Math.round(rate.rate * 100)}%`,
          sub: rate.rate === null ? 'закрытых сделок пока нет' : `из ${countLabel(rate.won + rate.lost, ['закрытой', 'закрытых', 'закрытых'])}`,
        }),
        touches.pace && statTile({
          label: 'Касаний за неделю',
          value: `${touches.logged} из ${touches.target}`,
          progress: {
            pct: touches.pct,
            tone: touches.pace === 'met' ? 'good' : touches.pace === 'behind' ? 'warn' : '',
            label: `записано ${touches.logged} из ${touches.target}`,
          },
          // No link in the sub: at six tiles the line is narrow, and
          // "activity log" wrapped onto a row of its own for a
          // destination the nav already offers.
          sub: el('span', {
            className: `stat-pace ${touches.pace === 'behind' ? 'warn' : 'good'}`,
          }, touches.pace === 'met' ? 'план выполнен'
            : touches.pace === 'on-track' ? 'в графике'
            : `отставание ${touches.gap}`),
        })
      ),

      blockEnabled(store.settings, 'dashboardPulse') && section('Пульс работы',
        store.user?.role === 'admin' ? el('a.btn.btn-ghost.btn-sm', { href: '#/control' }, 'Настроить пульт') : null,
        el('div.pulse-grid', {},
          [
            ['Просрочено', quality.overdueTasks.length, '#/followups', 'задачи с прошедшим сроком'],
            ['Без следующего шага', quality.dealsWithoutNextStep.length, '#/pipeline', 'открытые сделки'],
            ['Возможные дубли', quality.companyDuplicates.length + quality.contactDuplicates.length, '#/companies', 'контрагенты и контакты'],
            ['Без ответственного', quality.leadsWithoutOwner.length, '#/leads', 'открытые лиды'],
          ].map(([label, count, hash, sub]) => el('a.pulse-item', { href: hash },
            el('span.pulse-item-top', {}, el('span', {}, label), el('strong', { className: count ? 'attention' : '' }, String(count))),
            el('small', {}, sub)))),
        quality.total === 0 && el('div.all-clear', { html: icon('check', 18, 2.4) },
          el('span', {}, 'Операционных замечаний нет — данные и следующие шаги в порядке.'))),

      blockEnabled(store.settings, 'dashboardAttention') && section('Требует внимания',
        el('a.btn.btn-ghost.btn-sm', { href: '#/followups' }, 'Все задачи'),
        needsAttention.length
          ? el('div.task-list', {}, needsAttention.slice(0, ATTENTION_MAX).map((t) =>
              taskRow(t, { onEdit: (task) => openTaskForm(task) })))
          : el('div.all-clear', { html: icon('check', 18, 2.4) },
              el('span', {}, 'Нет просроченных задач и задач на сегодня.')),
        // The cap keeps this page scannable, but it must not read as the
        // whole answer. Follow-ups come soonest-first, so a founder ten
        // days behind saw the ten oldest and nothing else - today's work
        // included - under a heading that claims to be what needs them now.
        needsAttention.length > ATTENTION_MAX && el('div.list-more-note', {},
          `Ещё ${needsAttention.length - ATTENTION_MAX}: просроченные и на сегодня`),
        upcoming.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Ближайшие'),
          el('div.task-list', {}, upcoming.map((t) => taskRow(t, { onEdit: (task) => openTaskForm(task) })))
        ),
        /* Deals nobody has moved in a while: the other half of "what needs
           me today", and invisible until now. */
        /* Who signs? A deal can look busy - calls logged, follow-ups
           booked - while nobody has named the person who can say yes. */
        undecided.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Не указано, кто принимает решение'),
          el('div.deal-list.flush', {}, undecided.map(({ deal }) =>
            el('div.deal-row', {},
              el('a.grow.min0', { href: `#/pipeline?id=${deal.id}` },
                el('div.deal-row-name', {}, deal.name),
                el('div.person-sub', {},
                  store.companyById(deal.companyId)?.name
                  || store.contactById(deal.contactId)?.name || 'Без привязки')
              ),
              el('button.btn.btn-ghost.btn-sm', {
                html: icon('userPlus', 14, 2),
                onclick: () => openDealForm(deal),
              }, ' Добавить')
            )))
        ),
        stalled.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Зависшие сделки'),
          el('div.deal-list.flush', {}, stalled.map((d) =>
            el('a.deal-row', { href: `#/pipeline?id=${d.id}` },
              el('div.grow.min0', {},
                el('div.deal-row-name', {}, d.name),
                el('div.person-sub', {},
                  store.companyById(d.companyId)?.name
                  || store.contactById(d.contactId)?.name || 'Без привязки')
              ),
              el('span.age-pill', { dataset: { tone: 'stalled' } },
                el('span', { html: icon('clock', 12, 2.2), 'aria-hidden': 'true' }),
                `${daysInStage(d)} дн. · ${stageList.find((s) => s.id === d.stage)?.label || d.stage}`)
            )))
        )
      ),

      /* Going cold: the risk nobody scheduled. Needs attention covers what
         you promised to do; this covers what you forgot to. */
      blockEnabled(store.settings, 'dashboardCold') && (cold.length > 0 || nextless.length > 0) && section('Остывают',
        el('a.btn.btn-ghost.btn-sm', { href: '#/contacts' }, 'Все контакты'),
        cold.length > 0 && el('div.cold-list', {}, cold.map((r) => coldRow(r))),
        nextless.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Открытые сделки без следующего шага'),
          el('div.deal-list.flush', {}, nextless.map((r) =>
            el('div.deal-row', {},
              el('a.grow.min0', { href: `#/pipeline?id=${r.deal.id}` },
                el('div.deal-row-name', {}, r.deal.name),
                el('div.person-sub', {}, r.lastAt
                  ? `Последнее касание ${sinceLabel(r.lastAt).text} · задач нет`
                  : 'Ни записей, ни задач')
              ),
              el('button.btn.btn-ghost.btn-sm', {
                html: icon('followups', 14, 2),
                onclick: () => openTaskForm(null, {
                  presets: { dealId: r.deal.id, contactId: r.deal.contactId },
                }),
              }, ' Задача')
            )))
        )
      ),

      (blockEnabled(store.settings, 'dashboardPipeline') || blockEnabled(store.settings, 'dashboardActivity')) && el('div.two-col', {},
        blockEnabled(store.settings, 'dashboardPipeline') && section('Воронка по этапам',
          el('a.btn.btn-ghost.btn-sm', { href: '#/pipeline' }, 'Открыть доску'),
          open.length
            ? el('div.stage-bars', {}, stages.map((s) => el('div.stage-bar-row', {},
                stageBadge(s.stage),
                el('div.stage-bar-track', {},
                  el('div.stage-bar-fill', {
                    style: { width: `${s.count ? Math.max(2, (s.value / maxStage) * 100) : 0}%` },
                  })),
                el('span.stage-bar-value', {},
                  s.count ? compactMoney(s.value, currency) : '–',
                  el('span.stage-bar-sub', {}, ` · ${s.count}`))
              )))
            : el('p.card-empty', {}, 'Открытых сделок нет. ',
                el('button.btn-inline', { onclick: () => openDealForm() }, 'Добавить'), '.')
        ),
        blockEnabled(store.settings, 'dashboardActivity') && section('Последние записи',
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('plus', 14, 2.2),
            onclick: () => openActivityForm(),
          }, ' Записать'),
          store.activities.length
            ? el('div.activity-list', {}, store.recentActivities(5).map((a) =>
                activityRow(a, { onEdit: (act) => openActivityForm(act) })))
            : el('p.card-empty', {}, 'Здесь появятся встречи, звонки и заметки, которые вы запишете.')
        )
      ),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  const username = store.user?.username;
  root.append(
    el('header.dashboard-hero', {},
      el('div.dashboard-hero-copy', {},
        el('div.brand-kicker.light', {}, 'АВАНДОК · ПУЛЬС ПРОДАЖ'),
        el('h1', {}, username ? `${greeting()}, ${username}` : greeting()),
        el('p', {}, 'Рабочий центр: показатели, риски и следующий шаг — без поиска по разным экранам.')),
      el('div.dashboard-hero-actions', {},
        moduleEnabled(store.settings, 'reports') && el('a.btn.btn-ghost', { href: '#/forecast' }, 'Отчётность'),
        moduleEnabled(store.settings, 'pipeline') && canWrite(store.user) && el('button.btn.btn-primary', {
          type: 'button', onclick: () => openDealForm(), 'aria-label': 'Новая сделка',
        }, el('span', { html: icon('plus', 16) }), 'Новая сделка'))),
    body
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
