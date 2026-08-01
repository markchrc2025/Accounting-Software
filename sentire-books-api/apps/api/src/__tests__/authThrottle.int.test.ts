/**
 * Sign-in throttling + lockout integration tests (M0.4) — real Postgres, real
 * route. Skipped unless DATABASE_URL is set.
 *
 * Thresholds are lowered via env BEFORE importing the route, because its
 * limiters are constructed at module load.
 *
 * Unlock is verified by pushing `locked_until` into the past rather than
 * sleeping out a real backoff — the behaviour under test is "a lapsed lock lets
 * you back in", not the wall clock.
 */
process.env.AUTH_JWT_SECRET ??= "test-signing-secret";
process.env.AUTH_THROTTLE_WINDOW_MS = "60000";
process.env.AUTH_THROTTLE_IP_MAX = "50"; // high, so the email brake trips first
process.env.AUTH_THROTTLE_EMAIL_MAX = "3";
process.env.AUTH_LOCKOUT_THRESHOLD = "3";
process.env.AUTH_LOCKOUT_BASE_MS = "60000";

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db, ensureAuthTables, getCredential } from "@sentire-books/db";
import { setPassword } from "../password";

const RUN = !!process.env.DATABASE_URL;

const { authRoutes, __resetAuthLimiters } = await import("../routes/auth");

const app = new Hono();
app.route("/auth", authRoutes);

const EMAIL = "throttle-test@demo.scalebooks.local";
const GOOD = "correct-horse-battery";
const BAD = "wrong-password";

let ipSeq = 0;
/** A fresh IP per call keeps the per-IP brake out of the way unless tested. */
const signIn = (email: string, password: string, ip = `10.0.0.${++ipSeq % 250}`) =>
  app.request("/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });

const clearLockState = (email: string) =>
  db.execute(sql`UPDATE credentials SET failed_attempts = 0, locked_until = NULL WHERE email = ${email}`);

describe.skipIf(!RUN)("POST /auth/password — throttle + lockout", () => {
  beforeAll(async () => {
    await ensureAuthTables();
    await setPassword(EMAIL, GOOD);
  });

  beforeEach(async () => {
    __resetAuthLimiters();
    await clearLockState(EMAIL);
  });

  it("signs in normally — throttling does not touch the happy path", async () => {
    const res = await signIn(EMAIL, GOOD);
    expect(res.status).toBe(200);
    expect((await res.json()) as { token?: string }).toHaveProperty("token");
  });

  it("rejects a wrong password with 401 and counts it", async () => {
    const res = await signIn(EMAIL, BAD);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("invalid_credentials");
    expect((await getCredential(EMAIL))!.failedAttempts).toBe(1);
  });

  it("throttles a scripted brute force with 429 + Retry-After", async () => {
    const ip = "10.9.9.9";
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await signIn(EMAIL, BAD, ip)).status);

    expect(codes.slice(0, 3)).toEqual([401, 401, 401]); // budget
    expect(codes.slice(3)).toEqual([429, 429, 429]); // throttled thereafter

    const res = await signIn(EMAIL, BAD, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(((await res.json()) as { error?: string }).error).toBe("too_many_attempts");
  });

  it("locks the credential durably in the database", async () => {
    const ip = "10.9.9.10";
    for (let i = 0; i < 3; i++) await signIn(EMAIL, BAD, ip);

    const cred = (await getCredential(EMAIL))!;
    expect(cred.failedAttempts).toBe(3);
    expect(cred.lockedUntil).toBeInstanceOf(Date);
    expect(cred.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses the CORRECT password while locked — the lock is not just a counter", async () => {
    for (let i = 0; i < 3; i++) await signIn(EMAIL, BAD, "10.9.9.11");
    __resetAuthLimiters(); // drop the in-memory brake; only the DB lock remains

    const res = await signIn(EMAIL, GOOD);
    expect(res.status).toBe(429);
  });

  it("lets the user back in once the lock lapses", async () => {
    for (let i = 0; i < 3; i++) await signIn(EMAIL, BAD, "10.9.9.12");
    __resetAuthLimiters();
    // Backdate the lock instead of sleeping out the real backoff.
    await db.execute(
      sql`UPDATE credentials SET locked_until = now() - interval '1 minute' WHERE email = ${EMAIL}`,
    );

    const res = await signIn(EMAIL, GOOD);
    expect(res.status).toBe(200);
  });

  it("clears the failure count after a successful sign-in", async () => {
    await signIn(EMAIL, BAD, "10.9.9.13");
    expect((await getCredential(EMAIL))!.failedAttempts).toBe(1);

    __resetAuthLimiters();
    expect((await signIn(EMAIL, GOOD)).status).toBe(200);
    const cred = (await getCredential(EMAIL))!;
    expect(cred.failedAttempts).toBe(0);
    expect(cred.lockedUntil).toBeNull();
  });

  it("throttles an UNKNOWN email identically — no account-existence oracle", async () => {
    const ip = "10.9.9.14";
    const unknown = "does-not-exist@demo.scalebooks.local";
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await signIn(unknown, BAD, ip)).status);

    // Same shape as a real account: 401 up to the budget, then 429.
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it("throttles per IP across many different emails", async () => {
    process.env.AUTH_THROTTLE_IP_MAX; // documented: the IP brake is the wide net
    const ip = "10.9.9.15";
    let sawThrottle = false;
    for (let i = 0; i < 60; i++) {
      const res = await signIn(`spray-${i}@demo.scalebooks.local`, BAD, ip);
      if (res.status === 429) {
        sawThrottle = true;
        break;
      }
    }
    expect(sawThrottle).toBe(true);
  });

  it("keeps one throttled IP from blocking a different IP", async () => {
    const badIp = "10.9.9.16";
    for (let i = 0; i < 4; i++) await signIn(EMAIL, BAD, badIp);
    expect((await signIn(EMAIL, BAD, badIp)).status).toBe(429);

    await clearLockState(EMAIL);
    __resetAuthLimiters();
    expect((await signIn(EMAIL, GOOD, "10.9.9.17")).status).toBe(200);
  });
});
