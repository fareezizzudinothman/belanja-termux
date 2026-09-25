-- 001: schema, extensions and users
-- Idempotent: safe to run more than once.

CREATE SCHEMA IF NOT EXISTS belanja;

-- pgcrypto is available but gen_random_uuid() is built-in on PG 13+.
-- schema_migrations is created by the runner first; ensure it exists anyway.

CREATE TABLE IF NOT EXISTS belanja.schema_migrations (
  version     text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS belanja.users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  email         text        NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text        NOT NULL CHECK (char_length(password_hash) > 20),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION belanja.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON belanja.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON belanja.users
  FOR EACH ROW EXECUTE FUNCTION belanja.set_updated_at();