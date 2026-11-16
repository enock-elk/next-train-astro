-- Last good Live Telemetry reply. A later open returns this before Google answers.
CREATE TABLE IF NOT EXISTS telemetry_snapshot (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
