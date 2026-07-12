-- ════════════════════════════════════════════════════════════════════════════
-- Admin data tools escape hatch (workspace reset / restore).
-- ════════════════════════════════════════════════════════════════════════════
-- Posted journal entries are append-only by trigger (0000) — correct for normal
-- operation, but it makes an admin "wipe test data before go-live" impossible.
-- Both protective functions gain a TRANSACTION-LOCAL escape:
--
--   SELECT set_config('app.allow_data_admin', 'on', true);
--
-- Only the API's admin-gated reset/restore endpoints set it, inside their own
-- transaction, so the audit-trail guarantee is unchanged everywhere else. RLS
-- still applies — the escape never crosses workspaces.

CREATE OR REPLACE FUNCTION prevent_posted_entry_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_data_admin', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Posted entry % cannot be deleted — create a reversing entry.',
        OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.status = 'reversed'
       AND NEW.org_id = OLD.org_id AND NEW.entry_no = OLD.entry_no
       AND NEW.entry_date = OLD.entry_date
       AND NEW.memo IS NOT DISTINCT FROM OLD.memo THEN
      RETURN NEW;                                        -- allow post -> reversed
    END IF;
    RAISE EXCEPTION 'Posted entry % is immutable.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_posted_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status entry_status;
BEGIN
  IF current_setting('app.allow_data_admin', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status FROM journal_entries
    WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Lines of a posted entry cannot be added, changed, or removed.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: both rows present (the two amended trigger functions).
SELECT proname FROM pg_proc
 WHERE proname IN ('prevent_posted_entry_mutation','prevent_posted_line_mutation');
