/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The known AI-provider adapter types a user can configure for their own "rate with my AI"
 * rating, stored as `configured_adapter` rows the same way a notification channel is - same
 * table, same per-user ownership, same field-redaction need for the API key - but deliberately
 * not one of the plugin modules under `lib/notification/adapter/`: those are auto-discovered for
 * *notification* purposes (job creation's channel picker, etc.), and an AI provider showing up
 * there would be nonsensical. This is a small, static, hand-written list instead - two entries
 * don't need a plugin-directory system.
 *
 * @typedef {Object} AiProviderAdapter
 * @property {string} id
 * @property {string} name
 * @property {{key: string, label: string, secret: boolean, required: boolean}[]} fields
 */

/** @type {AiProviderAdapter[]} */
export const AI_PROVIDER_ADAPTERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      {
        key: 'baseUrl',
        label: 'Base URL (optional - defaults to api.openai.com)',
        secret: false,
        required: false,
      },
    ],
  },
];

/**
 * @param {string} id
 * @returns {AiProviderAdapter|null}
 */
export const aiProviderAdapterOf = (id) => AI_PROVIDER_ADAPTERS.find((adapter) => adapter.id === id) ?? null;

/**
 * Replace every secret field's value with a fixed placeholder, the same "never send a stored key
 * back to the browser" rule the notification channels use - the settings page shows that a key is
 * set, not what it is.
 *
 * @param {string} adapterId
 * @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
export const redactAiProviderFields = (adapterId, fields) => {
  const adapter = aiProviderAdapterOf(adapterId);
  if (!adapter) return {};
  const out = {};
  for (const field of adapter.fields) {
    const value = fields?.[field.key];
    out[field.key] = field.secret ? (value ? '••••••••' : '') : (value ?? '');
  }
  return out;
};
