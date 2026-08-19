/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// We mock SqliteConnection so we can assert which SQL the storage layer
// runs and with which params, without spinning up a real SQLite DB.

const calls = {
  execute: [],
  query: [],
};

const sqliteMock = {
  execute: (sql, params) => {
    calls.execute.push({ sql, params });
    // Default: pretend 1 row was affected (so setListingStatus reports success).
    return { changes: 1 };
  },
  query: (sql, params) => {
    calls.query.push({ sql, params });
    // Return shape varies by test - overridden via queryHandler when needed.
    if (sqliteMock.__queryHandler) return sqliteMock.__queryHandler(sql, params);
    return [];
  },
  // Batch updates are chunked inside a transaction (see forEachIdChunk); statements prepared on
  // the transaction's db handle land in the same `calls.execute` log as direct executes.
  withTransaction: (callback) =>
    callback({
      prepare: (sql) => ({
        run: (params) => {
          calls.execute.push({ sql, params });
          return { changes: 1 };
        },
      }),
    }),
  __queryHandler: null,
};

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({
  default: sqliteMock,
}));

describe('listingsStorage.setListingStatus', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = null;
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('runs an UPDATE storing a JSON payload with status and setAt', () => {
    const before = Date.now();
    const changes = listingsStorage.setListingStatus('listing-1', 'Applied');
    const after = Date.now();
    expect(changes).toBe(1);
    expect(calls.execute).toHaveLength(1);
    expect(calls.execute[0].sql).toMatch(/UPDATE listings SET status = @status WHERE id = @id/);
    expect(calls.execute[0].params.id).toBe('listing-1');
    const parsed = JSON.parse(calls.execute[0].params.status);
    expect(parsed.status).toBe('applied');
    expect(parsed.setAt).toBeGreaterThanOrEqual(before);
    expect(parsed.setAt).toBeLessThanOrEqual(after);
  });

  it('accepts null to clear the status (no JSON wrapping)', () => {
    listingsStorage.setListingStatus('listing-2', null);
    expect(calls.execute[0].params).toEqual({ id: 'listing-2', status: null });
  });

  it('rejects invalid statuses', () => {
    expect(() => listingsStorage.setListingStatus('listing-3', 'maybe')).toThrow(/Invalid listing status/);
    expect(calls.execute).toHaveLength(0);
  });

  it('returns 0 when no id is supplied (no SQL is run)', () => {
    const result = listingsStorage.setListingStatus(null, 'applied');
    expect(result).toBe(0);
    expect(calls.execute).toHaveLength(0);
  });
});

describe('listingsStorage.queryListings statusFilter', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    // Return empty rows for both the count and the page-fetch queries.
    sqliteMock.__queryHandler = (sql) => {
      if (/COUNT\(1\)/.test(sql)) return [{ cnt: 0 }];
      return [];
    };
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it("adds 'l.status IS NULL' to WHERE when statusFilter is 'none'", () => {
    listingsStorage.queryListings({ statusFilter: 'none', userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/\(l\.status IS NULL\)/);
  });

  it('extracts the inner status field via json_extract for a concrete status', () => {
    listingsStorage.queryListings({ statusFilter: 'applied', userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/json_extract\(l\.status, '\$\.status'\) = @statusValue/);
    expect(pageQuery.params.statusValue).toBe('applied');
  });

  it('ignores unknown statusFilter values silently', () => {
    listingsStorage.queryListings({ statusFilter: 'bogus', userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).not.toMatch(/status/i);
  });

  it('parses the JSON status payload of returned rows into an object', () => {
    sqliteMock.__queryHandler = (sql) => {
      if (/COUNT\(1\)/.test(sql)) return [{ cnt: 2 }];
      return [
        { id: 'a', status: JSON.stringify({ status: 'applied', setAt: 1700000000000 }) },
        { id: 'b', status: null },
      ];
    };
    const result = listingsStorage.queryListings({ userId: 'u1', isAdmin: true });
    expect(result.result[0].status).toEqual({ status: 'applied', setAt: 1700000000000 });
    expect(result.result[1].status).toBeNull();
  });
});

describe('listingsStorage.setListingAiVerdict', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = null;
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('runs an UPDATE storing the lower-cased verdict', () => {
    const changes = listingsStorage.setListingAiVerdict('listing-1', 'GOOD');
    expect(changes).toBe(1);
    expect(calls.execute).toHaveLength(1);
    expect(calls.execute[0].sql).toMatch(/UPDATE listings SET ai_verdict = @verdict WHERE id = @id/);
    expect(calls.execute[0].params).toEqual({ id: 'listing-1', verdict: 'good' });
  });

  it('accepts null to clear the verdict', () => {
    listingsStorage.setListingAiVerdict('listing-2', null);
    expect(calls.execute[0].params).toEqual({ id: 'listing-2', verdict: null });
  });

  it('rejects invalid verdicts', () => {
    expect(() => listingsStorage.setListingAiVerdict('listing-3', 'excellent')).toThrow(/Invalid AI verdict/);
    expect(calls.execute).toHaveLength(0);
  });

  it('returns 0 when no id is supplied (no SQL is run)', () => {
    const result = listingsStorage.setListingAiVerdict(null, 'good');
    expect(result).toBe(0);
    expect(calls.execute).toHaveLength(0);
  });
});

describe('listingsStorage.queryListings aiVerdictFilter', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = (sql) => {
      if (/COUNT\(1\)/.test(sql)) return [{ cnt: 0 }];
      return [];
    };
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it("adds 'l.ai_verdict IS NULL' to WHERE when aiVerdictFilter is 'none'", () => {
    listingsStorage.queryListings({ aiVerdictFilter: 'none', userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/\(l\.ai_verdict IS NULL\)/);
  });

  it('filters by equality for a concrete verdict', () => {
    listingsStorage.queryListings({ aiVerdictFilter: 'maybe', userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    // A single verdict still goes through the same IN-clause builder the multi-select filter
    // uses, so it lands in an IN of one rather than an `=`.
    expect(pageQuery.sql).toMatch(/\(l\.ai_verdict IN \(@aiVerdictValue0\)\)/);
    expect(pageQuery.params.aiVerdictValue0).toBe('maybe');
  });

  it('ignores unknown aiVerdictFilter values silently', () => {
    listingsStorage.queryListings({ aiVerdictFilter: 'bogus', userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).not.toMatch(/ai_verdict/i);
  });
});

describe('listingsStorage.queryListings grossYieldPercent', () => {
  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
  });

  it('attaches a rounded grossYieldPercent to each returned row when computable', async () => {
    vi.resetModules();
    vi.doMock('../../lib/services/finance/rentYield.js', () => ({
      grossYieldPercent: (row) => (row.id === 'a' ? 5.6789 : null),
      // netYieldPercent isn't under test here, but parseListingStatus calls it unconditionally,
      // so a mock that omits it breaks every test that imports listingsStorage.js afterward.
      netYieldPercent: () => null,
    }));
    const freshStorage = await import('../../lib/services/storage/listingsStorage.js');
    sqliteMock.__queryHandler = (sql) => {
      if (/COUNT\(1\)/.test(sql)) return [{ cnt: 2 }];
      return [{ id: 'a' }, { id: 'b' }];
    };
    const result = freshStorage.queryListings({ userId: 'u1', isAdmin: true });
    expect(result.result[0].grossYieldPercent).toBe(5.7);
    expect(result.result[1].grossYieldPercent).toBeNull();
    vi.doUnmock('../../lib/services/finance/rentYield.js');
  });
});

describe('listingsStorage.queryListings hiddenOnly', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = (sql) => {
      if (/COUNT\(1\)/.test(sql)) return [{ cnt: 0 }];
      return [];
    };
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('filters by manually_deleted = 0 by default', () => {
    listingsStorage.queryListings({ userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/\(l\.manually_deleted = 0\)/);
  });

  it('filters by manually_deleted = 1 when hiddenOnly is true', () => {
    listingsStorage.queryListings({ userId: 'u1', isAdmin: true, hiddenOnly: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/\(l\.manually_deleted = 1\)/);
    expect(pageQuery.sql).not.toMatch(/\(l\.manually_deleted = 0\)/);
  });
});

describe('listingsStorage.getAvailableProviders', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = null;
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('queries distinct providers excluding manually deleted by default', () => {
    sqliteMock.__queryHandler = () => [{ provider: 'immoscout' }, { provider: 'immowelt' }];
    const result = listingsStorage.getAvailableProviders({ userId: 'u1', isAdmin: true });
    expect(result).toEqual(['immoscout', 'immowelt']);
    expect(calls.query[0].sql).toMatch(/SELECT DISTINCT l\.provider/);
    expect(calls.query[0].sql).toMatch(/\(l\.manually_deleted = 0\)/);
  });

  it('filters by jobId when jobId is provided', () => {
    sqliteMock.__queryHandler = () => [{ provider: 'immoscout' }];
    const result = listingsStorage.getAvailableProviders({ jobId: 'job-1', userId: 'u1', isAdmin: true });
    expect(result).toEqual(['immoscout']);
    // Single job id, same IN-clause builder the multi-select job filter uses.
    expect(calls.query[0].sql).toMatch(/\(l\.job_id IN \(@jobId0\)\)/);
    expect(calls.query[0].params.jobId0).toBe('job-1');
  });
});

describe('listingsStorage.restoreListingsById', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = null;
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('clears the manually_deleted flag for the given ids', () => {
    listingsStorage.restoreListingsById(['a', 'b']);
    expect(calls.execute).toHaveLength(1);
    expect(calls.execute[0].sql).toMatch(/UPDATE listings\s+SET manually_deleted = 0\s+WHERE id IN \(\?,\?\)/);
    expect(calls.execute[0].params).toEqual(['a', 'b']);
  });

  it('is a no-op when ids are missing or empty', () => {
    listingsStorage.restoreListingsById([]);
    listingsStorage.restoreListingsById(undefined);
    expect(calls.execute).toHaveLength(0);
  });
});

describe('listingsStorage.getListingById', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('parses the JSON status payload of the returned row', () => {
    sqliteMock.__queryHandler = () => [
      { id: 'a', status: JSON.stringify({ status: 'rejected', setAt: 1700000000001 }) },
    ];
    const row = listingsStorage.getListingById('a', 'u1', true);
    expect(row.status).toEqual({ status: 'rejected', setAt: 1700000000001 });
  });

  it('returns null status untouched', () => {
    sqliteMock.__queryHandler = () => [{ id: 'a', status: null }];
    const row = listingsStorage.getListingById('a', 'u1', true);
    expect(row.status).toBeNull();
  });

  it('returns null when no row is found', () => {
    sqliteMock.__queryHandler = () => [];
    const row = listingsStorage.getListingById('missing', 'u1', true);
    expect(row).toBeNull();
  });

  it('checks only the selected listing job for a non-admin user', () => {
    sqliteMock.__queryHandler = () => [];

    listingsStorage.getListingById('a', 'u1', false);

    const { sql, params } = calls.query[0];
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('scoped_job.id = l.job_id');
    expect(sql).toContain('scoped_job.user_id = @userId');
    expect(sql).toContain('json_each(scoped_job.shared_with_user)');
    expect(sql).not.toContain('l.job_id IN');
    expect(params).toMatchObject({ id: 'a', userId: 'u1' });
  });
});

describe('watchListStorage.ensureWatch', () => {
  let watchListStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = null;
    watchListStorage = await import('../../lib/services/storage/watchListStorage.js');
  });

  it('inserts and reports watched=true on first call', () => {
    // After INSERT, createWatch queries for existence and gets a row back.
    sqliteMock.__queryHandler = () => [{ ok: 1 }];
    const result = watchListStorage.ensureWatch('listing-1', 'user-1');
    expect(result).toEqual({ watched: true });
    // INSERT should have been issued.
    expect(calls.execute.some((c) => /INSERT INTO watch_list/.test(c.sql))).toBe(true);
  });

  it('returns watched=true when an entry already exists', () => {
    // Simulate ON CONFLICT being a no-op: execute reports no changes, then SELECT confirms row exists.
    sqliteMock.execute = (sql, params) => {
      calls.execute.push({ sql, params });
      return { changes: 0 };
    };
    sqliteMock.__queryHandler = () => [{ ok: 1 }];
    const result = watchListStorage.ensureWatch('listing-2', 'user-2');
    expect(result).toEqual({ watched: true });
    // Restore execute to default for subsequent tests.
    sqliteMock.execute = (sql, params) => {
      calls.execute.push({ sql, params });
      return { changes: 1 };
    };
  });

  it('returns watched=false when listingId or userId is missing', () => {
    expect(watchListStorage.ensureWatch(null, 'u')).toEqual({ watched: false });
    expect(watchListStorage.ensureWatch('l', null)).toEqual({ watched: false });
    expect(calls.execute).toHaveLength(0);
  });
});
