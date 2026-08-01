# CLAUDE.md — Sentire Books

> Place this at the **repo root** that contains both `sentire-books-api/` and `sentire-books/`.
> Claude Code loads it every session. Keep it short and high-signal. The full plan lives in
> `Improvement Roadmap/Sentire_Books_MVP_Build_Handoff.md` — read that before building.

## What this is
Multi-tenant, **double-entry bookkeeping** platform for Philippine SMEs. The general ledger is
enforced by the database; every module feeds that one ledger.

- **API:** `sentire-books-api/` — Hono + Node 20 + TypeScript (`tsx`), pnpm + Turborepo
  (`apps/api`, `packages/db`, `packages/domain`). Postgres 15+, plain SQL migrations, Drizzle.
  Self-hosted on Sliplane (no managed backups).
- **Portal:** `sentire-books/` — React 18 + Vite SPA, **separate npm project** (not in the workspace).
- **Auth:** HS256 JWT (`jose`), scrypt hashes, 8h tokens. Authz re-resolved from DB every request.
- **Multi-tenancy:** Postgres **RLS**, one policy per table, keyed on `app.current_org_id` GUC set by
  `withOrgContext()`. API runs as restricted role `sentire_books_app`.
- **Money:** integer **centavos** (`bigint`) everywhere.

## Non-negotiable invariants (must hold after every change)
1. **One writer to the ledger** — everything posts through `postJournalEntryCore()`
   (`sentire-books-api/apps/api/src/ledger/postJournalEntry.ts`). No browser-side ledger posting.
2. **Corrections are reversals, never mutations** (`reverseJournalEntryCore()`).
3. **RLS on every tenant table** + an integration test run as `sentire_books_app`.
4. **Fail-closed defaults**; assert critical config at boot.
5. **Reports reconcile to the trial balance to the centavo.**
6. **No floats in any money path.**

## How to work
- Follow `Sentire_Books_MVP_Build_Handoff.md` **one milestone, one task at a time**, starting at
  Milestone 0. Don't skip ahead or parallelize.
- One focused change per task; make its acceptance check pass; **pause for review** before the next.
- API change ⇒ RLS-bound integration test. Portal change (M6+) ⇒ component/e2e test.
- After any ledger-touching change, prove reports still reconcile to the trial balance.
- Update the relevant doc in the same change; never leave `docs/SYSTEM-DESIGN.md` or deploy docs stale.
- If you uncover a new critical (fail-open switch, unguarded ledger write, RLS gap), **stop and surface it**.

## Deferred — do NOT build (hide, don't half-build)
AI Layer · Loans & Fixed Assets (hidden, endpoints sealed) · cross-tenant admin portal ·
real bank reconciliation · projections/pay-schedule polish.

## Commands
```bash
# API
cd sentire-books-api && pnpm install
pnpm --filter @sentire-books/db seed
pnpm --filter @sentire-books/api dev            # :8787
pnpm --filter @sentire-books/domain test
DATABASE_URL=... pnpm --filter @sentire-books/api test:int   # RLS role

# Portal
cd sentire-books && npm install && npm run dev  # :5173
```

Env that matters: `DATABASE_URL` (as `sentire_books_app`), `DATABASE_URL_DIRECT` (owner),
`AUTH_JWT_SECRET`, `CORS_ORIGIN`, `ALLOW_WORKSPACE_RESET`, `BOOKS_ADMIN_EMAIL` /
`BOOKS_ADMIN_INITIAL_PASSWORD`, `PORT`, `VITE_API_BASE_URL` (only var the frontend reads).

## Current focus
**Milestone 0 — Stop the bleeding.** Fail-close `ALLOW_WORKSPACE_RESET`, boot assertions
(auth bypass + CORS), rate-limit/lockout on `POST /auth/password`, seal Loans/Fixed-Assets endpoints.
See `Improvement Roadmap/Milestone-0_Checklist.md`.
