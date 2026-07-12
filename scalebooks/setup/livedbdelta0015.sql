-- ════════════════════════════════════════════════════════════════════════════
-- Billing / Accounts Receivable (Phase 3).
-- ════════════════════════════════════════════════════════════════════════════
-- Five portal domains move off Firestore:
--   • billing_statements — client statements (BS numbers, Draft→…→Paid flow)
--   • service_invoices   — single-amount invoice headers (IS numbers)
--   • collections        — customer payments received (COL numbers,
--                          Unposted→Posted/Voided)
--   • payment_schedules  — recurring/one-time payment obligations (PS numbers);
--                          payment-method details ride as UI-owned jsonb
--   • schedule_payments  — recorded payments against a schedule occurrence,
--                          soft-linked to the voucher/check they produced
-- Money is integer centavos; balances are Postgres-computed (GENERATED) so the
-- "net due − applied" math can't drift from the stored parts. Rates are numeric
-- percentages. Status vocabularies are the portal's own (text, not enums) —
-- the screens gate transitions today; server-side RBAC comes later.

CREATE TABLE IF NOT EXISTS billing_statements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bs_no                     text NOT NULL,
  contact_id                uuid REFERENCES contacts(id),
  contact_name              text NOT NULL,
  billing_date              date NOT NULL,
  due_date                  date,
  credit_term               integer NOT NULL DEFAULT 30,
  period_start              date,
  period_end                date,
  description               text,
  gross_cents               bigint NOT NULL DEFAULT 0,
  tax_group_name            text NOT NULL DEFAULT 'VAT',
  total_vat_inclusive_cents bigint NOT NULL DEFAULT 0,
  net_due_cents             bigint NOT NULL DEFAULT 0,
  applied_cents             bigint NOT NULL DEFAULT 0,
  balance_cents             bigint GENERATED ALWAYS AS (net_due_cents - applied_cents) STORED,
  income_account            text,
  lines                     jsonb,
  notes                     text,
  status                    text NOT NULL DEFAULT 'Draft',
  reviewed_by               text,
  approved_by               text,
  reject_reason             text,
  created_by                text REFERENCES app_users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bs_no)
);
CREATE INDEX IF NOT EXISTS billing_statements_org_date_idx
  ON billing_statements (org_id, billing_date DESC);

CREATE TABLE IF NOT EXISTS service_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  si_no                text NOT NULL,
  contact_id           uuid REFERENCES contacts(id),
  contact_name         text NOT NULL,
  si_date              date NOT NULL,
  due_date             date,
  amount_cents         bigint NOT NULL DEFAULT 0,
  tax_type             text NOT NULL DEFAULT 'N/A',
  ewt_rate             numeric(9,4) NOT NULL DEFAULT 0,
  income_account_code  text,
  billing_statement_id text,        -- soft link: BS number or id, as the portal stores it
  applied_cents        bigint NOT NULL DEFAULT 0,
  balance_cents        bigint GENERATED ALWAYS AS (amount_cents - applied_cents) STORED,
  notes                text,
  status               text NOT NULL DEFAULT 'Draft',
  reviewed_by          text,
  approved_by          text,
  reject_reason        text,
  created_by           text REFERENCES app_users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, si_no)
);
CREATE INDEX IF NOT EXISTS service_invoices_org_date_idx
  ON service_invoices (org_id, si_date DESC);

CREATE TABLE IF NOT EXISTS collections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_no         text NOT NULL,
  contact_id            uuid REFERENCES contacts(id),
  contact_name          text NOT NULL,
  collection_date       date NOT NULL,
  amount_received_cents bigint NOT NULL DEFAULT 0,
  applied_cents         bigint NOT NULL DEFAULT 0,
  unapplied_cents       bigint GENERATED ALWAYS AS (amount_received_cents - applied_cents) STORED,
  method                text NOT NULL DEFAULT 'Cash',
  reference_no          text,
  billing_statement_id  text,       -- soft links, same convention as service_invoices
  si_id                 text,
  notes                 text,
  status                text NOT NULL DEFAULT 'Unposted',
  posted_by             text,
  posted_at             timestamptz,
  created_by            text REFERENCES app_users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, collection_no)
);
CREATE INDEX IF NOT EXISTS collections_org_date_idx
  ON collections (org_id, collection_date DESC);

CREATE TABLE IF NOT EXISTS payment_schedules (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_no                  text NOT NULL,
  title                        text NOT NULL,
  contact_id                   uuid REFERENCES contacts(id),
  contact_name                 text,
  category                     text,
  frequency                    text NOT NULL DEFAULT 'Monthly',
  amount_cents                 bigint NOT NULL DEFAULT 0,
  due_date                     date,
  start_date                   date,
  end_date                     date,
  due_day                      integer NOT NULL DEFAULT 0,
  status                       text NOT NULL DEFAULT 'Active',
  notes                        text,
  default_expense_account_code text,
  default_tax_rate_id          text, -- taxRates.id OR taxGroups.id (the portal treats them as a union)
  payment_method               text,
  pm_config                    jsonb, -- bank-transfer / auto-debit / check-queue details (UI-owned)
  created_by                   text REFERENCES app_users(id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, schedule_no)
);

CREATE TABLE IF NOT EXISTS schedule_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id       uuid REFERENCES payment_schedules(id) ON DELETE SET NULL,
  schedule_title    text,
  due_date          date,
  pay_date          date NOT NULL,
  amount_cents      bigint NOT NULL DEFAULT 0,
  method            text,
  bank              text,
  check_id          text,
  check_number      text,
  check_register_id text,
  voucher_no        text,
  voucher_doc_id    uuid,             -- soft link to vouchers.id (no FK: drafts are deletable)
  notes             text,
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_payments_org_schedule_idx
  ON schedule_payments (org_id, schedule_id);

-- Org-scoped RLS + app-role grants for every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_statements','service_invoices','collections',
                           'payment_schedules','schedule_payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sentire_books_app', t);
  END LOOP;
END $$;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: all five columns non-null (each shows its table name).
SELECT
  to_regclass('public.billing_statements') AS billing_statements_ok,
  to_regclass('public.service_invoices')   AS service_invoices_ok,
  to_regclass('public.collections')        AS collections_ok,
  to_regclass('public.payment_schedules')  AS payment_schedules_ok,
  to_regclass('public.schedule_payments')  AS schedule_payments_ok;
