-- ════════════════════════════════════════════════════════════════════════════
-- One identity (email) may belong to MULTIPLE workspaces.
-- ════════════════════════════════════════════════════════════════════════════
-- Accounting is often done by people who serve several companies (an external
-- bookkeeper, or a firm managing many clients' books). So an email is no longer
-- globally unique in app_users — it's unique PER workspace. After sign-in the app
-- lists the caller's workspaces and (if more than one) shows a picker; each
-- request then carries the chosen org and is resolved to that specific membership.

-- Drop the global-unique-email constraints from 0007/0008…
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_email_key;
DROP INDEX IF EXISTS app_users_email_lower_key;

-- …and make (workspace, email) the unique key instead. A person appears at most
-- once per workspace, but may hold rows (with their own role) in many.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_org_email_lower_key
  ON app_users (org_id, lower(email));

-- List every workspace an email can access — powers the post-login picker.
DROP FUNCTION IF EXISTS get_user_workspaces(text);
CREATE FUNCTION get_user_workspaces(p_email text)
RETURNS TABLE (
  user_id   text,
  org_id    uuid,
  role      user_role,
  email     text,
  full_name text,
  org_code  text,
  org_name  text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower(p_email)
  ORDER BY o.name
$$;
REVOKE ALL ON FUNCTION get_user_workspaces(text) FROM public;
GRANT EXECUTE ON FUNCTION get_user_workspaces(text) TO sentire_books_app;

-- Resolve a single membership for a specific workspace (the request's active org).
-- Replaces the single-argument get_user_context(text) from 0008.
DROP FUNCTION IF EXISTS get_user_context(text);
DROP FUNCTION IF EXISTS get_user_context(text, uuid);
CREATE FUNCTION get_user_context(p_email text, p_org_id uuid)
RETURNS TABLE (
  user_id   text,
  org_id    uuid,
  role      user_role,
  email     text,
  full_name text,
  org_code  text,
  org_name  text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower(p_email) AND u.org_id = p_org_id
$$;
REVOKE ALL ON FUNCTION get_user_context(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(text, uuid) TO sentire_books_app;
