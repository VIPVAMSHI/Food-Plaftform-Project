-- Restaurant catalog. Plans and favorites are added in a later migration.
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cuisine TEXT NOT NULL,
  price TEXT NOT NULL CHECK (price IN ('$', '$$', '$$$', '$$$$')),
  serving INTEGER NOT NULL,
  neighborhood TEXT NOT NULL,
  address TEXT NOT NULL,
  street TEXT NOT NULL,
  miles REAL NOT NULL,
  wait_minutes INTEGER NOT NULL,
  rating REAL,
  image TEXT NOT NULL,
  note TEXT NOT NULL,
  dishes TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS places_neighborhood_idx ON places (neighborhood);
CREATE INDEX IF NOT EXISTS places_cuisine_idx ON places (cuisine);
