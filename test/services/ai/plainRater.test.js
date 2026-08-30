/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateListingWithOwnAi } from '../../../lib/services/ai/plainRater.js';

const LISTING = {
  title: 'Schöne Wohnung',
  description: 'Renoviert, Balkon, Fernwärme.',
  address: '48143 Münster',
  price: 200000,
  size: 60,
  rooms: 3,
  provider: 'immoscout',
  job_name: 'CORE · Münster',
  grossYieldPercent: 4.3,
  netYieldPercent: 3.1,
  image_url: null,
};

const ANTHROPIC_ADAPTER = { adapterId: 'anthropic', fields: { apiKey: 'sk-ant-test' } };
const OPENAI_ADAPTER = { adapterId: 'openai-compatible', fields: { apiKey: 'sk-oai-test' } };

const RATING = {
  verdict: 'maybe',
  reasoning: 'Net yield sits in the marginal band.',
  yieldNote: 'net: 3.1%, gross: 4.3%',
};

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rateListingWithOwnAi', () => {
  it('throws when the adapter has no API key configured', async () => {
    await expect(
      rateListingWithOwnAi({ listing: LISTING, adapter: { adapterId: 'anthropic', fields: {} } }),
    ).rejects.toThrow('No API key configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws for an unsupported adapter type', async () => {
    await expect(
      rateListingWithOwnAi({ listing: LISTING, adapter: { adapterId: 'made-up', fields: { apiKey: 'x' } } }),
    ).rejects.toThrow('Unsupported AI adapter');
  });

  describe('anthropic', () => {
    it('calls the Messages API with a forced tool call and returns its parsed input', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'tool_use', name: 'submit_rating', input: RATING }] }),
      });

      const result = await rateListingWithOwnAi({ listing: LISTING, adapter: ANTHROPIC_ADAPTER });

      expect(result).toEqual(RATING);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options.headers['x-api-key']).toBe('sk-ant-test');
      const body = JSON.parse(options.body);
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_rating' });
      expect(body.messages[0].content[0].text).toContain('Münster');
      // No image_url on the fixture listing, so no image content block should be sent.
      expect(body.messages[0].content).toHaveLength(1);
    });

    it('includes an image content block when the listing has a fetchable photo', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: (name) => (name === 'content-type' ? 'image/jpeg' : null) },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: [{ type: 'tool_use', name: 'submit_rating', input: RATING }] }),
        });

      await rateListingWithOwnAi({
        listing: { ...LISTING, image_url: 'https://example.com/photo.jpg' },
        adapter: ANTHROPIC_ADAPTER,
      });

      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.messages[0].content).toHaveLength(2);
      expect(body.messages[0].content[1]).toMatchObject({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg' },
      });
    });

    it('rates text-only when the photo fetch fails, rather than failing the whole rating', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(0),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: [{ type: 'tool_use', name: 'submit_rating', input: RATING }] }),
        });

      const result = await rateListingWithOwnAi({
        listing: { ...LISTING, image_url: 'https://example.com/broken.jpg' },
        adapter: ANTHROPIC_ADAPTER,
      });

      expect(result).toEqual(RATING);
      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.messages[0].content).toHaveLength(1);
    });

    it('throws with the provider error message on a non-200 response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'invalid x-api-key' } }),
      });

      await expect(rateListingWithOwnAi({ listing: LISTING, adapter: ANTHROPIC_ADAPTER })).rejects.toThrow(
        'invalid x-api-key',
      );
    });

    it('throws when the response has no submit_rating tool call', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'oops' }] }) });

      await expect(rateListingWithOwnAi({ listing: LISTING, adapter: ANTHROPIC_ADAPTER })).rejects.toThrow(
        'did not include a submit_rating tool call',
      );
    });

    it('throws when the provider returns a verdict outside good/maybe/bad', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', name: 'submit_rating', input: { ...RATING, verdict: 'excellent' } }],
        }),
      });

      await expect(rateListingWithOwnAi({ listing: LISTING, adapter: ANTHROPIC_ADAPTER })).rejects.toThrow(
        'invalid verdict',
      );
    });
  });

  describe('openai-compatible', () => {
    it('calls chat/completions with a forced function call, base URL defaulting to api.openai.com', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(RATING) } }] } }],
        }),
      });

      const result = await rateListingWithOwnAi({ listing: LISTING, adapter: OPENAI_ADAPTER });

      expect(result).toEqual(RATING);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.headers.authorization).toBe('Bearer sk-oai-test');
    });

    it('respects a custom base URL, trimming a trailing slash', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(RATING) } }] } }],
        }),
      });

      await rateListingWithOwnAi({
        listing: LISTING,
        adapter: { adapterId: 'openai-compatible', fields: { apiKey: 'x', baseUrl: 'https://my-proxy.example/v1/' } },
      });

      expect(fetchMock.mock.calls[0][0]).toBe('https://my-proxy.example/v1/chat/completions');
    });

    it('throws when the tool arguments are not valid JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: 'not json' } }] } }] }),
      });

      await expect(rateListingWithOwnAi({ listing: LISTING, adapter: OPENAI_ADAPTER })).rejects.toThrow(
        'not valid JSON',
      );
    });
  });
});
