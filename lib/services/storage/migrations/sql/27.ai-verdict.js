/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Migration: Add ai_verdict column to listings table.
// Stores a structured GOOD/MAYBE/BAD verdict from an AI review pass, separate from the
// free-text notes column, so the UI and API can filter/sort on it without parsing text.
export function up(db) {
  const columns = db.prepare(`PRAGMA table_info(listings)`).all();
  if (!columns.some((col) => col.name === 'ai_verdict')) {
    db.exec(`ALTER TABLE listings ADD COLUMN ai_verdict TEXT`);
  }
}
