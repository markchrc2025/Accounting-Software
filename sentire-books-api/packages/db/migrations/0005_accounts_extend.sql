-- ════════════════════════════════════════════════════════════════════════════
-- Extend the chart of accounts to match a real-world (Zoho-exported) COA:
-- hierarchy, sub-classification, descriptions, and an explicit normal balance.
-- ════════════════════════════════════════════════════════════════════════════
-- Why the uniqueness change: real charts reuse the same numeric "code" across
-- different top-level types (e.g. Equity 2003001 vs Liability 2003001). The code
-- is a display label, not a key — the account NAME is unique. So we key
-- uniqueness on (org_id, name) and keep code as a non-unique, indexed label.

-- Parent hierarchy (self-reference), Zoho's detailed subtype, free-text
-- description, and the account's normal balance side.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS parent_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtype        text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS normal_balance text
    CONSTRAINT accounts_normal_balance_chk CHECK (normal_balance IN ('debit','credit'));

-- Swap (org_id, code) uniqueness for (org_id, name); keep code indexed for lookups.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_org_id_code_key;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_org_code_key;
ALTER TABLE accounts ADD  CONSTRAINT accounts_org_name_key UNIQUE (org_id, name);
CREATE INDEX IF NOT EXISTS accounts_org_code_idx   ON accounts (org_id, code);
CREATE INDEX IF NOT EXISTS accounts_org_parent_idx ON accounts (org_id, parent_id);
