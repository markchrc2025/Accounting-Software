/**
 * CORS allow-list tests (M0.3).
 *
 * Two regressions locked down here:
 *  1. `CORS_ORIGIN=""` is not nullish, so it never fell back to the defaults —
 *     the list collapsed to empty and `allowedOrigins[0] ?? "*"` emitted a
 *     literal wildcard.
 *  2. An unknown origin was answered with the FIRST allowed origin echoed back,
 *     a header the caller can never match. It should get no header at all.
 *
 * The second half drives hono's real cors middleware so the assertion is about
 * the response header, not just our resolver in isolation.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  parseCorsOrigins,
  corsConfigErrors,
  corsConfigWarnings,
  corsOriginResolver,
  DEFAULT_CORS_ORIGINS,
} from "../config";

const PROD = { NODE_ENV: "production" } as const;

describe("parseCorsOrigins", () => {
  it("uses the built-in defaults when CORS_ORIGIN is unset", () => {
    expect(parseCorsOrigins({})).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it("splits, trims and drops blanks", () => {
    expect(parseCorsOrigins({ CORS_ORIGIN: " https://a.test , ,https://b.test ," })).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });

  it("never yields a wildcard, even when one is configured", () => {
    expect(parseCorsOrigins({ CORS_ORIGIN: "https://a.test,*" })).toEqual(["https://a.test"]);
  });

  it("returns EMPTY in production when set-but-blank (so boot can fail)", () => {
    expect(parseCorsOrigins({ ...PROD, CORS_ORIGIN: "" })).toEqual([]);
    expect(parseCorsOrigins({ ...PROD, CORS_ORIGIN: "   " })).toEqual([]);
    expect(parseCorsOrigins({ ...PROD, CORS_ORIGIN: "," })).toEqual([]);
    expect(parseCorsOrigins({ ...PROD, CORS_ORIGIN: "*" })).toEqual([]);
  });

  it("falls back to localhost only (never '*') outside production", () => {
    const origins = parseCorsOrigins({ CORS_ORIGIN: "" });
    expect(origins.length).toBeGreaterThan(0);
    expect(origins).not.toContain("*");
    expect(origins.every((o) => /^http:\/\/(localhost|127\.0\.0\.1)/.test(o))).toBe(true);
  });
});

describe("corsConfigErrors — production boot assertion", () => {
  it("is fatal when the production allow-list resolves to empty", () => {
    const errors = corsConfigErrors({ ...PROD, CORS_ORIGIN: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("CORS_ORIGIN");
  });

  it("is fatal when production configures only a wildcard", () => {
    expect(corsConfigErrors({ ...PROD, CORS_ORIGIN: "*" })).toHaveLength(1);
  });

  it("passes with a real production allow-list", () => {
    expect(corsConfigErrors({ ...PROD, CORS_ORIGIN: "https://books.sentire.solutions" })).toEqual([]);
  });

  it("passes in production when CORS_ORIGIN is unset (defaults apply)", () => {
    expect(corsConfigErrors(PROD)).toEqual([]);
  });

  it("never blocks a non-production boot", () => {
    expect(corsConfigErrors({ CORS_ORIGIN: "" })).toEqual([]);
  });
});

describe("corsConfigWarnings", () => {
  it("warns that a configured wildcard was discarded", () => {
    expect(corsConfigWarnings({ CORS_ORIGIN: "https://a.test,*" })[0]).toContain('"*"');
  });

  it("stays quiet for a normal list", () => {
    expect(corsConfigWarnings({ CORS_ORIGIN: "https://a.test" })).toEqual([]);
    expect(corsConfigWarnings({})).toEqual([]);
  });
});

describe("corsOriginResolver", () => {
  const resolve = corsOriginResolver(["https://a.test", "https://b.test"]);

  it("echoes an allowed origin", () => {
    expect(resolve("https://a.test")).toBe("https://a.test");
  });

  it("returns null for an unknown origin (no header, not a wrong one)", () => {
    expect(resolve("https://evil.test")).toBeNull();
  });

  it("returns null rather than the first allowed origin — the old bug", () => {
    expect(resolve("https://evil.test")).not.toBe("https://a.test");
  });
});

/* ── Response-level: the header the browser actually sees ─────────────────── */

const appWith = (allowed: string[]) => {
  const app = new Hono();
  app.use("*", cors({ origin: corsOriginResolver(allowed) }));
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
};

describe("Access-Control-Allow-Origin header", () => {
  const allowed = ["https://books.sentire.solutions"];

  it("is echoed for a listed origin", async () => {
    const res = await appWith(allowed).request("/health", {
      headers: { Origin: "https://books.sentire.solutions" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://books.sentire.solutions");
  });

  it("is NEVER '*' for an unlisted origin", async () => {
    const res = await appWith(allowed).request("/health", {
      headers: { Origin: "https://evil.test" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("is absent entirely for an unlisted origin", async () => {
    const res = await appWith(allowed).request("/health", {
      headers: { Origin: "https://evil.test" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is not '*' on a preflight from an unlisted origin", async () => {
    const res = await appWith(allowed).request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.test",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});
