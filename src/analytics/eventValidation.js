import { eventPropertySchemas, runScopedEventNames } from './eventSchemas.js';

export const maximumRequestBytes = 8 * 1024;
export const maximumContextBytes = 1024;
export const maximumPropertiesBytes = 4 * 1024;

const topLevelFields = new Set(['eventName', 'occurredAt', 'sessionId', 'runId', 'gameVersion', 'platform', 'context', 'properties']);
const contextFields = new Set(['deviceClass', 'language', 'isMuted']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const languagePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const utcTimestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

export class AnalyticsRequestError extends Error {
  constructor(status, code, message, category, eventName = 'unknown') {
    super(message);
    this.status = status;
    this.code = code;
    this.category = category;
    this.eventName = eventName;
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const serializedBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function fail(status, code, message, category, eventName) {
  throw new AnalyticsRequestError(status, code, message, category, eventName);
}

function parseUtcTimestamp(value, now, eventName) {
  const match = typeof value === 'string' && utcTimestampPattern.exec(value);
  if (!match)
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_timestamp', eventName);

  const occurredAt = new Date(value);
  const canonicalTimestamp = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== canonicalTimestamp)
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_timestamp', eventName);

  const ageMs = now.getTime() - occurredAt.getTime();
  if (ageMs > 86_400_000 || ageMs < -300_000)
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_timestamp_range', eventName);
  return occurredAt;
}

function validateContext(context, eventName) {
  if (!isObject(context) || serializedBytes(context) > maximumContextBytes || Object.keys(context).some(field => !contextFields.has(field)))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_context', eventName);
  if (context.deviceClass !== undefined && !['desktop', 'mobile', 'tablet'].includes(context.deviceClass))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_context', eventName);
  if (context.language !== undefined && (typeof context.language !== 'string' || !languagePattern.test(context.language)))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_context', eventName);
  if (context.isMuted !== undefined && typeof context.isMuted !== 'boolean')
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_context', eventName);
}

function validateProperties(eventName, properties, schema) {
  if (!isObject(properties))
    fail(422, 'INVALID_PROPERTIES', 'Event properties are invalid.', 'invalid_properties', eventName);
  if (serializedBytes(properties) > maximumPropertiesBytes)
    fail(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.', 'properties_too_large', eventName);
  if (Object.keys(properties).some(field => !(field in schema)))
    fail(422, 'INVALID_PROPERTIES', 'Event properties are invalid.', 'invalid_properties', eventName);

  for (const [field, rule] of Object.entries(schema))
    if ((rule.required && !(field in properties)) || (field in properties && !rule.validate(properties[field])))
      fail(422, 'INVALID_PROPERTIES', 'Event properties are invalid.', 'invalid_properties', eventName);
}

export function parseAnalyticsEvent(rawBody, now = new Date()) {
  if (Buffer.byteLength(rawBody, 'utf8') > maximumRequestBytes)
    fail(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.', 'request_too_large');

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    fail(400, 'INVALID_JSON', 'Request body must be valid JSON.', 'invalid_json');
  }
  if (!isObject(body))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_body');

  const eventName = typeof body.eventName === 'string' && body.eventName.length <= 64 && eventPropertySchemas[body.eventName] ? body.eventName : 'unknown';
  if (typeof body.eventName !== 'string' || body.eventName.length < 1 || body.eventName.length > 64)
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_event_name');
  if (Object.keys(body).some(field => !topLevelFields.has(field)))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'unknown_top_level_field', eventName);

  const schema = eventPropertySchemas[body.eventName];
  if (!schema)
    fail(422, 'UNKNOWN_EVENT', 'Event name is not accepted.', 'unknown_event');
  if (!uuidPattern.test(body.sessionId) || (body.runId !== undefined && body.runId !== null && !uuidPattern.test(body.runId)) || (runScopedEventNames.has(body.eventName) && !body.runId))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_uuid', body.eventName);
  if (typeof body.gameVersion !== 'string' || !versionPattern.test(body.gameVersion) || !['crazygames', 'local'].includes(body.platform))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_common_fields', body.eventName);

  const occurredAt = parseUtcTimestamp(body.occurredAt, now, body.eventName);
  validateContext(body.context, body.eventName);
  validateProperties(body.eventName, body.properties, schema);
  return { ...body, occurredAt, runId: body.runId ?? null };
}
