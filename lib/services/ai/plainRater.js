/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';
import { DEFAULT_RATING_INSTRUCTIONS } from './defaultRatingInstructions.js';

/** How long to wait for the provider's own response before giving up on one listing. */
const REQUEST_TIMEOUT_MS = 45_000;
/** How long to wait for the listing's photo before rating text-only instead. */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * The structured shape every provider is forced to answer in, via tool/function-calling rather
 * than free text - this is what makes a friend's own model choice safe to parse without a fragile
 * regex over prose. `yieldNote` mirrors the "(net: X.X%, gross: Y.Y%)" convention the older
 * agentic rater's notes already use, so a listing rated by either path reads the same way in the
 * UI.
 */
const RATING_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['good', 'maybe', 'bad'] },
    reasoning: { type: 'string', description: '1-3 sentences, specific to this listing.' },
    yieldNote: {
      type: 'string',
      description:
        'e.g. "net: 3.1%, gross: 4.4%", or "gross: 4.4%, net unavailable" when net yield was null, or "yield: unknown" when both were null.',
    },
  },
  required: ['verdict', 'reasoning', 'yieldNote'],
};

/**
 * @param {{title?: string, description?: string, address?: string, price?: number, size?: number,
 *   rooms?: number, provider?: string, job_name?: string, grossYieldPercent?: number,
 *   netYieldPercent?: number, build_year?: number, energy_class?: string}} listing
 * @returns {string}
 */
function formatListingForPrompt(listing) {
  const lines = [
    `Title: ${listing.title || '(none)'}`,
    `Description: ${listing.description || '(none)'}`,
    `Address: ${listing.address || '(unknown)'}`,
    `Price: ${listing.price != null ? `${listing.price} EUR` : '(unknown)'}`,
    `Size: ${listing.size != null ? `${listing.size} m²` : '(unknown)'}`,
    `Rooms: ${listing.rooms ?? '(unknown)'}`,
    `Build year: ${listing.build_year ?? '(unknown)'}`,
    `Energy class: ${listing.energy_class || '(unknown)'}`,
    `Provider: ${listing.provider || '(unknown)'}`,
    `City/job: ${listing.job_name || '(unknown)'}`,
    `grossYieldPercent: ${listing.grossYieldPercent ?? 'null'}`,
    `netYieldPercent: ${listing.netYieldPercent ?? 'null'}`,
  ];
  return lines.join('\n');
}

/**
 * Download a listing's preview photo and base64-encode it for a vision request. Best-effort: a
 * missing URL, a failed fetch, a timeout, or a non-image response all fall through to `null`
 * rather than failing the rating - the same "no visual signal, continue text-only" rule the
 * agentic rater's instructions already state explicitly.
 *
 * @param {string|null|undefined} imageUrl
 * @returns {Promise<{mediaType: string, base64: string}|null>}
 */
async function fetchImageForRating(imageUrl) {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const mediaType = response.headers.get('content-type') || 'image/jpeg';
    if (!mediaType.startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return null;
    return { mediaType: mediaType.split(';')[0].trim(), base64: buffer.toString('base64') };
  } catch (error) {
    logger.debug(`plainRater: photo fetch failed for ${imageUrl}: ${error.message}`);
    return null;
  }
}

/**
 * @param {{apiKey: string}} fields
 * @param {string|null} model
 * @param {string} prompt
 * @param {{mediaType: string, base64: string}|null} image
 * @returns {Promise<{verdict: string, reasoning: string, yieldNote: string}>}
 */
async function rateWithAnthropic(fields, model, prompt, image) {
  const content = [{ type: 'text', text: prompt }];
  if (image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': fields.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1024,
      tools: [
        { name: 'submit_rating', description: 'Submit the rating for this listing.', input_schema: RATING_TOOL_SCHEMA },
      ],
      tool_choice: { type: 'tool', name: 'submit_rating' },
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}: ${json?.error?.message || 'unknown error'}`);
  }
  const toolUse = json?.content?.find((block) => block.type === 'tool_use' && block.name === 'submit_rating');
  if (!toolUse?.input) {
    throw new Error('Anthropic response did not include a submit_rating tool call');
  }
  return toolUse.input;
}

/**
 * @param {{apiKey: string, baseUrl?: string}} fields
 * @param {string|null} model
 * @param {string} prompt
 * @param {{mediaType: string, base64: string}|null} image
 * @returns {Promise<{verdict: string, reasoning: string, yieldNote: string}>}
 */
async function rateWithOpenAiCompatible(fields, model, prompt, image) {
  const content = [{ type: 'text', text: prompt }];
  if (image) {
    content.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
  }

  const baseUrl = (fields.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${fields.apiKey}` },
    body: JSON.stringify({
      model: model || DEFAULT_OPENAI_MODEL,
      tools: [
        {
          type: 'function',
          function: {
            name: 'submit_rating',
            description: 'Submit the rating for this listing.',
            parameters: RATING_TOOL_SCHEMA,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'submit_rating' } },
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI-compatible API error ${response.status}: ${json?.error?.message || 'unknown error'}`);
  }
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) {
    throw new Error('OpenAI-compatible response did not include a submit_rating tool call');
  }
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    throw new Error('OpenAI-compatible response tool arguments were not valid JSON');
  }
}

/**
 * Rate one listing with a user's own configured AI provider - a single, non-agentic request (no
 * shell, no filesystem, no tool use beyond the provider's own structured-output mechanism), safe
 * to run for any number of users on shared infrastructure since each call only ever touches that
 * user's own key and that one listing's data.
 *
 * @param {Object} params
 * @param {Object} params.listing - The listing row (title, description, address, price, size,
 *   rooms, provider, job_name, grossYieldPercent, netYieldPercent, image_url).
 * @param {{adapterId: string, fields: Record<string, any>}} params.adapter - The user's
 *   configured_adapter row for 'anthropic' or 'openai-compatible'.
 * @param {string|null} [params.model] - Overrides the provider's built-in default.
 * @param {string|null} [params.instructions] - Overrides `DEFAULT_RATING_INSTRUCTIONS`.
 * @returns {Promise<{verdict: 'good'|'maybe'|'bad', reasoning: string, yieldNote: string}>}
 * @throws {Error} On an unsupported adapter, a missing API key, or a failed/malformed provider
 *   response - the caller decides how to surface that to the user.
 */
export async function rateListingWithOwnAi({ listing, adapter, model = null, instructions = null }) {
  if (!adapter?.fields?.apiKey) {
    throw new Error('No API key configured for this AI provider.');
  }
  const prompt = `${instructions || DEFAULT_RATING_INSTRUCTIONS}\n\n## Listing\n\n${formatListingForPrompt(listing)}`;
  const image = await fetchImageForRating(listing.image_url);

  let result;
  if (adapter.adapterId === 'anthropic') {
    result = await rateWithAnthropic(adapter.fields, model, prompt, image);
  } else if (adapter.adapterId === 'openai-compatible') {
    result = await rateWithOpenAiCompatible(adapter.fields, model, prompt, image);
  } else {
    throw new Error(`Unsupported AI adapter: ${adapter.adapterId}`);
  }

  if (!['good', 'maybe', 'bad'].includes(result.verdict)) {
    throw new Error(`Provider returned an invalid verdict: ${result.verdict}`);
  }
  return result;
}
