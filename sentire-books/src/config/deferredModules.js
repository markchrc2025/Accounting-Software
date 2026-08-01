/**
 * Modules deferred out of the MVP (Milestone 0.5).
 *
 * Hidden, NOT deleted. Loans (Financial Management) and Fixed Assets are built
 * and their code stays in the tree — they are simply unreachable from the UI,
 * and `ModuleGuard` refuses direct navigation, so a stale bookmark or a typed
 * URL lands on Access Denied rather than a half-finished module.
 *
 * The API is sealed independently (poster/approver role on every ledger-writing
 * endpoint, generic DELETE returns 405), so hiding here is defence in depth,
 * not the only control.
 *
 * To un-defer a module: remove it from this list. Nothing else needs changing —
 * the nav, create menu, command palette and route guard all read from here.
 */

/** Canonical module names, matching MODULE_ROUTE_MAP in PermissionsContext. */
export const DEFERRED_MODULES = ['Financial Management', 'Fixed Assets'];

/** Route prefixes owned by those modules. */
export const DEFERRED_PATHS = ['/financial', '/assets'];

/** Is this canonical module name deferred? */
export function isDeferredModule(moduleName) {
  return DEFERRED_MODULES.includes(moduleName);
}

/** Does this path belong to a deferred module? Matches the path and its children. */
export function isDeferredPath(path) {
  if (!path) return false;
  return DEFERRED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Drop deferred entries from a nav/menu list of `{ path }` items. */
export function withoutDeferred(items) {
  return (items || []).filter((item) => !isDeferredPath(item?.path));
}
