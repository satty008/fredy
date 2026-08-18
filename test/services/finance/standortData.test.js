/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let standortDataFor;
let dataFile;

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `standort-data-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(
    dataFile,
    JSON.stringify({
      cities: {
        Münster: {
          kaufpreisPerSqm: 4200,
          kaltmietePerSqm: 13,
          bruttomietrenditePercent: 3.7,
          prognosRangGesamt: 45,
          prognosRangStaerke: 40,
          prognosRangDynamik: 90,
        },
      },
    }),
  );
  process.env.STANDORT_DATA_PATH = dataFile;
  // Same reasoning as rentYield.test.js: the module caches by mtime at import time, so force a
  // fresh instance per test.
  vi.resetModules();
  ({ standortDataFor } = await import('../../../lib/services/finance/standortData.js'));
});

afterEach(() => {
  fs.rmSync(dataFile, { force: true });
  delete process.env.STANDORT_DATA_PATH;
});

describe('standortDataFor', () => {
  it('matches a known city by substring in the address, case-insensitively', () => {
    const result = standortDataFor({ address: 'Musterstraße 1, 48143 Münster' });
    expect(result).toEqual({
      kaufpreisPerSqm: 4200,
      kaltmietePerSqm: 13,
      bruttomietrenditePercent: 3.7,
      prognosRangGesamt: 45,
      prognosRangStaerke: 40,
      prognosRangDynamik: 90,
    });
  });

  it('matches a known city found in the title when address is missing', () => {
    expect(standortDataFor({ title: '2-Zimmer-Wohnung in Münster' })).not.toBe(null);
  });

  it('returns null when no city matches', () => {
    expect(standortDataFor({ address: 'Irgendwo 5, 99999 Nirgendwo' })).toBe(null);
  });

  it('returns null when the data file is missing', () => {
    fs.rmSync(dataFile, { force: true });
    expect(standortDataFor({ address: 'Musterstraße 1, 48143 Münster' })).toBe(null);
  });

  it('returns null when the data file has an empty cities object', () => {
    fs.writeFileSync(dataFile, JSON.stringify({ cities: {} }));
    vi.resetModules();
    return import('../../../lib/services/finance/standortData.js').then(({ standortDataFor: fresh }) => {
      expect(fresh({ address: 'Musterstraße 1, 48143 Münster' })).toBe(null);
    });
  });
});
