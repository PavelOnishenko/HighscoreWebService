import { randomUUID } from 'node:crypto';
import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';

const tableName = 'scores';
const leaderboardPartition = 'global';
const maximumScore = 999999;
let scoreTableClient;
let localTableReady;

function getCorsHeaders(request) {
  const origin = request.headers.get('origin');
  const headers = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (origin && origin === process.env.NEON_VOID_ALLOWED_ORIGIN)
    headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function getScoreTableClient() {
  if (scoreTableClient)
    return scoreTableClient;

  const connectionString = process.env.SCORES_STORAGE_CONNECTION_STRING;
  if (connectionString)
    scoreTableClient = TableClient.fromConnectionString(connectionString, tableName);
  else {
    const accountName = process.env.SCORES_STORAGE_ACCOUNT;
    if (!accountName)
      throw new Error('Set SCORES_STORAGE_ACCOUNT or SCORES_STORAGE_CONNECTION_STRING.');
    scoreTableClient = new TableClient(`https://${accountName}.table.core.windows.net`, tableName, new DefaultAzureCredential());
  }

  return scoreTableClient;
}

async function getReadyScoreTableClient() {
  const client = getScoreTableClient();
  if (process.env.SCORES_STORAGE_CONNECTION_STRING === 'UseDevelopmentStorage=true') {
    localTableReady ??= client.createTable().catch(error => {
      if (error.statusCode !== 409)
        throw error;
    });
    await localTableReady;
  }
  return client;
}

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 20;
}

function isValidScore(score) {
  return Number.isInteger(score) && score > 0 && score <= maximumScore;
}

function jsonResponse(status, jsonBody, headers) {
  return { status, jsonBody, headers };
}

export async function submitScore(request, context) {
  const headers = getCorsHeaders(request);
  if (request.method === 'OPTIONS')
    return { status: 204, headers };

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON.' }, headers);
  }

  const { name, score } = body ?? {};
  if (!isValidName(name) || !isValidScore(score))
    return jsonResponse(400, { error: 'Invalid name or score.' }, headers);

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const reversedScore = String(maximumScore - score).padStart(6, '0');

  try {
    const tableClient = await getReadyScoreTableClient();
    await tableClient.createEntity({ partitionKey: leaderboardPartition, rowKey: `${reversedScore}_${timestamp}_${id}`, id, name: name.trim(), score, timestamp });
    return jsonResponse(201, { ok: true }, headers);
  } catch (error) {
    context.error('Failed to save score.', error);
    return jsonResponse(500, { error: 'Unable to save score.' }, headers);
  }
}

export async function getLeaders(request, context) {
  const leaders = [];
  const headers = getCorsHeaders(request);

  try {
    const tableClient = await getReadyScoreTableClient();
    const entities = tableClient.listEntities({ queryOptions: { filter: `PartitionKey eq '${leaderboardPartition}'`, select: ['id', 'name', 'score', 'timestamp'] } });
    for await (const entity of entities) {
      leaders.push({ id: entity.id, name: entity.name, score: entity.score, timestamp: entity.timestamp });
      if (leaders.length === 20)
        break;
    }
    return jsonResponse(200, leaders, headers);
  } catch (error) {
    context.error('Failed to load leaderboard.', error);
    return jsonResponse(500, { error: 'Unable to load leaderboard.' }, headers);
  }
}

app.http('submitScore', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'submit', handler: submitScore });
app.http('getLeaders', { methods: ['GET'], authLevel: 'anonymous', route: 'leaders', handler: getLeaders });
