-- The host can pin one comment to the top of the wall; authors can edit their comments.
ALTER TABLE events ADD COLUMN pinned_comment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE comments ADD COLUMN edited_at TEXT NOT NULL DEFAULT '';
