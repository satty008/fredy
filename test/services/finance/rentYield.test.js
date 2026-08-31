/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let rentPerSqmFor;
let rentDataMatchFor;
let grossYieldPercent;
let targetRentFor;
let bundeslandFor;
let bundeslandCodeFor;
let kaufnebenkostenPercent;
let netYieldPercent;
let dataFile;

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `rent-data-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(
    dataFile,
    JSON.stringify({
      defaultRentPerSqm: 9,
      cities: {
        Münster: 12,
        Aachen: 10.5,
        Leipzig: { default: 10, areas: { Connewitz: 12.5, Grünau: 8 } },
      },
    }),
  );
  process.env.RENT_DATA_PATH = dataFile;
  // The module reads RENT_DATA_PATH once at import time, so force a fresh module instance
  // per test rather than relying on its internal mtime-based cache.
  vi.resetModules();
  ({
    rentPerSqmFor,
    rentDataMatchFor,
    grossYieldPercent,
    targetRentFor,
    bundeslandFor,
    bundeslandCodeFor,
    kaufnebenkostenPercent,
    netYieldPercent,
  } = await import('../../../lib/services/finance/rentYield.js'));
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

  it('prefers an area match over the city default when the city has area-level data', () => {
    expect(rentPerSqmFor({ address: 'Musterweg 3, Leipzig-Connewitz' })).toBe(12.5);
  });

  it('falls back to the city default when the city has area data but none of its areas match', () => {
    expect(rentPerSqmFor({ address: 'Musterweg 3, 04103 Leipzig' })).toBe(10);
  });

  it('does not let an area name match against a different city (no false cross-city match)', () => {
    // "Grünau" is a Leipzig district; this address never mentions Leipzig at all.
    expect(rentPerSqmFor({ address: 'Grünau 5, 48143 Münster' })).toBe(12);
  });

  describe('cold_rent_override', () => {
    it('overrides the city lookup, divided by size', () => {
      expect(rentPerSqmFor({ address: 'Musterstraße 1, 48143 Münster', size: 65, cold_rent_override: 650 })).toBe(10);
    });

    it('is ignored when size is missing, since a per-m² rate cannot be derived', () => {
      expect(rentPerSqmFor({ address: 'Musterstraße 1, 48143 Münster', cold_rent_override: 650 })).toBe(12);
    });

    it('is ignored when null, falling back to the normal lookup', () => {
      expect(rentPerSqmFor({ address: 'Musterstraße 1, 48143 Münster', size: 65, cold_rent_override: null })).toBe(12);
    });

    it('wins even when no city matches at all', () => {
      expect(rentPerSqmFor({ address: 'Irgendwo 5, 99999 Nirgendwo', size: 50, cold_rent_override: 500 })).toBe(10);
    });
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

  it('uses cold_rent_override instead of the city lookup when set', () => {
    // 650 EUR/month * 12 = 7800 annual rent; / 200000 price * 100 = 3.9%
    const result = grossYieldPercent({ price: 200000, size: 60, address: 'Münster', cold_rent_override: 650 });
    expect(result).toBeCloseTo(3.9, 5);
  });
});

describe('rentDataMatchFor', () => {
  it('reports "area" coverage for a district-level match', () => {
    expect(rentDataMatchFor({ address: 'Musterweg 3, Leipzig-Connewitz' })).toEqual({
      rentPerSqm: 12.5,
      coverage: 'area',
    });
  });

  it('reports "city" coverage for a city-level match with no area match', () => {
    expect(rentDataMatchFor({ address: 'Musterstraße 1, 48143 Münster' })).toEqual({
      rentPerSqm: 12,
      coverage: 'city',
    });
  });

  it('reports "default" coverage when no city matches at all', () => {
    expect(rentDataMatchFor({ address: 'Irgendwo 5, 99999 Nirgendwo' })).toEqual({
      rentPerSqm: 9,
      coverage: 'default',
    });
  });

  it('reports "override" coverage when cold_rent_override is set, even with no city match', () => {
    expect(rentDataMatchFor({ address: '99999 Nirgendwo', size: 50, cold_rent_override: 500 })).toEqual({
      rentPerSqm: 10,
      coverage: 'override',
    });
  });

  it('reports "none" coverage when the data file is missing entirely', () => {
    fs.rmSync(dataFile, { force: true });
    expect(rentDataMatchFor({ address: 'Musterstraße 1, 48143 Münster' })).toEqual({
      rentPerSqm: null,
      coverage: 'none',
    });
  });

  it('rentPerSqmFor stays a plain passthrough of the rentPerSqm half', () => {
    const listing = { address: 'Musterweg 3, Leipzig-Connewitz' };
    expect(rentPerSqmFor(listing)).toBe(rentDataMatchFor(listing).rentPerSqm);
  });
});

describe('targetRentFor', () => {
  it('computes rentPerSqm * size for a matched city', () => {
    expect(targetRentFor({ size: 60, address: 'Münster' })).toBe(720); // 12 * 60
  });

  it('falls back to defaultRentPerSqm when no city matches', () => {
    expect(targetRentFor({ size: 60, address: '99999 Nirgendwo' })).toBe(540); // 9 * 60
  });

  it('returns null when size is missing', () => {
    expect(targetRentFor({ address: 'Münster' })).toBe(null);
  });

  it('returns null when no rent estimate can be found', () => {
    fs.rmSync(dataFile, { force: true });
    expect(targetRentFor({ size: 60, address: 'Münster' })).toBe(null);
  });

  it('round-trips cold_rent_override, ignoring the city lookup', () => {
    expect(targetRentFor({ size: 60, address: 'Münster', cold_rent_override: 900 })).toBe(900);
  });
});

describe('bundeslandFor', () => {
  it('resolves a Bundesland from the 5-digit PLZ in the address', () => {
    expect(bundeslandFor({ address: 'Musterstraße 1, 48143 Münster' })).toBe('nordrhein-westfalen');
    expect(bundeslandFor({ address: '04103 Leipzig' })).toBe('sachsen');
  });

  it('resolves the dominant Bundesland for a prefix that spans state borders (Ulm/Neu-Ulm, 89)', () => {
    // 89 is ~57% Baden-Württemberg / ~43% Bayern by population - a real geographic edge case
    // (Ulm and Neu-Ulm sit on opposite banks of the Danube, in different states), not a bug.
    expect(bundeslandFor({ address: '89073 Ulm' })).toBe('baden-württemberg');
  });

  it('returns null when the address has no 5-digit PLZ', () => {
    expect(bundeslandFor({ address: 'Musterstraße ohne Postleitzahl' })).toBe(null);
  });

  it('returns null when the address is missing entirely', () => {
    expect(bundeslandFor({})).toBe(null);
  });

  it('returns null for a PLZ prefix not in the table', () => {
    expect(bundeslandFor({ address: '00000 Nirgendwo' })).toBe(null);
  });
});

describe('bundeslandCodeFor', () => {
  it('resolves the two-letter code for a Bundesland name with no special characters', () => {
    expect(bundeslandCodeFor({ address: '04103 Leipzig' })).toBe('SN'); // sachsen
  });

  it('resolves the two-letter code for a Bundesland name with an umlaut', () => {
    expect(bundeslandCodeFor({ address: '89073 Ulm' })).toBe('BW'); // baden-württemberg
  });

  it('resolves the two-letter code for a hyphenated Bundesland name', () => {
    expect(bundeslandCodeFor({ address: '48143 Münster' })).toBe('NW'); // nordrhein-westfalen
  });

  it('returns null when the Bundesland cannot be resolved', () => {
    expect(bundeslandCodeFor({ address: 'keine PLZ hier' })).toBe(null);
  });
});

describe('kaufnebenkostenPercent', () => {
  it('sums Grunderwerbsteuer (by Bundesland) with the standard Notar/Grundbuch/Makler assumptions', () => {
    // NRW Grunderwerbsteuer 6.5% + 2% Notar/Grundbuch + 3.57% Makler = 12.07%
    expect(kaufnebenkostenPercent({ address: '48143 Münster' })).toBeCloseTo(0.1207, 6);
    // Sachsen 5.5% + 2% + 3.57% = 11.07%
    expect(kaufnebenkostenPercent({ address: '04103 Leipzig' })).toBeCloseTo(0.1107, 6);
  });

  it('returns null when the Bundesland cannot be resolved', () => {
    expect(kaufnebenkostenPercent({ address: 'keine PLZ hier' })).toBe(null);
  });
});

describe('netYieldPercent', () => {
  it('computes (grossAnnualRent * 0.8) / (price * (1 + kaufnebenkosten)) * 100', () => {
    // 12 EUR/m² * 60m² * 12mo = 8640 gross annual rent; * 0.8 = 6912 net.
    // price 200000 * (1 + 0.1207) = 224140 total acquisition cost.
    // 6912 / 224140 * 100 = 3.083787%
    const result = netYieldPercent({ price: 200000, size: 60, address: '48143 Münster' });
    expect(result).toBeCloseTo(3.083787, 4);
  });

  it('is meaningfully lower than grossYieldPercent for the same listing', () => {
    const listing = { price: 200000, size: 60, address: '04103 Leipzig-Connewitz' };
    const gross = grossYieldPercent(listing);
    const net = netYieldPercent(listing);
    expect(net).toBeLessThan(gross);
    // Kaufnebenkosten + the non-allocable cost assumption should pull this down by more than a
    // token amount - this is the whole point of the metric.
    expect(gross - net).toBeGreaterThan(1);
  });

  it('returns null when price is missing', () => {
    expect(netYieldPercent({ size: 60, address: '48143 Münster' })).toBe(null);
  });

  it('returns null when size is missing', () => {
    expect(netYieldPercent({ price: 200000, address: '48143 Münster' })).toBe(null);
  });

  it('returns null when no rent estimate can be found', () => {
    fs.rmSync(dataFile, { force: true });
    expect(netYieldPercent({ price: 200000, size: 60, address: '48143 Münster' })).toBe(null);
  });

  it('returns null when the Bundesland cannot be resolved, even with a known rent', () => {
    expect(netYieldPercent({ price: 200000, size: 60, address: 'Münster ohne PLZ' })).toBe(null);
  });
});
