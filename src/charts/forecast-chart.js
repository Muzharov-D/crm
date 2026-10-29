/**
 * Monthly forecast column chart, rendered as HTML (no canvas/SVG scaling
 * blur, and labels stay real text). Each month is one stacked column:
 * the solid segment is the probability-weighted pipeline, the light
 * segment on top is the remaining upside to the unweighted best case.
 *
 * Dataviz spec: columns ≤24px, 4px rounded data end, square baseline,
 * 2px surface gap between stacked segments, legend for the two series,
 * per-column hover/focus tooltip, and one value label per column on its
 * cap - the figure the column's own height stands for. Naming the
 * weighted series there instead put a number on the top of a stack that
 * number is not the top of: an Aug of $31.5K weighted inside $49.5K best
 * case was labelled higher than an Oct of $18.8K inside $90K, so the
 * labels ranked the months one way and the bars the other. The weighted
 * segment is the solid one, read off its own height, the legend, the
 * tooltip, and the summary tiles above the chart.
 */

import { el, clear } from '../ui/dom.js';
import { compactMoney, formatMonth, formatMoney, countLabel } from '../lib/util.js';

const DEALS = ['сделка', 'сделки', 'сделок'];

const PLOT_H = 170;
/* The cap label sits on top of the tallest stack inside the fixed-height
   plot; scale bars to leave it headroom or it collides with the legend. */
const LABEL_HEADROOM = 24;

export function forecastChart(rows, currency, { goal = 0 } = {}) {
  // The goal shares the scale so the gap between it and the columns is the
  // real gap - a line pinned to the top would flatter a thin pipeline.
  const max = Math.max(...rows.map((r) => r.best + r.won), goal, 1);
  const px = (v) => Math.round((v / max) * (PLOT_H - LABEL_HEADROOM));

  const tooltip = el('div.chart-tip', { role: 'tooltip', hidden: true });
  const chart = el('div.forecast-chart');

  const showTip = (col, r) => {
    clear(tooltip);
    const upside = Math.max(0, r.best - r.weighted);
    tooltip.append(
      el('div.tip-title', {}, formatMonth(r.key)),
      tipRow('weighted', 'Взвешенно', formatMoney(r.weighted, currency)),
      upside > 0 && tipRow('upside', 'Потенциал', formatMoney(upside, currency)) || '',
      r.won > 0 && tipRow('won', 'Уже выиграно', formatMoney(r.won, currency)) || '',
      el('div.tip-sub', {},
        `Максимум ${formatMoney(r.best, currency)} · ${countLabel(r.count, DEALS)}`)
    );
    tooltip.hidden = false;
    // Clamp the tip inside the chart so edge columns don't overflow it.
    const colBox = col.getBoundingClientRect();
    const chartBox = chart.getBoundingClientRect();
    tooltip.style.left = '0px';
    const tipW = tooltip.getBoundingClientRect().width || 160;
    const x = colBox.left - chartBox.left + colBox.width / 2 - tipW / 2;
    tooltip.style.left = `${Math.max(4, Math.min(x, chartBox.width - tipW - 4))}px`;
  };
  const hideTip = () => { tooltip.hidden = true; };

  function tipRow(kind, label, value) {
    return el('div.tip-row', {},
      el('span.tip-swatch', { dataset: { kind }, 'aria-hidden': 'true' }),
      el('span.tip-label', {}, label),
      el('span.tip-value', {}, value)
    );
  }

  const cols = rows.map((r) => {
    const upside = Math.max(0, r.best - r.weighted);
    // What the column's height means, and so what its cap label says.
    const total = r.best + r.won;
    // Segments show for any real money, not just what rounds to a pixel:
    // a $3k month next to a $1M peak is a thin bar, never the empty dot.
    const seg = (kind, value) => (value > 0
      ? el(`div.col-seg.${kind}`, { style: { height: `${Math.max(px(value), 3)}px` } })
      : null);

    // Topmost visible segment carries the 4px rounded data end; the
    // baseline edge stays square.
    const segs = [
      seg('upside', upside),
      seg('weighted', r.weighted),
      seg('won', r.won),
    ].filter(Boolean);
    segs[0]?.classList.add('top');
    const hasBar = segs.length > 0;

    const col = el('button.chart-col', {
      type: 'button',
      'aria-label': `${formatMonth(r.key)}: взвешенно ${formatMoney(r.weighted, currency)}, `
        + `максимум ${formatMoney(r.best, currency)}`
        + (r.won ? `, уже выиграно ${formatMoney(r.won, currency)}` : '')
        + `, ${countLabel(r.count, DEALS)}`,
    },
      el('div.col-plot', { style: { height: `${PLOT_H}px` } },
        hasBar && el('div.col-stack', {},
          el('div.col-cap-label', {}, compactMoney(total, currency)),
          segs
        ),
        !hasBar && el('div.col-zero', { 'aria-hidden': 'true' })
      ),
      el('div.col-month', {}, formatMonth(r.key).split(' ')[0])
    );
    col.addEventListener('pointerenter', () => showTip(col, r));
    col.addEventListener('focus', () => showTip(col, r));
    col.addEventListener('pointerleave', hideTip);
    col.addEventListener('blur', hideTip);
    return col;
  });

  const goalLine = goal > 0 && el('div.chart-goal', {
    style: { top: `${PLOT_H - px(goal)}px` },
    role: 'img',
    'aria-label': `План на месяц ${formatMoney(goal, currency)}`,
  }, el('span.chart-goal-label', {}, `План ${compactMoney(goal, currency)}`));

  chart.append(
    el('div.chart-legend', {},
      legendKey('weighted', 'Взвешенно'),
      legendKey('upside', 'Потенциал до максимума'),
      rows.some((r) => r.won > 0) && legendKey('won', 'Уже выиграно'),
      goal > 0 && el('span.legend-key', {},
        el('span.legend-goal', { 'aria-hidden': 'true' }), 'План на месяц')
    ),
    el('div.chart-plot-row', {}, goalLine, cols),
    tooltip
  );
  return chart;
}

function legendKey(kind, label) {
  return el('span.legend-key', {},
    el('span.tip-swatch', { dataset: { kind }, 'aria-hidden': 'true' }),
    label
  );
}
