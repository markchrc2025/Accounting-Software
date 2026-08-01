#!/usr/bin/env bash
#
# Sentire Books — restore drill (M1.2)
#
# Restores a backup archive into a SCRATCH database and proves the ledger
# invariants survived. Never touches production: it refuses to restore over an
# existing database unless you pass --force, and the scratch name is separate
# from the live one by construction.
#
#   ./restore.sh /path/to/sentire-books-YYYYmmddTHHMMSSZ.dump
#
# Times the restore so the drill produces a measured RTO rather than a guess.
set -Eeuo pipefail

ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" ]] || { echo "usage: $0 <archive.dump> [--force]" >&2; exit 2; }
[[ -f "$ARCHIVE" ]] || { echo "no such archive: $ARCHIVE" >&2; exit 2; }
FORCE="${2:-}"

# Admin connection to the SCRATCH server (may be the same server, different DB).
: "${RESTORE_ADMIN_URL:?required - a superuser/owner connection to the scratch server, e.g. postgres://postgres@host:5432/postgres}"
SCRATCH_DB="${SCRATCH_DB:-sentire_books_restore_drill}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '[restore] %s\n' "$*"; }
fail() { printf '[restore] FATAL: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "required tool '$1' is not installed"; }
need psql
need pg_restore

# Build the scratch DB URL by swapping the database name on the admin URL.
SCRATCH_URL="${RESTORE_ADMIN_URL%/*}/${SCRATCH_DB}"

# ── 0. Guard: never restore over the live database ───────────────────────────
case "$SCRATCH_DB" in
  sentire_books|postgres|template*)
    fail "SCRATCH_DB='${SCRATCH_DB}' looks like a real database. Use a throwaway name." ;;
esac

EXISTS="$(psql "$RESTORE_ADMIN_URL" -tA -c \
  "SELECT 1 FROM pg_database WHERE datname = '${SCRATCH_DB}'" 2>/dev/null || true)"
if [[ "$EXISTS" == "1" && "$FORCE" != "--force" ]]; then
  fail "scratch database '${SCRATCH_DB}' already exists. Re-run with --force to drop and recreate it."
fi

# ── 1. Verify the checksum first, if a sidecar is present ────────────────────
if [[ -f "${ARCHIVE}.sha256" ]]; then
  log "verifying checksum…"
  ( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null ) \
    || fail "checksum MISMATCH — this archive is corrupt, do not trust it"
  log "checksum OK"
else
  log "no .sha256 sidecar found — skipping checksum (consider keeping them together)"
fi

# ── 2. Recreate the scratch database ─────────────────────────────────────────
log "recreating scratch database '${SCRATCH_DB}'…"
psql "$RESTORE_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)" \
  || fail "could not drop the scratch database"
psql "$RESTORE_ADMIN_URL" -q -c "CREATE DATABASE ${SCRATCH_DB}" \
  || fail "could not create the scratch database"

# ── 3. Restore, timed ────────────────────────────────────────────────────────
log "restoring…"
START=$(date +%s)
# The app role may not exist on a scratch server; --no-owner/--no-privileges
# keeps the restore from failing on GRANTs to a missing role. Object ownership
# is not what the drill is testing — the data and the invariants are.
if ! pg_restore --dbname="$SCRATCH_URL" --no-owner --no-privileges --exit-on-error "$ARCHIVE" 2>/tmp/restore.err; then
  sed 's/^/    /' /tmp/restore.err >&2
  fail "pg_restore failed"
fi
ELAPSED=$(( $(date +%s) - START ))
log "restore completed in ${ELAPSED}s"

# ── 4. Prove the ledger invariants survived ──────────────────────────────────
log "verifying ledger invariants…"
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "${HERE}/verify-ledger.sql" \
  || fail "LEDGER INVARIANTS FAILED — this backup restores, but the books are not trustworthy"

echo
log "════════════════════════════════════════════════════════"
log "DRILL PASSED"
log "  archive     : $(basename "$ARCHIVE")"
log "  restored to : ${SCRATCH_DB}"
log "  restore time: ${ELAPSED}s   ← this is your measured RTO floor"
log "════════════════════════════════════════════════════════"
log "Drop the scratch database when finished:"
log "  psql \"\$RESTORE_ADMIN_URL\" -c 'DROP DATABASE ${SCRATCH_DB} WITH (FORCE)'"
