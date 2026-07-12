-- ════════════════════════════════════════════════════════════════════════════
-- Tax subsystem + Bank management (Phases 4 & 5).
-- ════════════════════════════════════════════════════════════════════════════
-- tax_rates/tax_groups feed the per-line tax pickers on vouchers, contacts and
-- check vouchers; purpose_categories feeds the purpose autocomplete. Bank gets
-- daily balances (which the disbursement report snapshot reads), a manual
-- transaction ledger, and reconciliation records. Rates are percentages
-- (numeric); money is integer centavos.

CREATE TABLE IF NOT EXISTS tax_rates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  rate                  numeric(9,4) NOT NULL DEFAULT 0,
  tracking_type         text NOT NULL DEFAULT 'single',   -- single | separate
  tax_account_single    text,                             -- account codes
  tax_account_sales     text,
  tax_account_purchases text,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            text REFERENCES app_users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS tax_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  rate_names text[] NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT true,
  created_by text REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS purpose_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS daily_bank_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code       text NOT NULL,
  balance_date    date NOT NULL,
  beginning_cents bigint NOT NULL DEFAULT 0,
  ending_cents    bigint NOT NULL DEFAULT 0,
  notes           text,
  created_by      text REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_bank_balances_org_bank_date_idx
  ON daily_bank_balances (org_id, bank_code, balance_date DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code    text NOT NULL,
  tx_date      date NOT NULL,
  description  text,
  reference    text,
  debit_cents  bigint NOT NULL DEFAULT 0,
  credit_cents bigint NOT NULL DEFAULT 0,
  tx_type      text,
  status       text,
  source       text NOT NULL DEFAULT 'Manual',
  created_by   text REFERENCES app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_transactions_org_bank_date_idx
  ON bank_transactions (org_id, bank_code, tx_date DESC);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recon_no        text NOT NULL,
  bank_code       text NOT NULL,
  beginning_cents bigint NOT NULL DEFAULT 0,
  ending_cents    bigint NOT NULL DEFAULT 0,
  period_ending   date,
  cleared_count   integer NOT NULL DEFAULT 0,
  meta            jsonb,
  created_by      text REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, recon_no)
);

-- Org-scoped RLS + app-role grants for every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_rates','tax_groups','purpose_categories',
                           'daily_bank_balances','bank_transactions','bank_reconciliations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sentire_books_app', t);
  END LOOP;
END $$;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: all six columns non-null (each shows its table name).
SELECT
  to_regclass('public.tax_rates')            AS tax_rates_ok,
  to_regclass('public.tax_groups')           AS tax_groups_ok,
  to_regclass('public.purpose_categories')   AS purpose_categories_ok,
  to_regclass('public.daily_bank_balances')  AS daily_bank_balances_ok,
  to_regclass('public.bank_transactions')    AS bank_transactions_ok,
  to_regclass('public.bank_reconciliations') AS bank_reconciliations_ok;
