-- When a host merges a duplicate guest into the original, the duplicate's token
-- keeps working and now opens the original guest. Without this, the person's other
-- phone/browser would land on the name screen again and re-create the duplicate.
CREATE TABLE guest_aliases (
  token_hash  TEXT PRIMARY KEY,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_guest_aliases_guest ON guest_aliases(guest_id);
