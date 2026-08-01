# Runbook — Restore drill, RPO & RTO (M1.2)

> **What is already done (in the repo):** `setup/ops/restore.sh` restores an
> archive into a scratch database and runs `setup/ops/verify-ledger.sql`, which
> proves the ledger invariants survived — not merely that rows came back.
>
> **What only you can do:** perform one real drill against a production backup,
> and record the measured RTO. Commands are in §3.

---

## 1. Recovery objectives

These are **targets tied to the current backup design** (daily dump at 02:00 UTC,
M1.1). They are not aspirational — each is what the mechanism actually delivers.

| Objective | Target | What it means |
|---|---|---|
| **RPO** — max acceptable data loss | **24 hours** | Backups run daily. A total loss of the database at 01:59 UTC loses everything posted since 02:00 the previous day. |
| **RTO** — max acceptable downtime | **4 hours** | From "database is gone" to "API serving on a verified restore", including provisioning a new instance and a human noticing. |

**Measured restore time** on the current dataset (158 accounts, single-digit
entries): **under 1 second**. That is the RTO *floor* — the arithmetic below is
what fills the rest of the 4 hours.

```
  detection + decision       ~30 min   ← the real variable; shrink it with M1.4 alerting
  provision new Postgres     ~30 min
  download + verify archive  ~5 min
  pg_restore                 <1 min today, minutes at scale
  invariant verification     <1 min
  repoint API + smoke test   ~15 min
  ────────────────────────────────────
  realistic total            ~1.5 h    (4 h target leaves genuine headroom)
```

### Is a 24-hour RPO acceptable?

For a bookkeeping platform holding other businesses' records, **losing a day of
posted entries is a serious event** — re-keying a day of vouchers is expensive
and error-prone. 24 h is an honest description of what daily dumps give you, not
an endorsement.

To do better, the options in ascending order of effort:

| Option | RPO | Cost |
|---|---|---|
| Dump **twice daily** (02:00 + 14:00) | 12 h | one cron line |
| Dump **hourly** | 1 h | cheap at this data size (~144 KB/dump) |
| **WAL archiving** / continuous archiving | **minutes** | real setup: archive command, storage, and a restore path that replays WAL |

**Recommendation:** move to **hourly dumps** now (it is one line and the archives
are tiny), and treat WAL archiving as the Milestone 6 item it really is. Revisit
the moment a real tenant is on the system — at that point 24 h stops being
defensible.

---

## 2. What the verification proves

`verify-ledger.sql` fails the drill unless **all nine** hold. It is not a smoke
test; each check maps to a non-negotiable invariant in `CLAUDE.md`.

| # | Invariant |
|---|---|
| 1 | The trial balance balances **to the centavo** across all posted + reversed entries |
| 2 | Every posted entry balances **individually** |
| 3 | No posted entry is zero-valued |
| 4 | Every line is one-sided and non-negative |
| 5 | All 4 ledger triggers survived (2 balance, 2 immutability) |
| 6 | Both reporting views survived |
| 7 | **Every org-scoped table still has RLS**, and every RLS table has a policy |
| 8 | No duplicate document numbers within an org |
| 9 | The data actually came back (chart of accounts non-empty) |

Each raises an exception on failure, so `psql` exits non-zero and `restore.sh`
aborts the drill.

**These checks were themselves tested by deliberately breaking a restored copy:**

| Injected fault | Detected? |
|---|---|
| Ledger out of balance by **1 centavo** | ✅ exit 3 — "debits 500001 <> credits 500000" |
| One of the 4 ledger triggers dropped | ✅ exit 3 — "only 3/4 ledger triggers present" |
| RLS disabled on **one** tenant table (`accounts`) | ✅ exit 3 — names the table |

> The RLS check originally used a table-count threshold and **missed** that last
> case — 32 of 33 tables still had RLS, so it passed. It now keys on the presence
> of an `org_id` column, so any org-scoped table without RLS fails by name, and
> the check keeps working as new tables are added.

---

## 3. Perform the drill *(you — do this once, now)*

Run against a **real production backup**. Restore to a scratch database — the
script refuses names that look live and will not touch `sentire_books`.

```bash
# 1. Fetch the most recent backup and its checksum
aws s3 ls s3://sentire-books-backups/postgres/ | tail -3
aws s3 cp s3://sentire-books-backups/postgres/<name>.dump        /tmp/
aws s3 cp s3://sentire-books-backups/postgres/<name>.dump.sha256 /tmp/

# 2. Run the drill (checksum → restore → invariant verification, timed)
cd sentire-books-api/setup/ops
export RESTORE_ADMIN_URL="postgres://postgres:PASSWORD@DB_HOST:5432/postgres"
./restore.sh /tmp/<name>.dump

# 3. Clean up
psql "$RESTORE_ADMIN_URL" -c 'DROP DATABASE sentire_books_restore_drill WITH (FORCE)'
```

**A passing drill prints:**

```
[restore] checksum OK
[restore] restore completed in Ns
NOTICE:  ✅ ALL LEDGER INVARIANTS HOLD — this restore is trustworthy.
[restore] DRILL PASSED
[restore]   restore time: Ns   ← this is your measured RTO floor
```

Exit code **0**. Anything else is a failed drill — **do not** treat the backup as
usable until it passes.

### Record the result

Add a line to the table below after each drill. A backup you have never restored
is a rumour; a drill you never recorded is one too.

| Date | Archive | Restore time | Invariants | By |
|---|---|---|---|---|
| _(pending — first production drill)_ | | | | |
| 2026-08-01 | synthetic test dataset | <1 s | ✅ 9/9 | automated, in-repo |

**Re-run the drill quarterly, and after any Postgres major-version upgrade.**

---

## 4. Real recovery (production is gone)

1. **Stop the API** so nothing writes to a half-restored database.
2. Provision a new Postgres 15+ instance.
3. Restore *(as above, but into the real database name)*:
   ```bash
   pg_restore --dbname="$NEW_DATABASE_URL" --no-owner --no-privileges --exit-on-error <archive>
   ```
4. **Recreate the app role and grants** — `--no-privileges` skips them:
   ```bash
   psql "$NEW_DATABASE_URL" -f sentire-books-api/packages/db/migrations/0001_rls.sql
   psql "$NEW_DATABASE_URL" -f sentire-books-api/packages/db/migrations/0022_credentials.sql
   psql "$NEW_DATABASE_URL" -c "ALTER ROLE sentire_books_app WITH LOGIN PASSWORD '<new>';"
   ```
5. **Verify** before letting traffic in:
   ```bash
   psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f sentire-books-api/setup/ops/verify-ledger.sql
   ```
6. **Confirm the API's role is correct** (it must not be the owner):
   ```bash
   DATABASE_URL="$NEW_APP_URL" pnpm --filter @sentire-books/db whoami   # expect exit 0
   ```
7. Repoint `DATABASE_URL`, restart, and smoke-test: sign in, open the trial
   balance, confirm it matches the pre-incident figure.

> **Step 4 is the one people forget.** `--no-owner --no-privileges` makes the
> restore succeed on a fresh server, but leaves the API's role without grants —
> the API would come up and fail every query. Re-run those two migrations.
