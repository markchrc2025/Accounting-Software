/**
 * Environment-derived safety switches.
 *
 * Every switch here is **fail-closed**: a feature is enabled only when its
 * variable holds an exact, intentional opt-in token. Unset, blank, mistyped or
 * merely truthy-looking values all leave the feature OFF. Historically the
 * workspace-reset guard did the opposite — it disabled only on the literal
 * string "false", so an unset variable left a full production wipe reachable.
 */

/** The one value that opts a switch in. Anything else means "off". */
const ENABLE_TOKEN = "true";

/** Any environment-shaped bag: every key optional, values strings. */
export type EnvLike = { readonly [key: string]: string | undefined };

/**
 * Is the destructive `POST /settings/data/reset` (Factory Reset Workspace)
 * permitted on this environment?
 *
 * Reset wipes every row in the workspace, reinstalls the default chart of
 * accounts and restarts document numbering — so it must never be reachable by
 * accident. Enabled ONLY when ALLOW_WORKSPACE_RESET is exactly "true".
 */
export function isWorkspaceResetEnabled(
  env: EnvLike = process.env,
): boolean {
  return env.ALLOW_WORKSPACE_RESET === ENABLE_TOKEN;
}

/** True when the API believes it is serving production traffic. */
export function isProduction(
  env: EnvLike = process.env,
): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Fatal auth misconfigurations. The API must refuse to start rather than serve
 * production traffic with a weakened or absent authentication path.
 *
 * The dev bypass in `auth.ts` is reachable only when AUTH_JWT_SECRET is unset
 * AND AUTH_DEV_BYPASS is exactly "true" — it trusts an unauthenticated
 * `x-user-id` header. Both halves are treated as fatal in production
 * independently, so the bypass cannot become reachable through a later edit or
 * a half-applied environment.
 *
 * Returns messages instead of throwing so the assertion stays unit-testable;
 * the caller decides to exit.
 */
export function authConfigErrors(env: EnvLike = process.env): string[] {
  if (!isProduction(env)) return [];
  const errors: string[] = [];
  if (!env.AUTH_JWT_SECRET) {
    errors.push(
      "AUTH_JWT_SECRET is not set. In production the API must verify its own signed tokens; " +
        "without it every request fails closed and, if AUTH_DEV_BYPASS were set, an unauthenticated " +
        "x-user-id header would be trusted instead.",
    );
  }
  if (env.AUTH_DEV_BYPASS === "true") {
    errors.push(
      'AUTH_DEV_BYPASS="true" is set. That is a local-development escape which trusts an ' +
        "unauthenticated x-user-id header. It must never be set in production — remove it from the " +
        "environment.",
    );
  }
  return errors;
}

/**
 * Non-fatal auth configuration notes.
 *
 * AUTH_JWKS_URL / AUTH_ISSUER are read NOWHERE in this codebase — the API signs
 * and verifies its own HS256 tokens via AUTH_JWT_SECRET. They survive only in
 * stale deploy docs and render.yaml, so an operator can set them and believe
 * auth is configured when it is not. Warn loudly.
 *
 * TODO(M6.5): correct docs/DEPLOY-SLIPLANE.md, docs/SYSTEM-DESIGN.md and
 * render.yaml, which still describe the removed JWKS/OIDC model.
 */
export function authConfigWarnings(env: EnvLike = process.env): string[] {
  const warnings: string[] = [];
  const stale = ["AUTH_JWKS_URL", "AUTH_ISSUER"].filter((k) => env[k]);
  if (stale.length) {
    warnings.push(
      `[config] ⚠ ${stale.join(" and ")} ${stale.length > 1 ? "are" : "is"} set but IGNORED — ` +
        "this API verifies its own HS256 tokens via AUTH_JWT_SECRET. The deploy docs that ask for " +
        "these are stale (TODO M6.5). Setting them does not configure authentication.",
    );
  }
  if (!isProduction(env) && !env.AUTH_JWT_SECRET && env.AUTH_DEV_BYPASS === "true") {
    warnings.push(
      "[config] ⚠ auth DEV BYPASS is active — an unauthenticated x-user-id header is trusted. " +
        "Local development only.",
    );
  }
  return warnings;
}

/* ── CORS ──────────────────────────────────────────────────────────────────
 * The portal is a different origin from this API, so cross-origin requests need
 * an explicit allow-list. Two rules: the list is never empty in production, and
 * the API never answers with a wildcard.
 */

/** Used when CORS_ORIGIN is not set at all: the portal hosts + local Vite. */
export const DEFAULT_CORS_ORIGINS = [
  "https://books.sentire.solutions",
  "https://sentire-books.sliplane.app",
  "http://localhost:5173",
] as const;

/** Used when CORS_ORIGIN is set but blank, OUTSIDE production only. */
const DEV_FALLBACK_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] as const;

/**
 * Resolve the allow-list. A wildcard is stripped rather than honoured — this
 * API is credentialed by Bearer token and must always name its origins.
 *
 * Note `CORS_ORIGIN=""` is NOT nullish, so it does not fall back to the
 * defaults; that used to collapse the list to empty and emit "*".
 */
export function parseCorsOrigins(env: EnvLike = process.env): string[] {
  const raw = env.CORS_ORIGIN;
  if (raw === undefined) return [...DEFAULT_CORS_ORIGINS];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*");
  if (list.length > 0) return list;
  // Set-but-empty (or wildcard-only): never widen to "*".
  return isProduction(env) ? [] : [...DEV_FALLBACK_ORIGINS];
}

/** Fatal when production would be left without a usable allow-list. */
export function corsConfigErrors(env: EnvLike = process.env): string[] {
  if (!isProduction(env)) return [];
  if (parseCorsOrigins(env).length > 0) return [];
  return [
    "CORS_ORIGIN is set but resolves to an empty allow-list. The API refuses to serve production " +
      "traffic without naming its browser origins (it will never fall back to a wildcard). Set " +
      'CORS_ORIGIN to a comma-separated list, e.g. "https://books.sentire.solutions".',
  ];
}

/** Note when a wildcard was discarded, so the operator learns it did nothing. */
export function corsConfigWarnings(env: EnvLike = process.env): string[] {
  const raw = env.CORS_ORIGIN;
  if (raw !== undefined && raw.split(",").some((s) => s.trim() === "*")) {
    return [
      '[config] ⚠ CORS_ORIGIN contains "*", which was discarded — this API always answers with an ' +
        "explicit origin. List the browser origins instead.",
    ];
  }
  return [];
}

/**
 * Echo back ONLY a configured origin. Anything else returns null so hono emits
 * no Access-Control-Allow-Origin header at all — previously an unknown origin
 * got the first allowed origin echoed back, which is a header the caller can
 * never match.
 */
export function corsOriginResolver(
  allowed: readonly string[],
): (origin: string) => string | null {
  return (origin: string) => (allowed.includes(origin) ? origin : null);
}

/**
 * One-line boot notice so a destructive switch is never silently on. Returns
 * the message (rather than logging it) to stay testable; the caller logs it.
 */
export function workspaceResetBootNotice(env: EnvLike = process.env): string {
  if (!isWorkspaceResetEnabled(env)) {
    return "[config] workspace reset: DISABLED (set ALLOW_WORKSPACE_RESET=\"true\" to enable)";
  }
  return isProduction(env)
    ? "[config] ⚠ workspace reset: ENABLED IN PRODUCTION — POST /settings/data/reset can wipe this workspace. Unset ALLOW_WORKSPACE_RESET unless you are mid-migration."
    : "[config] workspace reset: ENABLED — POST /settings/data/reset can wipe this workspace.";
}
