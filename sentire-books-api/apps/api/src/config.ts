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
