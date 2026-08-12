# Neon Void analytics request contract

`POST /api/events` accepts one JSON event and returns `204` after one
PostgreSQL insert. The backend does not define event names or event-specific
parameters.

The maximum request is 8 KiB and `properties` is limited to 4 KiB.

- `eventName`: any non-empty string up to 64 characters.
- `occurredAt`: UTC ISO timestamp no more than 24 hours old or 5 minutes ahead.
- `sessionId`: UUIDv4.
- `runId`: required UUIDv4 created for the current run.
- `gameVersion`: 1-32 characters matching letters, numbers, `.`, `_`, `+`, or `-`.
- `platform`: `crazygames` or `local`.
- `deviceClass`: required `desktop`, `mobile`, or `tablet`.
- `language`: required short locale, at most 16 characters.
- `properties`: any JSON object, stored unchanged as JSONB.

Unknown top-level fields are rejected. Property names, types, and
values are not inspected. The game client owns event-specific conventions and
must not send personal or sensitive data.
