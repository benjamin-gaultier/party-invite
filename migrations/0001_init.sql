-- Events: one row per party. `id` is the unguessable slug used in the share link.
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL,            -- YYYY-MM-DD, local to the event
  time        TEXT NOT NULL DEFAULT '', -- HH:MM, local to the event
  address     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Guests: no accounts. Each guest gets a random token (stored hashed) that the
-- browser keeps, so returning to the link skips the name step. The host is a
-- guest with is_host = 1. Later features (chat, checklist, songs) reference guests.id.
CREATE TABLE guests (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  is_host     INTEGER NOT NULL DEFAULT 0,
  rsvp        TEXT CHECK (rsvp IN ('going', 'maybe', 'not_going')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_guests_event ON guests(event_id);
