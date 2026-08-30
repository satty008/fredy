/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { up } from '../../lib/services/storage/migrations/sql/41.user-rating-settings.js';

describe('migration 41 - user rating settings', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE configured_adapter (id TEXT PRIMARY KEY);
    `);
  });

  afterEach(() => db.close());

  const columns = () =>
    db
      .prepare(`PRAGMA table_info(user_rating_settings)`)
      .all()
      .map((column) => column.name);

  it('creates the table with the expected columns', () => {
    up(db);
    expect(columns()).toEqual(
      expect.arrayContaining(['user_id', 'ai_adapter_id', 'model', 'instructions', 'updated_at']),
    );
  });

  it('allows instructions to be left NULL, meaning "use the built-in default"', () => {
    up(db);
    db.prepare(`INSERT INTO users (id) VALUES ('u1')`).run();
    db.prepare(`INSERT INTO user_rating_settings (user_id, updated_at) VALUES ('u1', 0)`).run();

    const row = db
      .prepare(`SELECT instructions, ai_adapter_id, model FROM user_rating_settings WHERE user_id = ?`)
      .get('u1');
    expect(row.instructions).toBeNull();
    expect(row.ai_adapter_id).toBeNull();
    expect(row.model).toBeNull();
  });

  it('is a no-op when run again', () => {
    up(db);
    db.prepare(`INSERT INTO users (id) VALUES ('u1')`).run();
    db.prepare(`INSERT INTO user_rating_settings (user_id, updated_at) VALUES ('u1', 123)`).run();

    expect(() => up(db)).not.toThrow();

    const row = db.prepare(`SELECT updated_at FROM user_rating_settings WHERE user_id = ?`).get('u1');
    expect(row.updated_at).toBe(123);
  });
});
