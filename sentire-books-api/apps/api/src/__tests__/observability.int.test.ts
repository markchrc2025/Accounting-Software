/**
 * Observability tests (M1.3) — real routers, real middleware.
 *
 * Two properties:
 *  1. An induced 500 is CAPTURED with the org, user, route and request id
 *     attached — the context that makes an incident diagnosable. Previously a
 *     failure was a bare `console.error("[handler]", err)` with none of it.
 *  2. Secrets never reach a log line or an error report. This is a bookkeeping
 *     platform; a connection string or bearer token in a log aggregator is a
 *     breach, so it is asserted rather than assumed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { scrubSecrets, serializeError, logger } from "../logger";
import { requestContext, reportError } from "../observability";
import { DEMO_ORG_ID, DEMO_ADMIN_ID, DEMO_ADMIN_EMAIL } from "@sentire-books/db";

const RUN = !!process.env.DATABASE_URL;

/* ── Secret scrubbing (pure, always runs) ─────────────────────────────────── */

describe("scrubSecrets", () => {
  it("masks a Postgres connection string, password and all", () => {
    const out = scrubSecrets(
      'connect failed: postgres://sentire_books_app:sup3rs3cret@db.internal:5432/sentire_books',
    );
    expect(out).not.toContain("sup3rs3cret");
    expect(out).not.toContain("db.internal");
    expect(out).toContain("[REDACTED]");
  });

  it("masks postgresql:// too", () => {
    expect(scrubSecrets("postgresql://u:p@h/d")).not.toContain("p@h");
  });

  it("masks a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2lnbmF0dXJlX2hlcmU";
    const out = scrubSecrets(`token rejected: ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[REDACTED_JWT]");
  });

  it("masks a Bearer header value", () => {
    const out = scrubSecrets("Authorization: Bearer abc123.def456-ghi");
    expect(out).not.toContain("abc123");
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("leaves ordinary text alone", () => {
    const msg = "voucher PV202608-0001 is out of balance by 5 centavos";
    expect(scrubSecrets(msg)).toBe(msg);
  });
});

describe("serializeError", () => {
  it("scrubs the message and the stack", () => {
    const err = new Error("could not connect to postgres://u:hunter2@h:5432/db");
    const out = serializeError(err);
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(out.message).toContain("[REDACTED]");
  });

  it("keeps a Postgres error code, which is the diagnostic part", () => {
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(serializeError(err).code).toBe("23505");
  });

  it("handles a non-Error throw", () => {
    expect(serializeError("plain string").message).toBe("plain string");
  });
});

/* ── Request context + error capture ──────────────────────────────────────── */

describe.skipIf(!RUN)("induced error is captured with context", () => {
  const lines: Record<string, unknown>[] = [];
  let restore: () => void;

  beforeAll(async () => {
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
    // Capture what pino would emit, without asserting on its transport.
    const spy = vi.spyOn(logger, "child").mockImplementation(((bindings: Record<string, unknown>) => {
      const child = {
        error: (obj: unknown, msg?: string) => lines.push({ level: "error", ...bindings, ...(obj as object), msg }),
        warn: (obj: unknown, msg?: string) => lines.push({ level: "warn", ...bindings, ...(obj as object), msg }),
        info: (obj: unknown, msg?: string) => lines.push({ level: "info", ...bindings, ...(obj as object), msg }),
      };
      return child as never;
    }) as never);
    restore = () => spy.mockRestore();
  });

  afterAll(() => restore?.());

  /** A router whose handler always throws, mounted behind the real auth stack. */
  const buildApp = async () => {
    const { requireAuth } = await import("../auth");
    const app = new Hono();
    app.use("*", requestContext);
    app.get("/boom", requireAuth, async (c) => {
      try {
        throw Object.assign(
          new Error("simulated failure against postgres://app:leakme@db:5432/books"),
          { code: "XX000" },
        );
      } catch (err) {
        reportError(c, "inducedFailure", err);
        return c.json({ error: "internal_error" }, 500);
      }
    });
    return app;
  };

  it("captures the error with org, user, route and request id — and no secret", async () => {
    lines.length = 0;
    const app = await buildApp();

    const res = await app.request("/boom", {
      headers: {
        "x-user-id": DEMO_ADMIN_ID,
        "x-user-email": DEMO_ADMIN_EMAIL,
        "x-org-id": DEMO_ORG_ID,
      },
    });

    expect(res.status).toBe(500);
    // The request id is echoed so a user report can be traced to a log line.
    expect(res.headers.get("x-request-id")).toBeTruthy();

    const captured = lines.find((l) => l.where === "inducedFailure");
    expect(captured, "the induced error should have been captured").toBeTruthy();
    expect(captured!.orgId).toBe(DEMO_ORG_ID);
    expect(captured!.userId).toBe(DEMO_ADMIN_ID);
    expect(captured!.route).toBe("/boom");
    expect(captured!.requestId).toBeTruthy();

    // The connection string in the error message must not survive.
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("leakme");
    expect(serialized).toContain("[REDACTED]");
    // The diagnostic bits survive.
    expect(serialized).toContain("XX000");
  });

  it("logs a completion line carrying status and latency", async () => {
    lines.length = 0;
    const app = await buildApp();
    await app.request("/boom", {
      headers: {
        "x-user-id": DEMO_ADMIN_ID,
        "x-user-email": DEMO_ADMIN_EMAIL,
        "x-org-id": DEMO_ORG_ID,
      },
    });

    const completion = lines.find((l) => l.msg === "request failed");
    expect(completion, "a 5xx should log a completion line at error level").toBeTruthy();
    expect(completion!.status).toBe(500);
    expect(typeof completion!.durationMs).toBe("number");
    expect(completion!.orgId).toBe(DEMO_ORG_ID);
  });

  it("honours an inbound x-request-id so a trace spans services", async () => {
    const app = await buildApp();
    const res = await app.request("/boom", {
      headers: {
        "x-request-id": "trace-me-123",
        "x-user-id": DEMO_ADMIN_ID,
        "x-user-email": DEMO_ADMIN_EMAIL,
        "x-org-id": DEMO_ORG_ID,
      },
    });
    expect(res.headers.get("x-request-id")).toBe("trace-me-123");
  });
});
