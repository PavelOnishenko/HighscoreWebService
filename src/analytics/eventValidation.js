export const maximumRequestBytes = 8 * 1024;
export const maximumPropertiesBytes = 4 * 1024;

const topLevelFields = new Set(['eventName', 'occurredAt', 'sessionId', 'runId', 'gameVersion', 'platform', 'deviceClass', 'language', 'properties']);
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

function validateDimensions(event, eventName) {
  if (!['desktop', 'mobile', 'tablet'].includes(event.deviceClass))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_device_class', eventName);
  if (typeof event.language !== 'string' || event.language.length > 16 || !languagePattern.test(event.language))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_language', eventName);
}

function validateProperties(eventName, properties) {
  if (!isObject(properties))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_properties', eventName);
  if (serializedBytes(properties) > maximumPropertiesBytes)
    fail(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.', 'properties_too_large', eventName);
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

  const eventName = typeof body.eventName === 'string' && body.eventName.length <= 64 ? body.eventName : 'unknown';
  if (typeof body.eventName !== 'string' || body.eventName.length < 1 || body.eventName.length > 64)
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_event_name');
  if (Object.keys(body).some(field => !topLevelFields.has(field)))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'unknown_top_level_field', eventName);

  if (!uuidPattern.test(body.sessionId) || !uuidPattern.test(body.runId))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_uuid', body.eventName);
  if (typeof body.gameVersion !== 'string' || !versionPattern.test(body.gameVersion) || !['crazygames', 'local'].includes(body.platform))
    fail(400, 'INVALID_REQUEST', 'Request fields are invalid.', 'invalid_common_fields', body.eventName);

  const occurredAt = parseUtcTimestamp(body.occurredAt, now, body.eventName);
  validateDimensions(body, body.eventName);
  validateProperties(body.eventName, body.properties);
  return { ...body, occurredAt };
}
