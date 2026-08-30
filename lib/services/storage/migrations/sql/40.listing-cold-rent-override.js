/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Let a human overrule rent-data.json for one listing's cold rent.
 *
 * The city lookup in `rentPerSqmFor` is a substring match against the scraped address and title,
 * and two portals describing the same real flat can send it down two different branches - one
 * matching a district name, the other a city name, each with its own rate. Nothing about that is
 * fixable by editing rent-data.json, because the file is not wrong, the scraped text just is.
 * This column is the escape hatch: a monthly EUR figure, in the same unit already shown on the
 * finance card, that `rentPerSqmFor` prefers over its own lookup whenever it is set.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const columns = db.prepare(`PRAGMA table_info(listings)`).all();
  if (!columns.some((column) => column.name === 'cold_rent_override')) {
    db.exec(`ALTER TABLE listings ADD COLUMN cold_rent_override REAL`);
  }
}
