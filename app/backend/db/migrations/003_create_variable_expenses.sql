-- 003: variable expenses
-- Actual, one-time transactions. Each row belongs to a month derived from
-- expense_date via STORED generated columns (year + month), which keeps the
-- year/month values consistent with expense_date forever.

CREATE TABLE IF NOT EXISTS belanja.variable_expenses (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid           NOT NULL REFERENCES belanja.users(id) ON DELETE CASCADE,
  name          text           NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  type          text           NOT NULL CHECK (type IN
                  ('food','groceries','parent','toll','fuel','others')),
  amount        numeric(12,2)  NOT NULL CHECK (amount >= 0 AND amount <= 9999999999.99),
  expense_date  date           NOT NULL CHECK (expense_date BETWEEN '2000-01-01' AND '2100-12-31'),
  year          int            GENERATED ALWAYS AS (extract(year FROM expense_date)) STORED,
  month         int            GENERATED ALWAYS AS (extract(month FROM expense_date)) STORED,
  remarks       text,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  updated_at    timestamptz    NOT NULL DEFAULT now()
);

-- Fast lookups by month (monthly entry page, dashboard series).
CREATE INDEX IF NOT EXISTS idx_variable_expenses_user_month
  ON belanja.variable_expenses (user_id, year, month);

DROP TRIGGER IF EXISTS trg_variable_expenses_updated_at ON belanja.variable_expenses;
CREATE TRIGGER trg_variable_expenses_updated_at
  BEFORE UPDATE ON belanja.variable_expenses
  FOR EACH ROW EXECUTE FUNCTION belanja.set_updated_at();