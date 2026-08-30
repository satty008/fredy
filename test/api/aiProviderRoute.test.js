/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/configuredAdapterStorage.js', () => ({
  VISIBILITY: { PRIVATE: 'private', ADMIN: 'admin', EVERYONE: 'everyone' },
  getAllChannels: vi.fn(() => []),
  getChannel: vi.fn(() => null),
  upsertChannel: vi.fn(() => 'new-id'),
  removeChannel: vi.fn(),
}));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import * as adapterStorage from '../../lib/services/storage/configuredAdapterStorage.js';
import aiProviderPlugin from '../../lib/api/routes/aiProviderRouter.js';

async function buildApp(userId = 'user-1', isAdminUser = false) {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: userId };
    request.currentUser = { id: userId, isAdmin: isAdminUser };
  });
  await app.register(aiProviderPlugin);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  adapterStorage.getAllChannels.mockReturnValue([]);
  adapterStorage.getChannel.mockReturnValue(null);
  adapterStorage.upsertChannel.mockReturnValue('new-id');
});

describe('GET /types', () => {
  it('lists the known AI provider types with their field definitions', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/types' });

    expect(response.statusCode).toBe(200);
    const ids = response.json().map((t) => t.id);
    expect(ids).toEqual(['anthropic', 'openai-compatible']);
  });
});

describe('GET /', () => {
  it("returns only the caller's own AI-provider rows, not other users' or notification channels", async () => {
    adapterStorage.getAllChannels.mockReturnValue([
      { id: 'a1', userId: 'user-1', adapterId: 'anthropic', name: 'Mine', fields: {}, visibility: 'private' },
      { id: 'a2', userId: 'user-2', adapterId: 'anthropic', name: "Someone else's", fields: {}, visibility: 'private' },
      {
        id: 'a3',
        userId: 'user-1',
        adapterId: 'telegram',
        name: 'Not an AI provider',
        fields: {},
        visibility: 'private',
      },
    ]);
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((r) => r.id)).toEqual(['a1']);
  });
});

describe('GET /:id', () => {
  it('redacts the API key', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'a1',
      userId: 'user-1',
      adapterId: 'anthropic',
      name: 'Mine',
      fields: { apiKey: 'sk-ant-real-secret' },
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'GET', url: '/a1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().fields.apiKey).toBe('••••••••');
  });

  it('refuses a provider owned by another user', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'a1',
      userId: 'user-2',
      adapterId: 'anthropic',
      name: 'Not yours',
      fields: {},
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'GET', url: '/a1' });

    expect(response.statusCode).toBe(403);
  });

  it('404s for a non-AI-provider adapter id (e.g. a notification channel)', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'a1',
      userId: 'user-1',
      adapterId: 'telegram',
      name: 'Not an AI provider',
      fields: {},
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'GET', url: '/a1' });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /', () => {
  it('creates a new provider, always private regardless of what the body sends', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'new-id',
      userId: 'user-1',
      adapterId: 'anthropic',
      name: 'My key',
      fields: { apiKey: 'sk-ant-x' },
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { adapterId: 'anthropic', name: 'My key', fields: { apiKey: 'sk-ant-x' }, visibility: 'everyone' },
    });

    expect(response.statusCode).toBe(200);
    expect(adapterStorage.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'private', adapterId: 'anthropic' }),
    );
  });

  it('rejects an unknown adapter type', async () => {
    const app = await buildApp('user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { adapterId: 'made-up', name: 'X', fields: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a create with no API key', async () => {
    const app = await buildApp('user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { adapterId: 'anthropic', name: 'X', fields: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it('keeps the real stored key when the client echoes back the redaction placeholder', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'a1',
      userId: 'user-1',
      adapterId: 'anthropic',
      name: 'Mine',
      fields: { apiKey: 'sk-ant-real-secret' },
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    await app.inject({
      method: 'POST',
      url: '/',
      payload: { id: 'a1', name: 'Renamed', fields: { apiKey: '••••••••' } },
    });

    expect(adapterStorage.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({ fields: { apiKey: 'sk-ant-real-secret' } }),
    );
  });

  it('refuses editing a provider owned by another user', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'a1',
      userId: 'user-2',
      adapterId: 'anthropic',
      name: 'Not yours',
      fields: { apiKey: 'x' },
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'POST', url: '/', payload: { id: 'a1', name: 'Hijacked' } });

    expect(response.statusCode).toBe(403);
    expect(adapterStorage.upsertChannel).not.toHaveBeenCalled();
  });
});

describe('DELETE /:id', () => {
  it('deletes a provider the caller owns', async () => {
    adapterStorage.getChannel.mockReturnValue({
      id: 'a1',
      userId: 'user-1',
      adapterId: 'anthropic',
      name: 'Mine',
      fields: {},
      visibility: 'private',
    });
    const app = await buildApp('user-1');

    const response = await app.inject({ method: 'DELETE', url: '/a1' });

    expect(response.statusCode).toBe(200);
    expect(adapterStorage.removeChannel).toHaveBeenCalledWith('a1');
  });
});
