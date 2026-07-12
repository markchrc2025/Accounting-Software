/**
 * In-app email/password sign-in — verified locally against Sentire Books' own
 * credentials store (see @scalebooks/db `credentials`). A correct password
 * mints a short-lived Books token; the workspace is then resolved from the
 * app_users allowlist (the login form's company code selects it).
 *
 * Sign-in proves identity only. Whether that email is admitted to any workspace
 * is a separate check on every request (auth.ts), so a valid password for an
 * email that's on no allowlist gets a token but no workspace.
 */
import { getPasswordHash, setPasswordHash } from "@scalebooks/db";
import { hashPassword, verifyPassword } from "./crypto";
import { signAppToken } from "./tokens";

export type PasswordResult = { token: string } | { error: string; status: number };

export async function passwordSignIn(email: string, password: string): Promise<PasswordResult> {
  const emailLc = email.trim().toLowerCase();

  const hash = await getPasswordHash(emailLc);
  // Always run a verify — against a dummy hash when the email is unknown — so
  // response time doesn't reveal whether the email is registered.
  let ok = false;
  if (hash) {
    ok = await verifyPassword(password, hash);
  } else {
    await verifyPassword(password, DUMMY_HASH);
  }
  if (!ok) return { error: "invalid_credentials", status: 401 };

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
