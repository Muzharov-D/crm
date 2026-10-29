/**
 * The funnel, drawn as one bar per stage.
 *
 * Two things are encoded at once, because the question is two questions:
 * the bar's *width* is how many deals reached that stage (volume down the
 * funnel), and the filled part of it is how many advanced past it
 * (conversion out of it). The words underneath say the same thing in
 * plain language, because a founder needs to be able to repeat the finding
 * out loud - "of 40 deals that reached Qualified, 12 advanced".
 *
 * HTML, like the other charts here: no canvas blur, and every label stays
 * real, selectable text.
 */

import { el } from '../ui/dom.js';
import { stageBadge } from '../ui/bits.js';
import { countLabel, plural } from '../lib/util.js';

const pct = (n) => `${Math.round(n * 100)}%`;
const DEALS = ['сделка', 'сделки', 'сделок'];
/** "3 сделки дошли" / "1 сделка дошла": the count with its verb agreeing. */
const dealsDid = (n, verb) => `${countLabel(n, DEALS)} ${plural(n, verb)}`;
const REACHED = ['дошла', 'дошли', 'дошли'];
const ADVANCED = ['прошла дальше', 'прошли дальше', 'прошли дальше'];

/**
 * `rows` come from funnelReport(); `stages` is the configured list, so a
 * stage the funnel has since dropped still shows under its own name.
 */
export function funnelChart(rows, stages) {
  const max = Math.max(...rows.map((r) => r.entered), 1);

  return el('div.funnel', {},
    el('div.chart-legend', {},
      el('span.legend-key', {},
        el('span.tip-swatch', { dataset: { kind: 'advanced' }, 'aria-hidden': 'true' }),
        'Прошли дальше этого этапа'),
      el('span.legend-key', {},
        el('span.tip-swatch', { dataset: { kind: 'stalled-here' }, 'aria-hidden': 'true' }),
        'Проиграны или ещё здесь')
    ),
    rows.map((row) => {
      const width = (row.entered / max) * 100;
      const fill = row.entered ? (row.advanced / row.entered) * 100 : 0;
      const words = row.entered
        ? [
            dealsDid(row.advanced, ADVANCED),
            row.advanceRate === null ? null : pct(row.advanceRate),
            row.lostHere
              ? `проиграно здесь: ${row.lostHere}${row.lossShare ? ` · ${pct(row.lossShare)} всех проигрышей` : ''}`
              : null,
            row.open ? `в работе: ${row.open}` : null,
          ].filter(Boolean).join(' · ')
        : 'До этого этапа пока не дошла ни одна сделка';

      return el('div.funnel-row', {},
        el('div.funnel-head', {},
          stageBadge(row.stage, stages),
          el('span.funnel-count', {},
            row.entered ? dealsDid(row.entered, REACHED) : 'никто не дошёл')
        ),
        el('div.funnel-track', {
          role: 'img',
          'aria-label': `${row.label}: ${dealsDid(row.entered, REACHED)}, дальше прошли ${row.advanced}`
            + (row.advanceRate === null ? '' : ` (${pct(row.advanceRate)})`),
        },
          el('div.funnel-bar', { style: { width: `${Math.max(width, row.entered ? 3 : 0)}%` } },
            el('div.funnel-bar-fill', { style: { width: `${fill}%` } })
          )
        ),
        el('p.funnel-words', {}, words)
      );
    })
  );
}
