/**
 * Liveness and readiness (M1.4).
 *
 * Two endpoints, because they answer different questions and a platform that
 * conflates them will restart-loop through an outage it cannot fix:
 *
 *   GET /live    — is the process alive? Cheap, no dependencies, always 200
 *                  while the event loop turns. This is what the container
 *                  platform should probe: restarting the API does not repair a
 *                  broken database, so a DB blip must not trigger a restart.
 *
 *   GET /health  — is the service actually able to serve? Checks the database
 *                  round-trip and reports degraded capabilities. 503 when it
 *                  cannot serve. This is what the uptime monitor should probe,
 *                  and what a load balancer should use to take an instance out.
 *
 * Neither response ever contains a host, credential or connection string — a
 * health endpoint is unauthenticated, so its body is public.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db, lockoutColumnsAvailable } from "@sentire-books/db";
import { isWorkspaceResetEnabled } from "./config";
import { errorTrackingEnabled } from "./observability";
import { serializeError } from "./logger";

/** A hung database must not hang the probe. */
const DB_TIMEOUT_MS = Number(process.env.HEALTH_DB_TIMEOUT_MS ?? 3000);

export interface HealthReport {
  ok: boolean;
  service: "sentire-books-api";
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    signInLockout: "durable" | "in_memory_only";
    errorTracking: "enabled" | "not_configured";
    workspaceReset: "disabled" | "ENABLED";
  };
}

async function checkDatabase(): Promise<HealthReport["checks"]["database"]> {
  const started = Date.now();
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`database did not respond within ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    // serializeError scrubs the connection string the driver embeds.
    const { message } = serializeError(err) as { message: string };
    return { ok: false, latencyMs: Date.now() - started, error: message };
  }
}

export async function buildHealthReport(): Promise<HealthReport> {
  const database = await checkDatabase();
  return {
    ok: database.ok,
    service: "sentire-books-api",
    checks: {
      database,
      // Surfaced so a missed 0022 delta is visible to monitoring, not just in
      // a boot log nobody re-reads.
      signInLockout: lockoutColumnsAvailable() ? "durable" : "in_memory_only",
      errorTracking: errorTrackingEnabled() ? "enabled" : "not_configured",
      // Visible on purpose: a destructive switch left on should be noticed.
      workspaceReset: isWorkspaceResetEnabled() ? "ENABLED" : "disabled",
    },
  };
}

export const healthRoutes = new Hono();

/** Liveness — the container platform's restart probe. No dependencies. */
healthRoutes.get("/live", (c) => c.json({ ok: true, service: "sentire-books-api" }));

/** Readiness — the uptime monitor's probe. 503 when the DB is unreachable. */
healthRoutes.get("/health", async (c) => {
  const report = await buildHealthReport();
  return c.json(report, report.ok ? 200 : 503);
});
