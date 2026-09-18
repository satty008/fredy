/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Per-user AI rating configuration: which configured AI-provider adapter to use and what
 * instructions to send it.
 *
 * A separate table rather than reusing `configured_adapter` for the settings themselves, because
 * the adapter row is the *credential* (an API key, shareable via the existing visibility model)
 * while this is the *preference* (which credential to rate with, and what to tell it to do) -
 * one user could plausibly configure several AI-provider adapters over time but only ever has one
 * active rating configuration, the same way a person has several email addresses but one they
 * currently use to log in.
 *
 * `instructions` is nullable on purpose: NULL means "use the built-in default rubric", not "use
 * an empty prompt" - a brand-new user (or a friend who never touched Settings) gets a working
 * rater immediately, and only pays the cost of writing their own instructions if they want to
 * diverge from the default.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_rating_settings
    (
      user_id       TEXT PRIMARY KEY,
      ai_adapter_id TEXT,
      model         TEXT,
      instructions  TEXT,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (ai_adapter_id) REFERENCES configured_adapter (id) ON DELETE SET NULL
    );
  `);
}
