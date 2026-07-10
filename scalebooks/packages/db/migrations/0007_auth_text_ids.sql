-- ════════════════════════════════════════════════════════════════════════════
-- Auth provider user IDs are strings (Authenticize / Better Auth), not UUIDs.
-- ════════════════════════════════════════════════════════════════════════════
-- app_users.id equals the identity provider's user id (the JWT `sub`). Supabase
-- issued UUIDs; Better Auth issues opaque strings. Widen app_users.id and the
-- created_by foreign keys from uuid to text, and switch get_user_context to a
-- text parameter. Organization ids stay uuid.

-- Drop the FKs that reference app_users(id) so its type can change.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_created_by_fkey;
ALTER TABLE vouchers        DROP CONSTRAINT IF EXISTS vouchers_created_by_fkey;

-- Widen the columns (uuid → text; existing values cast cleanly).
ALTER TABLE app_users       ALTER COLUMN id         TYPE text USING id::text;
ALTER TABLE journal_entries ALTER COLUMN created_by TYPE text USING created_by::text;
ALTER TABLE vouchers        ALTER COLUMN created_by TYPE text USING created_by::text;

-- Re-add the foreign keys (same names Postgres generated originally).
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE vouchers
  ADD CONSTRAINT vouchers_created_by_fkey        FOREIGN KEY (created_by) REFERENCES app_users(id);

-- Recreate get_user_context with a text uid (changing a parameter type needs a
-- drop + create). Behavior and returned columns are otherwise unchanged.
DROP FUNCTION IF EXISTS get_user_context(uuid);
DROP FUNCTION IF EXISTS get_user_context(text);
CREATE FUNCTION get_user_context(p_uid text)
RETURNS TABLE (org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE u.id = p_uid
$$;
REVOKE ALL ON FUNCTION get_user_context(text) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(text) TO sentire_books_app;
