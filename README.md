# Highscore and Neon Void Analytics Service

Azure Functions endpoints for the existing Table Storage leaderboard and Neon Void analytics:

- `POST /api/submit` and `GET /api/leaders`: leaderboard.
- `POST /api/events`: anonymous analytics with arbitrary event names and JSON properties stored in Azure Database for PostgreSQL.

## Local setup

1. Install dependencies and Azure Functions Core Tools:
   ```bash
   npm install
   ```
2. Copy `local.settings.example.json` to `local.settings.json`.
3. Create a local PostgreSQL database and apply `database/setup_analytics.sql`.
4. Set `ANALYTICS_DATABASE_URL` and `NEON_VOID_ALLOWED_ORIGIN` in `local.settings.json`.
5. Start Azurite and the API together; the local `scores` table is created automatically:
   ```bash
   npm start
   ```
6. Submit a score:
   ```bash
   curl -X POST http://localhost:7071/api/submit \
     -H 'Content-Type: application/json' \
     -d '{"name":"Ada","score":1234}'
   ```
7. Fetch the leaderboard:
   ```bash
   curl http://localhost:7071/api/leaders
   ```

Run `npm test` for the generic analytics envelope, arbitrary JSON properties, safe logging, CORS, database-failure, and SQL parameterization tests. The request contract is documented in `docs/analytics_events.md`.

## Azure configuration

Create the existing `scores` Table Storage table. Create an Azure Database for PostgreSQL database and apply `database/setup_analytics.sql` with a deployment/admin role. Give the runtime database role only the permissions it needs to connect, use the schema/sequence, and insert into `analytics_events`.

For a runtime role named `analytics_writer`, grant `CONNECT` on the database, `USAGE` on schema `public`, `INSERT` on `analytics_events`, and `USAGE, SELECT` on sequence `analytics_events_id_seq`. Do not grant table update or delete permissions.

Set these Function App settings without committing their values:

- `SCORES_STORAGE_ACCOUNT`
- `ANALYTICS_DATABASE_URL` with `sslmode=require`
- `NEON_VOID_ALLOWED_ORIGIN` with the exact Neon Void website origin
- `FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR=true`

Enable Application Insights, HTTPS Only, and Azure Function CORS for the same exact origin. The function logs only status, accepted event name, duration, and a short error category through the invocation context. CORS prevents unapproved browser origins from reading responses; it is not authentication and custom callers can spoof an origin. Then publish with:

```bash
func azure functionapp publish <FUNCTION_APP_NAME>
```
