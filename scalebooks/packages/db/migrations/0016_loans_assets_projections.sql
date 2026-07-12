-- ════════════════════════════════════════════════════════════════════════════
-- Loans, Fixed Assets, Weekly Projections & Credit Lines (Phase 6).
-- ════════════════════════════════════════════════════════════════════════════
-- The last Firestore domains move to Postgres:
--   • loans / loan_payments — the loan registry (formerly one big array inside
--     the finc/profile doc) becomes real rows; payment allocations ride as
--     UI-owned jsonb. The amortization engine (loanMonitoring.js) stays
--     client-side, fed from these tables.
--   • fixed_assets / asset_types / asset_installment_payments /
--     asset_depr_postings — asset registry + financing; depreciation posts a
--     journal entry and the per-month posting lock is UNIQUE (org, period).
--   • weekly_projections — weekly cash plans (WP numbers); disbursement and
--     inflow lines ride as jsonb the UI owns.
--   • credit_lines — bank credit-line utilization records for the Bank screen.
-- Money is integer centavos in typed columns (pesos inside jsonb snapshots);
-- rates are numeric percentages.

CREATE TABLE IF NOT EXISTS loans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               text NOT NULL,               -- lender
  loan_type          text NOT NULL DEFAULT 'Term Loan',
  disbursement_date  date,                        -- UI: "First Payment Date" (schedule anchor)
  proceeds_date      date,
  term_months        integer NOT NULL DEFAULT 60,
  annual_rate        numeric(9,4) NOT NULL DEFAULT 0,
  principal_cents    bigint NOT NULL DEFAULT 0,
  interest_method    text NOT NULL DEFAULT 'Reducing Balance',
  processing_fee_cents bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'Active',   -- Active | Disposed
  payment_frequency  text NOT NULL DEFAULT 'Monthly',  -- Monthly | Semi-Monthly
  pay_day_mode       text NOT NULL DEFAULT 'Fixed',    -- Fixed | Variable per Month | Every N Days
  pay_day1           integer,
  pay_day2           integer,
  pay_days_per_month jsonb,                       -- { 'YYYY-MM': { d1, d2 } }
  interval_days      integer NOT NULL DEFAULT 15,
  payment_method     text,
  pm_config          jsonb,                       -- checkbook/check-queue/BT/ADA details (UI-owned)
  created_by         text REFERENCES app_users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  loan_id           uuid REFERENCES loans(id) ON DELETE SET NULL,
  loan_name         text,
  pay_date          date NOT NULL,
  interest_cents    bigint NOT NULL DEFAULT 0,
  principal_cents   bigint NOT NULL DEFAULT 0,
  penalty_cents     bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  method            text,
  reference_no      text,
  bank              text,
  voucher_no        text,        -- consumed LV's human number
  voucher_doc_id    uuid,        -- consumed LV's row id (soft link)
  check_voucher_no  text,        -- linked CV's human number
  notes             text,
  allocations       jsonb,       -- [{ period, interest, principal, penalty }] in pesos (UI-owned)
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_payments_org_loan_idx ON loan_payments (org_id, loan_id);

CREATE TABLE IF NOT EXISTS asset_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_no               text,                     -- FAT-### (client-assigned, display only)
  name                  text NOT NULL,
  depreciation_method   text NOT NULL DEFAULT 'Straight Line',
  useful_life_months    integer,
  fixed_asset_account   text,
  accum_deprec_account  text,
  deprec_expense_account text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_no                        text NOT NULL,  -- FA-### (client-assigned max+1, unique per org)
  name                            text NOT NULL,
  asset_type                      text,           -- asset_types.name (loose, as the portal keys it)
  purchase_date                   date,
  deprec_start_date               date,
  cost_cents                      bigint NOT NULL DEFAULT 0,
  residual_cents                  bigint NOT NULL DEFAULT 0,
  useful_life_months              integer NOT NULL DEFAULT 0,
  depreciation_method             text NOT NULL DEFAULT 'Straight Line',
  computation_type                text NOT NULL DEFAULT 'Non Pro Rata',
  fixed_asset_account             text,
  accum_deprec_account            text,
  deprec_expense_account          text,
  status                          text NOT NULL DEFAULT 'Active',  -- Active | Disposed
  disposal_date                   date,
  notes                           text,
  is_installment                  boolean NOT NULL DEFAULT false,
  installment_principal_cents     bigint NOT NULL DEFAULT 0,
  installment_start_date          date,
  installment_term_months         integer NOT NULL DEFAULT 0,
  installment_annual_rate         numeric(9,4) NOT NULL DEFAULT 0,
  installment_method              text NOT NULL DEFAULT 'Reducing Balance',
  installment_payable_account     text,
  installment_amortization_account text,
  payment_method                  text,
  pm_config                       jsonb,          -- pmChecks / ADA / BT / auto-voucher (UI-owned)
  created_by                      text REFERENCES app_users(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, asset_no)
);

CREATE TABLE IF NOT EXISTS asset_installment_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id          uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,
  asset_name        text,
  period            integer NOT NULL,             -- 1-based installment period
  label             text,                         -- 'Mar-2026'
  pay_date          date NOT NULL,
  principal_cents   bigint NOT NULL DEFAULT 0,
  interest_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  method            text,
  bank              text,
  check_id          text,
  check_number      text,
  check_register_id text,
  voucher_no        text,
  voucher_doc_id    uuid,
  notes             text,
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_installment_payments_org_asset_idx
  ON asset_installment_payments (org_id, asset_id);

CREATE TABLE IF NOT EXISTS asset_depr_postings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period           text NOT NULL,                 -- 'YYYY-MM'; one posting per month
  journal_entry_id uuid,                          -- the depreciation JE (soft link)
  total_cents      bigint NOT NULL DEFAULT 0,
  asset_count      integer NOT NULL DEFAULT 0,
  created_by       text REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period)
);

CREATE TABLE IF NOT EXISTS weekly_projections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proj_no         text NOT NULL,                  -- WP{YYYYMM}-#### (server-assigned)
  week_coverage   text,
  start_date      date,
  end_date        date,
  status          text NOT NULL DEFAULT 'Draft',
  total_out_cents bigint NOT NULL DEFAULT 0,      -- Σ lines[].amount, denormalized like the portal
  total_in_cents  bigint NOT NULL DEFAULT 0,      -- Σ inflowLines[].amount
  notes           text,
  lines           jsonb,                          -- disbursement lines (UI-owned, pesos)
  inflow_lines    jsonb,                          -- expected inflows (UI-owned, pesos)
  created_by      text REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proj_no)
);

CREATE TABLE IF NOT EXISTS credit_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code               text,
  display_name            text NOT NULL,
  credit_limit_cents      bigint NOT NULL DEFAULT 0,
  interest_rate           numeric(9,4) NOT NULL DEFAULT 0,   -- % per month
  available_balance_cents bigint NOT NULL DEFAULT 0,
  as_of_date              date,
  notes                   text,
  created_by              text REFERENCES app_users(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Org-scoped RLS + app-role grants for every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loans','loan_payments','asset_types','fixed_assets',
                           'asset_installment_payments','asset_depr_postings',
                           'weekly_projections','credit_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sentire_books_app', t);
  END LOOP;
END $$;
