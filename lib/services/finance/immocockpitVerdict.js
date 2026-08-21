/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { targetRentFor, kaufnebenkostenPercent } from './rentYield.js';

/**
 * Screening-default assumptions, copied 1:1 from immocockpit's own "Fredy handoff" defaults
 * (satty008/immocockpit, Component.applyFredyHandoff / the initial `state` object) so a listing's
 * badge here never disagrees with what opening "Analyze in Immocockpit" on the same listing would
 * show. These are deliberately not listing-specific - see rentYield.js's NOTAR_GRUNDBUCH_PERCENT/
 * MAKLER_PERCENT, which already mirror immocockpit's notaryPct+landRegistryPct/brokerPct the same
 * way. Re-sync by hand if immocockpit's defaults change; there is no shared build to keep them
 * in lockstep automatically.
 */
const LOAN_RATE_PERCENT = 4.6;
const LOAN_AMORTIZATION_PERCENT = 2.0;
const LTV_PERCENT = 85; // 85% financing at the rate/amortization above is the handoff's screening-default assumption
const MARGINAL_TAX_PERCENT = 35.1; // marginalRateAt(100_000 taxable income / 2, married-filing baseline), rounded like immocockpit's own default state
const RECOVERABLE_COST_RATE = 0.2; // immocockpit costEstimateMode default: recoverableCosts = coldRent * 20%
const NON_RECOVERABLE_COST_RATE = 0.15; // ... nonRecoverableCosts = coldRent * 15%
const VACANCY_RATE = 0.03;
const OWN_RESERVE_PER_SQM_YEAR = 10; // EUR/m²/year
const BUILDING_SHARE_PERCENT = 75; // no land-value split exists for a scraped listing, so this stays at immocockpit's own default
const AFA_RATE_PERCENT = 2;
const VALUE_GROWTH_PERCENT = 2; // only used for the year-1 appreciation term inside the cash-on-cash score

/**
 * Kaufpreisfaktor (price ÷ annual cold rent) tier boundaries: immocockpit's own renderVals()
 * defines `th.grossG = 0.05` and `th.grossY = 0.04` (5%/4% gross yield) alongside the thresholds
 * that actually feed the verdict score, but never scores on them - grossYield isn't one of the
 * four scored metrics. Expressed as a factor (100/yield) instead of a yield percentage: factor
 * <= 20 is immocockpit's own "green" gross-yield line, <= 25 its "yellow" one. Turned into a
 * good/maybe/bad tier here (rather than leaving the raw thresholds for a caller to apply) so the
 * factor badge can reuse the same good/maybe/bad color mapping every other verdict already has,
 * with no threshold duplicated into the UI layer.
 *
 * @param {number} factor
 * @returns {'good'|'maybe'|'bad'}
 */
function tierOfPriceFactor(factor) {
  return factor <= 20 ? 'good' : factor <= 25 ? 'maybe' : 'bad';
}

/**
 * Year-1 verdict score thresholds, copied from immocockpit's renderVals() verdict block:
 * each metric scores 2 (green) / 1 (yellow) / 0 (red), and the four scores are summed to a 0-8
 * total - >=6 is "good", >=3 "maybe", below that "bad". cfAfterTax's yellow threshold is relative
 * (half a month's debt service) rather than a fixed EUR figure, same as the source.
 */
function scoreOf(value, green, yellow) {
  return value >= green ? 2 : value >= yellow ? 1 : 0;
}

/**
 * Estimate immocockpit's own buy-to-let verdict (good/maybe/bad) for a listing, using the exact
 * screening-default assumptions its "Analyze in Immocockpit" deep-link would apply automatically:
 * 85% financing at 4.6%/2%, a married/€100k-taxable-income buyer profile, and immocockpit's own
 * cost-estimate-mode operating cost assumptions. This lets Fredy show the verdict inline, without
 * requiring the user to open immocockpit for every listing to see whether it's even worth a look.
 *
 * Deliberately only covers what immocockpit's engine computes from numbers - yield, cashflow,
 * DSCR, year-1 cash-on-cash return. It cannot see photos or read the listing description, which
 * is exactly what the separate AI rating (ai_verdict) is for.
 *
 * Only meaningful for 'buy' jobs; a rental's asking price isn't a purchase price. Returns null
 * when the verdict can't be computed at all: missing price/size, no rent estimate for the
 * listing's location, or no resolvable Bundesland (needed for Grunderwerbsteuer).
 *
 * @param {{ price?: number, size?: number, address?: string, title?: string, dealType?: string }} listing
 * @returns {{ verdict: 'good'|'maybe'|'bad', score: number, grossYieldPercent: number,
 *   netYieldPercent: number, cfAfterTaxMonthly: number, equityReturnPercent: number, dscr: number,
 *   coldRentPerSqm: number, priceFactor: number, priceFactorTier: 'good'|'maybe'|'bad' }|null}
 */
export function immocockpitVerdictFor(listing) {
  if (listing.dealType !== 'buy' || !listing.price || !listing.size) {
    return null;
  }
  const coldRent = targetRentFor(listing);
  if (coldRent == null) {
    return null;
  }
  const kaufnebenkosten = kaufnebenkostenPercent(listing);
  if (kaufnebenkosten == null) {
    return null;
  }

  const price = listing.price;
  const purchaseCosts = kaufnebenkosten * price;
  const totalInvestment = price + purchaseCosts;

  const estRecoverable = coldRent * RECOVERABLE_COST_RATE;
  const estNonRecoverable = coldRent * NON_RECOVERABLE_COST_RATE;
  const warmRent = coldRent + estRecoverable;
  const ownReserveMonthly = (listing.size * OWN_RESERVE_PER_SQM_YEAR) / 12;
  const vacancyMonthly = VACANCY_RATE * warmRent;
  const totalOperatingCosts = estNonRecoverable + estRecoverable + ownReserveMonthly + vacancyMonthly;

  // Cash needed up front is the purchase costs plus whatever slice of the price the LTV doesn't
  // cover - at 100% financing that would collapse to just the purchase costs, but 85% leaves a
  // real down payment as part of equity too.
  const loanAmount = (LTV_PERCENT / 100) * price;
  const equity = totalInvestment - loanAmount;
  const interestMonthly = ((LOAN_RATE_PERCENT / 100) * loanAmount) / 12;
  const principalMonthly = ((LOAN_AMORTIZATION_PERCENT / 100) * loanAmount) / 12;
  const monthlyDebtService = interestMonthly + principalMonthly;

  const afaBasis = (BUILDING_SHARE_PERCENT / 100) * totalInvestment;
  const afaMonthly = (afaBasis * (AFA_RATE_PERCENT / 100)) / 12;

  const cfOperational = warmRent - totalOperatingCosts - monthlyDebtService;
  const taxableCf = warmRent - estNonRecoverable - estRecoverable - vacancyMonthly - interestMonthly - afaMonthly;
  const tax = (MARGINAL_TAX_PERCENT / 100) * taxableCf;
  const cfAfterTax = cfOperational - tax;

  const netYield = (warmRent * 12 - totalOperatingCosts * 12) / totalInvestment;
  // Immocockpit's own grossYield getter: annual cold rent over price alone, no cost adjustment -
  // the same coldRent/price this function already has in scope, so no separate lookup needed.
  const grossYield = (coldRent * 12) / price;

  const appreciationY1 = totalInvestment * (VALUE_GROWTH_PERCENT / 100);
  const principalPaidY1 = principalMonthly * 12;
  const cfAfterTaxY1 = cfAfterTax * 12;
  const equityReturn = equity > 0 ? (appreciationY1 + principalPaidY1 + cfAfterTaxY1) / equity : 0;

  const dscr = monthlyDebtService > 0 ? (warmRent * 12) / (monthlyDebtService * 12) : 2;

  const score =
    scoreOf(netYield, 0.04, 0.03) +
    scoreOf(cfAfterTax, 0, -monthlyDebtService / 2) +
    scoreOf(equityReturn, 0.08, 0.03) +
    scoreOf(dscr, 1.2, 1.0);

  const verdict = score >= 6 ? 'good' : score >= 3 ? 'maybe' : 'bad';

  return {
    verdict,
    score,
    grossYieldPercent: grossYield * 100,
    netYieldPercent: netYield * 100,
    cfAfterTaxMonthly: cfAfterTax,
    equityReturnPercent: equityReturn * 100,
    dscr,
    // The cold-rent-per-m² assumption the whole calculation rests on, surfaced so the badge's
    // tooltip can show what rent was actually assumed rather than just the numbers it produced.
    coldRentPerSqm: coldRent / listing.size,
    // Kaufpreisfaktor: price ÷ annual cold rent, the same number as 100/grossYieldPercent just
    // expressed as a multiple instead of a percentage - "how many years of rent to pay back the
    // price". Not part of the 0-8 verdict score above (immocockpit's own renderVals() defines
    // gross-yield thresholds but never actually scores on them - see tierOfPriceFactor), but
    // common enough as its own screening number that it gets a badge of its own.
    priceFactor: price / (coldRent * 12),
    priceFactorTier: tierOfPriceFactor(price / (coldRent * 12)),
  };
}
