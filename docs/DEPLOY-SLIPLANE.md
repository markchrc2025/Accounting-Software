# Deploying Sentire Books on Sliplane

How to run the whole stack — **web + API + PostgreSQL** — as Docker containers on
[Sliplane](https://sliplane.io), replacing Render.

> **Read this first — the one thing that can't move.** Your login, Google/Microsoft
> SSO, and JWT verification are all provided by **Supabase Auth**. Sliplane is a
> Docker host, not an identity provider — it has no equivalent. So the practical
> migration is:
>
> | Layer | Today | After |
> |---|---|---|
> | Web (Vite SPA) | Render static | **Sliplane** (nginx container) |
> | API (Hono) | Render web service | **Sliplane** (Node container) |
> | App database (Postgres) | Supabase Postgres | **Sliplane** (Postgres container + volume) |
> | **Auth / SSO / JWKS** | **Supabase Auth** | **Supabase Auth (kept)** |
>
> You keep the free Supabase project **purely as the identity provider** (it issues
> the JWTs the API verifies via JWKS). Everything else runs on Sliplane. Fully
> deleting Supabase means replacing the entire auth system — see
> [§8](#8-if-you-really-want-zero-supabase).
>
> Because there is **no data yet**, moving the database is low-risk: a fresh
> Postgres just needs the schema, which is the SQL script you already have.

---

## 0. Prerequisites

- A Sliplane account with a **server** provisioned (Sliplane runs your containers
  on a Hetzner server you control).
- Your GitHub repo connected to Sliplane (so it can build from the Dockerfiles).
- `psql` on your laptop (to run the schema once).
- Your Supabase project kept alive (Auth only). Note its ref: `mqsdymealtdrzmbnvvoc`.
- Decide two passwords up front:
  - **DB superuser** password (`postgres` role) — for migrations/admin.
  - **App role** password (`sentire_books_app`) — what the API connects with.

The repo already contains everything Sliplane needs to build:
- `scalebooks/apps/api/Dockerfile` — the API image.
- `scalebooks/apps/web/Dockerfile` + `scalebooks/apps/web/nginx.conf` — the web image.
- `scalebooks/.dockerignore`.
- `scalebooks/setup/db-setup.sql` — the full schema (works on any Postgres 15+).

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

1. **Edit the bootstrap values** in `scalebooks/setup/db-setup.sql` (three
   `-- EDIT` spots):
   - `ALTER ROLE sentire_books_app WITH LOGIN PASSWORD '…'` → your **app role** password.
   - the `organizations` insert → your **company name** and **company code**
     (the tenant ID users type at login, e.g. `SENTIRE`).
2. **Run it against your DB as the owner/superuser** (the `owner` URL from Sliplane's
   managed Postgres, or `postgres` for your own container):
   ```bash
   psql "postgres://owner:<PW>@<host>:<port>/sentire_books?sslmode=no-verify" \
     -f scalebooks/setup/db-setup.sql
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
  | `AUTH_JWKS_URL` | `https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1/.well-known/jwks.json` |
  | `AUTH_ISSUER` | `https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1` |
  | `CORS_ORIGIN` | `https://<your-web-service>.sliplane.app,http://localhost:5173` |
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
  | `VITE_API_BASE_URL` | your API URL from step 3, e.g. `https://sentire-books-api.sliplane.app` |
  | `VITE_SUPABASE_URL` | `https://mqsdymealtdrzmbnvvoc.supabase.co` |
  | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_roR2UnE41AKs4Qwb8fQuKQ_nHp8EgKD` |

  If Sliplane doesn't expose build args for your plan, hard-code these three as the
  `ARG` defaults in `apps/web/Dockerfile` (they're public). `VITE_API_BASE_URL` **must**
  be set to the real API URL before the build, or the SPA will call the wrong host.

- After deploy, note the web URL (e.g. `https://sentire-books-web.sliplane.app`).

---

## 5. Point Supabase Auth at the new web origin

Supabase still handles login; it just needs to trust the new URL.

- **Supabase → Authentication → URL Configuration:**
  - **Site URL:** `https://<your-web-service>.sliplane.app`
  - **Redirect URLs:** add `https://<your-web-service>.sliplane.app/**` (keep
    `http://localhost:5173/**` for local dev).
- Google/Microsoft provider settings don't change — SSO redirects to Supabase, which
  redirects back to an allow-listed app URL.
- Confirm `CORS_ORIGIN` on the API (step 3) includes the exact web origin.

---

## 6. Bootstrap your admin (after first sign-in)

Because the app DB is no longer inside Supabase, map your admin by **UID** rather than
joining `auth.users`:

1. Sign in once at your web URL (creates the Supabase auth user).
2. **Supabase → Authentication → Users** → copy your user's **UID**.
3. Run against the DB as the owner/superuser:
   ```sql
   INSERT INTO app_users (id, org_id, email, full_name, role)
   VALUES (
     '<your-supabase-uid>',
     'a0000000-0000-0000-0000-000000000001',  -- the org id from setup
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
- Optional: point a **custom domain** in Sliplane at the web (and API) services, then
  update `VITE_API_BASE_URL`, `CORS_ORIGIN`, and the Supabase redirect URLs to match.
- Once green, **delete the Render services**. `render.yaml` can stay in the repo
  (harmless) or be removed.

**CI is unaffected** — GitHub Actions spins up its own throwaway Postgres and doesn't
deploy, so no changes are needed there. Turn on Sliplane's auto-deploy-on-push if you
want the same "merge → deploy" flow you had on Render.

---

## 8. If you *really* want zero Supabase

Dropping Supabase entirely means replacing **Auth**, which is a separate project, not a
config change. Two routes:

1. **Self-host Supabase Auth (GoTrue)** as another Sliplane container + configure the
   Google/Microsoft OAuth apps against it, and repoint `AUTH_JWKS_URL`/`AUTH_ISSUER` +
   `VITE_SUPABASE_URL` at it. Most faithful (the app code barely changes) but you now
   operate an auth server.
2. **Swap providers** (e.g. Auth0, Clerk, Keycloak, Ory). The API already verifies any
   standard JWKS/OIDC issuer, so this is mostly reconfiguration plus wiring the web
   login UI to the new SDK.

Recommendation: **don't** — keep Supabase Auth. It's free at this scale, the JWKS/JWT
chain is already built and hardened, and it keeps the migration to "lift the compute
and data onto Sliplane" instead of "rebuild login."

---

## Reference — environment variables at a glance

**`sentire-books-db`** (Postgres container): `POSTGRES_USER=postgres`,
`POSTGRES_PASSWORD=…`, `POSTGRES_DB=sentire_books` + a volume at
`/var/lib/postgresql/data`.

**`sentire-books-api`** (runtime env):
```
DATABASE_URL=postgres://sentire_books_app:<APP_PW>@<db-host>:<port>/sentire_books?sslmode=no-verify
AUTH_JWKS_URL=https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1/.well-known/jwks.json
AUTH_ISSUER=https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1
CORS_ORIGIN=https://<web>.sliplane.app,http://localhost:5173
PORT=8787
```

**`sentire-books-web`** (build args, baked into the bundle):
```
VITE_API_BASE_URL=https://<api>.sliplane.app
VITE_SUPABASE_URL=https://mqsdymealtdrzmbnvvoc.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_roR2UnE41AKs4Qwb8fQuKQ_nHp8EgKD
```

Secrets (DB passwords) live **only** in the Sliplane dashboard — never in the repo.
