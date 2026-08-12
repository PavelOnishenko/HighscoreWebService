# Neon Void analytics event contract

`POST /api/events` accepts one JSON event and returns `204` after one PostgreSQL insert. The maximum request is 8 KiB; `context` is limited to 1 KiB and `properties` to 4 KiB. Unknown fields are rejected.

Common fields:

- `eventName`: one event listed below.
- `occurredAt`: a UTC ISO timestamp no more than 24 hours old or 5 minutes ahead.
- `sessionId`: UUIDv4. `runId`: UUIDv4 or `null`, but required for tutorial, run, wave, gameplay, tower, energy, and ad events.
- `gameVersion`: 1-32 characters matching letters, numbers, `.`, `_`, `+`, or `-`.
- `platform`: `crazygames` or `local`.
- `context`: optional `deviceClass` (`desktop`, `mobile`, `tablet`), `language` (short locale), and `isMuted` (boolean).

Property names without `?` are required. Numeric ranges are inclusive: durations `0..86400000`, waves `1..100000`, counts `0..1000000`, amounts/scores `0..1000000000`, tower levels `1..6`.

| Event | Properties |
|---|---|
| `session_start` | none |
| `load_complete` | `durationMs`, `assetsLoaded?` |
| `first_interaction` | `inputType` (`pointer`, `touch`, `keyboard`), `elapsedMs` |
| `tutorial_start` | `tutorialVersion` (`1..100`) |
| `tutorial_step_complete` | `stepId`, `durationMs` |
| `tutorial_skip` | `stepId`, `elapsedMs` |
| `tutorial_complete` | `durationMs`, `livesLost?` |
| `run_start` | `mode` (`standard`, `endless`) |
| `wave_start` | `wave`, `enemyCount`, `energy`, `lives` |
| `wave_complete` | `wave`, `durationMs`, `livesRemaining`, `energyRemaining`, `leaks?`, `damageTaken?`, `enemiesKilled?` |
| `wave_fail` | `wave`, `reason` (`base_destroyed`, `quit`, `restart`, `runtime_error`), `durationMs`, `enemyType?` (`swarm`, `tank`, `other`), `livesBefore?` |
| `run_end` | `finalWave`, `score`, `durationMs`, `towers`, `reason` (`defeat`, `victory`, `restart`, `quit`, `runtime_error`) |
| `gameplay_start` | `reason` (`initial_start`, `resume`, `ad_finished`, `restart`) |
| `gameplay_stop` | `reason` (`pause`, `menu`, `game_over`, `blocking_screen`, `ad`) |
| `tower_place` | `wave`, `towerColor`, `towerLevel`, `cost`, `energyRemaining` |
| `tower_merge` | `wave`, `inputLevel`, `resultLevel`, `towerColor`, `cost`, `energyRemaining?` |
| `tower_color_switch` | `wave`, `fromColor`, `toColor`, `cost`, `energyRemaining`, `duringWave` |
| `energy_blocked_action` | `action` (`tower_place`, `tower_merge`, `tower_color_switch`, `tower_upgrade`), `requiredEnergy`, `currentEnergy` |
| `ad_started` | `adType` (`midgame`, `rewarded`), `reason` (`wave_milestone`, `reward_offer`, `manual`) |
| `ad_finished` | same as `ad_started`, plus `completed` boolean |
| `ad_error` | same type/reason, plus `errorCategory` (`sdk_unavailable`, `request_rejected`, `timeout`, `provider_error`, `unknown`) |
| `runtime_error` | `category` (`uncaught_exception`, `unhandled_rejection`, `asset`, `render`, `game_state`, `unknown`), 16-64 hex-character `messageHash`, `gameState` (`loading`, `menu`, `gameplay`, `paused`, `ad`, `game_over`, `unknown`) |

Tower colors are `red`, `blue`, or `green`. Tutorial `stepId` is one of the IDs in Neon Void's current `gameConfig.ts`; the backend list lives in `src/analytics/eventSchemas.js` and is authoritative.
