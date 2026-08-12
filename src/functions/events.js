import { app } from '@azure/functions';
import { AnalyticsRequestError, parseAnalyticsEvent } from '../analytics/eventValidation.js';
import { insertAnalyticsEvent } from '../analytics/postgresEventStore.js';

function corsHeaders(origin, allowedOrigin) {
  const headers = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (origin && origin === allowedOrigin)
    headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonError(status, code, message, headers) {
  return { status, jsonBody: { code, message }, headers: { ...headers, 'Content-Type': 'application/json' } };
}

function logOutcome(context, status, eventName, startedAt, category, getTime) {
  const message = `analytics_event status=${status} eventName=${eventName} durationMs=${Math.max(0, getTime() - startedAt)}${category ? ` category=${category}` : ''}`;
  if (status >= 500)
    context.error(message);
  else if (status >= 400)
    context.warn(message);
  else
    context.info(message);
}

export function createEventsHandler({ insertEvent = insertAnalyticsEvent, getCurrentDate = () => new Date(), getTime = Date.now, allowedOrigin = process.env.NEON_VOID_ALLOWED_ORIGIN } = {}) {
  return async function events(request, context) {
    const startedAt = getTime();
    const origin = request.headers.get('origin');
    const headers = corsHeaders(origin, allowedOrigin);

    if (request.method === 'OPTIONS') {
      logOutcome(context, 204, 'unknown', startedAt, undefined, getTime);
      return { status: 204, headers };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      logOutcome(context, 400, 'unknown', startedAt, 'invalid_content_type', getTime);
      return jsonError(400, 'INVALID_REQUEST', 'Content-Type must be application/json.', headers);
    }

    let event;
    try {
      event = parseAnalyticsEvent(await request.text(), getCurrentDate());
    } catch (error) {
      if (!(error instanceof AnalyticsRequestError)) {
        logOutcome(context, 500, 'unknown', startedAt, 'request_read_failure', getTime);
        return jsonError(500, 'INTERNAL_ERROR', 'Unable to store event.', headers);
      }
      logOutcome(context, error.status, error.eventName, startedAt, error.category, getTime);
      return jsonError(error.status, error.code, error.message, headers);
    }

    try {
      await insertEvent(event);
      logOutcome(context, 204, event.eventName, startedAt, undefined, getTime);
      return { status: 204, headers };
    } catch {
      logOutcome(context, 500, event.eventName, startedAt, 'database_failure', getTime);
      return jsonError(500, 'INTERNAL_ERROR', 'Unable to store event.', headers);
    }
  };
}

app.http('recordAnalyticsEvent', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'events', handler: createEventsHandler() });
