-- Color scheme picked by the host ('' = default violet). One of COLORS in src/index.ts.
ALTER TABLE events ADD COLUMN color TEXT NOT NULL DEFAULT '';
