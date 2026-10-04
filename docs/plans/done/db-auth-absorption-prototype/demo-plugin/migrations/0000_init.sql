CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  body text NOT NULL
);
