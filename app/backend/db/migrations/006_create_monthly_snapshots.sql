-- 006: historical snapshots
-- frozen_fixed / frozen_installments are populated ONLY when a month is closed.
-- They preserve the recurring amounts as they were at closing time, so that
-- editing/deleting a fixed expense or installment afterwards can never change
-- historical monthly totals.
--
-- The original master row id is kept (SET NULL if later deleted) purely for
-- traceability; name/amount are copies, which is what the math uses.

CREATE TABLE IF NOT EXISTS belanja.monthly_fixed_expenses (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_entry_id uuid           NOT NULL REFERENCES belanja.monthly_entries(id) ON DELETE CASCADE,
  user_id          uuid           NOT NULL REFERENCES belanja.users(id) ON DELETE CASCADE,
  fixed_expense_id uuid           REFERENCES belanja.fixed_expenses(id) ON DELETE SET NULL,
  name             text           NOT NULL,
  type             text           NOT NULL,
  amount           numeric(12,2)  NOT NULL CHECK (amount >= 0),
  remarks          text,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT monthly_fixed_unique UNIQUE (monthly_entry_id, fixed_expense_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_fixed_entry
  ON belanja.monthly_fixed_expenses (monthly_entry_id);

CREATE INDEX IF NOT EXISTS idx_monthly_fixed_user
  ON belanja.monthly_fixed_expenses (user_id);

CREATE TABLE IF NOT EXISTS belanja.monthly_installments (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_entry_id  uuid           NOT NULL REFERENCES belanja.monthly_entries(id) ON DELETE CASCADE,
  user_id           uuid           NOT NULL REFERENCES belanja.users(id) ON DELETE CASCADE,
  installment_id    uuid           REFERENCES belanja.installments(id) ON DELETE SET NULL,
  loan_name         text           NOT NULL,
  type              text           NOT NULL,
  monthly_installment numeric(12,2) NOT NULL CHECK (monthly_installment > 0),
  remarks           text,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT monthly_installments_unique UNIQUE (monthly_entry_id, installment_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_installments_entry
  ON belanja.monthly_installments (monthly_entry_id);

CREATE INDEX IF NOT EXISTS idx_monthly_installments_user
  ON belanja.monthly_installments (user_id);