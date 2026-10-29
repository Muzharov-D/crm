import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import {
  forecastByMonth, weightedPipeline, pipelineValue, stageSummary,
  winRate, avgSalesCycle, isTerminalStage, stageVelocity, isOpen,
  closeReasonBreakdown, winRateBy, avgClosedValue, goalProgress, pipelineCoverage,
} from '../lib/forecast.js';
import { formatMonth, formatMoney, compactMoney, countLabel, plural } from '../lib/util.js';
import { isRecurring } from '../lib/recurring.js';
import { monthlyFlows, winRateTrend, salesCycleTrend } from '../lib/trends.js';
import { funnelReport, FUNNEL_WINDOWS, matchesFunnelWindow } from '../lib/funnel.js';
import { pageHead, emptyState, statTile, section, stageBadge } from '../ui/bits.js';
import { forecastChart } from '../charts/forecast-chart.js';
import { flowsChart, miniTrend } from '../charts/trends-chart.js';
import { funnelChart } from '../charts/funnel-chart.js';
import { openDealForm } from '../ui/forms.js';

const HORIZON = 6;
const DEALS = ['сделка', 'сделки', 'сделок'];

/** One side of the why-deals-close comparison: reasons ranked by count. */
function reasonColumn(title, tone, breakdown, max, currency) {
  const total = breakdown.rows.reduce((n, r) => n + r.count, 0);
  return el('div.wl-col', {},
    el('h3.wl-col-title', {},
      el('span.stage-badge', { dataset: { stage: tone } },
        el('span.stage-dot', { 'aria-hidden': 'true' }), title),
      el('span.wl-col-count', {}, `с причиной: ${total}`)
    ),
    breakdown.rows.length
      ? el('div.stage-bars', {}, breakdown.rows.map((r) => el('div.wl-bar-row', {},
          el('span.wl-bar-label', {}, r.reason),
          el('div.stage-bar-track', {},
            el('div.stage-bar-fill', {
              className: `stage-bar-fill ${tone}`,
              style: { width: `${Math.max(4, (r.count / max) * 100)}%` },
            })),
          el('span.stage-bar-value', {}, String(r.count),
            el('span.stage-bar-sub', {}, ` · ${compactMoney(r.value, currency)}`))
        )))
      : el('p.card-empty.flush', {}, breakdown.unrecorded
          ? 'Причины пока не указаны.'
          : `${tone === 'won' ? 'Выигранных' : 'Проигранных'} сделок пока нет.`)
  );
}

/** Win rate for one grouping (lead source, industry…), most-closed first. */
function rateTable(label, rows, currency) {
  return el('div.wl-table', {},
    el('h3.wl-col-title', {}, label),
    el('div.table-wrap.flush', {},
      el('table.data-table', {},
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, label),
          el('th.num', { scope: 'col' }, 'Выиграно'),
          el('th.num', { scope: 'col' }, 'Проиграно'),
          el('th.num', { scope: 'col' }, 'Доля выигранных'),
          el('th.num', { scope: 'col' }, 'Сумма выигранных')
        )),
        el('tbody', {}, rows.map((r) => el('tr', {},
          el('th', { scope: 'row' }, r.key),
          el('td.num', {}, String(r.won)),
          el('td.num', {}, String(r.lost)),
          el('td.num', {}, `${Math.round(r.rate * 100)}%`),
          el('td.num', {}, r.wonValue ? formatMoney(r.wonValue, currency) : '–')
        )))
      )
    )
  );
}

export function forecastView() {
  const root = el('div.view');
  const body = el('div');
  /* The conversion cohort: which deals the funnel below is about. Kept on
     the view so switching it doesn't reset the page. */
  let cohort = 'all';

  function render() {
    clear(body);
    const { currency, stageProbabilities: overrides } = store.settings;
    const stageList = store.stages();
    const open = store.deals.filter((d) => !isTerminalStage(d.stage));

    if (!store.deals.length) {
      body.append(emptyState({
        icon: 'chart',
        title: 'Прогнозировать пока нечего',
        message: 'Укажите у каждой сделки сумму и дату закрытия, и здесь появится помесячный прогноз выручки по воронке.',
        action: el('button.btn.btn-primary', { onclick: () => openDealForm() }, 'Добавить сделку'),
      }));
      return;
    }

    const rows = forecastByMonth(store.deals, { months: HORIZON, overrides, stages: stageList });
    const weighted = weightedPipeline(store.deals, overrides, stageList);
    const goal = goalProgress(store.deals, store.settings.revenueGoal);
    const coverage = pipelineCoverage(weighted, goal.remaining);
    const rate = winRate(store.deals);
    const cycle = avgSalesCycle(store.deals);

    /* Per-stage contribution: how the weighted number is built. */
    const stages = stageSummary(open, overrides, stageList).filter((s) =>
      !isTerminalStage(s.stage) && s.count > 0);
    const maxStage = Math.max(...stages.map((s) => s.weighted), 1);

    const velocity = stageVelocity(store.deals, stageList);
    const maxVelocity = Math.max(...velocity.map((v) => v.days || 0), 1);

    /* Trajectory: everything derived at render time from createdAt,
       closedAt, and values - no snapshots, no new stored data. */
    const flows = monthlyFlows(store.deals);
    const anyFlow = flows.some((r) => r.added.count || r.won.count || r.lost.count);
    const rateTrend = winRateTrend(flows);
    const cycleTrend = salesCycleTrend(store.deals);

    /* Win/loss analysis over everything that has closed. */
    const closed = store.deals.filter((d) => !isOpen(d));
    const wonReasons = closeReasonBreakdown(closed, 'won');
    const lostReasons = closeReasonBreakdown(closed, 'lost');
    const maxReason = Math.max(
      ...wonReasons.rows.map((r) => r.count), ...lostReasons.rows.map((r) => r.count), 1);
    const averages = avgClosedValue(closed);
    const bySource = winRateBy(closed, (d) => store.contactById(d.contactId)?.source);
    const byIndustry = winRateBy(closed, (d) => store.companyById(d.companyId)?.industry);

    append(body, [
      el('div.stat-grid', { className: `stat-grid${coverage === null ? '' : ' wide'}` },
        statTile({
          label: 'Взвешенная воронка',
          value: compactMoney(weighted, currency),
          sub: 'сумма × вероятность этапа',
        }),
        coverage !== null && statTile({
          label: 'Покрытие плана',
          value: `${String(coverage).replace('.', ',')}×`,
          sub: `взвешенная к ${compactMoney(goal.remaining, currency)} до плана в этом месяце`,
        }),
        statTile({
          label: 'Максимум',
          value: compactMoney(pipelineValue(store.deals), currency),
          sub: countLabel(open.length, ['открытая сделка', 'открытые сделки', 'открытых сделок']),
        }),
        statTile({
          label: 'Доля выигранных',
          value: rate.rate === null ? '—' : `${Math.round(rate.rate * 100)}%`,
          sub: rate.rate === null ? 'закрытых сделок пока нет' : `выиграно ${rate.won} · проиграно ${rate.lost}`,
        }),
        statTile({
          label: 'Цикл сделки',
          value: cycle === null ? '—' : `${cycle} дн.`,
          sub: cycle === null ? 'появится после первой выигранной сделки' : 'в среднем от создания до выигрыша',
        })
      ),

      section(`Ближайшие ${countLabel(HORIZON, ['месяц', 'месяца', 'месяцев'])}`, null,
        el('div.settings-body', {},
          forecastChart(rows, currency, { goal: goal.goal }),
          // Say it where the shape of the chart depends on it: a
          // subscription is not a spike in its close month.
          store.deals.some(isRecurring) && el('p.settings-note.mt-sm', {},
            'Регулярные сделки распределены по месяцам оплаты, а не учтены целиком в месяце закрытия.')
        )
      ),

      section('По месяцам', null,
        el('div.table-wrap', {},
          el('table.data-table', {},
            el('thead', {}, el('tr', {},
              el('th', { scope: 'col' }, 'Месяц'),
              el('th.num', { scope: 'col' }, 'Сделки'),
              el('th.num', { scope: 'col' }, 'Максимум'),
              el('th.num', { scope: 'col' }, 'Взвешенно'),
              el('th.num', { scope: 'col' }, 'Выиграно')
            )),
            el('tbody', {}, rows.map((r) => el('tr', {},
              el('th', { scope: 'row' }, formatMonth(r.key)),
              el('td.num', {}, String(r.count)),
              el('td.num', {}, formatMoney(r.best, currency)),
              el('td.num', {}, formatMoney(r.weighted, currency)),
              el('td.num', {}, r.won ? formatMoney(r.won, currency) : '–')
            )))
          )
        )
      ),

      /* The trajectory: is the top of the funnel keeping up with the
         bottom? Visible months before it hits revenue. */
      anyFlow && section('Динамика воронки · последние 12 месяцев', null,
        el('div.settings-body', {},
          flowsChart(flows, currency),
          el('div.trend-minis', {},
            el('div', {},
              el('h3.wl-col-title', {}, 'Доля выигранных по месяцу закрытия'),
              miniTrend(rateTrend.map((r) => ({
                key: r.key,
                value: r.rate === null ? null : Math.round(r.rate * 100),
              })), {
                format: (v) => `${v}%`,
                series: 'Доля выигранных',
                ariaLabel: 'Доля выигранных по месяцу закрытия',
              })
            ),
            el('div', {},
              el('h3.wl-col-title', {}, 'Цикл сделки по месяцу закрытия'),
              miniTrend(cycleTrend.map((r) => ({ key: r.key, value: r.days })), {
                format: (v) => `${v} дн.`,
                series: 'От создания до выигрыша, в среднем',
                ariaLabel: 'Средний цикл сделки по месяцу закрытия',
              })
            )
          ),
          el('p.settings-note.mt-sm', {},
            '«Добавлено» считает сделки по месяцу создания, чем бы они ни закончились. Выигранные, проигранные, доля выигранных и длина цикла считаются по месяцу закрытия.')
        )
      ),

      /* Where deals leak. Win rate says how often you close; this says
         which step loses them, which is the number that changes how you
         sell. Everything here is derived from stageHistory at render
         time. */
      (() => {
        const cohortDeals = store.deals.filter((d) => matchesFunnelWindow(d, cohort));
        const funnel = funnelReport(cohortDeals, stageList);
        const worst = [...funnel.rows].sort((a, b) => b.lostHere - a.lostHere)[0];
        const anyJourney = funnel.rows.some((r) => r.entered > 0);

        const windowSelect = el('select.select', {
          'aria-label': 'Какие сделки учитывает воронка',
          dataset: { focusKey: 'funnel-window' },
          onchange: keepingFocus((e) => { cohort = e.target.value; render(); }),
        }, FUNNEL_WINDOWS.map((w) =>
          el('option', { value: w.value, selected: w.value === cohort }, w.label)));

        return section('Конверсия',
          el('div.select-wrap.close-window', {}, windowSelect),
          el('div.settings-body', {},
            anyJourney
              ? el('div', {},
                  el('div.funnel-summary', {},
                    el('div.funnel-summary-item', {},
                      el('span.stat-label', {}, 'От входа до выигрыша'),
                      el('span.funnel-summary-value', {},
                        funnel.totals.wonRate === null ? '—'
                          : `${Math.round(funnel.totals.wonRate * 100)}%`),
                      el('span.stat-sub', {},
                        `${funnel.totals.won} из ${countLabel(funnel.totals.deals, ['вошедшей сделки', 'вошедших сделок', 'вошедших сделок'])}`
                        + (funnel.totals.open ? ` · ещё в работе: ${funnel.totals.open}` : ''))
                    ),
                    worst?.lostHere > 0 && el('div.funnel-summary-item', {},
                      el('span.stat-label', {}, 'Больше всего потерь'),
                      el('span.funnel-summary-value', {}, worst.label),
                      el('span.stat-sub', {},
                        `${countLabel(worst.lostHere, DEALS)} ${plural(worst.lostHere, ['проиграна', 'проиграны', 'проиграно'])} на этом этапе`
                        + (worst.lossShare ? ` · ${Math.round(worst.lossShare * 100)}% всех проигрышей` : ''))
                    )
                  ),
                  funnelChart(funnel.rows, stageList),
                  el('p.settings-note.mt-sm', {},
                    'Сделка считается дошедшей до этапа, только если действительно на нём была, и прошедшей дальше, только если потом продвинулась. ',
                    funnel.untracked > 0
                      ? `${countLabel(funnel.untracked, DEALS)} ${plural(funnel.untracked, ['закрыта', 'закрыты', 'закрыто'])} до начала учёта этапов и не ${plural(funnel.untracked, ['учитывается', 'учитываются', 'учитываются'])}, чтобы не выдавать их за мгновенную конверсию.`
                      : 'Сделки в работе учитываются на текущем этапе, а не как проигранные.')
                )
              : el('p.card-empty.flush', {}, cohort === 'all'
                  ? 'Истории этапов пока нет. Передвиньте сделку по доске, и здесь появятся данные.'
                  : 'За этот период в воронку не пришло ни одной сделки. Выберите период шире.')
          )
        );
      })(),

      /* How long each stage actually takes, from accumulated history. */
      velocity.some((v) => v.days !== null) && section('Время на этапах', null,
        el('div.settings-body', {},
          el('div.stage-bars', {}, velocity.map((v) => el('div.stage-bar-row', {},
            stageBadge(v.stage, stageList),
            el('div.stage-bar-track', {},
              v.days !== null && el('div.stage-bar-fill', {
                style: { width: `${Math.max(2, (v.days / maxVelocity) * 100)}%` },
              })),
            el('span.stage-bar-value', {},
              v.days === null ? '–' : `${v.days} дн.`,
              el('span.stage-bar-sub', {}, v.count
                ? ` · ${countLabel(v.count, DEALS)}`
                : ' · пока нет данных'))
          ))),
          el('p.settings-note.mt-sm', {},
            'Сколько дней в среднем сделка проводит на этапе, прежде чем перейти дальше. Сделки, которые ещё на этапе, учитываются после перехода.')
        )
      ),

      /* Win/loss analysis: only worth a section once something has closed. */
      closed.length > 0 && section('Почему сделки закрываются', null,
        el('div.settings-body', {},
          el('div.wl-cols', {},
            reasonColumn('Выигранные', 'won', wonReasons, maxReason, currency),
            reasonColumn('Проигранные', 'lost', lostReasons, maxReason, currency)
          ),
          el('div.wl-averages', {},
            el('div.wl-average', {},
              el('span.stat-label', {}, 'Средняя выигранная сделка'),
              el('span.wl-average-value', {}, averages.won === null ? '–' : formatMoney(averages.won, currency))),
            el('div.wl-average', {},
              el('span.stat-label', {}, 'Средняя проигранная сделка'),
              el('span.wl-average-value', {}, averages.lost === null ? '–' : formatMoney(averages.lost, currency)))
          ),
          (wonReasons.unrecorded + lostReasons.unrecorded) > 0 && el('p.settings-note.mt-sm', {},
            `Без причины: ${countLabel(wonReasons.unrecorded + lostReasons.unrecorded, ['закрытая сделка', 'закрытые сделки', 'закрытых сделок'])}. Укажите причину в карточке сделки, чтобы анализ был точнее.`)
        )
      ),

      (bySource.length > 0 || byIndustry.length > 0) && section('Откуда приходят выигрыши', null,
        el('div.settings-body', {},
          bySource.length > 0 && rateTable('Источник контакта', bySource, currency),
          byIndustry.length > 0 && rateTable('Отрасль компании', byIndustry, currency)
        )
      ),

      stages.length > 0 && section('Из чего складывается взвешенная сумма', null,
        el('div.settings-body', {},
          el('div.stage-bars', {}, stages.map((s) => el('div.stage-bar-row', {},
            stageBadge(s.stage, stageList),
            el('div.stage-bar-track', {},
              el('div.stage-bar-fill', { style: { width: `${Math.max(2, (s.weighted / maxStage) * 100)}%` } })),
            el('span.stage-bar-value', {},
              `${compactMoney(s.weighted, currency)}`,
              el('span.stage-bar-sub', {}, ` из ${compactMoney(s.value, currency)}`))
          ))),
          el('p.settings-note.mt-sm', {},
            'Вероятность для каждого этапа можно настроить в «Настройках», когда станет понятна реальная конверсия.')
        )
      ),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  root.append(pageHead('Прогноз'), body);
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
