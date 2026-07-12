-- ════════════════════════════════════════════════════════════════════════════
-- Resolve users by verified EMAIL, not the auth provider's id.
-- ════════════════════════════════════════════════════════════════════════════
-- Authenticize is only the authenticator; Sentire Books owns its users. app_users
-- is an email allowlist we maintain in-app. A user is admitted iff their verified
-- token email matches an app_users row — regardless of the provider's internal id.
--
-- So: app_users.id becomes an app-owned identifier (defaulted here, so invites
-- don't need the provider's id up front), and get_user_context looks up by email.

-- App owns the id now; generate it on insert when not supplied.
ALTER TABLE app_users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Case-insensitive uniqueness on the allowlist key.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_key ON app_users (lower(email));

-- Look up by email; also return the app_users id (used for created_by stamps).
DROP FUNCTION IF EXISTS get_user_context(uuid);
DROP FUNCTION IF EXISTS get_user_context(text);
CREATE FUNCTION get_user_context(p_email text)
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
$$;
REVOKE ALL ON FUNCTION get_user_context(text) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(text) TO sentire_books_app;
