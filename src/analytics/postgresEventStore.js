import pg from 'pg';

const { Pool } = pg;
let analyticsPool;

export const insertAnalyticsEventSql = `
  INSERT INTO analytics_events (
    event_name, occurred_at, session_id, run_id, game_version, platform, device_class, language, properties
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
`;

function getAnalyticsPool() {
  if (analyticsPool)
    return analyticsPool;
  if (!process.env.ANALYTICS_DATABASE_URL)
    throw new Error('ANALYTICS_DATABASE_URL is not configured.');
  analyticsPool = new Pool({ connectionString: process.env.ANALYTICS_DATABASE_URL, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return analyticsPool;
}

export async function insertAnalyticsEvent(event, database = getAnalyticsPool()) {
  const values = [
    event.eventName, event.occurredAt, event.sessionId, event.runId, event.gameVersion, event.platform,
    event.context.deviceClass ?? null, event.context.language ?? null, JSON.stringify(event.properties)
  ];
  await database.query(insertAnalyticsEventSql, values);
}

