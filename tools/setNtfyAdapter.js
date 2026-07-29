/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Wires the ntfy notification adapter onto every enabled job, so Fredy pushes a raw
 * (un-rated) notification the moment it finds a new listing - independent of any AI
 * rating pass, which only runs on demand.
 *
 * All credentials come from the environment, never from this file or the command line, so
 * nothing sensitive ends up in shell history or a git diff.
 *
 * Usage:
 *   FREDY_BASE_URL=https://fredy.example.com \
 *   FREDY_TOKEN=fredy_xxx \
 *   NTFY_SERVER=https://ntfy.example.com \
 *   NTFY_TOPIC=my-topic \
 *   NTFY_TOKEN=tk_xxx \
 *   node tools/setNtfyAdapter.js
 *
 * Optional: NTFY_PRIORITY (default 4), JOB_NAME_FILTER (substring match on job name,
 * default matches every enabled job).
 */

/* eslint-disable no-console */

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

const FREDY_BASE_URL = required('FREDY_BASE_URL').replace(/\/$/, '');
const FREDY_TOKEN = required('FREDY_TOKEN');
const NTFY_SERVER = required('NTFY_SERVER').replace(/\/$/, '');
const NTFY_TOPIC = required('NTFY_TOPIC');
const NTFY_TOKEN = required('NTFY_TOKEN');
const NTFY_PRIORITY = Number(process.env.NTFY_PRIORITY || 4);
const JOB_NAME_FILTER = process.env.JOB_NAME_FILTER || '';

async function fredyRequest(method, path, body) {
  const res = await fetch(`${FREDY_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${FREDY_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const jobs = await fredyRequest('GET', '/api/jobs/');
  const targets = jobs.filter((job) => job.enabled && job.name.includes(JOB_NAME_FILTER));

  const ntfyAdapter = {
    id: 'ntfy',
    enabled: true,
    fields: {
      priority: NTFY_PRIORITY,
      server: NTFY_SERVER,
      topic: NTFY_TOPIC,
      accessToken: NTFY_TOKEN,
    },
  };

  for (const job of targets) {
    // The upsert endpoint keys off `jobId`, not `id` - reusing the fetched `id` field directly
    // silently creates a duplicate job instead of updating the existing one.
    await fredyRequest('POST', '/api/jobs/', { ...job, notificationAdapter: [ntfyAdapter], jobId: job.id });
    console.log(`Updated: ${job.name}`);
  }

  console.log(`Done. ${targets.length} job(s) updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
