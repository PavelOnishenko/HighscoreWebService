[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'analytics-query.config.json'),
  [string]$EventName,
  [guid]$SessionId,
  [guid]$RunId,
  [datetime]$Since,
  [ValidateRange(1, 1000)][int]$Limit = 20
)

$ErrorActionPreference = 'Stop'

if (!(Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "Analytics query config was not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$requiredSettings = 'server', 'database', 'user', 'port', 'rootCertificate', 'psqlPath', 'azureResourceGroup', 'azurePostgresServer', 'firewallRuleName', 'publicIpEndpoint'
foreach ($setting in $requiredSettings) {
  if (!$config.$setting) {
    throw "Analytics query config is missing '$setting'."
  }
}

$psqlPath = [Environment]::ExpandEnvironmentVariables($config.psqlPath)
$rootCertificate = [Environment]::ExpandEnvironmentVariables($config.rootCertificate)
if (!(Test-Path -LiteralPath $psqlPath -PathType Leaf)) {
  throw "psql was not found: $psqlPath"
}
if (!(Test-Path -LiteralPath $rootCertificate -PathType Leaf)) {
  throw "TLS root certificate bundle was not found: $rootCertificate"
}
if (!(Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI was not found on PATH.'
}

& az account show --output none
if ($LASTEXITCODE -ne 0) {
  throw 'Azure CLI is not signed in. Run az login and retry.'
}

$publicIp = ([string](Invoke-RestMethod -Uri $config.publicIpEndpoint -TimeoutSec 10)).Trim()
$parsedIp = $null
if (![Net.IPAddress]::TryParse($publicIp, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw "Public IP lookup returned an invalid IPv4 address: $publicIp"
}

$firewallArguments = @('--resource-group', $config.azureResourceGroup, '--server-name', $config.azurePostgresServer, '--name', $config.firewallRuleName)
& az postgres flexible-server firewall-rule show @firewallArguments --output none 2>$null
if ($LASTEXITCODE -eq 0) {
  & az postgres flexible-server firewall-rule update @firewallArguments --start-ip-address $publicIp --end-ip-address $publicIp --output none
} else {
  & az postgres flexible-server firewall-rule create @firewallArguments --start-ip-address $publicIp --end-ip-address $publicIp --output none
}
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to synchronize the Azure PostgreSQL firewall rule.'
}
Write-Host "Azure firewall rule '$($config.firewallRuleName)' now allows $publicIp."

$securePassword = Read-Host "PostgreSQL password for $($config.user)" -AsSecureString
$credential = [pscredential]::new($config.user, $securePassword)
$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$previousRootCertificate = $env:PGSSLROOTCERT
$eventNameValue = if ($EventName) { $EventName } else { '' }
$sessionIdValue = if ($PSBoundParameters.ContainsKey('SessionId')) { $SessionId.ToString() } else { '' }
$runIdValue = if ($PSBoundParameters.ContainsKey('RunId')) { $RunId.ToString() } else { '' }
$sinceValue = if ($PSBoundParameters.ContainsKey('Since')) { $Since.ToUniversalTime().ToString('o') } else { '' }

$query = @'
SELECT id, event_name, occurred_at, received_at, session_id, run_id,
       game_version, platform, device_class, language, properties
FROM analytics_events
WHERE (NULLIF(:'event_name', '') IS NULL OR event_name = :'event_name')
  AND (NULLIF(:'session_id', '') IS NULL OR session_id = NULLIF(:'session_id', '')::uuid)
  AND (NULLIF(:'run_id', '') IS NULL OR run_id = NULLIF(:'run_id', '')::uuid)
  AND (NULLIF(:'since', '') IS NULL OR occurred_at >= NULLIF(:'since', '')::timestamptz)
ORDER BY occurred_at DESC
LIMIT :limit;
'@

$psqlArguments = @(
  "--host=$($config.server)", "--port=$($config.port)", "--dbname=$($config.database)", "--username=$($config.user)",
  '--no-psqlrc', '--set=ON_ERROR_STOP=1', "--set=event_name=$eventNameValue", "--set=session_id=$sessionIdValue",
  "--set=run_id=$runIdValue", "--set=since=$sinceValue", "--set=limit=$Limit"
)

try {
  $env:PGPASSWORD = $credential.GetNetworkCredential().Password
  $env:PGSSLMODE = 'verify-full'
  $env:PGSSLROOTCERT = (Resolve-Path -LiteralPath $rootCertificate).Path
  $query | & $psqlPath $psqlArguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql exited with code $LASTEXITCODE."
  }
} finally {
  $env:PGPASSWORD = $previousPassword
  $env:PGSSLMODE = $previousSslMode
  $env:PGSSLROOTCERT = $previousRootCertificate
  $credential = $null
  $securePassword = $null
}
