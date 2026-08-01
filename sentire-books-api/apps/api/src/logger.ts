/**
 * Structured logging (M1.3).
 *
 * Replaces ~30 bare `console.error("[handler]", err)` calls, which carried no
 * request id, org, user, route or latency — an incident was invisible.
 *
 * ── Secrets never reach the logs ──────────────────────────────────────────────
 * Two independent defences, because this is a bookkeeping platform and a leaked
 * connection string or bearer token in a log aggregator is a breach:
 *
 *   1. pino `redact` paths blank out the usual carriers (authorization headers,
 *      cookies, tokens, passwords, connection strings) wherever they appear in
 *      a log object.
 *   2. `scrubSecrets()` walks free-text strings — error messages especially —
 *      and masks anything that looks like a Postgres URL, a JWT, or a Bearer
 *      token. Postgres driver errors happily embed the connection string, so
 *      path-based redaction alone is not enough.
 */
import { pino } from "pino";
import { createRequire } from "node:module";

/** Field paths blanked wherever they appear in a logged object. */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "headers.authorization",
  "headers.cookie",
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "AUTH_JWT_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "connectionString",
  "*.password",
  "*.token",
  "*.secret",
  "*.DATABASE_URL",
];

/** postgres://user:pass@host/db — the driver embeds these in error text. */
const PG_URL = /\b(postgres(?:ql)?:\/\/)[^\s"']*/gi;
/** A JWT: three base64url segments. */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
/** `Bearer <token>` in free text. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

/**
 * Mask secrets embedded in free text. Applied to messages and error strings,
 * where structured redaction cannot reach.
 */
export function scrubSecrets(value: string): string {
  return value
    .replace(PG_URL, "$1[REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(BEARER, "Bearer [REDACTED]");
}

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: "sentire-books-api" },
  // Scrub the message itself — driver errors carry the connection string.
  hooks: {
    logMethod(args, method) {
      const scrubbed = args.map((a) => (typeof a === "string" ? scrubSecrets(a) : a));
      return method.apply(this, scrubbed as Parameters<typeof method>);
    },
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Newline-delimited JSON by default — that is what a log shipper wants, and
  // what production must emit. Pretty output is opt-in via LOG_PRETTY=true and
  // degrades to JSON if pino-pretty is not installed, so a missing dev-only
  // dependency can never stop the API from starting.
  ...(prettyTransport() ?? {}),
});

function prettyTransport(): { transport: { target: string; options: object } } | undefined {
  if (isProd || process.env.LOG_PRETTY !== "true") return undefined;
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } };
  } catch {
    return undefined;
  }
}

/** The per-request context every log line should carry. */
export interface LogContext {
  requestId: string;
  orgId?: string | undefined;
  userId?: string | undefined;
  route?: string | undefined;
  method?: string | undefined;
}

/** A child logger bound to one request. */
export function requestLogger(ctx: LogContext) {
  return logger.child(ctx);
}

/**
 * Normalize an unknown thrown value into something safe to log. Postgres errors
 * carry a `code` worth keeping, and their message may embed the connection
 * string — so the message is scrubbed.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: scrubSecrets(err.message),
    };
    if (err.stack) out.stack = scrubSecrets(err.stack);
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") out.code = code;
    return out;
  }
  return { message: scrubSecrets(String(err)) };
}
