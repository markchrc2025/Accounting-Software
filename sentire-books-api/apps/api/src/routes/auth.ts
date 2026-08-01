import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getUserWorkspaces, withOrgContext, appUsers } from "@sentire-books/db";
import { requireAuth, requireIdentity } from "../auth";
import { passwordSignIn } from "../password";
import { authThrottleConfig } from "../config";
import { FailureLimiter } from "../authLimiter";

export const authRoutes = new Hono();

/**
 * Sign-in brakes (M0.4). Only FAILURES are counted, so a normal sign-in is
 * never throttled. The per-email limiter also covers emails that do not exist,
 * which is what keeps a throttled response from confirming an account is real.
 *
 * TODO(M7): per-process state — move to a shared store when the API runs more
 * than one instance, or an attacker's budget multiplies by the instance count.
 */
const throttle = authThrottleConfig();
const ipLimiter = new FailureLimiter(throttle.windowMs, throttle.ipMaxFailures);
const emailLimiter = new FailureLimiter(throttle.windowMs, throttle.emailMaxFailures);

// Keep the maps from growing without bound on a long-lived process.
const sweepTimer = setInterval(
  () => {
    ipLimiter.sweep();
    emailLimiter.sweep();
  },
  Math.max(throttle.windowMs, 60_000),
);
sweepTimer.unref?.();

/** Test seam — lets the integration suite start from a clean slate. */
export function __resetAuthLimiters(): void {
  ipLimiter.reset();
  emailLimiter.reset();
}

/** Best-effort client IP; falls back to a constant so the limiter still works. */
function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "unknown";
}

// In-app email/password sign-in (public). Verifies against Sentire Books' own
// credentials and returns a JWT the SPA uses as a Bearer token. The workspace is
// then resolved as usual (the form's company code selects it).
authRoutes.post("/password", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const email = typeof (body as { email?: unknown })?.email === "string" ? (body as { email: string }).email.trim() : "";
  const password =
    typeof (body as { password?: unknown })?.password === "string" ? (body as { password: string }).password : "";
  if (!email || !password) return c.json({ error: "missing_credentials" }, 400);

  const ip = clientIp(c);
  const emailKey = email.toLowerCase();

  // Throttled callers are rejected before any password work — cheap, and it
  // bounds guessing regardless of whether the email exists.
  const tooMany = (retryAfterSec: number) =>
    c.json(
      {
        error: "too_many_attempts",
        detail: "Too many sign-in attempts. Try again later.",
        retryAfterSec,
      },
      429,
      { "Retry-After": String(retryAfterSec) },
    );

  const ipState = ipLimiter.check(ip);
  if (ipState.limited) return tooMany(ipState.retryAfterSec);
  const emailState = emailLimiter.check(emailKey);
  if (emailState.limited) return tooMany(emailState.retryAfterSec);

  const result = await passwordSignIn(email, password);

  if ("error" in result) {
    // A durable lockout reports 429 straight through; a bad password also
    // charges both limiters.
    if (result.status === 429) return tooMany(result.retryAfterSec ?? 60);
    ipLimiter.fail(ip);
    emailLimiter.fail(emailKey);
    return c.json({ error: result.error }, result.status as 401 | 502);
  }

  ipLimiter.clear(ip);
  emailLimiter.clear(emailKey);
  return c.json({ token: result.token });
});

// Every workspace the signed-in identity can access. Needs only a valid token
// (no workspace chosen yet) — the web app calls this right after login to decide
// whether to auto-enter the single workspace or show a picker.
authRoutes.get("/workspaces", requireIdentity, async (c) => {
  const { email } = c.get("identity");
  const workspaces = await getUserWorkspaces(email);
  return c.json({
    email,
    workspaces: workspaces.map((w) => ({
      id: w.orgId,
      code: w.orgCode,
      name: w.orgName,
      role: w.role,
    })),
  });
});

// The signed-in user's identity, resolved for the ACTIVE workspace (chosen via
// the x-org-id header) and their role in it.
authRoutes.get("/me", requireAuth, async (c) => {
  const a = c.get("auth");
  // The profile card needs a display name; fetch it from the allowlist row.
  const [row] = await withOrgContext(
    { userId: a.userId, orgId: a.orgId, role: a.role },
    (tx) =>
      tx
        .select({ fullName: appUsers.fullName, profile: appUsers.profile })
        .from(appUsers)
        .where(and(eq(appUsers.orgId, a.orgId), eq(appUsers.id, a.userId))),
  );
  return c.json({
    user: {
      id: a.userId,
      email: a.email,
      fullName: row?.fullName ?? null,
      profile: row?.profile ?? null,
    },
    org: { id: a.orgId, name: a.orgName, code: a.orgCode },
    role: a.role,
  });
});
