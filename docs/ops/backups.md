# Runbook — Automated Postgres backups (M1.1)

> **What is already done (in the repo):** `sentire-books-api/setup/ops/backup.sh`
> takes a verified, checksummed, compressed dump and copies it off-host, plus
> `backup.env.example` as the config template.
>
> **What only you can do:** create the off-host bucket, issue credentials, and
> install the schedule. Those need infra access. Steps 1–4 below are yours.

---

## ⚠️ Read this first: the backup role must bypass RLS

Every tenant table is under Row-Level Security. Run as the API's role
(`sentire_books_app`), `pg_dump` **fails** — but it still leaves a
plausible-looking file on disk containing **zero rows**:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "accounts"
   → exit 1, but a 136 KB file remains
```

A cron job that ignores exit codes would bank that file forever. `backup.sh`
defends against this twice: it **refuses to start** unless the connection can
bypass RLS, and it **extracts a canary table from the finished archive** and
fails if it has no rows. Do not work around either check — point
`BACKUP_DATABASE_URL` at the **database owner** (the same connection as
`DATABASE_URL_DIRECT`).

---

## Step 1 — Create the off-host bucket *(you)*

The backup must not live on the database host's own disk. Sliplane runs Postgres
on the same server as the API, so a host failure loses both.

Any S3-compatible provider works. Backblaze B2 and Cloudflare R2 are the cheapest
for this volume (the whole database compresses to a few hundred KB today).

1. Create a **private** bucket, e.g. `sentire-books-backups`.
2. Enable **object versioning** if offered — it protects against a corrupted
   backup overwriting a good one.
3. Add a **lifecycle rule**: expire objects older than **30 days**. That is the
   remote half of retention (the script prunes only its local staging copies).
   At hourly cadence that is ~720 objects / ~100 MB — small enough that tiering
   (keep hourly for 7 days, then one per day) is an optimisation, not a need.

## Step 2 — Issue scoped credentials *(you)*

Create an application key limited to **this bucket**, with **write + list** only.
Do not use an account root key, and do not grant delete — lifecycle rules handle
expiry, and a compromised backup key should not be able to erase history.

Record the endpoint URL for non-AWS providers (B2 and R2 both need one).

## Step 3 — Install the config *(you)*

On the host that will run the schedule:

```bash
cd /opt/sentire-books/sentire-books-api/setup/ops     # adjust to your checkout
cp backup.env.example backup.env
$EDITOR backup.env                                    # fill in URL + credentials
chmod 600 backup.env                                  # it holds a DB password
```

Fill in:

| Variable | Value |
|---|---|
| `BACKUP_DATABASE_URL` | the **owner** connection (same as `DATABASE_URL_DIRECT`) |
| `BACKUP_DEST` | `s3://sentire-books-backups/postgres` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | the scoped key from step 2 |
| `AWS_ENDPOINT_URL` | your provider's endpoint (B2/R2; omit for AWS) |

The `aws` CLI must be installed on that host for an `s3://` destination. If you
would rather not install it, mount an off-host volume and set `BACKUP_DEST` to
that path instead — the script handles both.

## Step 4 — Schedule it *(you)*

**Hourly, on the hour** — the confirmed RPO target is **1 hour**. Each archive is
~144 KB compressed, so 30 days of hourly dumps is roughly 100 MB: the cost of
going from a 24-hour to a 1-hour RPO is negligible.

**Option A — host cron** (simplest if you have shell access):

```cron
0 * * * * set -a; . /opt/sentire-books/sentire-books-api/setup/ops/backup.env; set +a; \
          /opt/sentire-books/sentire-books-api/setup/ops/backup.sh \
          >> /var/log/sentire-books-backup.log 2>&1 || \
          echo "Sentire Books backup FAILED" | mail -s "backup failed" you@example.com
```

**Option B — a Sliplane scheduled service** running the same command in a
container that has `postgresql-client` and `awscli` installed.

Either way: **the schedule must alert you when the job exits non-zero.** An
unwatched backup job is the failure mode this whole milestone exists to prevent.
Wire it to the same alert destination as the uptime monitor (M1.4).

---

## Verify it worked

After the first scheduled run:

```bash
# 1. The object exists and is recent
aws s3 ls s3://sentire-books-backups/postgres/ --human-readable | tail -5

# 2. Its checksum matches (download both, verify)
aws s3 cp s3://sentire-books-backups/postgres/<name>.dump        /tmp/
aws s3 cp s3://sentire-books-backups/postgres/<name>.dump.sha256 /tmp/
cd /tmp && sha256sum -c <name>.dump.sha256      # must print: OK

# 3. It contains real rows (no database needed)
pg_restore --data-only --table=accounts --file=- /tmp/<name>.dump | grep -c $'\t'
#    → expect 158+ (the default chart of accounts), never 0
```

Then perform the **restore drill** — see `docs/ops/restore.md` (M1.2). A backup
you have never restored is a rumour.

---

## What the script does

| Stage | Behaviour on failure |
|---|---|
| Preflight — role can bypass RLS? | exit 1, nothing written |
| `pg_dump --format=custom --compress=9` | exit 1, partial archive deleted |
| `pg_restore --list` (archive readable?) | exit 1, partial archive deleted |
| Canary table has rows? | exit 1, partial archive deleted |
| sha256 sidecar | — |
| Copy off-host | exit 1, nothing published |
| Prune local staging older than retention | non-fatal |

Nothing in the script prints a connection string, password or token.

## Verified behaviour

Exercised against a real Postgres with the full migration set:

| Scenario | Result |
|---|---|
| Run as `sentire_books_app` (RLS-subject) | **exit 1**, refused before dumping, nothing written |
| Run as owner | **exit 0**, 158 accounts verified in the archive, checksum verifies |
| Canary table empty | **exit 1**, partial archive removed, nothing published |
| Bad credentials | **exit 1**, clear message |
| Missing `BACKUP_DATABASE_URL` | **exit 1**, clear message |
