/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/userRatingSettingsStorage.js', () => ({
  getUserRatingSettings: vi.fn(() => null),
  upsertUserRatingSettings: vi.fn(),
}));
vi.mock('../../lib/services/storage/configuredAdapterStorage.js', () => ({
  getChannel: vi.fn(() => null),
}));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import * as ratingSettingsStorage from '../../lib/services/storage/userRatingSettingsStorage.js';
import * as adapterStorage from '../../lib/services/storage/configuredAdapterStorage.js';
import { DEFAULT_RATING_INSTRUCTIONS } from '../../lib/services/ai/defaultRatingInstructions.js';
import ratingSettingsPlugin from '../../lib/api/routes/ratingSettingsRouter.js';

async function buildApp(userId = 'user-1') {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: userId };
    request.currentUser = { id: userId, isAdmin: false };
  });
  await app.register(ratingSettingsPlugin);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  ratingSettingsStorage.getUserRatingSettings.mockReturnValue(null);
  adapterStorage.getChannel.mockReturnValue(null);
});

describe('GET /', () => {
  it('falls back to the built-in default instructions for a user who never customized them', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      instructions: DEFAULT_RATING_INSTRUCTIONS,
      isCustomized: false,
      configured: false,
    });
  });

  it('returns the stored instructions and marks them customized', async () => {
    ratingSettingsStorage.getUserRatingSettings.mockReturnValue({
      userId: 'user-1',
      aiAdapterId: 'adapter-1',
      model: 'claude-sonnet-5',
      instructions: 'My own rubric.',
      updatedAt: 0,
    });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.json()).toMatchObject({
      instructions: 'My own rubric.',
      isCustomized: true,
      configured: true,
      aiAdapterId: 'adapter-1',
    });
  });
});

describe('POST /', () => {
  it('saves a chosen AI provider the caller owns', async () => {
    adapterStorage.getChannel.mockReturnValue({ id: 'adapter-1', userId: 'user-1', adapterId: 'anthropic' });
    const app = await buildApp();

    const response = await app.inject({ method: 'POST', url: '/', payload: { aiAdapterId: 'adapter-1' } });

    expect(response.statusCode).toBe(200);
    expect(ratingSettingsStorage.upsertUserRatingSettings).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', aiAdapterId: 'adapter-1' }),
    );
  });

  it('refuses an AI provider owned by someone else', async () => {
    adapterStorage.getChannel.mockReturnValue({ id: 'adapter-1', userId: 'someone-else', adapterId: 'anthropic' });
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'POST', url: '/', payload: { aiAdapterId: 'adapter-1' } });

    expect(response.statusCode).toBe(403);
    expect(ratingSettingsStorage.upsertUserRatingSettings).not.toHaveBeenCalled();
  });

  it('rejects an unknown AI provider id', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'POST', url: '/', payload: { aiAdapterId: 'does-not-exist' } });

    expect(response.statusCode).toBe(400);
  });

  it('treats an omitted instructions field as "reset to default" (stores null)', async () => {
    const app = await buildApp();

    await app.inject({ method: 'POST', url: '/', payload: { aiAdapterId: null } });

    expect(ratingSettingsStorage.upsertUserRatingSettings).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: null }),
    );
  });

  it('stores a genuinely empty string distinctly from null when the caller sends one', async () => {
    const app = await buildApp();

    await app.inject({ method: 'POST', url: '/', payload: { instructions: '' } });

    expect(ratingSettingsStorage.upsertUserRatingSettings).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: '' }),
    );
  });
});
