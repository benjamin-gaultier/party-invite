-- Plus-ones: a guest can say who comes with them. JSON array of names, one entry per
-- companion; "" means a companion without a name ("+1"). Only counted while the guest
-- answered going or maybe.
ALTER TABLE guests ADD COLUMN plus_ones TEXT NOT NULL DEFAULT '[]';
-- How many companions each guest may bring: 0 = none allowed. 10 is the app's "no limit".
ALTER TABLE events ADD COLUMN plus_ones_max INTEGER NOT NULL DEFAULT 10;
