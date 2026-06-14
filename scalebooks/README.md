# ScaleBooks — clean monorepo foundation

A rebuild scaffold for the ScaleBooks accounting platform on a **relational, ACID,
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

## Migration approach (strangler)

Move one module at a time, starting with the ledger core (COA → Journal), then the
modules with the worst integrity bugs (Vouchers, Checks, Payments), then Billing,
then Payroll last (most GAS logic to port). Run new modules against Postgres behind
a feature flag while the rest stays on the old app.

## Not yet included (intentionally)

Row-Level Security policies, JWT verification in `apps/api/src/auth.ts` (currently a
stub), the COA/contacts/voucher tables, PDF/Excel services, and the ported UI. These
are the next steps, not part of this initial scaffold.
