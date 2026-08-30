/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let db;

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({
  default: {
    query: (sql, params = {}) => db.prepare(sql).all(params),
    execute: (sql, params = {}) => db.prepare(sql).run(params),
  },
}));

describe('userRatingSettingsStorage', () => {
  let storage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE configured_adapter (id TEXT PRIMARY KEY);
      CREATE TABLE user_rating_settings (
        user_id TEXT PRIMARY KEY, ai_adapter_id TEXT, model TEXT, instructions TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(`INSERT INTO users (id) VALUES ('u1'), ('u2')`).run();
    storage = await import('../../lib/services/storage/userRatingSettingsStorage.js');
  });

  afterEach(() => db.close());

  it('returns null for a user who has never configured rating', () => {
    expect(storage.getUserRatingSettings('u1')).toBe(null);
  });

  it('creates a settings row on first upsert', () => {
    storage.upsertUserRatingSettings({
      userId: 'u1',
      aiAdapterId: 'adapter-1',
      model: 'claude-sonnet-5',
      instructions: 'Be strict about Erbpacht.',
    });

    const settings = storage.getUserRatingSettings('u1');
    expect(settings).toMatchObject({
      userId: 'u1',
      aiAdapterId: 'adapter-1',
      model: 'claude-sonnet-5',
      instructions: 'Be strict about Erbpacht.',
    });
  });

  it('replaces the existing row on a second upsert rather than erroring', () => {
    storage.upsertUserRatingSettings({ userId: 'u1', aiAdapterId: 'adapter-1', model: null, instructions: null });
    storage.upsertUserRatingSettings({ userId: 'u1', aiAdapterId: 'adapter-2', model: 'gpt-5', instructions: 'v2' });

    const settings = storage.getUserRatingSettings('u1');
    expect(settings).toMatchObject({ aiAdapterId: 'adapter-2', model: 'gpt-5', instructions: 'v2' });
  });

  it('keeps settings scoped per user', () => {
    storage.upsertUserRatingSettings({ userId: 'u1', aiAdapterId: 'adapter-1' });
    storage.upsertUserRatingSettings({ userId: 'u2', aiAdapterId: 'adapter-2' });

    expect(storage.getUserRatingSettings('u1').aiAdapterId).toBe('adapter-1');
    expect(storage.getUserRatingSettings('u2').aiAdapterId).toBe('adapter-2');
  });

  it('defaults aiAdapterId/model/instructions to null when omitted', () => {
    storage.upsertUserRatingSettings({ userId: 'u1' });

    expect(storage.getUserRatingSettings('u1')).toMatchObject({
      aiAdapterId: null,
      model: null,
      instructions: null,
    });
  });
});
