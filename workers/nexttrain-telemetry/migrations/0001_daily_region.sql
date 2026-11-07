-- One row per reporting device per Johannesburg day.
-- A region change updates the row. It does not create a second device.
CREATE TABLE IF NOT EXISTS daily_region (
  day TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('GP', 'WC', 'KZN', 'EC')),
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (day, device_hash)
);

CREATE INDEX IF NOT EXISTS daily_region_day_region ON daily_region (day, region);
