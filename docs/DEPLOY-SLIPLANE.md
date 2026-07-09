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
  - **App role** password (`scalebooks_app`) — what the API connects with.

The repo already contains everything Sliplane needs to build:
- `scalebooks/apps/api/Dockerfile` — the API image.
- `scalebooks/apps/web/Dockerfile` + `scalebooks/apps/web/nginx.conf` — the web image.
- `scalebooks/.dockerignore`.
- `scalebooks/setup/supabase-setup.sql` — the full schema (works on any Postgres 15+).

For **all three** Sliplane services set **Build context = `scalebooks`** (the pnpm
workspace root), and the Dockerfile path as noted below.

---

## 1. Create the database service (`scalebooks-db`)

Create a service from the **Postgres** image (Sliplane marketplace, or a plain
`postgres:16` Docker image).

- **Image:** `postgres:16`
- **Volume (required — or you lose data on redeploy):** mount a persistent volume
  at `/var/lib/postgresql/data`.
- **Port:** `5432` — keep it **internal** (do not expose publicly, except the
  temporary window in step 2).
- **Environment:**

  | Key | Value |
  |---|---|
  | `POSTGRES_USER` | `postgres` |
  | `POSTGRES_PASSWORD` | *your DB superuser password* |
  | `POSTGRES_DB` | `scalebooks` |

Note the service's **internal hostname** (Sliplane shows it — typically the service
name, e.g. `scalebooks-db`). The API reaches the DB at that host on the private
network.

---

## 2. Load the schema (run once)

The schema is plain SQL and runs on any Postgres 15+. There is no data to migrate.

1. **Edit the bootstrap values** in `scalebooks/setup/supabase-setup.sql` (three
   `-- EDIT` spots):
   - `ALTER ROLE scalebooks_app WITH LOGIN PASSWORD '…'` → your **app role** password.
   - the `organizations` insert → your **company name** and **company code**
     (the tenant ID users type at login, e.g. `SENTIRE`).
2. **Run it against the Sliplane DB.** Easiest: temporarily give `scalebooks-db` a
   public port in Sliplane, then from your laptop:
   ```bash
   psql "postgresql://postgres:<DB_SUPERUSER_PW>@<public-host>:<public-port>/scalebooks" \
     -f scalebooks/setup/supabase-setup.sql
   # then REMOVE the public port again in Sliplane.
   ```
   (Alternative: open a shell/console on the `scalebooks-db` service and pipe the
   file into `psql -U postgres -d scalebooks`.)

This creates the schema, ledger-integrity triggers, RLS, reporting views, the
`scalebooks_app` login role, your organization + company code, and the 158-account
default chart. It runs as the `postgres` **owner**, which is exempt from RLS — exactly
how the API's non-owner `scalebooks_app` role is *not*.

> The setup file's final admin block is Supabase-specific (`FROM auth.users`) and is
> **commented out** — leave it. You'll map your admin in step 6 by UID instead.

---

## 3. Create the API service (`scalebooks-api`)

- **Dockerfile:** `apps/api/Dockerfile` · **Build context:** `scalebooks` · **Port:** `8787`
- **Environment:**

  | Key | Value |
  |---|---|
  | `DATABASE_URL` | `postgresql://scalebooks_app:<APP_PW>@<db-internal-host>:5432/scalebooks` |
  | `AUTH_JWKS_URL` | `https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1/.well-known/jwks.json` |
  | `AUTH_ISSUER` | `https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1` |
  | `CORS_ORIGIN` | `https://<your-web-service>.sliplane.app,http://localhost:5173` |
  | `PORT` | `8787` (optional; matches the service port) |

  Do **not** set `AUTH_DEV_BYPASS` — it's local-only and, once `AUTH_JWKS_URL` is set,
  is structurally unreachable anyway.

- Connect it as the **RLS-bound `scalebooks_app` role** — never as `postgres`. That is
  what makes Row-Level Security actually enforce tenant isolation.
- After deploy, note the API URL (e.g. `https://scalebooks-api.sliplane.app`) and
  smoke-test: `curl https://scalebooks-api.sliplane.app/health` → `{"ok":true,…}`.

---

## 4. Create the web service (`scalebooks-web`)

- **Dockerfile:** `apps/web/Dockerfile` · **Build context:** `scalebooks` · **Port:** `80`
- **Build arguments** (Vite inlines these at build time — all are public/safe):

  | Build arg | Value |
  |---|---|
  | `VITE_API_BASE_URL` | your API URL from step 3, e.g. `https://scalebooks-api.sliplane.app` |
  | `VITE_SUPABASE_URL` | `https://mqsdymealtdrzmbnvvoc.supabase.co` |
  | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_roR2UnE41AKs4Qwb8fQuKQ_nHp8EgKD` |

  If Sliplane doesn't expose build args for your plan, hard-code these three as the
  `ARG` defaults in `apps/web/Dockerfile` (they're public). `VITE_API_BASE_URL` **must**
  be set to the real API URL before the build, or the SPA will call the wrong host.

- After deploy, note the web URL (e.g. `https://scalebooks-web.sliplane.app`).

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
3. Run against the Sliplane DB (as `postgres`):
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

**`scalebooks-db`** (Postgres container): `POSTGRES_USER=postgres`,
`POSTGRES_PASSWORD=…`, `POSTGRES_DB=scalebooks` + a volume at
`/var/lib/postgresql/data`.

**`scalebooks-api`** (runtime env):
```
DATABASE_URL=postgresql://scalebooks_app:<APP_PW>@<db-internal-host>:5432/scalebooks
AUTH_JWKS_URL=https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1/.well-known/jwks.json
AUTH_ISSUER=https://mqsdymealtdrzmbnvvoc.supabase.co/auth/v1
CORS_ORIGIN=https://<web>.sliplane.app,http://localhost:5173
PORT=8787
```

**`scalebooks-web`** (build args, baked into the bundle):
```
VITE_API_BASE_URL=https://<api>.sliplane.app
VITE_SUPABASE_URL=https://mqsdymealtdrzmbnvvoc.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_roR2UnE41AKs4Qwb8fQuKQ_nHp8EgKD
```

Secrets (DB passwords) live **only** in the Sliplane dashboard — never in the repo.
