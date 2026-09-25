-- 004: installments / loans
-- remaining_months is a STORED generated column =
--     total_months - paid_months
-- so it can never drift from the input values.

CREATE TABLE IF NOT EXISTS belanja.installments (
  id                   uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid           NOT NULL REFERENCES belanja.users(id) ON DELETE CASCADE,
  loan_name            text           NOT NULL CHECK (char_length(btrim(loan_name)) BETWEEN 1 AND 150),
  type                 text           NOT NULL CHECK (type IN
                         ('bank','shopee_paylater','tiktok_paylater','credit_card',
                          'bill','property','vehicle','hutang_orang','others')),
  amount               numeric(12,2)  NOT NULL CHECK (amount >= 0 AND amount <= 9999999999.99),
  total_months         int            NOT NULL CHECK (total_months BETWEEN 1 AND 600),
  paid_months          int            NOT NULL DEFAULT 0 CHECK (paid_months BETWEEN 0 AND 600),
  remaining_months     int            GENERATED ALWAYS AS (total_months - paid_months) STORED,
  monthly_installment  numeric(12,2)  NOT NULL CHECK (monthly_installment > 0 AND monthly_installment <= 9999999999.99),
  start_date           date           CHECK (start_date IS NULL OR start_date BETWEEN '2000-01-01' AND '2100-12-31'),
  end_date             date           CHECK (end_date IS NULL OR end_date BETWEEN '2000-01-01' AND '2100-12-31'),
  remarks              text,
  active               boolean        NOT NULL DEFAULT true,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT installments_paid_ok   CHECK (paid_months <= total_months),
  CONSTRAINT installments_dates_ok  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_installments_user
  ON belanja.installments (user_id);

CREATE INDEX IF NOT EXISTS idx_installments_user_active
  ON belanja.installments (user_id) WHERE active;

DROP TRIGGER IF EXISTS trg_installments_updated_at ON belanja.installments;
CREATE TRIGGER trg_installments_updated_at
  BEFORE UPDATE ON belanja.installments
  FOR EACH ROW EXECUTE FUNCTION belanja.set_updated_at();