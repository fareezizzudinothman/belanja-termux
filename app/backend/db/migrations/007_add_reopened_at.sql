-- 007: reopen marker + monthly lifecycle normalization
--
-- reopened_at records the LAST time the user explicitly reopened a CLOSED
-- month. The lazy auto-close on API access only closes an OPEN month older
-- than the current month when it was *left open* (reopened_at IS NULL). A month
-- the user deliberately reopened stays open for corrections until they close
-- it again - the next close rebuilds the snapshot fresh.
--
-- No CHECK constraint changes: the monthly_entries schema from 005 already has
-- everything else the lifecycle needs (status OPEN/CLOSED, unique per user +
-- month, closed_at).

ALTER TABLE belanja.monthly_entries
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;