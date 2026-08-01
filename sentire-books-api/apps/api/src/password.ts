/**
 * In-app email/password sign-in — verified locally against Sentire Books' own
 * credentials store (see @sentire-books/db `credentials`). A correct password
 * mints a short-lived Books token; the workspace is then resolved from the
 * app_users allowlist (the login form's company code selects it).
 *
 * Sign-in proves identity only. Whether that email is admitted to any workspace
 * is a separate check on every request (auth.ts), so a valid password for an
 * email that's on no allowlist gets a token but no workspace.
 */
import {
  getCredential,
  setPasswordHash,
  recordFailedSignIn,
  clearFailedSignIns,
} from "@sentire-books/db";
import { hashPassword, verifyPassword } from "./crypto";
import { signAppToken } from "./tokens";
import { authThrottleConfig, lockoutDurationMs } from "./config";

export type PasswordResult =
  | { token: string }
  | { error: string; status: number; retryAfterSec?: number };

export async function passwordSignIn(email: string, password: string): Promise<PasswordResult> {
  const emailLc = email.trim().toLowerCase();
  const cfg = authThrottleConfig();

  const cred = await getCredential(emailLc);

  // Durable lockout: a real credential that has crossed the failure threshold
  // stays locked across restarts. Still run a verify below so the response time
  // of a locked account matches every other rejection.
  const now = Date.now();
  const lockedUntil = cred?.lockedUntil ? cred.lockedUntil.getTime() : 0;
  const isLocked = lockedUntil > now;

  // Always run a verify — against a dummy hash when the email is unknown — so
  // response time doesn't reveal whether the email is registered.
  let ok = false;
  if (cred) {
    ok = await verifyPassword(password, cred.passwordHash);
  } else {
    await verifyPassword(password, DUMMY_HASH);
  }

  if (isLocked) {
    // Deliberately the same shape the in-memory limiter returns for an UNKNOWN
    // email, so a lockout can't be used to confirm an account exists.
    return {
      error: "too_many_attempts",
      status: 429,
      retryAfterSec: Math.ceil((lockedUntil - now) / 1000),
    };
  }

  if (!ok) {
    if (cred) {
      // Count the failure and lock once the threshold is crossed.
      const failures = cred.failedAttempts + 1;
      const lockMs = lockoutDurationMs(failures, cfg);
      await recordFailedSignIn(emailLc, lockMs > 0 ? new Date(now + lockMs) : null);
    }
    return { error: "invalid_credentials", status: 401 };
  }

  if (cred && (cred.failedAttempts !== 0 || cred.lockedUntil)) {
    await clearFailedSignIns(emailLc);
  }
  const token = await signAppToken({ sub: emailLc, email: emailLc });
  return { token };
}

/** Set (or replace) an email identity's password. */
export async function setPassword(email: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await setPasswordHash(email.trim().toLowerCase(), hash);
}

// A well-formed scrypt hash of a random value — only used to keep failed logins
// as costly as successful ones (timing-uniform), never matched.
const DUMMY_HASH =
  "scrypt$0000000000000000000000000000000000000000000000000000000000000000$" +
  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
