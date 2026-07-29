/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getListingsForMap: vi.fn(() => []),
  getListingById: vi.fn(() => null),
  setListingNotes: vi.fn(() => 1),
  setListingStatus: vi.fn(() => 1),
  setListingAiVerdict: vi.fn(() => 1),
  deleteListingsByJobId: vi.fn(),
  deleteListingsById: vi.fn(),
  restoreListingsById: vi.fn(),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({
  toggleWatch: vi.fn(),
  ensureWatch: vi.fn(),
}));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: vi.fn(() => null) }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({})),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const isAdminMock = vi.fn(() => true);
vi.mock('../../lib/api/security.js', () => ({ isAdmin: (...args) => isAdminMock(...args) }));

import listingsPlugin from '../../lib/api/routes/listingsRouter.js';

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: 'user-1' };
  });
  await app.register(listingsPlugin);
  await app.ready();
  return app;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  isAdminMock.mockReturnValue(true);
  process.env.FREDY_RATER_URL = 'http://rater.internal:8090';
  process.env.FREDY_RATER_SECRET = 'test-secret';
  global.fetch = vi.fn();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('POST /rate', () => {
  it('rejects non-admin requests with 401', async () => {
    isAdminMock.mockReturnValue(false);
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/rate', payload: { listingIds: ['a'] } });

    expect(response.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty or missing listingIds array', async () => {
    const app = await buildApp();

    const empty = await app.inject({ method: 'POST', url: '/rate', payload: { listingIds: [] } });
    expect(empty.statusCode).toBe(400);

    const missing = await app.inject({ method: 'POST', url: '/rate', payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects more than 25 listing ids', async () => {
    const app = await buildApp();
    const listingIds = Array.from({ length: 26 }, (_, i) => `id-${i}`);
    const response = await app.inject({ method: 'POST', url: '/rate', payload: { listingIds } });

    expect(response.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards valid requests to the rater service with the shared secret, defaulting the model', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ status: 'started', count: 2 }),
    });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/rate',
      payload: { listingIds: ['a', 'b'] },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'started', count: 2 });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://rater.internal:8090/rate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
        body: JSON.stringify({ listingIds: ['a', 'b'], model: 'claude-sonnet-5' }),
      }),
    );
  });

  it('forwards an explicitly chosen model to the rater service', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ status: 'started', count: 1 }),
    });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/rate',
      payload: { listingIds: ['a'], model: 'claude-opus-5' },
    });

    expect(response.statusCode).toBe(202);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://rater.internal:8090/rate',
      expect.objectContaining({
        body: JSON.stringify({ listingIds: ['a'], model: 'claude-opus-5' }),
      }),
    );
  });

  it('rejects an unknown model', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/rate',
      payload: { listingIds: ['a'], model: 'gpt-4o' },
    });

    expect(response.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 503 when the rater service is not configured', async () => {
    delete process.env.FREDY_RATER_URL;
    delete process.env.FREDY_RATER_SECRET;
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/rate', payload: { listingIds: ['a'] } });

    expect(response.statusCode).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('propagates a 429 from the rater service (already busy)', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'a rating run is already in progress, try again shortly' }),
    });
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/rate', payload: { listingIds: ['a'] } });

    expect(response.statusCode).toBe(429);
  });

  it('returns 502 when the rater service is unreachable', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/rate', payload: { listingIds: ['a'] } });

    expect(response.statusCode).toBe(502);
  });
});
