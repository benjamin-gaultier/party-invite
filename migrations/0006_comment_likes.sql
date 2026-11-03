-- Likes on comments: one per guest per comment. Powers the ❤️ button and the
-- "X liked your comment" alerts. Deleting a comment or a guest removes their likes.
CREATE TABLE comment_likes (
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, guest_id)
);
