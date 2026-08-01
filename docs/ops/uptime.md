# Runbook — Health checks, uptime monitoring & alerting (M1.4)

> **What is already done (in the repo):** two endpoints — `/live` (liveness) and
> `/health` (readiness, checks the database) — implemented in
> `apps/api/src/health.ts` and covered by tests.
>
> **What only you can do:** point the platform's restart probe at `/live`, create
> the external uptime monitor against `/health`, and choose where alerts land.

---

## ⚠️ Use the right endpoint for the right job

These answer different questions, and wiring them the wrong way round turns a
database blip into a restart loop.

| Endpoint | Question | Touches DB | Probe it from |
|---|---|---|---|
| **`/live`** | Is the process alive? | ❌ no | The **container platform** (Sliplane health check) |
| **`/health`** | Can it actually serve? | ✅ yes | The **external uptime monitor**, and any load balancer |

**Why they are separate.** Restarting the API does not repair a broken database.
If the platform's restart probe checked the DB, a database outage would kill and
recreate a perfectly healthy container over and over — turning a recoverable
incident into a crash-loop that also destroys your in-memory sign-in throttles.
`/live` stays 200 through a DB outage on purpose.

**Verified behaviour** (Postgres stopped mid-flight):

```
DB up    →  /live 200   /health 200  {"ok":true, "database":{"ok":true,"latencyMs":1}}
DB down  →  /live 200   /health 503  {"ok":false,"database":{"ok":false,"error":"connect ECONNREFUSED …"}}
```

`/health` also reports capability state, so a half-applied deploy is visible to
monitoring rather than buried in a boot log:

```json
{
  "ok": true,
  "checks": {
    "database":       { "ok": true, "latencyMs": 1 },
    "signInLockout":  "durable",          // "in_memory_only" ⇒ delta 0022 not applied
    "errorTracking":  "not_configured",   // ⇒ SENTRY_DSN not set
    "workspaceReset": "disabled"          // "ENABLED" ⇒ a destructive switch is on
  }
}
```

Both endpoints are **unauthenticated**, so their bodies are public by design.
Neither ever contains a host, credential or connection string — asserted by test.

---

## Step 1 — Repoint the platform health check *(you)*

In the Sliplane service settings for **`sentire-books-api`**, set the health-check
path to:

```
/live
```

It is currently `/health` (per `render.yaml`, which is stale anyway). Leaving it
on `/health` is the crash-loop described above.

## Step 2 — Create the external uptime monitor *(you)*

Any of Better Stack, UptimeRobot, Healthchecks.io or Pingdom will do. Free tiers
are sufficient at this scale.

| Setting | Value |
|---|---|
| **URL** | `https://<your-api-host>/health` |
| **Method** | GET |
| **Interval** | 60 s (1–5 min on a free tier is fine) |
| **Expect status** | `200` |
| **Expect body contains** | `"ok":true` |
| **Timeout** | 10 s |
| **Alert after** | 2 consecutive failures (avoids paging on one blip) |

Also monitor the **portal** so a broken frontend deploy is caught:

| Setting | Value |
|---|---|
| **URL** | `https://books.sentire.solutions/` |
| **Expect status** | `200` |

## Step 3 — Choose where alerts land *(you)*

Route to something you will actually see out of hours — **email plus one of**
SMS, a phone app push, or a Slack/Telegram channel. Email alone is not enough
for a system holding other businesses' books.

**Send these three to the same destination:**

1. Uptime monitor — `/health` failing.
2. **Backup job failure** (M1.1) — a non-zero exit from `backup.sh`.
3. Sentry (M1.3) — new-issue alerts, once `SENTRY_DSN` is configured.

## Step 4 — Verify the alert path *(you — actually do this)*

An alert channel you have never tested is a rumour, exactly like an untested
backup. Prove it end to end:

```bash
# Temporarily stop the database (or point the API at a bad port) and confirm:
#   1. /health starts returning 503
#   2. the monitor fires within its interval
#   3. the alert reaches your phone / channel
curl -i https://<your-api-host>/health     # expect: HTTP/1.1 503
```

Record the date you verified it here:

| Date verified | Channel | By |
|---|---|---|
| _(pending)_ | | |

---

## What to watch beyond up/down

Once the basics are wired, these are the signals worth a dashboard. All are
already emitted as structured JSON by the logger (M1.3) — `requestId`, `orgId`,
`userId`, `route`, `method`, `status`, `durationMs` on every request.

| Signal | Where from | Alert when |
|---|---|---|
| Error rate | log lines with `"msg":"request failed"` | > 1% of requests over 5 min |
| p95 latency | `durationMs` | > 2 s sustained |
| Sign-in failures | `route:"/auth/password"` + `status:401/429` | a spike suggests credential stuffing |
| `signInLockout` degraded | `/health` body | ever `in_memory_only` in production |
| `workspaceReset` on | `/health` body | ever `ENABLED` in production |

The last two are cheap tripwires for the exact misconfigurations Milestone 0
closed — worth alerting on precisely because they should never be true.
