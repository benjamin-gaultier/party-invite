-- Event photo album. The image files live in R2 (binding PHOTOS) under
-- "<event id>/<photo id>" and "<event id>/<photo id>.thumb"; this table says who
-- posted what. Rows go with their event or guest (cascade); the Worker deletes the files.
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_photos_event ON photos(event_id, created_at);

-- 1 = guests can add photos only from the day of the party (hosts always can).
ALTER TABLE events ADD COLUMN photos_party_day INTEGER NOT NULL DEFAULT 0;
