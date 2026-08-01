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
