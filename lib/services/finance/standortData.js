/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import logger from '../logger.js';

const STANDORT_DATA_PATH = process.env.STANDORT_DATA_PATH || '/conf/standort-data.json';

/**
 * @typedef {Object} StandortEntry
 * @property {number|null} kaufpreisPerSqm EUR/m², existing-flat purchase price.
 * @property {number|null} kaltmietePerSqm EUR/m², cold rent.
 * @property {number|null} bruttomietrenditePercent Gross yield, as immocation's own tool computes it.
 * @property {number|null} prognosRangGesamt Prognos Zukunftsatlas overall rank, 1 (best) to 400.
 * @property {number|null} prognosRangStaerke Zukunftsatlas "Stärke" (current economic strength) rank.
 * @property {number|null} prognosRangDynamik Zukunftsatlas "Dynamik" (growth/future trend) rank -
 *   the forward-looking half of the two; a strong Dynamik rank with a weaker Stärke rank flags a
 *   place still catching up but moving the right direction, which a snapshot yield number can't see.
 */

/** @type {{ cities: Record<string, StandortEntry> } | null} */
let cache = null;
let cacheMtimeMs = 0;

/**
 * Load and cache the location-data reference file, reloading whenever its mtime changes. Same
 * mtime-cache shape as rentYield.js's loadRentData - see that file for why (picks up manual
 * edits to /conf/standort-data.json without a container restart).
 *
 * This file has no automated source yet: immocation's Standort Tool (standort.immocation.de) has
 * no bulk export, so entries are added by hand, one city at a time, from its search table. An
 * empty or missing file is a normal, supported state - every lookup below just returns null, the
 * same "no data for this listing" outcome rentPerSqmFor has when a city isn't in rent-data.json.
 *
 * @returns {{ cities: Record<string, StandortEntry> }}
 */
function loadStandortData() {
  try {
    const stat = fs.statSync(STANDORT_DATA_PATH);
    if (cache && stat.mtimeMs === cacheMtimeMs) {
      return cache;
    }
    const raw = JSON.parse(fs.readFileSync(STANDORT_DATA_PATH, 'utf-8'));
    cache = {
      // Keys are lower-cased once here, same reasoning as rentYield.js's city map: lookups never
      // have to re-normalize per listing.
      cities: Object.fromEntries(Object.entries(raw.cities || {}).map(([city, entry]) => [city.toLowerCase(), entry])),
    };
    cacheMtimeMs = stat.mtimeMs;
    return cache;
  } catch (err) {
    logger.debug(`standortData: no usable data file at ${STANDORT_DATA_PATH} (${err.message})`);
    return { cities: {} };
  }
}

/**
 * Resolve a listing's Standort Tool entry by matching a known city name against its address and
 * title text - same substring-match approach as rentYield.js's rentPerSqmFor, so a listing that
 * already resolves a rent reference resolves this the same way, from the same two fields.
 *
 * @param {{ address?: string, title?: string }} listing
 * @returns {StandortEntry|null} The matched city's data, or null when no configured city name
 *   appears in either field (including when the reference file is empty or missing entirely).
 */
export function standortDataFor(listing) {
  const { cities } = loadStandortData();
  const haystack = `${listing.address || ''} ${listing.title || ''}`.toLowerCase();
  for (const [city, entry] of Object.entries(cities)) {
    if (haystack.includes(city)) {
      return entry;
    }
  }
  return null;
}
