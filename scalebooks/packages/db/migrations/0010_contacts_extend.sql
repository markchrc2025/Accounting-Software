-- ════════════════════════════════════════════════════════════════════════════
-- Extend contacts to carry the full portal contact model.
-- ════════════════════════════════════════════════════════════════════════════
-- The portal's Contacts screen models a rich entity (multi-category types,
-- branch hierarchy, AR/AP account refs, terms/credit, structured addresses,
-- bank accounts, contact persons, notes). Persist it losslessly:
--   • `type` stays the canonical enum (vendor|customer|employee) that vouchers
--     and the simple app filter on — derived server-side from `types`.
--   • `types` keeps the portal's labels (Customer/Supplier/Employee/Contractor/
--     Government/Other) so the UI round-trips exactly.
--   • money is integer CENTAVOS, matching the rest of the platform.
--   • contact_no (CNT{YYYYMM}-{NNNN}) is assigned server-side from
--     document_counters, replacing the client-side Firestore counter.

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

-- Human-readable number is unique per workspace (when assigned).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_no_key
  ON contacts (org_id, contact_no) WHERE contact_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_org_parent_idx ON contacts (org_id, parent_id);
