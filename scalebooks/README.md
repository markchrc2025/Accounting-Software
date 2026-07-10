# Sentire Books — clean monorepo foundation

A rebuild scaffold for the Sentire Books accounting platform on a **relational, ACID,
type-safe** stack. It exists to fix the structural problems found in the audit of
the existing app (open Firestore rules, client-side-only validation, non-atomic
multi-document writes, floating-point money, no tests).

This is a **foundation**, not a finished port. The existing React UI in
`../workscale-finance/hosting/src` is migrated module-by-module on top of it.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), pnpm + Turborepo |
| Database | PostgreSQL (Supabase or Neon) |
| Schema / queries | Drizzle ORM |
| API | Hono (Node) — the only writer to the ledger |
| Frontend | React + Vite + Tailwind (ported from the current app) |
| Validation | Zod (shared FE ↔ BE via `@scalebooks/domain`) |
| Money | integer **centavos**, never floats |
| Tests | Vitest; CI via GitHub Actions |

## Layout

```
scalebooks/
├── packages/
│   ├── domain/   Zod schemas + money + TRAIN tax — pure, 100% unit-tested
│   └── db/       Drizzle schema + migrations (incl. ledger triggers)
└── apps/
    ├── api/      Hono API; postJournalEntry runs in a DB transaction
    └── web/      React/Vite shell (UI ported here over time)
```

## Why this fixes the audit findings

- **Double-entry is enforced in the database**, not the browser. A deferred
  constraint trigger rejects any *posted* entry where Σdebit ≠ Σcredit
  (`packages/db/migrations/0000_init.sql`). The app's Zod check is just friendly UX.
- **Atomic writes.** `postJournalEntry` does number-allocation, entry, lines, and
  posting inside one `db.transaction`. No more orphaned vouchers / JE-without-source.
- **Posted entries are append-only.** Triggers block editing/deleting a posted
  entry; corrections are reversing entries. No silently-deleted posted JEs.
- **No number races.** `UNIQUE (org_id, entry_no)` + an atomic counter upsert make
  duplicate document numbers impossible (the DB rejects them, not a pre-flight query).
- **Exact money.** `bigint` centavos in the DB and integer math in `@scalebooks/domain`
  — `0.1 + 0.2` can never drift a trial balance.
- **Tested.** Money, balance, and tax logic have unit tests; CI runs typecheck +
  test + build on every push.

## Getting started

```bash
cp .env.example .env          # point DATABASE_URL at your Postgres
pnpm install
psql "$DATABASE_URL_DIRECT" -f packages/db/migrations/0000_init.sql
pnpm test                     # domain unit tests
pnpm --filter @scalebooks/api dev
pnpm --filter @scalebooks/web dev
```

## Deployment (Supabase + Render)

**Supabase** = Postgres + Auth + Storage. **Render** = the API (Hono). The web app is
a static Vite build (host on Cloudflare Pages / Vercel / Netlify).

1. **Apply migrations + create the app role** (as the `postgres` owner, via the
   Supabase SQL editor or the direct connection):
   ```bash
   for f in packages/db/migrations/*.sql; do psql "$DATABASE_URL_DIRECT" -f "$f"; done
   # give the RLS-bound app role a login (choose a strong password):
   psql "$DATABASE_URL_DIRECT" -c "ALTER ROLE sentire_books_app WITH LOGIN PASSWORD '...';"
   ```
   The API's `DATABASE_URL` then connects through the **transaction pooler** as
   `sentire_books_app` (subject to RLS); migrations/seed use the **direct** owner URL.

2. **Auth:** enable **Authentication → Providers → Google**, and add your web app's
   origin to **URL Configuration → Redirect URLs**. The API verifies tokens via
   `AUTH_JWKS_URL` (asymmetric ES256 signing key) — no secret needed.

3. **Bootstrap the first admin.** Sign in once (creates a Supabase auth user), copy
   your UID from **Authentication → Users**, then map it to an org:
   ```sql
   insert into organizations (id, name) values (gen_random_uuid(), 'Your Company')
     returning id;  -- note the org id
   insert into app_users (id, org_id, email, full_name, role)
   values ('<your-supabase-uid>', '<org-id>', 'you@co.com', 'You', 'admin');
   ```
   After that, Admins invite/provision other users from the app.

4. **API on Render:** deploy via `render.yaml` (Singapore, Starter plan). Set
   `DATABASE_URL` (pooler, contains the password) in the dashboard; `AUTH_JWKS_URL`
   and `AUTH_ISSUER` are in the blueprint.

Local dev needs none of this: leave `AUTH_JWKS_URL`/`VITE_SUPABASE_*` unset and the
app uses the `AUTH_DEV_BYPASS` header flow (no login screen).

## Migration approach (strangler)

Move one module at a time, starting with the ledger core (COA → Journal), then the
modules with the worst integrity bugs (Vouchers, Checks, Payments), then Billing,
then Payroll last (most GAS logic to port). Run new modules against Postgres behind
a feature flag while the rest stays on the old app.

## Built so far

- Ledger core: schema + balance/append-only triggers, `postJournalEntry` (transactional).
- Chart of Accounts: domain + standard PH chart + seed + `GET/POST /accounts`.
- Row-Level Security on all org-scoped tables + `withOrgContext` per-request scoping.
- Real JWT auth (JWKS verification; org/role resolved from the DB, not token claims).
- Journal UI: list recent entries + post a balanced entry (live balance, account picker).

## Next steps

Contacts / vouchers / checks tables and their UIs, PDF (BIR 2316, vouchers) and Excel
(HRIS import) services, payroll (most GAS logic to port), and reporting views
(trial balance, P&L) — following the strangler order above.
