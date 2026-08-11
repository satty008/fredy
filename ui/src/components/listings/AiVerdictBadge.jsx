/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { AI_VERDICT_COLORS, withAlpha } from '../cards/chartTheme.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';

import './AiVerdictBadge.less';

/**
 * A listing's AI review verdict (good/maybe/bad), meant to sit directly in front of the title
 * in the grid/table/list views so the verdict is visible while scanning many listings at once,
 * without opening each one - the detail page already surfaces the same verdict next to its Notes
 * section, but that only helps once you're already on a single listing. Renders nothing when the
 * listing hasn't been rated yet, same null-render convention as AffordabilityChip.
 *
 * @param {Object} props
 * @param {'good'|'maybe'|'bad'|null} [props.verdict] From the listings query (ai_verdict column).
 */
export default function AiVerdictBadge({ verdict }) {
  const t = useTranslation();

  if (verdict == null) {
    return null;
  }

  const color = AI_VERDICT_COLORS[verdict];
  const label = t(`listings.filterAiVerdict${verdict[0].toUpperCase()}${verdict.slice(1)}`);

  return (
    <span
      className="aiVerdictBadge"
      style={{
        color,
        backgroundColor: withAlpha(color, 0.12),
        borderColor: withAlpha(color, 0.4),
      }}
    >
      {label}
    </span>
  );
}

AiVerdictBadge.displayName = 'AiVerdictBadge';
