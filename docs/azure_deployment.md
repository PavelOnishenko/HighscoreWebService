# Azure deployment runbook

This runbook deploys the repository as one Node.js 22 Azure Function App with:

- `POST /api/events` backed by Azure Database for PostgreSQL;
- `POST /api/submit` and `GET /api/leaders` backed by Azure Table Storage;
- a system-assigned managed identity for Table Storage access;
- Application Insights logging;
- application-owned wildcard CORS headers.

The commands below use PowerShell. Run them from the repository root. Names in
angle brackets must be replaced. Azure resource names must be globally unique.

## 1. Prerequisites

Install and verify:

- Node.js 22 and npm;
- Azure CLI 2.60 or later;
- Azure Functions Core Tools 4;
- PostgreSQL client tools (`psql`);
- an Azure subscription where you can create resources and role assignments.

```powershell
node --version
npm --version
az version
func --version
psql --version
```

Sign in and select the intended subscription:

```powershell
az login
az account list --output table
az account set --subscription "<SUBSCRIPTION_NAME_OR_ID>"
az account show --query "{name:name,id:id,tenantId:tenantId}" --output table
```

Do not continue until `az account show` displays the correct subscription.

## 2. Validate the repository

Install exactly the locked dependencies and run the tests:

```powershell
npm ci
npm test
```

All tests must pass before deployment. Do not use `--publish-local-settings`:
`local.settings.json` is local-only and can contain secrets or Azurite settings.

Before the first deployment, follow the [local analytics pre-deployment
test](local_analytics_testing.md). It runs the real Functions handler against a
local PostgreSQL container and confirms that the event and JSONB properties were
stored. This does not replace the live Azure smoke test in section 10.

## 3. Choose names and region

List Flex Consumption regions that support Node.js:

```powershell
az functionapp list-flexconsumption-locations --runtime node --output table
```

Set deployment variables. Storage account names accept only 3-24 lowercase
letters and digits.

```powershell
$resourceGroup = "neon-void-prod"
$location = "westeurope"
$functionAppName = "<GLOBALLY_UNIQUE_FUNCTION_APP_NAME>"
$storageAccountName = "<GLOBALLYUNIQUESTORAGE>"
$postgresServerName = "<GLOBALLY-UNIQUE-POSTGRES-SERVER>"
$databaseName = "neon_void_analytics"
$postgresAdmin = "nvadmin"
$postgresAdminPassword = "<STRONG_TEMPORARY_ADMIN_PASSWORD>"
```

The Function URL will be
`https://<FUNCTION_APP_NAME>.azurewebsites.net`. The PostgreSQL hostname will be
`<POSTGRES_SERVER_NAME>.postgres.database.azure.com`.

If the Function App and storage account already exist, skip sections 4 and 5 and
use their actual names in the variables above. Continue with section 6.

## 4. Create the resource group and storage account

```powershell
az group create --name $resourceGroup --location $location
az storage account create --resource-group $resourceGroup --name $storageAccountName --location $location --sku Standard_LRS --kind StorageV2 --allow-blob-public-access false
```

Create the `scores` table:

```powershell
az storage table create --account-name $storageAccountName --name scores --auth-mode login
```

If this returns `403`, your signed-in user has management access but lacks Table
data access. Assign yourself `Storage Table Data Contributor` at the storage
account scope, wait a few minutes, and retry:

```powershell
$storageAccountId = az storage account show --resource-group $resourceGroup --name $storageAccountName --query id --output tsv
$currentUserId = az ad signed-in-user show --query id --output tsv
az role assignment create --assignee-object-id $currentUserId --assignee-principal-type User --role "Storage Table Data Contributor" --scope $storageAccountId
```

## 5. Create the Function App

Create a Node.js 22 Flex Consumption Function App. This also creates or connects
the Function host storage and normally creates Application Insights.

```powershell
az functionapp create --resource-group $resourceGroup --name $functionAppName --storage-account $storageAccountName --flexconsumption-location $location --runtime node --runtime-version 22
```

Require HTTPS:

```powershell
az resource update --resource-group $resourceGroup --resource-type Microsoft.Web/sites --name $functionAppName --set properties.httpsOnly=true
```

Enable the system-assigned managed identity and grant it access to Table Storage:

```powershell
$functionPrincipalId = az functionapp identity assign --resource-group $resourceGroup --name $functionAppName --query principalId --output tsv
$storageAccountId = az storage account show --resource-group $resourceGroup --name $storageAccountName --query id --output tsv
az role assignment create --assignee-object-id $functionPrincipalId --assignee-principal-type ServicePrincipal --role "Storage Table Data Contributor" --scope $storageAccountId
```

Role assignments can take several minutes to become effective.

## 6. Create PostgreSQL

This first deployment uses PostgreSQL public networking. Your current public IP
is allowed for setup, and Azure services are allowed so the dynamically scaled
Function App can connect. The `0.0.0.0` Azure-services rule is broader than this
single Function App; credentials still protect the database. Replace this later
with private networking if tighter network isolation becomes necessary.

Find your public IP, then create PostgreSQL Flexible Server:

```powershell
$publicIp = (Invoke-RestMethod "https://api.ipify.org").Trim()
az postgres flexible-server create --resource-group $resourceGroup --name $postgresServerName --location $location `
  --admin-user $postgresAdmin --admin-password $postgresAdminPassword --tier Burstable --sku-name Standard_B1ms `
  --version 16 --storage-size 32 --public-access $publicIp
```

Create the analytics database and permit Azure-hosted services:

```powershell
az postgres flexible-server db create --resource-group $resourceGroup --server-name $postgresServerName --database-name $databaseName
az postgres flexible-server firewall-rule create --resource-group $resourceGroup --server-name $postgresServerName `
  --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

Define the admin connection used only during setup:

```powershell
$postgresHost = "$postgresServerName.postgres.database.azure.com"
$adminConnection = "host=$postgresHost port=5432 dbname=$databaseName user=$postgresAdmin sslmode=verify-full"
$env:PGPASSWORD = $postgresAdminPassword
```

Apply the reviewed table definition:

```powershell
psql $adminConnection -v ON_ERROR_STOP=1 -f database/setup_analytics.sql
```

Create the least-privileged runtime role interactively:

```powershell
psql $adminConnection
```

Run these statements inside `psql`:

```sql
CREATE ROLE analytics_writer LOGIN;
\password analytics_writer
GRANT CONNECT ON DATABASE neon_void_analytics TO analytics_writer;
GRANT USAGE ON SCHEMA public TO analytics_writer;
GRANT INSERT ON TABLE analytics_events TO analytics_writer;
GRANT USAGE, SELECT ON SEQUENCE analytics_events_id_seq TO analytics_writer;
\q
```

Choose a strong runtime password at the `\password` prompt and keep it outside
the repository. Clear the admin password from the process environment afterward:

```powershell
Remove-Item Env:PGPASSWORD
$postgresAdminPassword = $null
```

### Updating an existing analytics table

If `analytics_events` already exists from the earlier schema, first inspect it:

```sql
SELECT count(*) AS rows_missing_required_values
FROM analytics_events
WHERE run_id IS NULL OR device_class IS NULL OR language IS NULL;
```

Resolve or delete any returned legacy rows intentionally. Then run:

```sql
ALTER TABLE analytics_events DROP COLUMN IF EXISTS is_muted;
ALTER TABLE analytics_events ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE analytics_events ALTER COLUMN device_class SET NOT NULL;
ALTER TABLE analytics_events ALTER COLUMN language SET NOT NULL;
DROP INDEX IF EXISTS analytics_events_run_time_idx;
CREATE INDEX analytics_events_run_time_idx ON analytics_events (run_id, occurred_at);
```

Do not claim the schema upgrade succeeded until all statements complete without
errors.

## 7. Configure the Function App

Set the runtime writer password locally only long enough to construct the URL.
URL-encoding is required if the password contains characters such as `@`, `:`,
`/`, `?`, or `#`.

```powershell
$analyticsWriterPassword = "<PASSWORD_ENTERED_AT_PSQL_PROMPT>"
$encodedWriterPassword = [uri]::EscapeDataString($analyticsWriterPassword)
$analyticsDatabaseUrl = "postgresql://analytics_writer:${encodedWriterPassword}@${postgresHost}:5432/${databaseName}?sslmode=verify-full"
```

Add the production settings:

```powershell
az functionapp config appsettings set --resource-group $resourceGroup --name $functionAppName `
  --settings "SCORES_STORAGE_ACCOUNT=$storageAccountName" "ANALYTICS_DATABASE_URL=$analyticsDatabaseUrl" `
  "FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR=true" "NODE_ENV=production"
```

For an older deployment, remove local-storage and old origin settings if they
exist. The production code must use managed identity for scores and owns its
wildcard CORS headers.

```powershell
az functionapp config appsettings delete --resource-group $resourceGroup --name $functionAppName --setting-names SCORES_STORAGE_CONNECTION_STRING NEON_VOID_ALLOWED_ORIGIN
```

Clear local copies of the runtime secret:

```powershell
$analyticsWriterPassword = $null
$encodedWriterPassword = $null
$analyticsDatabaseUrl = $null
```

Confirm the required setting names exist. Avoid printing secret values into
shared logs or screenshots.

```powershell
az functionapp config appsettings list --resource-group $resourceGroup --name $functionAppName --query "[].name" --output table
```

## 8. Leave Azure platform CORS empty

The HTTP handlers return `Access-Control-Allow-Origin: *`. Azure platform CORS
must not override that behavior. Remove every configured platform origin:

```powershell
az functionapp cors remove --resource-group $resourceGroup --name $functionAppName --allowed-origins
az functionapp cors show --resource-group $resourceGroup --name $functionAppName
```

The displayed `allowedOrigins` list should be empty. Do not add `*` in the Azure
portal; the application already emits the wildcard header.

## 9. Publish the code

From the repository root:

```powershell
func azure functionapp publish $functionAppName
```

Core Tools publishes the project files to the existing Function App. It does not
upload `local.settings.json` unless explicitly asked, which is why this runbook
sets production settings separately.

The publish output must discover these functions:

```text
getLeaders            GET           /api/leaders
recordAnalyticsEvent  POST,OPTIONS  /api/events
submitScore           POST,OPTIONS  /api/submit
```

## 10. Verify the live deployment

Build the base URL:

```powershell
$baseUrl = "https://$functionAppName.azurewebsites.net"
```

Check the leaderboard route:

```powershell
Invoke-RestMethod "$baseUrl/api/leaders"
```

Send one analytics event with fresh UUIDv4 values and a millisecond UTC
timestamp:

```powershell
$testEvent = @{
  eventName = "deployment_test"
  occurredAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  sessionId = [guid]::NewGuid().ToString()
  runId = [guid]::NewGuid().ToString()
  gameVersion = "deployment-test"
  platform = "local"
  deviceClass = "desktop"
  language = "en"
  properties = @{ source = "azure-smoke-test" }
} | ConvertTo-Json -Depth 5

$response = Invoke-WebRequest -Method Post -Uri "$baseUrl/api/events" -ContentType "application/json" -Body $testEvent
$response.StatusCode
$response.Headers["Access-Control-Allow-Origin"]
```

Expected values are `204` and `*`.

Verify the database row with the admin or another read-only operational account:

```sql
SELECT id, event_name, occurred_at, received_at, platform, device_class, language, properties
FROM analytics_events
WHERE event_name = 'deployment_test'
ORDER BY id DESC
LIMIT 5;
```

Verify Application Insights from the Function App's **Application Insights ->
Logs** page:

```kusto
traces
| where message startswith "analytics_event"
| order by timestamp desc
| take 20
```

The successful smoke test should produce a `status=204` trace without its request
body.

## 11. Optional leaderboard write test

This creates real Table Storage data:

```powershell
$score = @{ name = "DEPLOY_TEST"; score = 1 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/submit" -ContentType "application/json" -Body $score
Invoke-RestMethod "$baseUrl/api/leaders"
```

Delete the `DEPLOY_TEST` entity afterward using Azure Storage Explorer or the
storage account's Table browser. Do not leave deployment-test scores in the
production leaderboard.

## 12. Common failures

- `/api/events` returns `500`: verify `ANALYTICS_DATABASE_URL`, the PostgreSQL
  firewall, writer password, table existence, and writer grants. The Function log
  category should be `database_failure`; secrets are intentionally not logged.
- `/api/submit` or `/api/leaders` returns `500`: verify `SCORES_STORAGE_ACCOUNT`,
  the `scores` table, the Function managed identity, and its `Storage Table Data
  Contributor` assignment. Wait several minutes after creating the assignment.
- Browser preflight fails: confirm Azure platform CORS has an empty origin list
  and the `OPTIONS` response contains `Access-Control-Allow-Origin: *`.
- No functions appear after publishing: confirm Node.js 22, Function runtime 4,
  `FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR=true`, and inspect startup logs.
- PostgreSQL setup from your computer times out: update the temporary client-IP
  firewall rule. Remove obsolete client-IP rules after setup.

## 13. Subsequent deployments

For code-only updates:

```powershell
npm ci
npm test
func azure functionapp publish $functionAppName
```

Do not rerun resource creation. Apply reviewed database changes separately before
publishing code that depends on them, then repeat the live verification steps.

## Official references

- [Create a Flex Consumption Function App](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to)
- [Publish with Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local#publish)
- [Configure Function App settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-use-azure-function-app-settings)
- [Azure PostgreSQL Flexible Server CLI quickstart](https://learn.microsoft.com/en-us/azure/postgresql/connectivity/connect-azure-cli)
- [Configure verified TLS for Azure PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect)
- [Assign Azure roles for Table data](https://learn.microsoft.com/en-us/azure/storage/tables/assign-azure-role-data-access)
