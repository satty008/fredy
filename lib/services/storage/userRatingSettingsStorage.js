/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import SqliteConnection from './SqliteConnection.js';

/**
 * @typedef {Object} UserRatingSettings
 * @property {string} userId
 * @property {string|null} aiAdapterId - Which `configured_adapter` row (an 'anthropic' or
 *   'openai-compatible' credential) to rate with. `null` means rating isn't configured yet.
 * @property {string|null} model - Model name to request from that provider. `null` means the
 *   provider's own default.
 * @property {string|null} instructions - Custom rating instructions. `null` means "use the
 *   built-in default rubric" - see `lib/services/ai/defaultRatingInstructions.js`.
 * @property {number} updatedAt
 */

/**
 * @param {Object} row
 * @returns {UserRatingSettings}
 */
const mapRow = (row) => ({
  userId: row.user_id,
  aiAdapterId: row.ai_adapter_id,
  model: row.model,
  instructions: row.instructions,
  updatedAt: row.updated_at,
});

/**
 * A user's rating configuration, or `null` if they've never set one up - which is
 * indistinguishable from "use every default" for the caller's purposes, but kept as `null`
 * rather than a synthesized row so `getConfiguredAdapterOrNull` style callers can tell the two
 * apart if they ever need to.
 *
 * @param {string} userId
 * @returns {UserRatingSettings|null}
 */
export const getUserRatingSettings = (userId) => {
  if (!userId) return null;
  const row = SqliteConnection.query(`SELECT * FROM user_rating_settings WHERE user_id = @userId LIMIT 1`, {
    userId,
  })[0];
  return row ? mapRow(row) : null;
};

/**
 * Insert or update a user's rating configuration. Always a full replace of the three editable
 * fields - there is exactly one row per user, so there is no partial-update ambiguity to resolve.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string|null} [params.aiAdapterId]
 * @param {string|null} [params.model]
 * @param {string|null} [params.instructions]
 * @returns {void}
 */
export const upsertUserRatingSettings = ({ userId, aiAdapterId = null, model = null, instructions = null }) => {
  if (!userId) return;
  const now = Date.now();
  SqliteConnection.execute(
    `INSERT INTO user_rating_settings (user_id, ai_adapter_id, model, instructions, updated_at)
     VALUES (@userId, @aiAdapterId, @model, @instructions, @now)
     ON CONFLICT(user_id) DO UPDATE SET
       ai_adapter_id = excluded.ai_adapter_id,
       model = excluded.model,
       instructions = excluded.instructions,
       updated_at = excluded.updated_at`,
    { userId, aiAdapterId, model, instructions, now },
  );
};
