# Local analytics pre-deployment test

This procedure runs the real Azure Functions host and writes an analytics event
to PostgreSQL on your computer. It verifies the `/api/events` route, request
validation, parameterized insert, and stored JSONB without deploying anything to
Azure.

Azurite is also started because `local.settings.json` configures the local
Functions host to use it for `AzureWebJobsStorage`. The leaderboard is not part
of this test and does not need to be called.

## 1. Install prerequisites

- Node.js 22 and npm;
- Azure Functions Core Tools 4;
- Docker Desktop with Linux containers enabled.

Run from the repository root:

```powershell
node --version
func --version
docker --version
npm ci
```

## 2. Start PostgreSQL

These commands create a persistent Docker volume and a PostgreSQL 16 container.
The passwords below are local-development values only.

```powershell
docker volume create neon-void-analytics-data
docker run --name neon-void-analytics-postgres --detach --publish 5432:5432 `
  --env POSTGRES_DB=neon_void_analytics --env POSTGRES_USER=nvadmin --env POSTGRES_PASSWORD=local_admin_password `
  --volume neon-void-analytics-data:/var/lib/postgresql/data postgres:16
```

Wait until PostgreSQL is ready:

```powershell
docker exec neon-void-analytics-postgres pg_isready -U nvadmin -d neon_void_analytics
```

Expected output ends with `accepting connections`.

For later test sessions, preserve the existing rows and restart the same
container with:

```powershell
docker start neon-void-analytics-postgres
```

## 3. Create the schema and runtime writer

Apply the production table definition:

```powershell
Get-Content -Raw database/setup_analytics.sql | docker exec -i neon-void-analytics-postgres `
  psql -U nvadmin -d neon_void_analytics -v ON_ERROR_STOP=1
```

For a newly created container, create the same least-privileged writer role used
by the Function App and grant it insert access:

```powershell
docker exec neon-void-analytics-postgres psql -U nvadmin -d neon_void_analytics -v ON_ERROR_STOP=1 `
  -c "CREATE ROLE analytics_writer LOGIN PASSWORD 'local_writer_password';"
docker exec neon-void-analytics-postgres psql -U nvadmin -d neon_void_analytics -v ON_ERROR_STOP=1 `
  -c "GRANT CONNECT ON DATABASE neon_void_analytics TO analytics_writer; GRANT USAGE ON SCHEMA public TO analytics_writer; GRANT INSERT ON TABLE analytics_events TO analytics_writer; GRANT USAGE, SELECT ON SEQUENCE analytics_events_id_seq TO analytics_writer;"
```

Do not rerun `CREATE ROLE` when reusing the same container. The schema command is
safe to rerun because it uses `IF NOT EXISTS`.

## 4. Configure local Functions

Create the ignored local settings file if it does not exist:

```powershell
Copy-Item local.settings.example.json local.settings.json
```

Set this value in `local.settings.json`:

```json
"ANALYTICS_DATABASE_URL": "postgresql://analytics_writer:local_writer_password@localhost:5432/neon_void_analytics"
```

Keep `AzureWebJobsStorage` and `SCORES_STORAGE_CONNECTION_STRING` set to
`UseDevelopmentStorage=true`. Never publish `local.settings.json`.

## 5. Start the local service

Start Azurite in one terminal:

```powershell
npm run storage
```

Start the Azure Functions host in a second terminal:

```powershell
func start
```

The host output must list:

```text
recordAnalyticsEvent: [POST,OPTIONS] http://localhost:7071/api/events
```

`npm start` is an equivalent one-terminal shortcut that starts both processes.

## 6. Insert an event through the HTTP endpoint

In a third PowerShell terminal, send a valid event. Event names and `properties`
are intentionally arbitrary.

```powershell
$localTestEvent = @{
  eventName = "local_predeploy_test"
  occurredAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  sessionId = [guid]::NewGuid().ToString()
  runId = [guid]::NewGuid().ToString()
  gameVersion = "local-test"
  platform = "local"
  deviceClass = "desktop"
  language = "en"
  properties = @{ source = "local-functions"; nested = @{ value = 42 } }
} | ConvertTo-Json -Depth 5

$response = Invoke-WebRequest -Method Post -Uri "http://localhost:7071/api/events" `
  -ContentType "application/json" -Body $localTestEvent
$response.StatusCode
$response.Headers["Access-Control-Allow-Origin"]
```

Expected values are `204` and `*`.

## 7. Confirm the database row

Query PostgreSQL inside the container, so a host installation of `psql` is not
needed:

```powershell
docker exec neon-void-analytics-postgres psql -U nvadmin -d neon_void_analytics `
  -c "SELECT id, event_name, occurred_at, session_id, run_id, game_version, platform, device_class, language, properties FROM analytics_events WHERE event_name = 'local_predeploy_test' ORDER BY id DESC LIMIT 5;"
```

The result must contain the event and JSON similar to:

```json
{"nested": {"value": 42}, "source": "local-functions"}
```

That proves the HTTP request reached the real Function handler and its
`properties` object was inserted into PostgreSQL as JSONB.

## 8. Stop or reset the local environment

Stop the Functions host and Azurite with `Ctrl+C`, then stop PostgreSQL while
preserving its rows:

```powershell
docker stop neon-void-analytics-postgres
```

To completely reset the local analytics database, run the following only when
you intend to delete every locally stored analytics row:

```powershell
docker rm --force neon-void-analytics-postgres
docker volume rm neon-void-analytics-data
```

## What this test does not prove

This local test does not verify Azure PostgreSQL firewall rules, production TLS,
Function App settings, managed identity, deployment, or Application Insights.
Those are verified by the live smoke test in `docs/azure_deployment.md` after
deployment.

## Common failures

- `docker` is not recognized: install and start Docker Desktop.
- Port `5432` is already in use: stop the other PostgreSQL service or publish the
