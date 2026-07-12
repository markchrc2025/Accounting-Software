# Deploying Sentire Books on Sliplane

How to run the whole stack — **web + API + PostgreSQL** — as Docker containers on
[Sliplane](https://sliplane.io), replacing Render.

> **The whole stack runs on Sliplane — no Supabase anywhere.**
>
> | Layer | Runs on |
> |---|---|
> | Web (Vite SPA) | **Sliplane** (nginx container) |
> | API (Hono) | **Sliplane** (Node container) |
> | App database (Postgres) | **Sliplane** (Postgres container/managed) |
> | **Auth / SSO / JWKS** | **Authenticize** (your own OIDC provider, also on Sliplane) |
>
> Login, Google SSO, and JWT signing are handled by **Authenticize** (a Better
> Auth / OIDC server you run). The API verifies its RS256 JWTs via Authenticize's
> JWKS — no shared secret. Because there is **no data yet**, moving the database is
> low-risk: a fresh Postgres just needs the schema.
>
> **Cookie/domain requirement:** because the Sentire login form calls Authenticize
> cross-origin, the web app and Authenticize must share a **registrable root
> domain** (e.g. `books.example.com` + `auth.example.com`) so the session cookie
> flows. `*.sliplane.app` subdomains won't work for this — use a custom domain.

---

## 0. Prerequisites

- A Sliplane account with a **server** provisioned (Sliplane runs your containers
  on a Hetzner server you control).
- Your GitHub repo connected to Sliplane (so it can build from the Dockerfiles).
- `psql` on your laptop (to run the schema once).
- **Authenticize** deployed (its own Sliplane service + Postgres) and reachable at a
  URL on the same root domain as the web app. See the Authenticize repo's `.env.example`.
- Decide two passwords up front:
  - **DB superuser** password (`postgres` role) — for migrations/admin.
  - **App role** password (`sentire_books_app`) — what the API connects with.

The repo already contains everything Sliplane needs to build:
- `sentire-books-api/apps/api/Dockerfile` — the API image.
- `sentire-books/Dockerfile` + `sentire-books/nginx.conf` — the portal image.
- `sentire-books-api/.dockerignore`.
- `sentire-books-api/setup/db-setup.sql` — the full schema (works on any Postgres 15+).

For **all three** Sliplane services set **Build context = `scalebooks`** (the pnpm
workspace root), and the Dockerfile path as noted below.

---

## 1. The database

**If you use Sliplane's managed Postgres** (recommended — one click), you already
have a connection URL like:
```
postgres://owner:<PW>@<host>:<port>/sentire_books?sslmode=no-verify
```
That `owner` role is the DB **superuser** — use it only to load the schema and for
admin. The API must **never** connect as `owner`: a superuser bypasses Row-Level
Security, which would defeat tenant isolation. In step 2 you create a separate,
non-superuser `sentire_books_app` role for the API. The `?sslmode=no-verify` is
handled by the API's DB client (it maps to an encrypted, non-verifying TLS
connection).

**If you run your own `postgres:16` container instead:** mount a persistent volume
at `/var/lib/postgresql/data` (or you lose data on redeploy), set `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB=sentire_books`, and keep port `5432` internal.
Note the service's internal hostname (typically the service name, e.g.
`sentire-books-db`) — the API reaches the DB there on the private network.

---

## 2. Load the schema (run once)

The schema is plain SQL and runs on any Postgres 15+. There is no data to migrate.

1. **Edit the bootstrap values** in `sentire-books-api/setup/db-setup.sql` (three
   `-- EDIT` spots):
   - `ALTER ROLE sentire_books_app WITH LOGIN PASSWORD '…'` → your **app role** password.
   - the `organizations` insert → your **company name** and **company code**
     (the tenant ID users type at login, e.g. `SENTIRE`).
2. **Run it against your DB as the owner/superuser** (the `owner` URL from Sliplane's
   managed Postgres, or `postgres` for your own container):
   ```bash
   psql "postgres://owner:<PW>@<host>:<port>/sentire_books?sslmode=no-verify" \
     -f sentire-books-api/setup/db-setup.sql
   ```
   (Sliplane's managed Postgres URL is already publicly reachable, so you can run this
   straight from your laptop. For a self-hosted container, temporarily expose port
   5432 or use the service console, then close it again.)

This creates the schema, ledger-integrity triggers, RLS, reporting views, the
`sentire_books_app` login role, your organization + company code, and the 158-account
default chart. It runs as the **owner/superuser**, which is exempt from RLS — exactly
how the API's non-superuser `sentire_books_app` role is *not*.

> The setup file's final admin block is Supabase-specific (`FROM auth.users`) and is
> **commented out** — leave it. You'll map your admin in step 6 by UID instead.

---

## 3. Create the API service (`sentire-books-api`)

- **Dockerfile:** `apps/api/Dockerfile` · **Build context:** `scalebooks` · **Port:** `8787`
- **Environment:**

  | Key | Value |
  |---|---|
  | `DATABASE_URL` | `postgres://sentire_books_app:<APP_PW>@<db-host>:<port>/sentire_books?sslmode=no-verify` |
  | `AUTH_JWKS_URL` | `<AUTHENTICIZE_URL>/api/auth/jwks` |
  | `AUTH_ISSUER` | `<AUTHENTICIZE_URL>` |
  | `CORS_ORIGIN` | `https://<your-web-origin>,http://localhost:5173` |
  | `PORT` | `8787` (optional; matches the service port) |

  Keep `?sslmode=no-verify` if your host requires TLS (Sliplane's managed Postgres
  does); drop it for a plain internal container connection. Do **not** set
  `AUTH_DEV_BYPASS` — it's local-only and, once `AUTH_JWKS_URL` is set, is
  structurally unreachable anyway.

- Connect it as the **RLS-bound `sentire_books_app` role** — never as the `owner`/
  `postgres` superuser. Only a non-superuser role is subject to RLS; that is what
  actually enforces tenant isolation.
- After deploy, note the API URL (e.g. `https://sentire-books-api.sliplane.app`) and
  smoke-test: `curl https://sentire-books-api.sliplane.app/health` → `{"ok":true,…}`.

---

## 4. Create the web service (`sentire-books-web`)

- **Dockerfile:** `apps/web/Dockerfile` · **Build context:** `scalebooks` · **Port:** `80`
- **Build arguments** (Vite inlines these at build time — all are public/safe):

  | Build arg | Value |
  |---|---|
  | `VITE_API_BASE_URL` | your API URL from step 3 |
  | `VITE_AUTH_URL` | your Authenticize URL, e.g. `https://auth.example.com` |

  If Sliplane doesn't expose build args for your plan, hard-code these as the `ARG`
  defaults in `apps/web/Dockerfile` (they're public). Both **must** be set to the
  real URLs before the build, or the SPA calls the wrong hosts.

- After deploy, note the web URL (e.g. `https://sentire-books-web.sliplane.app`).

---

## 5. Wire up Authenticize

Authenticize (your Better Auth / OIDC server) is deployed as its own Sliplane
service with its own Postgres. In its **admin dashboard → Apps**, register Sentire
Books, then trust the web origin so the cross-origin login works:

- **Register an app** for Sentire Books (a public/SPA client is fine). Its redirect
  URI isn't used by the keep-our-form flow, but registering the app also trusts its
  origin.
- **`TRUSTED_ORIGINS`** on the Authenticize service must include the Sentire web
  origin (comma-separated), e.g. `https://books.example.com`.
- **`COOKIE_DOMAIN`** on Authenticize = your shared root, e.g. `.example.com`, so the
  session cookie is readable by the app subdomain.
- **Google SSO** is configured on **Authenticize** (`GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`) — not in the app. (Microsoft isn't wired in Authenticize
  yet; the Microsoft button will show a friendly "not enabled" message until it is.)
- Confirm the API's `CORS_ORIGIN` (step 3) includes the exact web origin, and that
  `AUTH_JWKS_URL` / `AUTH_ISSUER` point at Authenticize.

---

## 6. Bootstrap your admin (after first sign-in)

Users are **invited from the Authenticize dashboard** (it's invite-only). Then map
that user to your org by their Authenticize **user ID** (a string, not a UUID):

1. In the Authenticize dashboard, create your user (or accept the invite) and sign in
   once at the Sentire web URL.
2. Copy your **user ID** from the Authenticize dashboard → Users.
3. Run against the DB as the owner/superuser:
   ```sql
   INSERT INTO app_users (id, org_id, email, full_name, role)
   VALUES (
     '<your-authenticize-user-id>',                 -- e.g. 'aBcd1234...'
     'a0000000-0000-0000-0000-000000000001',        -- the org id from setup
     'you@example.com',
     'Your Name',
     'admin'
   )
   ON CONFLICT (id) DO NOTHING;
   ```
4. Reload the app — you're in, scoped to your org by RLS.

---

## 7. Verify, then cut over

- `GET /health` on the API returns ok.
- Sign in with **company code + email** (and Google/Microsoft once enabled).
- Post a journal entry; open Reports (trial balance balances); create a contact.
- Optional: point **custom domains** at web + API + Authenticize (on one shared root),
  then update `VITE_API_BASE_URL`, `VITE_AUTH_URL`, `CORS_ORIGIN`, Authenticize's
  `TRUSTED_ORIGINS`/`COOKIE_DOMAIN`, and the registered app to match.
- Once green, **delete the Render services**. `render.yaml` can stay in the repo
  (harmless) or be removed.

**CI is unaffected** — GitHub Actions spins up its own throwaway Postgres and doesn't
deploy, so no changes are needed there. Turn on Sliplane's auto-deploy-on-push if you
want the same "merge → deploy" flow you had on Render.

---

## Reference — environment variables at a glance

**Postgres** (Sliplane managed or `postgres:16`): DB `sentire_books`; owner/superuser
for setup, and the non-superuser `sentire_books_app` role for the API.

**`sentire-books-api`** (runtime env):
```
DATABASE_URL=postgres://sentire_books_app:<APP_PW>@<db-host>:<port>/sentire_books?sslmode=no-verify
AUTH_JWKS_URL=<AUTHENTICIZE_URL>/api/auth/jwks
AUTH_ISSUER=<AUTHENTICIZE_URL>
CORS_ORIGIN=https://<web-origin>,http://localhost:5173
PORT=8787
```

**`sentire-books-web`** (build args, baked into the bundle):
```
VITE_API_BASE_URL=https://<api-origin>
VITE_AUTH_URL=<AUTHENTICIZE_URL>
```

**Authenticize** (its own service — see its `.env.example`): `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL=<AUTHENTICIZE_URL>`, its own `DATABASE_URL`, `ADMIN_EMAILS`,
`TRUSTED_ORIGINS=<web-origin>`, `COOKIE_DOMAIN=.<root-domain>`, and `GOOGLE_CLIENT_ID`
/`GOOGLE_CLIENT_SECRET` for Google SSO.

Secrets (DB passwords, `BETTER_AUTH_SECRET`, OAuth secrets) live **only** in the
Sliplane dashboard — never in the repo.
