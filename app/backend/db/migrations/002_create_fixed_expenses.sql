-- 002: fixed expenses
-- Recurring-master definitions. Editing these later NEVER rewrites closed
-- monthly records because closing materializes snapshots (monthly_fixed_expenses).

CREATE TABLE IF NOT EXISTS belanja.fixed_expenses (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid           NOT NULL REFERENCES belanja.users(id) ON DELETE CASCADE,
  name        text           NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  type        text           NOT NULL CHECK (type IN
                ('bank','shopee_paylater','tiktok_paylater','credit_card',
                 'bill','property','vehicle','hutang_orang','others')),
  amount      numeric(12,2)  NOT NULL CHECK (amount >= 0 AND amount <= 9999999999.99),
  remarks     text,
  active      boolean        NOT NULL DEFAULT true,
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_expenses_user
  ON belanja.fixed_expenses (user_id);

-- Partial index for the most common lookup: active recurring masters of a user.
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_user_active
  ON belanja.fixed_expenses (user_id) WHERE active;

DROP TRIGGER IF EXISTS trg_fixed_expenses_updated_at ON belanja.fixed_expenses;
CREATE TRIGGER trg_fixed_expenses_updated_at
  BEFORE UPDATE ON belanja.fixed_expenses
  FOR EACH ROW EXECUTE FUNCTION belanja.set_updated_at();