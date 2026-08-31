/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../../services/logger.js';
import * as ratingSettingsStorage from '../../services/storage/userRatingSettingsStorage.js';
import * as adapterStorage from '../../services/storage/configuredAdapterStorage.js';
import { aiProviderAdapterOf } from '../../services/ai/aiProviderAdapters.js';
import { canEditChannel } from '../../services/security/channelAccess.js';
import { DEFAULT_RATING_INSTRUCTIONS } from '../../services/ai/defaultRatingInstructions.js';

/**
 * @param {string} userId
 * @returns {Object}
 */
const toDto = (userId) => {
  const settings = ratingSettingsStorage.getUserRatingSettings(userId);
  return {
    aiAdapterId: settings?.aiAdapterId ?? null,
    model: settings?.model ?? null,
    // The client always sees *a* value here, either the user's own or the built-in default -
    // there is no meaningful "unset" state to represent in a textarea the way there is for a
    // nullable DB column, and pre-filling the default is what makes it editable-from rather
    // than an empty box the user has to rebuild from scratch.
    instructions: settings?.instructions ?? DEFAULT_RATING_INSTRUCTIONS,
    isCustomized: settings?.instructions != null,
    configured: settings?.aiAdapterId != null,
  };
};

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function ratingSettingsPlugin(fastify) {
  fastify.get('/', async (request) => toDto(request.session.currentUser));

  fastify.post('/', async (request, reply) => {
    const userId = request.session.currentUser;
    const body = request.body ?? {};
    const { aiAdapterId = null, model = null } = body;

    if (aiAdapterId != null) {
      const adapterRow = adapterStorage.getChannel(aiAdapterId);
      if (adapterRow == null || !aiProviderAdapterOf(adapterRow.adapterId)) {
        return reply.code(400).send({ error: 'Unknown AI provider' });
      }
      if (!canEditChannel(request.currentUser, adapterRow)) {
        return reply.code(403).send({ error: 'You are not allowed to rate with this AI provider.' });
      }
    }

    // `instructions: null` (or omitted) resets to the built-in default - distinct from
    // `instructions: ""`, which would be a genuinely empty custom prompt sent to the model
    // verbatim. The UI's "reset to default" action sends null; clearing the textarea by hand and
    // saving sends "".
    const instructions = typeof body.instructions === 'string' ? body.instructions : null;

    try {
      ratingSettingsStorage.upsertUserRatingSettings({ userId, aiAdapterId, model, instructions });
      // The updated settings go back so the client can reflect a reset-to-default instructions
      // value immediately, without a second round trip.
      return reply.send(toDto(userId));
    } catch (error) {
      logger.error('Failed to save rating settings', error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
