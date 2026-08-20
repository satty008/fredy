/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  userCanAccessListing: vi.fn(() => true),
  getListingById: vi.fn(() => ({ id: 'listing-1', job_id: 'job-1', cold_rent_override: null })),
  setColdRentOverride: vi.fn(() => 1),
  queryListings: vi.fn(),
  getListingsForMap: vi.fn(),
  getPriceHistory: vi.fn(),
  setListingNotes: vi.fn(),
  setListingStatus: vi.fn(),
  deleteListingsByJobId: vi.fn(),
  deleteListingsById: vi.fn(),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({ toggleWatch: vi.fn(), ensureWatch: vi.fn() }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({
  getJob: vi.fn(() => ({ id: 'job-1', userId: 'owner-1' })),
}));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({ demoMode: false })),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/geocoding/distanceService.js', () => ({ updateDistancesForListing: vi.fn() }));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));

import * as listingStorage from '../../lib/services/storage/listingsStorage.js';
import { isAdmin } from '../../lib/api/security.js';
import listingsPlugin from '../../lib/api/routes/listingsRouter.js';

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: 'user-1' };
    request.currentUser = { id: 'user-1' };
  });
  await app.register(listingsPlugin);
  await app.ready();
  return app;
}

const post = async (body) => {
  const app = await buildApp();
  return app.inject({ method: 'POST', url: '/listing-1/cold-rent-override', payload: body });
};

beforeEach(() => {
  vi.clearAllMocks();
  listingStorage.userCanAccessListing.mockReturnValue(true);
  listingStorage.getListingById.mockReturnValue({ id: 'listing-1', job_id: 'job-1', cold_rent_override: null });
  listingStorage.setColdRentOverride.mockReturnValue(1);
  isAdmin.mockReturnValue(false);
});

describe('POST /:listingId/cold-rent-override', () => {
  it('stores the override', async () => {
    const response = await post({ coldRent: 650 });

    expect(response.statusCode).toBe(200);
    expect(listingStorage.setColdRentOverride).toHaveBeenCalledWith('listing-1', 650);
  });

  it('clears the override when coldRent is null', async () => {
    const response = await post({ coldRent: null });

    expect(response.statusCode).toBe(200);
    expect(listingStorage.setColdRentOverride).toHaveBeenCalledWith('listing-1', null);
  });

  it('answers with the refreshed listing so the caller need not fetch it again', async () => {
    listingStorage.getListingById.mockReturnValue({
      id: 'listing-1',
      job_id: 'job-1',
      cold_rent_override: 650,
    });

    const response = await post({ coldRent: 650 });

    expect(response.json()).toMatchObject({ cold_rent_override: 650 });
  });

  describe('validation', () => {
    it('rejects a negative cold rent', async () => {
      const response = await post({ coldRent: -1 });

      expect(response.statusCode).toBe(400);
      expect(listingStorage.setColdRentOverride).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric cold rent', async () => {
      const response = await post({ coldRent: 'lots' });

      expect(response.statusCode).toBe(400);
      expect(listingStorage.setColdRentOverride).not.toHaveBeenCalled();
    });
  });

  describe('access', () => {
    it('refuses a listing the user cannot see', async () => {
      listingStorage.userCanAccessListing.mockReturnValue(false);

      const response = await post({ coldRent: 650 });

      expect(response.statusCode).toBe(403);
      expect(listingStorage.setColdRentOverride).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('reports a listing that disappeared as 404', async () => {
      listingStorage.setColdRentOverride.mockReturnValue(0);

      const response = await post({ coldRent: 650 });

      expect(response.statusCode).toBe(404);
    });

    it('turns a storage failure into a 500', async () => {
      listingStorage.setColdRentOverride.mockImplementation(() => {
        throw new Error('database on fire');
      });

      const response = await post({ coldRent: 650 });

      expect(response.statusCode).toBe(500);
    });
  });
});
