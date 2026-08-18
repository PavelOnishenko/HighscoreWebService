# Analytics query helper

`query-analytics.ps1` reads the checked-in Azure PostgreSQL connection settings
from `analytics-query.config.json` and prompts securely for only the password.

```powershell
# Newest 20 records
.\scripts\query-analytics.ps1

# Filter by event and UTC date/time
.\scripts\query-analytics.ps1 -EventName "tower_upgrade" -Since "2026-08-18" -Limit 50

# Follow one session or run
.\scripts\query-analytics.ps1 -SessionId "<UUID>"
.\scripts\query-analytics.ps1 -RunId "<UUID>"
```

The script uses the `psql.exe` path and verified Azure PostgreSQL CA bundle
from the config file. Update that file if the server, operational user,
database, port, executable, or certificate location changes.

Before querying, the script obtains the current public IPv4 address from
`https://api.ipify.org` and creates or updates the dedicated
`LocalAnalyticsQuery` Azure PostgreSQL firewall rule. Azure CLI must be signed in.
