-- Likes become emoji reactions (one per guest per comment, like WhatsApp).
-- Existing likes keep showing as a heart.
ALTER TABLE comment_likes ADD COLUMN emoji TEXT NOT NULL DEFAULT '❤️';
