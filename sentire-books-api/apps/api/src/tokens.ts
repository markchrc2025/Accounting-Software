/**
 * Sentire Books access tokens — locally signed (HS256), locally verified.
 *
 * Books issues and trusts its own JWTs now (no external identity provider). The
 * token proves the holder's email identity; workspace authorization is resolved
 * separately from the app_users allowlist on every request (see auth.ts).
 */
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "sentire-books";
const TTL = "8h";

function secret(): Uint8Array {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error("AUTH_JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export interface AppTokenClaims {
  sub: string;
  email: string;
}

export async function signAppToken(claims: AppTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret());
}

/** Verify a Books token; returns its identity or null if invalid/expired. */
export async function verifyAppToken(token: string): Promise<AppTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!sub || !email) return null;
    return { sub, email };
  } catch {
    return null;
  }
}
