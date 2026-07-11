/**
 * In-app email/password sign-in, proxied to Authenticize server-side.
 *
 * The Sentire login form collects the credentials and posts them to our API,
 * which forwards them to Authenticize's Better Auth email/password endpoint,
 * then exchanges the resulting session for a JWKS-signed JWT. Sentire never
 * stores the password — Authenticize remains the credential authority — and no
 * browser cookies cross domains, so it works across separate *.sliplane.app hosts.
 *
 * Trade-off vs. the "Sign in with Sentire" redirect: this path is password-only
 * (social login / MFA and one-click cross-app SSO need the redirect), and it
 * doesn't establish an Authenticize SSO session in the browser.
 */
const trimSlash = (s: string) => s.replace(/\/+$/, "");

function issuer(): string {
  const v = process.env.AUTH_ISSUER;
  if (!v) throw new Error("AUTH_ISSUER is not set");
  return trimSlash(v);
}

/** Rebuild a `Cookie` header from a response's Set-Cookie list (name=value only). */
function cookieHeaderFrom(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies
    .map((sc) => sc.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

export type PasswordResult = { token: string } | { error: string; status: number };

export async function passwordSignIn(email: string, password: string): Promise<PasswordResult> {
  const base = issuer();
  // Server-side call: present the auth server's own origin so Better Auth's CSRF
  // check treats it as same-origin (there's no browser Origin to forward).
  const origin = base;

  let signIn: Response;
  try {
    signIn = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: "auth_unreachable", status: 502 };
  }
  if (signIn.status === 401 || signIn.status === 403 || signIn.status === 400) {
    return { error: "invalid_credentials", status: 401 };
  }
  if (!signIn.ok) {
    return { error: "sign_in_failed", status: 502 };
  }

  const cookie = cookieHeaderFrom(signIn);
  if (!cookie) return { error: "no_session", status: 502 };

  // Exchange the session for a JWT our API can verify via JWKS.
  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${base}/api/auth/token`, { headers: { cookie, origin } });
  } catch {
    return { error: "auth_unreachable", status: 502 };
  }
  if (!tokenRes.ok) return { error: "token_failed", status: 502 };

  const body = (await tokenRes.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) return { error: "no_token", status: 502 };
  return { token: body.token };
}
