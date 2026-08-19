/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tooltip } from '@douyinfe/semi-ui-19';

import { AI_VERDICT_COLORS, formatEuro, withAlpha } from '../cards/chartTheme.js';
import { useTranslation, useLocale } from '../../services/i18n/i18n.jsx';

import './ImmocockpitVerdictBadge.less';

/**
 * A listing's immocockpit buy-to-let verdict (good/maybe/bad) - the same verdict opening
 * "Analyze in Immocockpit" on this listing would compute, using immocockpit's own screening
 * defaults (100% financing at 4.2%/2%, a married/€100k-taxable-income buyer profile). Server-
 * computed, same reasoning as AffordabilityChip: the badge on a row must never disagree with
 * what the deep-link would actually show.
 *
 * Distinct from AiVerdictBadge on purpose - this one only ever sees the numbers (yield, cashflow,
 * DSCR, cash-on-cash), never the listing's photos or description text, which is exactly what the
 * AI rating is for. The "IC" prefix keeps the two from being mistaken for one another when both
 * sit on the same row. Renders nothing for a rental job (immocockpit only models a purchase) or
 * before the underlying numbers can be computed at all (missing price/size/rent estimate).
 *
 * @param {Object} props
 * @param {'good'|'maybe'|'bad'|null} [props.verdict] From the listings query (immocockpitVerdict).
 * @param {{ grossYieldPercent: number, netYieldPercent: number, cfAfterTaxMonthly: number,
 *   equityReturnPercent: number, dscr: number, coldRentPerSqm: number }|null} [props.analysis]
 *   The full computation, when available (immocockpitAnalysis - rides with every listing row the
 *   same way immocockpitVerdict does) - powers a richer tooltip with the numbers behind the verdict.
 */
export default function ImmocockpitVerdictBadge({ verdict, analysis }) {
  const t = useTranslation();
  const locale = useLocale();

  if (verdict == null) {
    return null;
  }

  const color = AI_VERDICT_COLORS[verdict];
  const label = t(`listings.filterImmocockpitVerdict${verdict[0].toUpperCase()}${verdict.slice(1)}`);
  const tooltip = analysis
    ? t('listings.immocockpitVerdictTooltipDetailed', {
        grossYield: analysis.grossYieldPercent.toFixed(1),
        netYield: analysis.netYieldPercent.toFixed(1),
        cashflow: formatEuro(Math.round(analysis.cfAfterTaxMonthly), locale),
        equityReturn: analysis.equityReturnPercent.toFixed(1),
        dscr: analysis.dscr.toFixed(2),
        coldRentPerSqm: analysis.coldRentPerSqm.toFixed(2),
      })
    : t('listings.immocockpitVerdictTooltip');

  return (
    <Tooltip content={tooltip} position="top">
      <span
        className="immocockpitVerdictBadge"
        style={{
          color,
          backgroundColor: withAlpha(color, 0.12),
          borderColor: withAlpha(color, 0.4),
        }}
      >
        {t('listings.immocockpitVerdictPrefix')} {label}
      </span>
    </Tooltip>
  );
}

ImmocockpitVerdictBadge.displayName = 'ImmocockpitVerdictBadge';
