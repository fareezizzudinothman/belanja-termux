-- 005: monthly entries
-- One row per (user_id, year, month). UNIQUE constraint guarantees there is
-- never a duplicate month for the same user. Status drives the read-only rule:
--   OPEN   -> editable variable expenses, live recurring definitions
--   CLOSED -> frozen (snapshot) recurring values, variables read-only

CREATE TABLE IF NOT EXISTS belanja.monthly_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES belanja.users(id) ON DELETE CASCADE,
  year        int         NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month       int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  status      text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_entries_unique UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_entries_user
  ON belanja.monthly_entries (user_id, year, month);

DROP TRIGGER IF EXISTS trg_monthly_entries_updated_at ON belanja.monthly_entries;
CREATE TRIGGER trg_monthly_entries_updated_at
  BEFORE UPDATE ON belanja.monthly_entries
  FOR EACH ROW EXECUTE FUNCTION belanja.set_updated_at();