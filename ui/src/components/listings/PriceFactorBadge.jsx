/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tooltip } from '@douyinfe/semi-ui-19';

import { AI_VERDICT_COLORS, withAlpha } from '../cards/chartTheme.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';

import './PriceFactorBadge.less';

/**
 * A listing's Kaufpreisfaktor (purchase price ÷ annual cold rent) - "how many years of rent it
 * takes to pay back the price", the same rent assumption and price immocockitVerdictFor already
 * uses, so this can never disagree with the IC badge sitting next to it. Equivalent to
 * 100/grossYieldPercent, just expressed as a multiple instead of a percentage, which is the more
 * familiar form for this particular number in German real-estate listings/conversation.
 *
 * Colored by priceFactorTier, computed server-side from immocockpit's own (defined but unused in
 * its verdict score) gross-yield thresholds - factor <=20 green, <=25 yellow, above that red -
 * see immocockpitVerdict.js's tierOfPriceFactor. Renders nothing when immocockpitAnalysis itself
 * is null (rental job, or the underlying numbers can't be computed for this listing).
 *
 * @param {Object} props
 * @param {{ priceFactor: number, priceFactorTier: 'good'|'maybe'|'bad' }|null} [props.analysis]
 *   From the listings query (immocockpitAnalysis) - rides with every listing row.
 */
export default function PriceFactorBadge({ analysis }) {
  const t = useTranslation();

  if (analysis?.priceFactor == null) {
    return null;
  }

  const color = AI_VERDICT_COLORS[analysis.priceFactorTier];
  const factor = analysis.priceFactor.toFixed(1);
  const tooltip = t('listings.priceFactorTooltip', { factor });

  return (
    <Tooltip content={tooltip} position="top">
      <span
        className="priceFactorBadge"
        style={{
          color,
          backgroundColor: withAlpha(color, 0.12),
          borderColor: withAlpha(color, 0.4),
        }}
      >
        {t('listings.priceFactorPrefix')} {factor}
      </span>
    </Tooltip>
  );
}

PriceFactorBadge.displayName = 'PriceFactorBadge';
