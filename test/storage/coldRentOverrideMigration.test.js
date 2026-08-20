/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { up } from '../../lib/services/storage/migrations/sql/36.listing-cold-rent-override.js';

describe('migration 36 - listing cold rent override', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        address TEXT
      );
    `);
  });

  afterEach(() => db.close());

  const columns = () =>
    db
      .prepare(`PRAGMA table_info(listings)`)
      .all()
      .map((column) => column.name);

  const addListing = (id) => db.prepare(`INSERT INTO listings (id, address) VALUES (?,?)`).run(id, 'some address');

  it('adds the override column', () => {
    up(db);
    expect(columns()).toContain('cold_rent_override');
  });

  it('backfills existing listings with NULL, meaning no override', () => {
    addListing('listing-1');
    up(db);

    const row = db.prepare(`SELECT cold_rent_override FROM listings WHERE id = ?`).get('listing-1');
    expect(row.cold_rent_override).toBeNull();
  });

  it('is a no-op when run again', () => {
    up(db);
    addListing('listing-2');
    db.prepare(`UPDATE listings SET cold_rent_override = ? WHERE id = ?`).run(650, 'listing-2');

    expect(() => up(db)).not.toThrow();

    const row = db.prepare(`SELECT cold_rent_override FROM listings WHERE id = ?`).get('listing-2');
    expect(row.cold_rent_override).toBe(650);
  });
});
