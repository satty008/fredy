/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../../services/logger.js';
import { canEditChannel } from '../../services/security/channelAccess.js';
import * as adapterStorage from '../../services/storage/configuredAdapterStorage.js';
import {
  AI_PROVIDER_ADAPTERS,
  aiProviderAdapterOf,
  redactAiProviderFields,
} from '../../services/ai/aiProviderAdapters.js';

/**
 * Deliberately unlike notification channels, an AI-provider credential is never shareable -
 * `visibility` isn't exposed here at all, always stored `private`. Sharing a Telegram bot token
 * only lets someone send through your bot; sharing an API key means their usage bills to your
 * account. The whole point of this feature is that each person brings their own key, so there is
 * no legitimate reason to widen it, and not offering the control is safer than offering it and
 * hoping nobody flips it by mistake.
 *
 * @param {import('../../services/storage/configuredAdapterStorage.js').Channel} row
 * @param {{id: string, isAdmin?: boolean}} user
 * @param {boolean} includeFields
 * @returns {Object}
 */
const toDto = (row, user, includeFields) => ({
  id: row.id,
  adapterId: row.adapterId,
  adapterName: aiProviderAdapterOf(row.adapterId)?.name ?? row.adapterId,
  name: row.name,
  isOwner: row.userId === user.id,
  canEdit: canEditChannel(user, row),
  ...(includeFields ? { fields: redactAiProviderFields(row.adapterId, row.fields) } : {}),
});

/**
 * Every configured AI-provider row belonging to a user, regardless of what other adapter types
 * (notification channels) happen to share the same table.
 *
 * @param {string} userId
 * @returns {import('../../services/storage/configuredAdapterStorage.js').Channel[]}
 */
const ownAiProviderRows = (userId) => {
  const knownIds = new Set(AI_PROVIDER_ADAPTERS.map((a) => a.id));
  return adapterStorage.getAllChannels().filter((row) => knownIds.has(row.adapterId) && row.userId === userId);
};

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function aiProviderPlugin(fastify) {
  fastify.get('/types', async () => AI_PROVIDER_ADAPTERS.map(({ id, name, fields }) => ({ id, name, fields })));

  fastify.get('/', async (request) => {
    return ownAiProviderRows(request.session.currentUser).map((row) => toDto(row, request.currentUser, false));
  });

  fastify.get('/:id', async (request, reply) => {
    const row = adapterStorage.getChannel(request.params.id);
    if (row == null || !aiProviderAdapterOf(row.adapterId)) {
      return reply.code(404).send({ error: 'AI provider not found' });
    }
    if (!canEditChannel(request.currentUser, row)) {
      return reply.code(403).send({ error: 'You are not allowed to see this AI provider.' });
    }
    return toDto(row, request.currentUser, true);
  });

  fastify.post('/', async (request, reply) => {
    const body = request.body ?? {};
    const { id = null, adapterId, name } = body;

    const existing = id ? adapterStorage.getChannel(id) : null;
    if (id && (existing == null || !aiProviderAdapterOf(existing.adapterId))) {
      return reply.code(404).send({ error: 'AI provider not found' });
    }
    if (existing && !canEditChannel(request.currentUser, existing)) {
      return reply.code(403).send({ error: 'You are not allowed to change this AI provider.' });
    }

    const resolvedAdapterId = existing ? existing.adapterId : adapterId;
    const adapterDef = aiProviderAdapterOf(resolvedAdapterId);
    if (adapterDef == null) {
      return reply.code(400).send({ error: 'Unknown AI provider type' });
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: 'An AI provider needs a name.' });
    }

    // A merge, not an overwrite - the same "omitted key keeps the stored value" rule as
    // notification channels, so re-saving the name doesn't blank out an already-stored API key.
    const hasFieldsKey = Object.prototype.hasOwnProperty.call(body, 'fields');
    let resolvedFields = hasFieldsKey ? { ...(body.fields ?? {}) } : { ...(existing?.fields ?? {}) };
    if (hasFieldsKey && existing) {
      for (const field of adapterDef.fields) {
        // The client only ever sees a redacted placeholder for a secret field, so if that's what
        // came back unchanged, keep the real stored value rather than saving the placeholder.
        if (field.secret && resolvedFields[field.key] === '••••••••') {
          resolvedFields[field.key] = existing.fields?.[field.key] ?? '';
        }
      }
    }
    const missingRequired = adapterDef.fields.find((f) => f.required && !resolvedFields[f.key]);
    if (missingRequired) {
      return reply.code(400).send({ error: `${missingRequired.label} is required.` });
    }

    try {
      const savedId = adapterStorage.upsertChannel({
        id: existing?.id,
        userId: existing?.userId ?? request.session.currentUser,
        adapterId: resolvedAdapterId,
        name: name.trim(),
        fields: resolvedFields,
        visibility: adapterStorage.VISIBILITY.PRIVATE,
      });
      return reply.send(toDto(adapterStorage.getChannel(savedId), request.currentUser, false));
    } catch (error) {
      logger.error('Failed to save AI provider', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const row = adapterStorage.getChannel(request.params.id);
    if (row == null || !aiProviderAdapterOf(row.adapterId)) {
      return reply.code(404).send({ error: 'AI provider not found' });
    }
    if (!canEditChannel(request.currentUser, row)) {
      return reply.code(403).send({ error: 'You are not allowed to delete this AI provider.' });
    }
    adapterStorage.removeChannel(row.id);
    return reply.send();
  });
}
