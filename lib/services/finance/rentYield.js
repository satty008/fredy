/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import logger from '../logger.js';

const RENT_DATA_PATH = process.env.RENT_DATA_PATH || '/conf/rent-data.json';

/** @type {{ defaultRentPerSqm: number|null, cities: Record<string, number> } | null} */
let cache = null;
let cacheMtimeMs = 0;

/**
 * Load and cache the rent-per-m² reference data, reloading whenever the file's mtime changes
 * so edits to `/conf/rent-data.json` take effect without a container restart.
 *
 * @returns {{ defaultRentPerSqm: number|null, cities: Record<string, number> }}
 */
function loadRentData() {
  try {
    const stat = fs.statSync(RENT_DATA_PATH);
    if (cache && stat.mtimeMs === cacheMtimeMs) {
      return cache;
    }
    const raw = JSON.parse(fs.readFileSync(RENT_DATA_PATH, 'utf-8'));
    cache = {
      defaultRentPerSqm: typeof raw.defaultRentPerSqm === 'number' ? raw.defaultRentPerSqm : null,
      // Keys are lower-cased once here so lookups never have to re-normalize per listing.
      cities: Object.fromEntries(Object.entries(raw.cities || {}).map(([city, rent]) => [city.toLowerCase(), rent])),
    };
    cacheMtimeMs = stat.mtimeMs;
    return cache;
  } catch (err) {
    logger.debug(`rentYield: no usable rent-data file at ${RENT_DATA_PATH} (${err.message})`);
    return { defaultRentPerSqm: null, cities: {} };
  }
}

/**
 * Resolve the cold rent per m²/month for a listing by matching known city names against its
 * address and title text. Falls back to the data file's `defaultRentPerSqm` when no configured
 * city name appears in either field.
 *
 * @param {{ address?: string, title?: string }} listing
 * @returns {number|null} Rent per m² per month, or null when no estimate is available at all.
 */
export function rentPerSqmFor(listing) {
  const { defaultRentPerSqm, cities } = loadRentData();
  const haystack = `${listing.address || ''} ${listing.title || ''}`.toLowerCase();
  for (const [city, rentPerSqm] of Object.entries(cities)) {
    if (haystack.includes(city)) {
      return rentPerSqm;
    }
  }
  return defaultRentPerSqm;
}

/**
 * Estimate a listing's gross rental yield: `(estimated annual cold rent / purchase price) * 100`.
 *
 * This is a rough screening metric, not an investment-grade calculation - it ignores vacancy,
 * non-allocable running costs, and purchase side-costs (Grunderwerbsteuer, Notar, Makler).
 * Use it to discard obviously-below-target listings early, not as the final word on a deal.
 *
 * @param {{ price?: number, size?: number, address?: string, title?: string }} listing
 * @returns {number|null} Gross yield as a percentage, or null when it cannot be computed
 *   (missing price/size, or no rent estimate found for the listing's location).
 */
export function grossYieldPercent(listing) {
  if (!listing.price || !listing.size) {
    return null;
  }
  const rentPerSqm = rentPerSqmFor(listing);
  if (rentPerSqm == null) {
    return null;
  }
  const annualRent = rentPerSqm * listing.size * 12;
  return (annualRent / listing.price) * 100;
}
