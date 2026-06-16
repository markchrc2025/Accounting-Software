-- ════════════════════════════════════════════════════════════════════════════
-- Contacts — vendors, customers, employees referenced by vouchers and JE lines.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE contact_type AS ENUM ('vendor', 'customer', 'employee');

CREATE TABLE contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type       contact_type NOT NULL,
  name       text NOT NULL,
  tin        text,
  email      text,
  phone      text,
  address    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_org_type_idx ON contacts (org_id, type);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON contacts
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO scalebooks_app;
