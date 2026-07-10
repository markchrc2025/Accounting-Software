/**
 * OIDC Authorization Code flow against Authenticize (the Sentire ecosystem's
 * central identity provider). Sentire Books is a confidential OAuth client:
 *
 *   GET /auth/login                       → redirect to Authenticize /authorize
 *   GET /api/auth/callback/authenticize   → exchange code, hand a JWT to the SPA
 *   GET /auth/logout                      → clear local state, back to the app
 *
 * We never see the user's password — it's entered only on Authenticize. The
 * code exchange (which needs the client secret) happens here on the backend, so
 * the secret never reaches the browser. The resulting id_token is a JWKS-signed
 * JWT carrying the verified email; the SPA uses it as a Bearer token, and
 * requireAuth admits the caller by that email against the app_users allowlist.
 *
 * Token delivery avoids cross-subdomain cookies (which don't work reliably
 * between *.sliplane.app hosts): the callback redirects back to the web app with
 * the token in the URL fragment, which the SPA reads and keeps in memory.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";

const STATE_COOKIE = "sb_oidc";
const trimSlash = (s: string) => s.replace(/\/+$/, "");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function issuer(): string {
  return trimSlash(requireEnv("AUTH_ISSUER"));
}

/** OIDC endpoints — derived from the issuer, overridable for non-standard hosts. */
function endpoints() {
  const base = issuer();
  return {
    authorize: process.env.AUTH_AUTHORIZE_URL ?? `${base}/api/auth/oauth2/authorize`,
    token: process.env.AUTH_TOKEN_URL ?? `${base}/api/auth/oauth2/token`,
    jwks: process.env.AUTH_JWKS_URL ?? `${base}/api/auth/jwks`,
  };
}

/** Where to send the browser after login/errors — the web app's origin. */
function webAppUrl(): string {
  const explicit = process.env.WEB_APP_URL;
  const fromCors = (process.env.CORS_ORIGIN ?? "").split(",")[0]?.trim();
  const url = explicit || fromCors;
  if (!url) throw new Error("WEB_APP_URL (or CORS_ORIGIN) is not set");
  return trimSlash(url);
}

/** Secret used to sign the short-lived state cookie (falls back to the client secret). */
function stateSecret(): string {
  return process.env.AUTH_STATE_SECRET ?? requireEnv("AUTH_CLIENT_SECRET");
}

const b64url = (b: Buffer): string => b.toString("base64url");

/** `<base64url(payload)>.<hmac>` — tamper-evident, not encrypted (no secrets inside). */
function sign(payload: string): string {
  const mac = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}
function unsign(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const payload = Buffer.from(body, "base64url").toString();
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(endpoints().jwks));
  return _jwks;
}

/** Only allow same-app absolute paths — never an open redirect off-site. */
function sanitizeReturnTo(v: string | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return "/";
  return v;
}

function redirectToWeb(c: Context, path: string, hash: URLSearchParams): Response {
  return c.redirect(`${webAppUrl()}${path}#${hash.toString()}`);
}
function redirectToWebError(c: Context, code: string): Response {
  return redirectToWeb(c, "/", new URLSearchParams({ error: code }));
}

interface OidcState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

/** GET /auth/login — kick off the Authorization Code + PKCE flow. */
export async function oidcLogin(c: Context): Promise<Response> {
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
  const returnTo = sanitizeReturnTo(c.req.query("returnTo"));

  const saved: OidcState = { state, nonce, codeVerifier, returnTo };
  // SameSite=Lax so the cookie is still sent on the top-level GET redirect back
  // from Authenticize, while staying first-party to this API host.
  setCookie(c, STATE_COOKIE, sign(JSON.stringify(saved)), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("AUTH_CLIENT_ID"),
    redirect_uri: requireEnv("AUTH_REDIRECT_URI"),
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return c.redirect(`${endpoints().authorize}?${params.toString()}`);
}

/** GET /api/auth/callback/authenticize — exchange the code and return a token. */
export async function oidcCallback(c: Context): Promise<Response> {
  const providerError = c.req.query("error");
  if (providerError) return redirectToWebError(c, providerError);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const rawCookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  if (!code || !state || !rawCookie) return redirectToWebError(c, "invalid_request");
  const payload = unsign(rawCookie);
  if (!payload) return redirectToWebError(c, "invalid_state");

  let saved: OidcState;
  try {
    saved = JSON.parse(payload) as OidcState;
  } catch {
    return redirectToWebError(c, "invalid_state");
  }
  if (saved.state !== state) return redirectToWebError(c, "state_mismatch");

  // Exchange the code for tokens. Confidential client → HTTP Basic client auth,
  // which is the OIDC default (and what openid-client, per Authenticize's docs,
  // uses). PKCE code_verifier is included as defence-in-depth.
  let tokenRes: Response;
  try {
    tokenRes = await fetch(endpoints().token, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization:
          "Basic " +
          Buffer.from(
            `${requireEnv("AUTH_CLIENT_ID")}:${requireEnv("AUTH_CLIENT_SECRET")}`,
          ).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: requireEnv("AUTH_REDIRECT_URI"),
        code_verifier: saved.codeVerifier,
      }).toString(),
    });
  } catch {
    return redirectToWebError(c, "token_unreachable");
  }
  if (!tokenRes.ok) {
    console.error("[oidc] token exchange failed", tokenRes.status, await tokenRes.text().catch(() => ""));
    return redirectToWebError(c, "token_exchange_failed");
  }

  const tokens = (await tokenRes.json().catch(() => null)) as
    | { id_token?: string; access_token?: string; expires_in?: number }
    | null;
  const idToken = tokens?.id_token;
  if (!idToken) return redirectToWebError(c, "no_id_token");

  // Verify the id_token: signature (JWKS), issuer, audience (our client id), and
  // the nonce we planted — closing the loop against token injection/replay.
  try {
    const { payload: claims } = await jwtVerify(idToken, jwks(), {
      issuer: issuer(),
      audience: requireEnv("AUTH_CLIENT_ID"),
    });
    if (saved.nonce && claims.nonce !== saved.nonce) {
      return redirectToWebError(c, "nonce_mismatch");
    }
  } catch {
    return redirectToWebError(c, "id_token_invalid");
  }

  const hash = new URLSearchParams({ token: idToken });
  if (tokens?.expires_in) hash.set("expires_in", String(tokens.expires_in));
  return redirectToWeb(c, saved.returnTo, hash);
}

/**
 * GET /auth/logout — the SPA has already dropped its in-memory token; send the
 * user back to the app's login screen. (The Authenticize SSO session is not
 * cleared here, so re-login is immediate — a front-channel logout can be added
 * once the ecosystem shares a cookie domain.)
 */
export function oidcLogout(c: Context): Response {
  return c.redirect(`${webAppUrl()}/`);
}
