/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * queryListings runs plain SQL (plus a JS-side pass for immocockpitVerdictFilter), so these tests
 * back the mocked SqliteConnection with a real in-memory database rather than asserting on
 * statement strings - the thing worth proving is that a multi-select filter (job, aiVerdict,
 * icVerdict) returns the union of every selected value, not just the first one.
 */
let db;

vi.mock('../../../lib/services/storage/SqliteConnection.js', () => ({
  default: {
    execute: (sql, params = {}) => db.prepare(sql).run(params),
    query: (sql, params = {}) => db.prepare(sql).all(params),
    withTransaction: (callback) => db.transaction((cb) => cb(db))(callback),
  },
}));
vi.mock('../../../lib/services/similarity-check/similarityCache.js', () => ({
  removeEntry: () => {},
  isListingKnownAndAddIfNot: () => false,
  initSimilarityCache: () => {},
  startSimilarityCacheReloader: () => {},
  checkAndAddEntry: () => false,
}));

let dataFile;
let queryListings;

const addJob = (id, { userId = 'u1', dealType = 'rent', name = id } = {}) =>
  db
    .prepare(`INSERT INTO jobs (id, user_id, shared_with_user, name, deal_type) VALUES (?, ?, '[]', ?, ?)`)
    .run(id, userId, name, dealType);

const addListing = (
  id,
  jobId,
  { price = null, size = null, address = null, aiVerdict = null, provider = 'demo' } = {},
) =>
  db
    .prepare(
      `INSERT INTO listings (id, job_id, title, address, price, size, provider, is_active, manually_deleted, ai_verdict, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 0)`,
    )
    .run(id, jobId, id, address, price, size, provider, aiVerdict);

const idsOf = (page) => page.result.map((r) => r.id).sort();

describe('queryListings - multi-select filters', () => {
  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, user_id TEXT, shared_with_user TEXT, name TEXT, deal_type TEXT
      );
      CREATE TABLE listings (
        id TEXT PRIMARY KEY, job_id TEXT, title TEXT, address TEXT, price REAL, size REAL,
        provider TEXT, is_active INTEGER, manually_deleted INTEGER DEFAULT 0,
        ai_verdict TEXT, status TEXT, created_at INTEGER
      );
      CREATE TABLE watch_list (id TEXT PRIMARY KEY, listing_id TEXT, user_id TEXT);
      CREATE TABLE listing_travel_times (listing_id TEXT);
    `);

    // A resolvable rent reference so immocockpitVerdictFor doesn't bail out on price/size'd 'buy'
    // listings below - same fixture city (Münster, NW) used by immocockpitVerdict.test.js.
    dataFile = path.join(os.tmpdir(), `rent-data-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(dataFile, JSON.stringify({ defaultRentPerSqm: 9, cities: { Münster: 12 } }));
    process.env.RENT_DATA_PATH = dataFile;
    vi.resetModules();
    ({ queryListings } = await import('../../../lib/services/storage/listingsStorage.js'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataFile, { force: true });
    delete process.env.RENT_DATA_PATH;
  });

  describe('job (multi-select)', () => {
    it('returns listings from any of several selected jobs, not just the first', () => {
      addJob('j1');
      addJob('j2');
      addJob('j3');
      addListing('a', 'j1');
      addListing('b', 'j2');
      addListing('c', 'j3');

      const page = queryListings({ jobIdFilter: ['j1', 'j2'], userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['a', 'b']);
    });

    it('still works with the single-id form other callers (finance/mcp) use', () => {
      addJob('j1');
      addJob('j2');
      addListing('a', 'j1');
      addListing('b', 'j2');

      const page = queryListings({ jobIdFilter: 'j1', userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['a']);
    });
  });

  describe('aiVerdict (multi-select)', () => {
    it('unions several verdicts, including "none" for unrated listings', () => {
      addJob('j1');
      addListing('good1', 'j1', { aiVerdict: 'good' });
      addListing('bad1', 'j1', { aiVerdict: 'bad' });
      addListing('unrated1', 'j1', { aiVerdict: null });

      const page = queryListings({ aiVerdictFilter: ['good', 'none'], userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['good1', 'unrated1']);
    });

    it('matches only the selected verdicts, excluding one left out', () => {
      addJob('j1');
      addListing('good1', 'j1', { aiVerdict: 'good' });
      addListing('maybe1', 'j1', { aiVerdict: 'maybe' });
      addListing('bad1', 'j1', { aiVerdict: 'bad' });

      const page = queryListings({ aiVerdictFilter: ['good', 'bad'], userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['bad1', 'good1']);
    });
  });

  describe('provider (multi-select)', () => {
    it('returns listings from any of several selected providers, not just the first', () => {
      addJob('j1');
      addListing('a', 'j1', { provider: 'immoscout' });
      addListing('b', 'j1', { provider: 'immowelt' });
      addListing('c', 'j1', { provider: 'kleinanzeigen' });

      const page = queryListings({ providerFilter: ['immoscout', 'immowelt'], userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['a', 'b']);
    });

    it('still works with the single-name form other callers (finance/mcp) use', () => {
      addJob('j1');
      addListing('a', 'j1', { provider: 'immoscout' });
      addListing('b', 'j1', { provider: 'immowelt' });

      const page = queryListings({ providerFilter: 'immoscout', userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['a']);
    });
  });

  describe('icVerdict (multi-select, JS-side)', () => {
    it('unions several immocockpit verdicts and reports the correct total for the union', () => {
      addJob('buyJob', { dealType: 'buy' });
      // Cheap relative to rent -> good; mid -> maybe; expensive -> bad (same thresholds as
      // immocockpitVerdict.test.js, all against the 12 EUR/m2 Münster fixture above).
      addListing('cheap', 'buyJob', { price: 60000, size: 60, address: '48143 Münster' });
      addListing('mid', 'buyJob', { price: 200000, size: 60, address: '48143 Münster' });
      addListing('pricey', 'buyJob', { price: 500000, size: 60, address: '48143 Münster' });

      const page = queryListings({ immocockpitVerdictFilter: ['good', 'bad'], userId: 'u1', isAdmin: true });

      expect(idsOf(page)).toEqual(['cheap', 'pricey']);
      expect(page.totalNumber).toBe(2);
    });
  });
});
