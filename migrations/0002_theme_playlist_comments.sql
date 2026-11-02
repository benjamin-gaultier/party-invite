-- Event theme / dress code and a shared playlist (e.g. a collaborative Spotify
-- playlist) with a short prompt for guests.
ALTER TABLE events ADD COLUMN theme         TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN playlist_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN playlist_note TEXT NOT NULL DEFAULT '';

-- Comment wall: any guest can post, the author or the host can delete.
CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_event ON comments(event_id, created_at);
