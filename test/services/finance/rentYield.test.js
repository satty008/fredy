/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let rentPerSqmFor;
let grossYieldPercent;
let dataFile;

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `rent-data-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(
    dataFile,
    JSON.stringify({
      defaultRentPerSqm: 9,
      cities: { Münster: 12, Aachen: 10.5 },
    }),
  );
  process.env.RENT_DATA_PATH = dataFile;
  // The module reads RENT_DATA_PATH once at import time, so force a fresh module instance
  // per test rather than relying on its internal mtime-based cache.
  vi.resetModules();
  ({ rentPerSqmFor, grossYieldPercent } = await import('../../../lib/services/finance/rentYield.js'));
});

afterEach(() => {
  fs.rmSync(dataFile, { force: true });
  delete process.env.RENT_DATA_PATH;
});

describe('rentPerSqmFor', () => {
  it('matches a known city by substring in the address, case-insensitively', () => {
    expect(rentPerSqmFor({ address: 'Musterstraße 1, 48143 Münster' })).toBe(12);
  });

  it('matches a known city found in the title when address is missing', () => {
    expect(rentPerSqmFor({ title: '2-Zimmer-Wohnung in Aachen' })).toBe(10.5);
  });

  it('falls back to defaultRentPerSqm when no city matches', () => {
    expect(rentPerSqmFor({ address: 'Irgendwo 5, 99999 Nirgendwo' })).toBe(9);
  });

  it('returns null when the data file is missing', () => {
    fs.rmSync(dataFile, { force: true });
    expect(rentPerSqmFor({ address: 'Musterstraße 1, 48143 Münster' })).toBe(null);
  });
});

describe('grossYieldPercent', () => {
  it('computes annualRent / price * 100 for a matched city', () => {
    // 12 EUR/m² * 60 m² * 12 months = 8640 annual rent; / 200000 price * 100 = 4.32%
    const result = grossYieldPercent({ price: 200000, size: 60, address: 'Münster' });
    expect(result).toBeCloseTo(4.32, 5);
  });

  it('returns null when price is missing', () => {
    expect(grossYieldPercent({ size: 60, address: 'Münster' })).toBe(null);
  });

  it('returns null when size is missing', () => {
    expect(grossYieldPercent({ price: 200000, address: 'Münster' })).toBe(null);
  });

  it('returns null when no rent estimate can be found', () => {
    fs.rmSync(dataFile, { force: true });
    expect(grossYieldPercent({ price: 200000, size: 60, address: 'Münster' })).toBe(null);
  });
});
