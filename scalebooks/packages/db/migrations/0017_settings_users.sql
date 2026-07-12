-- ════════════════════════════════════════════════════════════════════════════
-- Settings & users extensions (Phase 7 cutover).
-- ════════════════════════════════════════════════════════════════════════════
-- The Settings screen leaves Firestore:
--   • payment_terms — reference data (Net 30, …) edited on the Settings page
--     and read by billing.
--   • org_settings.module_policies — module workflow toggles (enabled voucher
--     types, approval requirements, stale-check days, …) get their own jsonb
--     column instead of squatting in doc_numbering.
--   • app_users.profile — the portal's richer per-user bag (roles[], module
--     access matrix, work email, signature) rides as jsonb next to the
--     canonical role enum the API enforces.

CREATE TABLE IF NOT EXISTS payment_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  days        integer NOT NULL DEFAULT 0,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
ALTER TABLE payment_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON payment_terms;
CREATE POLICY org_isolation ON payment_terms
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_terms TO sentire_books_app;

ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS module_policies jsonb;
ALTER TABLE app_users    ADD COLUMN IF NOT EXISTS profile         jsonb;
