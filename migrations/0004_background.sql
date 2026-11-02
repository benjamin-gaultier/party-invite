-- Background picture per event, chosen by the host. Small (resized in the
-- browser), so it lives in D1 instead of needing an R2 bucket.
CREATE TABLE event_backgrounds (
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  data        BLOB NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 0 = no background. Bumped on every change so browsers fetch the new image.
ALTER TABLE events ADD COLUMN background_version INTEGER NOT NULL DEFAULT 0;
