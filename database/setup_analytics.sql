CREATE TABLE IF NOT EXISTS analytics_events (
    id bigserial PRIMARY KEY,
    event_name varchar(64) NOT NULL,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    session_id uuid NOT NULL,
    run_id uuid NOT NULL,
    game_version varchar(32) NOT NULL,
    platform varchar(16) NOT NULL,
    device_class varchar(16) NOT NULL,
    language varchar(16) NOT NULL,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS analytics_events_event_time_idx ON analytics_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_time_idx ON analytics_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_run_time_idx ON analytics_events (run_id, occurred_at);

