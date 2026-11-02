-- Host's Spotify connection per event, so guests can add songs from the app
-- without a Spotify account. Tokens belong to the host's Spotify account.
CREATE TABLE spotify_links (
  event_id      TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  guest_id      TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE, -- host who connected
  playlist_id   TEXT NOT NULL,
  account_name  TEXT NOT NULL DEFAULT '',
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL, -- unix seconds
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short-lived OAuth "state" values while the host is on Spotify's consent page.
CREATE TABLE spotify_states (
  state       TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL -- unix seconds
);

-- Songs guests added through the app (who added what).
CREATE TABLE song_adds (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  artists     TEXT NOT NULL,
  image       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, track_id)
);

CREATE INDEX idx_song_adds_event ON song_adds(event_id, created_at);
