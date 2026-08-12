import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventsHandler } from '../src/functions/events.js';
import { submitScore } from '../src/functions/scores.js';
import { insertAnalyticsEvent, insertAnalyticsEventSql } from '../src/analytics/postgresEventStore.js';

const allowedOrigin = 'https://game.example';
const now = new Date('2026-08-04T12:00:00.000Z');

function validEvent(overrides = {}) {
  return {
    eventName: 'wave_complete', occurredAt: '2026-08-04T11:59:00.000Z', sessionId: '92b62a2f-b4c9-4a38-9fdc-7b45c9ac4515',
    runId: '47fd990c-9ee6-457f-9ff2-0ae9b536e8b4', gameVersion: '1.4.0', platform: 'crazygames',
    context: { deviceClass: 'desktop', language: 'en', isMuted: false },
    properties: { wave: 5, durationMs: 48210, livesRemaining: 7, energyRemaining: 120 }, ...overrides
  };
}

function request(body, { method = 'POST', origin = allowedOrigin, contentType = 'application/json', rawBody } = {}) {
  const headers = new Headers();
  if (origin)
    headers.set('origin', origin);
  if (contentType)
    headers.set('content-type', contentType);
  return { method, headers, text: async () => rawBody ?? JSON.stringify(body) };
}

function context() {
  const messages = [];
  return { messages, info: message => messages.push(message), warn: message => messages.push(message), error: message => messages.push(message) };
}

function handler(insertEvent = async () => {}) {
  return createEventsHandler({ insertEvent, allowedOrigin, getCurrentDate: () => now, getTime: () => now.getTime() });
}

test('accepts and inserts one valid event', async () => {
  let inserted;
  const response = await handler(event => { inserted = event; })(request(validEvent()), context());
  assert.equal(response.status, 204);
  assert.equal(response.headers['Access-Control-Allow-Origin'], allowedOrigin);
  assert.equal(inserted.eventName, 'wave_complete');
  assert.deepEqual(inserted.properties, validEvent().properties);
});

test('rejects malformed JSON and oversized input', async t => {
  await t.test('malformed JSON is 400', async () => {
    const response = await handler()(request(null, { rawBody: '{broken' }), context());
    assert.equal(response.status, 400);
    assert.deepEqual(response.jsonBody, { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  });
  await t.test('oversized request is 413', async () => {
    const response = await handler()(request(null, { rawBody: 'x'.repeat(8193) }), context());
    assert.equal(response.status, 413);
  });
  await t.test('oversized properties are 413', async () => {
    const response = await handler()(request(validEvent({ properties: { padding: 'x'.repeat(4097) } })), context());
    assert.equal(response.status, 413);
  });
});

test('rejects unknown events and fields', async t => {
  await t.test('unknown event is 422', async () => {
    const response = await handler()(request(validEvent({ eventName: 'player_email' })), context());
    assert.equal(response.status, 422);
    assert.equal(response.jsonBody.code, 'UNKNOWN_EVENT');
  });
  await t.test('unknown top-level field is 400', async () => {
    const response = await handler()(request({ ...validEvent(), email: 'private@example.com' }), context());
    assert.equal(response.status, 400);
  });
  await t.test('unknown context field is 400', async () => {
    const response = await handler()(request(validEvent({ context: { ...validEvent().context, userAgent: 'private' } })), context());
    assert.equal(response.status, 400);
  });
  await t.test('unknown property is 422', async () => {
    const response = await handler()(request(validEvent({ properties: { ...validEvent().properties, playerName: 'private' } })), context());
    assert.equal(response.status, 422);
  });
});

test('rejects invalid UUIDs, timestamps, and property values', async t => {
  const cases = [
    ['UUID', { sessionId: 'not-a-uuid' }, 400],
    ['non-v4 UUID', { sessionId: '92b62a2f-b4c9-1a38-9fdc-7b45c9ac4515' }, 400],
    ['missing run UUID', { runId: null }, 400],
    ['old timestamp', { occurredAt: '2026-08-03T11:59:59.999Z' }, 400],
    ['future timestamp', { occurredAt: '2026-08-04T12:05:00.001Z' }, 400],
    ['property type', { properties: { ...validEvent().properties, wave: '5' } }, 422],
    ['property range', { properties: { ...validEvent().properties, wave: 0 } }, 422]
  ];
  for (const [name, overrides, status] of cases)
    await t.test(name, async () => assert.equal((await handler()(request(validEvent(overrides)), context())).status, status));
});

test('database failure returns a safe 500 and logs no submitted or secret values', async () => {
  const requestMarker = 'private@example.com';
  const secretMarker = 'postgresql://user:secret@host/database';
  process.env.ANALYTICS_DATABASE_URL = secretMarker;
  const rejectedContext = context();
  await handler()(request({ ...validEvent(), email: requestMarker }), rejectedContext);
  const invocationContext = context();
  const response = await handler(async () => { throw new Error(`SQL failed for ${requestMarker} using ${secretMarker}`); })(request(validEvent()), invocationContext);
  assert.equal(response.status, 500);
  assert.deepEqual(response.jsonBody, { code: 'INTERNAL_ERROR', message: 'Unable to store event.' });
  assert.doesNotMatch(JSON.stringify([...rejectedContext.messages, ...invocationContext.messages]), /private@example\.com|postgresql:\/\//);
  delete process.env.ANALYTICS_DATABASE_URL;
});

test('uses a fixed parameterized insert statement', async () => {
  const maliciousVersion = "1.0.0'; DROP TABLE analytics_events; --";
  let query;
  await insertAnalyticsEvent({ ...validEvent({ gameVersion: maliciousVersion }), occurredAt: now }, { query: async (text, values) => { query = { text, values }; } });
  assert.equal(query.text, insertAnalyticsEventSql);
  assert.doesNotMatch(query.text, /DROP TABLE/);
  assert.equal(query.values[4], maliciousVersion);
});

test('allows only the configured browser origin', async () => {
  const allowed = await handler()(request(null, { method: 'OPTIONS', contentType: null }), context());
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], allowedOrigin);

  const denied = await handler()(request(null, { method: 'OPTIONS', origin: 'https://other.example', contentType: null }), context());
  assert.equal(denied.status, 204);
  assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
});

test('uses the same exact-origin CORS policy for the existing leaderboard', async () => {
  const previousOrigin = process.env.NEON_VOID_ALLOWED_ORIGIN;
  process.env.NEON_VOID_ALLOWED_ORIGIN = allowedOrigin;
  try {
    const allowed = await submitScore(request(null, { method: 'OPTIONS', contentType: null }), context());
    const denied = await submitScore(request(null, { method: 'OPTIONS', origin: 'https://other.example', contentType: null }), context());
    assert.equal(allowed.headers['Access-Control-Allow-Origin'], allowedOrigin);
    assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
  } finally {
    if (previousOrigin === undefined)
      delete process.env.NEON_VOID_ALLOWED_ORIGIN;
    else
      process.env.NEON_VOID_ALLOWED_ORIGIN = previousOrigin;
  }
});
