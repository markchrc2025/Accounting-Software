-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security — defense-in-depth multi-tenant isolation.
-- ════════════════════════════════════════════════════════════════════════════
-- The API authenticates the caller, looks up their org via get_user_context(),
-- then sets `app.current_org_id` for the transaction. Every policy below filters
-- rows to that org, so even a bug that forgets `WHERE org_id = …` cannot leak or
-- write across tenants.
--
-- Connection model:
--   • migrations + seed run as the table OWNER → exempt from RLS (we do NOT FORCE),
--     so bootstrapping organizations/users/accounts works.
--   • the API connects as the non-owner role `scalebooks_app` → subject to RLS.
-- Point the app's DATABASE_URL at scalebooks_app in production.

-- Reads `app.current_org_id`; NULL when unset → policies deny by default.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;

-- Bootstrap: resolve a user's org + role WITHOUT RLS (SECURITY DEFINER), so the
-- API can establish context before any org-scoped query runs.
CREATE OR REPLACE FUNCTION get_user_context(p_uid uuid)
RETURNS TABLE (org_id uuid, role user_role, email text, full_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT org_id, role, email, full_name FROM app_users WHERE id = p_uid
$$;
REVOKE ALL ON FUNCTION get_user_context(uuid) FROM public;

-- Application role (subject to RLS). Grant it to your login role in deployment:
--   GRANT scalebooks_app TO <login_role>;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scalebooks_app') THEN
    CREATE ROLE scalebooks_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO scalebooks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scalebooks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scalebooks_app;
GRANT EXECUTE ON FUNCTION current_org_id() TO scalebooks_app;
GRANT EXECUTE ON FUNCTION get_user_context(uuid) TO scalebooks_app;

-- ── Enable RLS + org-isolation policies ─────────────────────────────────────
ALTER TABLE organizations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines     ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON organizations
  USING (id = current_org_id());

CREATE POLICY org_isolation ON app_users
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

CREATE POLICY org_isolation ON accounts
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

CREATE POLICY org_isolation ON document_counters
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

CREATE POLICY org_isolation ON journal_entries
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- journal_lines inherit their org from the parent entry.
CREATE POLICY org_isolation ON journal_lines
  USING (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_lines.entry_id AND je.org_id = current_org_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_lines.entry_id AND je.org_id = current_org_id()));
