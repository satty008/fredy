/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  userCanAccessListing: vi.fn(() => true),
  getListingById: vi.fn(),
  setListingAiVerdict: vi.fn(),
  setListingNotes: vi.fn(),
  queryListings: vi.fn(),
  getListingsForMap: vi.fn(),
  getPriceHistory: vi.fn(),
  setListingStatus: vi.fn(),
  deleteListingsByJobId: vi.fn(),
  deleteListingsById: vi.fn(),
}));
vi.mock('../../lib/services/storage/userRatingSettingsStorage.js', () => ({
  getUserRatingSettings: vi.fn(),
}));
vi.mock('../../lib/services/storage/configuredAdapterStorage.js', () => ({
  getChannel: vi.fn(),
}));
vi.mock('../../lib/services/ai/plainRater.js', () => ({ rateListingWithOwnAi: vi.fn() }));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({ toggleWatch: vi.fn(), ensureWatch: vi.fn() }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: vi.fn() }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({ demoMode: false })),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/geocoding/distanceService.js', () => ({ updateDistancesForListing: vi.fn() }));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));

import * as listingStorage from '../../lib/services/storage/listingsStorage.js';
import * as ratingSettingsStorage from '../../lib/services/storage/userRatingSettingsStorage.js';
import * as adapterStorage from '../../lib/services/storage/configuredAdapterStorage.js';
import { rateListingWithOwnAi } from '../../lib/services/ai/plainRater.js';
import listingsPlugin from '../../lib/api/routes/listingsRouter.js';

async function buildApp(userId = 'user-1') {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: userId };
    request.currentUser = { id: userId, isAdmin: false };
  });
  await app.register(listingsPlugin);
  await app.ready();
  return app;
}

const post = (payload, userId) =>
  buildApp(userId).then((app) => app.inject({ method: 'POST', url: '/rate-with-own-ai', payload }));

beforeEach(() => {
  vi.clearAllMocks();
  ratingSettingsStorage.getUserRatingSettings.mockReturnValue({
    userId: 'user-1',
    aiAdapterId: 'adapter-1',
    model: 'claude-sonnet-5',
    instructions: null,
  });
  adapterStorage.getChannel.mockReturnValue({
    id: 'adapter-1',
    userId: 'user-1',
    adapterId: 'anthropic',
    fields: { apiKey: 'sk-ant-x' },
  });
  listingStorage.getListingById.mockReturnValue({ id: 'listing-1', title: 'A flat', dealType: 'buy' });
  rateListingWithOwnAi.mockResolvedValue({ verdict: 'maybe', reasoning: 'Marginal yield.', yieldNote: 'net: 3.1%' });
});

describe('POST /rate-with-own-ai', () => {
  it('rates each listing and writes the verdict + a formatted note', async () => {
    const response = await post({ listingIds: ['listing-1'] });

    expect(response.statusCode).toBe(200);
    expect(listingStorage.setListingAiVerdict).toHaveBeenCalledWith('listing-1', 'maybe');
    expect(listingStorage.setListingNotes).toHaveBeenCalledWith(
      'listing-1',
      '[AI review] MAYBE (net: 3.1%) — Marginal yield.',
    );
    expect(response.json().results).toEqual([{ listingId: 'listing-1', status: 'rated', verdict: 'maybe' }]);
  });

  it('is not admin-gated - any authenticated user with their own provider can call it', async () => {
    const response = await post({ listingIds: ['listing-1'] }, 'user-1');
    expect(response.statusCode).toBe(200);
  });

  it('rejects when the caller has no AI provider configured', async () => {
    ratingSettingsStorage.getUserRatingSettings.mockReturnValue(null);

    const response = await post({ listingIds: ['listing-1'] });

    expect(response.statusCode).toBe(400);
    expect(rateListingWithOwnAi).not.toHaveBeenCalled();
  });

  it('rejects when the configured provider no longer belongs to the caller', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'adapter-1',
      userId: 'someone-else',
      adapterId: 'anthropic',
      fields: {},
    });

    const response = await post({ listingIds: ['listing-1'] });

    expect(response.statusCode).toBe(400);
    expect(rateListingWithOwnAi).not.toHaveBeenCalled();
  });

  it('reports a missing listing without failing the rest of the batch', async () => {
    listingStorage.getListingById.mockReturnValueOnce(null).mockReturnValueOnce({ id: 'listing-2', dealType: 'buy' });

    const response = await post({ listingIds: ['listing-1', 'listing-2'] });

    expect(response.json().results).toEqual([
      { listingId: 'listing-1', status: 'not_found' },
      { listingId: 'listing-2', status: 'rated', verdict: 'maybe' },
    ]);
  });

  it('reports a per-listing provider failure without failing the rest of the batch', async () => {
    listingStorage.getListingById
      .mockReturnValueOnce({ id: 'listing-1', dealType: 'buy' })
      .mockReturnValueOnce({ id: 'listing-2', dealType: 'buy' });
    rateListingWithOwnAi.mockRejectedValueOnce(new Error('Anthropic API error 401: invalid x-api-key'));
    rateListingWithOwnAi.mockResolvedValueOnce({ verdict: 'good', reasoning: 'Clean.', yieldNote: 'net: 5%' });

    const response = await post({ listingIds: ['listing-1', 'listing-2'] });

    expect(response.json().results).toEqual([
      { listingId: 'listing-1', status: 'error', message: 'Anthropic API error 401: invalid x-api-key' },
      { listingId: 'listing-2', status: 'rated', verdict: 'good' },
    ]);
  });

  it('rejects an empty listingIds array', async () => {
    const response = await post({ listingIds: [] });
    expect(response.statusCode).toBe(400);
  });

  it('rejects more than the per-request cap', async () => {
    const response = await post({ listingIds: Array.from({ length: 26 }, (_, i) => `listing-${i}`) });
    expect(response.statusCode).toBe(400);
  });
});
