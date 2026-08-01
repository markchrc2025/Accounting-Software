/**
 * Error tracking + request context (M1.3).
 *
 * Sentry is optional: with no SENTRY_DSN set, every function here is a no-op, so
 * local development and CI run unchanged. When a DSN is present, unhandled
 * errors are reported with the org, user and route attached — the context that
 * makes an incident diagnosable.
 *
 * Nothing sent to Sentry contains a token, password or connection string:
 * payloads pass through the same `scrubSecrets()` used by the logger.
 */
import * as Sentry from "@sentry/node";
import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";
import { requestLogger, serializeError, scrubSecrets, type LogContext } from "./logger";

let enabled = false;

/** Initialize error tracking. Safe to call when no DSN is configured. */
export function initErrorTracking(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Last line of defence: scrub anything secret-shaped before it leaves.
    beforeSend(event) {
      if (event.message) event.message = scrubSecrets(event.message);
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubSecrets(ex.value);
      }
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
  enabled = true;
}

export function errorTrackingEnabled(): boolean {
  return enabled;
}

declare module "hono" {
  interface ContextVariableMap {
    log: ReturnType<typeof requestLogger>;
    requestId: string;
  }
}

/**
 * Per-request context: assigns a request id, binds a child logger, and logs one
 * completion line with method, route, status and latency.
 *
 * Org and user are resolved by `requireAuth` AFTER this middleware runs, so they
 * are read at completion time rather than at entry.
 */
export async function requestContext(c: Context, next: Next) {
  const requestId = c.req.header("x-request-id") ?? randomUUID();
  const started = Date.now();

  const base: LogContext = {
    requestId,
    route: c.req.path,
    method: c.req.method,
  };
  c.set("requestId", requestId);
  c.set("log", requestLogger(base));

  // Surface the id so a user-reported error can be traced to a log line.
  c.header("x-request-id", requestId);

  try {
    await next();
  } finally {
    const auth = c.get("auth");
    const done = requestLogger({
      ...base,
      orgId: auth?.orgId,
      userId: auth?.userId,
    });
    const durationMs = Date.now() - started;
    const status = c.res?.status ?? 0;
    const line = { status, durationMs };
    if (status >= 500) done.error(line, "request failed");
    else if (status >= 400) done.warn(line, "request rejected");
    else done.info(line, "request");
  }
}

/**
 * Report a handled error with its request context. Use in place of
 * `console.error("[handler]", err)`.
 */
export function reportError(c: Context, where: string, err: unknown): void {
  const auth = c.get("auth");
  const log = c.get("log") ?? requestLogger({ requestId: "unknown", route: c.req.path });

  log.error({ where, err: serializeError(err), orgId: auth?.orgId, userId: auth?.userId }, `${where} failed`);

  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("handler", where);
    scope.setTag("route", c.req.path);
    scope.setTag("method", c.req.method);
    if (auth?.orgId) scope.setTag("org_id", auth.orgId);
    if (auth?.userId) scope.setUser({ id: auth.userId });
    scope.setContext("request", { id: c.get("requestId"), route: c.req.path, method: c.req.method });
    Sentry.captureException(err);
  });
}

/** Flush buffered events — call before a deliberate exit. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
