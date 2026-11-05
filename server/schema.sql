-- Calentimer Telemetry & Real-Time Presence Schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS active_heartbeats (
  client_id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  device_type TEXT,            -- 'mobile-ios', 'mobile-android', 'desktop'
  is_pwa INTEGER DEFAULT 0,    -- 1 if launched as standalone PWA
  active_category TEXT,        -- e.g. 'Study', 'Work', or null
  is_timer_running INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_last_seen ON active_heartbeats(last_seen_at);

CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL,    -- 'session_completed', 'task_finished', 'app_launched'
  payload JSON NOT NULL,       -- Dynamic payload: durationSec, category, hasHardStop, usedTimeBank, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_created ON app_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON app_events(event_type);
