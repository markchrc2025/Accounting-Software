-- ════════════════════════════════════════════════════════════════════════════
-- Sentire Books LIVE DB catch-up: migrations 0010 + 0011 ONLY.
-- Run as `owner` on the sentire_books database (pgAdmin). Safe to re-run.
-- Do NOT run the full db-setup.sql on an existing database — it starts from
-- CREATE TYPE and dies on "already exists" (as you saw).
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── 0010_contacts_extend ─────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_no            text,
  ADD COLUMN IF NOT EXISTS display_name          text,
  ADD COLUMN IF NOT EXISTS parent_id             uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS types                 text[],
  ADD COLUMN IF NOT EXISTS cost_center           text,
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS branch                text,
  ADD COLUMN IF NOT EXISTS department            text,
  ADD COLUMN IF NOT EXISTS ar_account_code       text,
  ADD COLUMN IF NOT EXISTS ap_account_code       text,
  ADD COLUMN IF NOT EXISTS payment_terms         text,
  ADD COLUMN IF NOT EXISTS currency              text,
  ADD COLUMN IF NOT EXISTS credit_limit_cents    bigint,
  ADD COLUMN IF NOT EXISTS opening_balance_cents bigint,
  ADD COLUMN IF NOT EXISTS tax_ref               text,
  ADD COLUMN IF NOT EXISTS mobile                text,
  ADD COLUMN IF NOT EXISTS website               text,
  ADD COLUMN IF NOT EXISTS billing_address       jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address      jsonb,
  ADD COLUMN IF NOT EXISTS banks                 jsonb,
  ADD COLUMN IF NOT EXISTS contact_persons       jsonb,
  ADD COLUMN IF NOT EXISTS notes                 text,
  ADD COLUMN IF NOT EXISTS internal_remarks      text,
  ADD COLUMN IF NOT EXISTS needs_completion      boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_no_key
  ON contacts (org_id, contact_no) WHERE contact_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_org_parent_idx ON contacts (org_id, parent_id);

-- ───────────────────────────── 0011_journal_workflow ────────────────────────
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'for_clearing';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'cleared';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'for_posting';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'voided';

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_type          text NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS reference           text,
  ADD COLUMN IF NOT EXISTS accrual_reversal_of uuid REFERENCES journal_entries(id);

-- Report fix: reversed entries' postings still count (their reversal offsets
-- them) — without this, every reversal shows a net negative in reports.
CREATE OR REPLACE VIEW v_account_postings
WITH (security_invoker = true) AS
SELECT
  je.org_id,
  je.id           AS entry_id,
  je.entry_date,
  a.id            AS account_id,
  a.code          AS account_code,
  a.name          AS account_name,
  a.type          AS account_type,
  jl.debit_cents,
  jl.credit_cents
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
JOIN accounts        a  ON a.id  = jl.account_id
WHERE je.status IN ('posted', 'reversed');

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT
  to_regclass('public.contacts_org_no_key')                                   AS contacts_0010_ok,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'entry_status')                                         AS entry_status_values, -- expect 10
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'entry_type')      AS journal_0011_ok;     -- expect 1
