/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let immocockpitVerdictFor;
let dataFile;

// Münster (PLZ prefix 48) resolves to Nordrhein-Westfalen (6.5% Grunderwerbsteuer) via
// germanyTaxData.json, so this address exercises the full computation rather than hitting one
// of the null-gating early returns.
const BUY_LISTING = { price: 200000, size: 60, address: 'Musterstraße 1, 48143 Münster', dealType: 'buy' };

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `rent-data-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(dataFile, JSON.stringify({ defaultRentPerSqm: 9, cities: { Münster: 12 } }));
  process.env.RENT_DATA_PATH = dataFile;
  vi.resetModules();
  ({ immocockpitVerdictFor } = await import('../../../lib/services/finance/immocockpitVerdict.js'));
});

afterEach(() => {
  fs.rmSync(dataFile, { force: true });
  delete process.env.RENT_DATA_PATH;
});

describe('immocockpitVerdictFor', () => {
  it("computes the same verdict immocockpit's own Fredy-handoff screening defaults would", () => {
    // Hand-computed from immocockpit's computeEngine at 12 EUR/m2 * 60 m2 cold rent, 100%
    // financing at 4.2%/2%, married/EUR100k marginal tax 35.1%, NW's 6.5% Grunderwerbsteuer:
    // netYield ~2.87% (below both thresholds -> 0), cfAfterTax ~-359 EUR/mo (above the -517
    // yellow line -> 1), year-1 cash-on-cash ~17.3% (above the 8% green line -> 2), DSCR ~0.84
    // (below 1.0 -> 0). Score 3 -> "maybe".
    const result = immocockpitVerdictFor(BUY_LISTING);
    expect(result.verdict).toBe('maybe');
    expect(result.score).toBe(3);
    expect(result.netYieldPercent).toBeCloseTo(2.87, 1);
    expect(result.cfAfterTaxMonthly).toBeCloseTo(-358.93, 0);
    expect(result.equityReturnPercent).toBeCloseTo(17.3, 0);
    expect(result.dscr).toBeCloseTo(0.836, 2);
  });

  it('returns null for a rental job - immocockpit only models a purchase', () => {
    expect(immocockpitVerdictFor({ ...BUY_LISTING, dealType: 'rent' })).toBe(null);
  });

  it('returns null when price is missing', () => {
    expect(immocockpitVerdictFor({ ...BUY_LISTING, price: undefined })).toBe(null);
  });

  it('returns null when size is missing', () => {
    expect(immocockpitVerdictFor({ ...BUY_LISTING, size: undefined })).toBe(null);
  });

  it('returns null when no rent estimate can be found for the address', () => {
    fs.rmSync(dataFile, { force: true });
    expect(immocockpitVerdictFor(BUY_LISTING)).toBe(null);
  });

  it('returns null when the Bundesland cannot be resolved from the address', () => {
    expect(immocockpitVerdictFor({ ...BUY_LISTING, address: 'no postal code here' })).toBe(null);
  });

  it('scores a strongly cash-flow-positive, high-yield listing as good', () => {
    // A cheap, high-rent listing: yield and cashflow both clear the green thresholds easily.
    const result = immocockpitVerdictFor({ price: 60000, size: 60, address: '48143 Münster', dealType: 'buy' });
    expect(result.verdict).toBe('good');
  });
});
