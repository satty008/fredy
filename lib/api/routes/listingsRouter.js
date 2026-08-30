/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as listingStorage from '../../services/storage/listingsStorage.js';
import * as watchListStorage from '../../services/storage/watchListStorage.js';
import { isAdmin as isAdminFn } from '../security.js';
import logger from '../../services/logger.js';
import { nullOrEmpty } from '../../utils.js';
import { getJob } from '../../services/storage/jobStorage.js';
import { getSettings, getUserSettings } from '../../services/storage/settingsStorage.js';
import { trackPoi } from '../../services/tracking/Tracker.js';
import { TRACKING_POIS } from '../../TRACKING_POIS.js';
import { affordabilityBandFor } from '../../services/finance/listingFilter.js';
import { thresholdsFor, verdictForListing } from '../../services/finance/affordability.js';
import { canAccessJob } from '../../services/security/access.js';
import { targetRentFor, bundeslandCodeFor } from '../../services/finance/rentYield.js';
import { standortDataFor } from '../../services/finance/standortData.js';
import { updateDistancesForListing } from '../../services/geocoding/distanceService.js';
import { geocodeAddress, isGeocodingPaused } from '../../services/geocoding/geoCodingService.js';
import { getCountriesForProvider } from '../../services/providers/providerCountries.js';
import * as ratingSettingsStorage from '../../services/storage/userRatingSettingsStorage.js';
import * as adapterStorage from '../../services/storage/configuredAdapterStorage.js';
import { canEditChannel } from '../../services/security/channelAccess.js';
import { rateListingWithOwnAi } from '../../services/ai/plainRater.js';
import { filterMask, TECHNOLOGIES, OPERATOR_CODES } from '../../services/connectivity/mobileBits.js';

/**
 * Deliberately identical for "listing does not exist" and "listing belongs to someone else", so the
 * response cannot be used to probe which ids are real.
 */
const NO_ACCESS_MESSAGE = 'You are trying to access a listing that is not associated to your user';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function listingsPlugin(fastify) {
  fastify.get('/table', async (request) => {
    const {
      page,
      pageSize = 50,
      activityFilter,
      jobNameFilter,
      providerFilter,
      watchListFilter,
      statusFilter,
      aiVerdictFilter,
      icVerdictFilter,
      priceFactorFilter,
      hiddenOnly,
      sortfield = null,
      sortdir = 'asc',
      freeTextFilter,
      affordabilityFilter,
      travelTimeMode,
      travelTimeMaxMinutes,
      travelTimeLabel,
      connectivityMinDown,
      connectivityFiber,
      connectivityMobileTech,
      connectivityMobileOperator,
    } = request.query || {};

    const toBool = (v) => {
      if (v === true || v === 'true' || v === 1 || v === '1') return true;
      if (v === false || v === 'false' || v === 0 || v === '0') return false;
      return null;
    };
    const normalizedActivity = toBool(activityFilter);
    const normalizedWatch = toBool(watchListFilter);
    const normalizedHidden = toBool(hiddenOnly) === true;
    const allowedStatuses = ['applied', 'rejected', 'accepted', 'none'];
    const normalizedStatus =
      typeof statusFilter === 'string' && allowedStatuses.includes(statusFilter.toLowerCase())
        ? statusFilter.toLowerCase()
        : undefined;
    const allowedAiVerdicts = ['good', 'maybe', 'bad', 'none'];
    // Both verdict filters travel as a comma-separated list (the UI is multi-select), even when
    // only one value is picked. Unrecognized entries are dropped rather than rejected, and an
    // empty result reads as "filter not set" - the same meaning `undefined` carried for the
    // single-value form this replaces.
    const normalizeVerdictList = (raw) => {
      if (nullOrEmpty(raw)) return undefined;
      const list = [
        ...new Set(
          String(raw)
            .split(',')
            .map((v) => v.trim().toLowerCase())
            .filter((v) => allowedAiVerdicts.includes(v)),
        ),
      ];
      return list.length > 0 ? list : undefined;
    };
    const normalizedAiVerdict = normalizeVerdictList(aiVerdictFilter);
    // Same allowlist as the AI verdict above; 'none' here means immocockpitVerdictFor couldn't
    // compute one (not a 'buy' job, or no rent estimate/Bundesland for the listing's city).
    const normalizedIcVerdict = normalizeVerdictList(icVerdictFilter);
    // Same shape again, keyed to the Kaufpreisfaktor's own good/maybe/bad banding
    // (immocockpitAnalysis.priceFactorTier) rather than the overall IC verdict - a listing can
    // fail one without failing the other.
    const normalizedPriceFactor = normalizeVerdictList(priceFactorFilter);

    // jobNameFilter carries job ids despite its name (a leftover from before the job filter went
    // multi-select), as a comma-separated list. Each id is resolved through getJob so an invalid
    // or deleted one is silently dropped rather than breaking the whole filter.
    let jobIdFilter = null;
    if (!nullOrEmpty(jobNameFilter)) {
      const ids = [
        ...new Set(
          String(jobNameFilter)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
      const resolvedIds = ids.map((id) => getJob(id)?.id).filter(Boolean);
      jobIdFilter = resolvedIds.length > 0 ? resolvedIds : null;
    }

    // providerFilter: one or several provider names, comma-separated (the UI is multi-select).
    // Unlike jobNameFilter there is nothing to resolve against a table - a provider is just its
    // own name - so this only splits, trims and dedupes.
    const normalizedProvider = nullOrEmpty(providerFilter)
      ? undefined
      : [
          ...new Set(
            String(providerFilter)
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ];

    // Affordability is derived server-side from the user's stored profile, never from the
    // request, so a hand-edited or bookmarked URL cannot inject its own price bounds. An
    // incomplete profile yields no band at all, which means the filter is ignored rather than
    // returning an empty page.
    //
    // This is the hottest endpoint in the app, so the settings row is read exactly once per
    // request and serves both the filter's band and the per-row verdicts below.
    // The mode and the ceiling come from the request, but only ever as a name and a number: the
    // whitelist that turns a mode into a column lives in the query itself, so nothing from here
    // reaches the SQL.
    const parsedMaxMinutes = Number.parseInt(String(travelTimeMaxMinutes), 10);
    const travelTimeFilter =
      ['transit', 'car', 'bike', 'walk'].includes(String(travelTimeMode).toLowerCase()) &&
      Number.isFinite(parsedMaxMinutes) &&
      parsedMaxMinutes > 0
        ? {
            mode: String(travelTimeMode).toLowerCase(),
            maxMinutes: parsedMaxMinutes,
            label: nullOrEmpty(travelTimeLabel) ? null : String(travelTimeLabel),
          }
        : null;

    // The connectivity filters. The downstream is a plain number and the fibre flag a boolean, but
    // the mobile pair is turned into a bitmask here rather than being passed through: which bit a
    // technology and operator map to is a decision for the code that wrote them, and a mask taken
    // from the query string would let a bookmarked URL ask about bits that mean something else.
    const parsedMinDown = Number.parseInt(String(connectivityMinDown), 10);
    const normalizedMinDown = Number.isFinite(parsedMinDown) && parsedMinDown > 0 ? parsedMinDown : null;
    const normalizedFiber = toBool(connectivityFiber) === true;
    const wantedTech = String(connectivityMobileTech ?? '').toLowerCase();
    const wantedOperator = String(connectivityMobileOperator ?? '').toLowerCase();
    const connectivityMobileMask = TECHNOLOGIES.includes(wantedTech)
      ? filterMask(wantedTech, OPERATOR_CODES.includes(wantedOperator) ? wantedOperator : null)
      : null;

    const userId = request.session.currentUser;
    const financeProfile = getUserSettings(userId)?.finance_profile ?? null;
    const affordabilityBand = nullOrEmpty(affordabilityFilter)
      ? null
      : affordabilityBandFor(affordabilityFilter, financeProfile);

    // Each row carries its own affordability verdict, computed here against that same profile.
    // The UI used to derive it in the browser from a copy of the finance modules; it now only
    // renders what the server decided, so the chip on a row and the filter that returned it can
    // never disagree. Without a profile there are no thresholds and every verdict is null, which
    // is what hides the chips.
    const thresholds = financeProfile == null ? null : thresholdsFor(financeProfile);
    const withVerdict = (page) => ({
      ...page,
      result: page.result.map((listing) => ({
        ...listing,
        // immocockpitVerdict/immocockpitAnalysis already ride in on the row itself - computed at
        // read time in listingsStorage.parseListingStatus, the same place grossYieldPercent is,
        // so immocockpitVerdictFilter above can score and paginate on exactly what this endpoint
        // then renders. affordabilityVerdict depends on the request's finance profile, which
        // isn't a stored column, so it's still layered on here rather than in storage.
        affordabilityVerdict:
          thresholds == null ? null : verdictForListing(listing.price, listing.dealType, thresholds),
        // Location context (Prognos Zukunftsatlas rank, area price/rent level) from immocation's
        // Standort Tool, when the listing's city has an entry - see standortData.js. Attached
        // here too so the AI rater can read it straight off the /table response it already
        // fetches, without a per-listing detail call.
        standortData: standortDataFor(listing),
      })),
    });

    const pageData = listingStorage.queryListings({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      freeTextFilter: freeTextFilter || null,
      activityFilter: normalizedActivity,
      jobIdFilter: jobIdFilter,
      providerFilter: normalizedProvider,
      watchListFilter: normalizedWatch,
      statusFilter: normalizedStatus,
      aiVerdictFilter: normalizedAiVerdict,
      immocockpitVerdictFilter: normalizedIcVerdict,
      priceFactorFilter: normalizedPriceFactor,
      hiddenOnly: normalizedHidden,
      sortField: sortfield || null,
      sortDir: sortdir === 'desc' ? 'desc' : 'asc',
      affordabilityBand,
      travelTimeFilter,
      connectivityMinDown: normalizedMinDown,
      connectivityFiberOnly: normalizedFiber,
      connectivityMobileMask,
      userId,
      isAdmin: isAdminFn(request),
    });

    const availableProviders =
      typeof listingStorage.getAvailableProviders === 'function'
        ? listingStorage.getAvailableProviders({
            jobId: jobIdFilter,
            userId,
            isAdmin: isAdminFn(request),
            hiddenOnly: normalizedHidden,
          })
        : [];

    return withVerdict({
      ...pageData,
      availableProviders,
    });
  });

  fastify.get('/map', async (request) => {
    const { jobId } = request.query || {};
    return listingStorage.getListingsForMap({
      jobId: nullOrEmpty(jobId) ? null : jobId,
      userId: request.session.currentUser,
      isAdmin: isAdminFn(request),
    });
  });

  fastify.get('/:listingId', async (request, reply) => {
    const { listingId } = request.params;
    const userId = request.session.currentUser;
    const listing = listingStorage.getListingById(listingId, userId, isAdminFn(request));
    if (!listing) {
      return reply.code(404).send({ message: 'Listing not found' });
    }
    // Same server-side verdict the overview rows carry, so the detail page agrees with the row
    // the user clicked without deriving anything itself.
    const thresholds = thresholdsFor(getUserSettings(userId)?.finance_profile ?? null);
    return {
      ...listing,
      // immocockpitVerdict/immocockpitAnalysis already ride in on the row - see the /table
      // handler's comment above.
      affordabilityVerdict: verdictForListing(listing.price, listing.dealType, thresholds),
      // Location context (Prognos Zukunftsatlas rank, area price/rent level) from immocation's
      // Standort Tool, when the listing's city has an entry - see standortData.js.
      standortData: standortDataFor(listing),
      // The estimated achievable rent and the listing's Bundesland code, in the shape an
      // external rental-return calculator (immocockpit) expects for its deep-link handoff -
      // see ListingDetail.jsx's "Analyze in Immocockpit" button.
      targetRent: targetRentFor(listing),
      bundeslandCode: bundeslandCodeFor(listing),
    };
  });

  fastify.get('/:listingId/priceHistory', async (request, reply) => {
    const { listingId } = request.params;
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }
    // Same access gate as every other per-listing route: a listing id is guessable, and the price
    // history of somebody else's search is still somebody else's data.
    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }
    return listingStorage.getPriceHistory(listingId);
  });

  fastify.post('/watch', async (request, reply) => {
    try {
      const { listingId } = request.body || {};
      const userId = request.session?.currentUser;
      if (!listingId || !userId) {
        return reply.code(400).send({ message: 'listingId or user not provided' });
      }
      if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
        return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
      }
      watchListStorage.toggleWatch(listingId, userId);
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to toggle watch' });
    }
    return reply.send();
  });

  fastify.post('/:listingId/notes', async (request, reply) => {
    const { listingId } = request.params || {};
    const { notes } = request.body || {};
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }
    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }
    try {
      const changes = listingStorage.setListingNotes(listingId, typeof notes === 'string' ? notes : null);
      if (changes === 0) {
        return reply.code(404).send({ message: 'Listing not found' });
      }
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to update listing notes' });
    }

    await trackPoi(TRACKING_POIS.NOTES_CREATE);
    return reply.send();
  });

  /*
   * Overwrite the address a portal reported with one the user picked, coordinates included.
   *
   * The coordinates are required rather than geocoded here: the caller has already resolved them,
   * either through the address search or by dropping a pin, and doing it again would mean a second
   * Nominatim call and a second chance to disagree with what the user was shown.
   */
  fastify.post('/:listingId/address', async (request, reply) => {
    const { listingId } = request.params || {};
    const { address, latitude, longitude } = request.body || {};
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }

    const trimmed = typeof address === 'string' ? address.trim() : '';
    if (trimmed.length === 0 || trimmed.length > 512) {
      return reply.code(400).send({ message: 'A valid address is required' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    // -1/-1 is the geocoder's "looked, found nothing" marker. It must never be stored as a
    // position, or the listing would claim to sit off the coast of Africa.
    const coordsInvalid =
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      (lat === -1 && lng === -1);
    if (coordsInvalid) {
      return reply.code(400).send({ message: 'Valid coordinates are required' });
    }

    const settings = await getSettings();
    if (settings.demoMode && !isAdminFn(request)) {
      return reply.code(403).send({ error: 'Sorry, but you cannot change addresses in demo mode ;)' });
    }

    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }

    try {
      const listing = listingStorage.getListingById(listingId, userId, isAdminFn(request));
      if (!listing) {
        return reply.code(404).send({ message: 'Listing not found' });
      }

      const changes = listingStorage.setListingAddress(listingId, trimmed, lat, lng);
      if (changes === 0) {
        return reply.code(404).send({ message: 'Listing not found' });
      }

      // Distances are measured against the reference addresses of whoever owns the job, which is
      // not necessarily whoever is looking at the listing - jobs can be shared.
      const ownerUserId = getJob(listing.job_id)?.userId;
      if (ownerUserId) {
        updateDistancesForListing(listingId, lat, lng, ownerUserId);
      }

      await trackPoi(TRACKING_POIS.LISTING_ADDRESS_MANUAL);
      // The refreshed listing goes back with the response so the detail view can redraw without a
      // second round trip.
      return reply.send(listingStorage.getListingById(listingId, userId, isAdminFn(request)));
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to update listing address' });
    }
  });

  /*
   * Look up one listing's coordinates again, now.
   *
   * Geocoding at scrape time is best effort: a timeout or a rate limit leaves the listing with no
   * coordinates, and until now the only thing that would try again was the six-hourly sweep. People
   * found their own way round that by opening Settings and pressing Save, which happens to kick the
   * sweep off (issue #418). This is that, made deliberate and narrowed to the one listing being
   * looked at.
   *
   * Answers with a state rather than an error, because "we could not reach the geocoder" and "there
   * is no such place" need opposite things from the user: wait, or fix the address by hand.
   */
  fastify.post('/:listingId/geocode', async (request, reply) => {
    const { listingId } = request.params || {};
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }

    const settings = await getSettings();
    if (settings.demoMode && !isAdminFn(request)) {
      return reply.code(403).send({ error: 'Sorry, but you cannot change addresses in demo mode ;)' });
    }

    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }

    try {
      const listing = listingStorage.getListingById(listingId, userId, isAdminFn(request));
      if (!listing) {
        return reply.code(404).send({ message: 'Listing not found' });
      }
      if (nullOrEmpty(listing.address)) {
        return reply.send({ status: 'noAddress' });
      }
      // Nothing to retry: the user placed this one themselves, and re-deriving it from the portal's
      // address text would quietly move their pin.
      if (listing.address_is_manual) {
        return reply.send({ status: 'manual' });
      }
      // Asked before the request rather than inferred from a null afterwards, so a stood-off
      // geocoder cannot be reported to the user as an address that does not exist.
      if (isGeocodingPaused()) {
        return reply.send({ status: 'unavailable' });
      }

      const coords = await geocodeAddress(listing.address, await getCountriesForProvider(listing.provider));
      if (coords == null) {
        return reply.send({ status: 'unavailable' });
      }
      if (coords.lat === -1 || coords.lng === -1) {
        return reply.send({ status: 'notFound' });
      }

      listingStorage.updateListingGeocoordinates(listingId, coords.lat, coords.lng);
      const ownerUserId = getJob(listing.job_id)?.userId;
      if (ownerUserId) {
        updateDistancesForListing(listingId, coords.lat, coords.lng, ownerUserId);
      }

      // The refreshed listing rides back with the answer so the detail view can draw the map without
      // a second round trip, the same way the manual address endpoint above does.
      return reply.send({
        status: 'found',
        listing: listingStorage.getListingById(listingId, userId, isAdminFn(request)),
      });
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to look up the coordinates of this listing' });
    }
  });

  fastify.post('/:listingId/status', async (request, reply) => {
    const { listingId } = request.params || {};
    const { status } = request.body || {};
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }
    const allowed = ['applied', 'rejected', 'accepted'];
    const normalized = status == null ? null : String(status).toLowerCase();
    if (normalized != null && !allowed.includes(normalized)) {
      return reply.code(400).send({ message: `Invalid status: ${status}` });
    }
    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }
    try {
      const changes = listingStorage.setListingStatus(listingId, normalized);
      await trackPoi(TRACKING_POIS.USING_LISTING_STATUS);
      if (changes === 0) {
        return reply.code(404).send({ message: 'Listing not found' });
      }
      if (normalized != null) {
        watchListStorage.ensureWatch(listingId, userId);
      }
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to update listing status' });
    }
    return reply.send();
  });

  fastify.post('/:listingId/ai-verdict', async (request, reply) => {
    const { listingId } = request.params || {};
    const { verdict } = request.body || {};
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }
    const allowed = ['good', 'maybe', 'bad'];
    const normalized = verdict == null ? null : String(verdict).toLowerCase();
    if (normalized != null && !allowed.includes(normalized)) {
      return reply.code(400).send({ message: `Invalid AI verdict: ${verdict}` });
    }
    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }
    try {
      const changes = listingStorage.setListingAiVerdict(listingId, normalized);
      if (changes === 0) {
        return reply.code(404).send({ message: 'Listing not found' });
      }
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to update AI verdict' });
    }
    return reply.send();
  });

  /*
   * Overrule rent-data.json's rent-per-m² lookup for one listing with a monthly EUR figure the
   * user typed in themselves.
   *
   * Exists because the lookup matches city/district names against scraped address and title text,
   * and two portals can describe the same real flat with address strings that hit two different
   * cities - the yield and IC verdict then disagree about the same listing, and nothing about
   * rent-data.json itself is wrong in that case. `coldRent: null` clears the override.
   */
  fastify.post('/:listingId/cold-rent-override', async (request, reply) => {
    const { listingId } = request.params || {};
    const { coldRent } = request.body || {};
    const userId = request.session?.currentUser;
    if (!listingId || !userId) {
      return reply.code(400).send({ message: 'listingId or user not provided' });
    }

    let normalized = null;
    if (coldRent != null) {
      normalized = Number(coldRent);
      if (!Number.isFinite(normalized) || normalized < 0) {
        return reply.code(400).send({ message: 'coldRent must be a non-negative number, or null to clear it' });
      }
    }

    if (!listingStorage.userCanAccessListing(listingId, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }

    try {
      const changes = listingStorage.setColdRentOverride(listingId, normalized);
      if (changes === 0) {
        return reply.code(404).send({ message: 'Listing not found' });
      }
      // The refreshed listing goes back so the detail view's yield/IC verdict badges can redraw
      // without a second round trip, the same way the manual address endpoint does.
      return reply.send(listingStorage.getListingById(listingId, userId, isAdminFn(request)));
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ message: 'Failed to update cold rent override' });
    }
  });

  const MAX_LISTINGS_PER_RATE_REQUEST = 25;
  // Kept in sync by hand with the allowlist in the fredy-rater webhook.js, which lives outside
  // this repo (a separate host, the only one holding the Claude Code OAuth token).
  const ALLOWED_RATING_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'];
  const DEFAULT_RATING_MODEL = 'claude-sonnet-5';

  fastify.post('/rate', async (request, reply) => {
    if (!isAdminFn(request)) {
      return reply.code(401).send();
    }
    const { listingIds, model } = request.body || {};
    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      return reply.code(400).send({ message: 'listingIds must be a non-empty array' });
    }
    if (listingIds.length > MAX_LISTINGS_PER_RATE_REQUEST) {
      return reply.code(400).send({ message: `At most ${MAX_LISTINGS_PER_RATE_REQUEST} listings per request` });
    }
    if (model != null && !ALLOWED_RATING_MODELS.includes(model)) {
      return reply.code(400).send({ message: `Invalid model: ${model}` });
    }
    const normalizedModel = model ?? DEFAULT_RATING_MODEL;

    const raterUrl = process.env.FREDY_RATER_URL;
    const raterSecret = process.env.FREDY_RATER_SECRET;
    if (!raterUrl || !raterSecret) {
      logger.error('AI rating triggered but FREDY_RATER_URL/FREDY_RATER_SECRET are not configured');
      return reply.code(503).send({ message: 'AI rating service is not configured' });
    }

    try {
      const response = await fetch(`${raterUrl}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${raterSecret}` },
        body: JSON.stringify({ listingIds, model: normalizedModel }),
        signal: AbortSignal.timeout(5000),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        logger.error(`AI rating trigger failed: ${response.status} ${JSON.stringify(json)}`);
        return reply.code(response.status === 429 ? 429 : 502).send(json);
      }
      return reply.code(202).send(json);
    } catch (error) {
      logger.error(error);
      return reply.code(502).send({ message: 'Failed to reach the AI rating service' });
    }
  });

  /*
   * The friend-facing rating path: any authenticated user with their own AI provider configured
   * (Settings -> Rate with my AI) can trigger this, not just an admin - unlike '/rate' above,
   * which stays admin-only and untouched, this never spawns anything agentic and never touches
   * the shared Claude Code OAuth token, so there is no shared blast radius to gate behind admin.
   * Runs synchronously (one HTTP call per listing to the user's own provider) rather than
   * dispatching to a background job, since there is no separate worker for this path to hand off
   * to - MAX_LISTINGS_PER_RATE_REQUEST keeps a single request bounded either way.
   */
  fastify.post('/rate-with-own-ai', async (request, reply) => {
    const userId = request.session.currentUser;
    const { listingIds } = request.body || {};
    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      return reply.code(400).send({ message: 'listingIds must be a non-empty array' });
    }
    if (listingIds.length > MAX_LISTINGS_PER_RATE_REQUEST) {
      return reply.code(400).send({ message: `At most ${MAX_LISTINGS_PER_RATE_REQUEST} listings per request` });
    }

    const settings = ratingSettingsStorage.getUserRatingSettings(userId);
    if (!settings?.aiAdapterId) {
      return reply.code(400).send({ message: 'No AI provider configured. Set one up in Settings first.' });
    }
    const adapterRow = adapterStorage.getChannel(settings.aiAdapterId);
    if (!adapterRow || !canEditChannel(request.currentUser, adapterRow)) {
      return reply.code(400).send({ message: 'The configured AI provider is no longer available.' });
    }
    const adapter = { adapterId: adapterRow.adapterId, fields: adapterRow.fields };

    const results = [];
    for (const listingId of listingIds) {
      const listing = listingStorage.getListingById(listingId, userId, isAdminFn(request));
      if (!listing) {
        results.push({ listingId, status: 'not_found' });
        continue;
      }
      try {
        const rating = await rateListingWithOwnAi({
          listing,
          adapter,
          model: settings.model,
          instructions: settings.instructions,
        });
        listingStorage.setListingAiVerdict(listingId, rating.verdict);
        listingStorage.setListingNotes(
          listingId,
          `[AI review] ${rating.verdict.toUpperCase()} (${rating.yieldNote}) — ${rating.reasoning}`,
        );
        results.push({ listingId, status: 'rated', verdict: rating.verdict });
      } catch (error) {
        logger.error(`rate-with-own-ai failed for listing ${listingId}: ${error.message}`);
        results.push({ listingId, status: 'error', message: error.message });
      }
    }
    return reply.send({ results });
  });

  fastify.delete('/job', async (request, reply) => {
    const { jobId, hardDelete = false } = request.body;
    const settings = await getSettings();
    try {
      if (settings.demoMode && !isAdminFn(request)) {
        return reply.code(403).send({ error: 'Sorry, but you cannot remove listings in demo mode ;)' });
      }
      const job = getJob(jobId);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }
      if (!canAccessJob(request.currentUser, job)) {
        return reply
          .code(403)
          .send({ error: 'You are trying to remove listings for a job that is not associated to your user' });
      }
      listingStorage.deleteListingsByJobId(jobId, hardDelete);
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ error: error.message });
    }
    return reply.send();
  });

  fastify.delete('/', async (request, reply) => {
    const { ids, hardDelete = false } = request.body;
    const settings = await getSettings();
    try {
      if (settings.demoMode && !isAdminFn(request)) {
        return reply.code(403).send({ error: 'Sorry, but you cannot remove listings in demo mode ;)' });
      }
      if (Array.isArray(ids) && ids.length > 0) {
        const allowed = listingStorage.filterListingIdsForUser(ids, request.session.currentUser, isAdminFn(request));
        // All-or-nothing: a request that names even one foreign listing is rejected outright rather
        // than silently deleting the part the user happened to own. hardDelete is irreversible, so a
        // partial success would be impossible to reason about afterwards.
        if (allowed.length !== new Set(ids).size) {
          return reply.code(403).send({ error: NO_ACCESS_MESSAGE });
        }
        listingStorage.deleteListingsById(allowed, hardDelete);
      }
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ error: error.message });
    }
    return reply.send();
  });

  fastify.post('/restore', async (request, reply) => {
    const { ids } = request.body || {};
    const settings = await getSettings();
    try {
      if (settings.demoMode && !isAdminFn(request)) {
        return reply.code(403).send({ error: 'Sorry, but you cannot restore listings in demo mode ;)' });
      }
      if (Array.isArray(ids) && ids.length > 0) {
        const allowed = listingStorage.filterListingIdsForUser(ids, request.session.currentUser, isAdminFn(request));
        if (allowed.length !== new Set(ids).size) {
          return reply.code(403).send({ error: NO_ACCESS_MESSAGE });
        }
        listingStorage.restoreListingsById(allowed);
      }
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ error: error.message });
    }
    return reply.send();
  });

  /**
   * Mark listings as available again after the alive-checker got them wrong.
   *
   * Takes the user at their word rather than probing: they are looking at the open ad, which is
   * more than the probe ever knew. See {@link listingStorage.reactivateListings} for what that
   * costs - the row is excluded from every future active check.
   *
   * Same shape and guards as `/restore` above, which solves the neighbouring problem of a listing
   * the user hid by hand.
   */
  fastify.post('/reactivate', async (request, reply) => {
    const { ids } = request.body || {};
    const settings = await getSettings();
    try {
      if (settings.demoMode && !isAdminFn(request)) {
        return reply.code(403).send({ error: 'Sorry, but you cannot reactivate listings in demo mode ;)' });
      }
      if (Array.isArray(ids) && ids.length > 0) {
        const allowed = listingStorage.filterListingIdsForUser(ids, request.session.currentUser, isAdminFn(request));
        if (allowed.length !== new Set(ids).size) {
          return reply.code(403).send({ error: NO_ACCESS_MESSAGE });
        }
        listingStorage.reactivateListings(allowed);
      }
    } catch (error) {
      logger.error(error);
      return reply.code(500).send({ error: error.message });
    }
    return reply.send();
  });
}
