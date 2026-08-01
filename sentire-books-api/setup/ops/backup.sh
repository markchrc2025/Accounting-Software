#!/usr/bin/env bash
#
# Sentire Books — scheduled Postgres backup (M1.1)
#
# Takes a compressed custom-format dump, PROVES it contains data, checksums it,
# copies it off-host, and prunes old copies. Any failure exits non-zero and
# removes the partial artefact — a backup that might be empty is worse than an
# obviously missing one.
#
#   ./backup.sh
#
# Configuration comes from the environment (see backup.env.example). Nothing in
# this script ever prints a connection string, password or token.
#
# ── Why the role matters ──────────────────────────────────────────────────────
# Every tenant table is under Row-Level Security. Run as the API's role
# (`sentire_books_app`), pg_dump fails with "query would be affected by
# row-level security policy" — but it STILL leaves a plausible-looking file on
# disk containing zero rows. So this script refuses to start unless the
# connection can bypass RLS, and separately verifies the finished archive
# actually contains rows.
set -Eeuo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
: "${BACKUP_DATABASE_URL:?required - use the OWNER connection (DATABASE_URL_DIRECT), NOT the app role}"
: "${BACKUP_DEST:?required - an s3://bucket/prefix or an absolute path on a mounted off-host volume}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_STAGING="${BACKUP_STAGING:-/var/tmp/sentire-books-backups}"
# A table that must never legitimately be empty — proves the dump has content.
BACKUP_CANARY_TABLE="${BACKUP_CANARY_TABLE:-accounts}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="sentire-books-${STAMP}.dump"
ARCHIVE="${BACKUP_STAGING}/${NAME}"

log()  { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup] FATAL: %s\n' "$*" >&2; exit 1; }

# Remove the partial archive on any failure, so a broken run can never be
# mistaken for a good backup.
cleanup_partial() {
  local code=$?
  if [[ $code -ne 0 && -f "$ARCHIVE" ]]; then
    rm -f "$ARCHIVE" "${ARCHIVE}.sha256"
    printf '[backup] removed partial archive after failure\n' >&2
  fi
  exit $code
}
trap cleanup_partial EXIT

need() { command -v "$1" >/dev/null 2>&1 || fail "required tool '$1' is not installed"; }
need pg_dump
need pg_restore
need psql
need sha256sum

mkdir -p "$BACKUP_STAGING"

# ── 1. Preflight: the connection must not be subject to RLS ───────────────────
# Without this, a misconfigured cron silently banks empty backups.
log "checking backup role privileges…"
CAN_BYPASS="$(psql "$BACKUP_DATABASE_URL" -tA -c \
  "SELECT (rolsuper OR rolbypassrls) FROM pg_roles WHERE rolname = current_user" 2>/dev/null || true)"
BACKUP_ROLE="$(psql "$BACKUP_DATABASE_URL" -tA -c "SELECT current_user" 2>/dev/null || true)"

[[ -n "$BACKUP_ROLE" ]] || fail "cannot connect to the database (credentials or host wrong)"
if [[ "$CAN_BYPASS" != "t" ]]; then
  fail "role '${BACKUP_ROLE}' is subject to Row-Level Security — pg_dump would fail and leave an EMPTY archive behind. Point BACKUP_DATABASE_URL at the database OWNER (same connection as DATABASE_URL_DIRECT)."
fi
log "role '${BACKUP_ROLE}' can bypass RLS — proceeding"

# ── 2. Dump ───────────────────────────────────────────────────────────────────
# Custom format: compressed, and supports selective restore in the drill (M1.2).
log "dumping to ${NAME}…"
pg_dump "$BACKUP_DATABASE_URL" --format=custom --compress=9 --file="$ARCHIVE" \
  || fail "pg_dump failed"

[[ -s "$ARCHIVE" ]] || fail "pg_dump produced an empty file"

# ── 3. Verify the archive is readable AND actually contains rows ──────────────
log "verifying archive…"
pg_restore --list "$ARCHIVE" >/dev/null 2>&1 || fail "archive is unreadable (pg_restore --list failed)"

# Extract the canary table's data straight from the archive — no database needed.
CANARY_ROWS="$(pg_restore --data-only --table="$BACKUP_CANARY_TABLE" --file=- "$ARCHIVE" 2>/dev/null \
  | grep -c $'\t' || true)"
if [[ "${CANARY_ROWS:-0}" -lt 1 ]]; then
  fail "archive contains NO rows for '${BACKUP_CANARY_TABLE}'. Refusing to publish an empty backup."
fi
log "archive verified: ${CANARY_ROWS} rows in '${BACKUP_CANARY_TABLE}', $(du -h "$ARCHIVE" | cut -f1) compressed"

# ── 4. Checksum ───────────────────────────────────────────────────────────────
( cd "$BACKUP_STAGING" && sha256sum "$NAME" > "${NAME}.sha256" )
log "sha256: $(cut -d' ' -f1 < "${ARCHIVE}.sha256")"

# ── 5. Copy off-host ──────────────────────────────────────────────────────────
case "$BACKUP_DEST" in
  s3://*)
    need aws
    log "uploading to ${BACKUP_DEST%/}/${NAME}…"
    aws s3 cp "$ARCHIVE"          "${BACKUP_DEST%/}/${NAME}"        --only-show-errors || fail "upload failed"
    aws s3 cp "${ARCHIVE}.sha256" "${BACKUP_DEST%/}/${NAME}.sha256" --only-show-errors || fail "checksum upload failed"
    ;;
  *)
    [[ -d "$BACKUP_DEST" ]] || fail "BACKUP_DEST '${BACKUP_DEST}' is not a directory (and not an s3:// URL)"
    log "copying to ${BACKUP_DEST%/}/${NAME}…"
    cp "$ARCHIVE" "${ARCHIVE}.sha256" "${BACKUP_DEST%/}/" || fail "copy failed"
    ;;
esac

# ── 6. Prune ──────────────────────────────────────────────────────────────────
log "pruning copies older than ${BACKUP_RETENTION_DAYS} days…"
find "$BACKUP_STAGING" -name 'sentire-books-*.dump*' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -delete || true
case "$BACKUP_DEST" in
  s3://*)
    # Object storage lifecycle rules are the right tool here — see the runbook.
    log "remote pruning is handled by the bucket's lifecycle policy (see docs/ops/backups.md)"
    ;;
  *)
    find "$BACKUP_DEST" -name 'sentire-books-*.dump*' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -delete || true
    ;;
esac

log "OK — ${NAME} backed up to ${BACKUP_DEST%/}"
