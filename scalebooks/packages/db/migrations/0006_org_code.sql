-- ════════════════════════════════════════════════════════════════════════════
-- Company code (tenant ID) for multi-tenant login.
-- ════════════════════════════════════════════════════════════════════════════
-- Every organization gets a unique, human-usable `code` (e.g. ACMEFOODS). It is
-- entered at login and verified against the signed-in user's org, so a user must
-- know their workspace code to get in. Data isolation is still enforced by RLS
-- (a user only ever sees their own org) — the code is the workspace gate, not a
-- second auth secret.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS code text;

-- Backfill existing rows with a deterministic, unique placeholder before NOT NULL.
UPDATE organizations
   SET code = 'ORG' || upper(substr(replace(id::text, '-', ''), 1, 8))
 WHERE code IS NULL;

ALTER TABLE organizations ALTER COLUMN code SET NOT NULL;

-- Case-insensitive uniqueness — the code identifies a tenant globally.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_code_key ON organizations (upper(code));

-- get_user_context now also returns the org's code + name, so the API can verify
-- the company code entered at login and surface the workspace name. Changing the
-- returned columns requires dropping + recreating the function.
DROP FUNCTION IF EXISTS get_user_context(uuid);
CREATE FUNCTION get_user_context(p_uid uuid)
RETURNS TABLE (org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE u.id = p_uid
$$;
REVOKE ALL ON FUNCTION get_user_context(uuid) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(uuid) TO scalebooks_app;
