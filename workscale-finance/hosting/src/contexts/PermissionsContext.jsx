import { createContext, useContext } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';

// ── Constants ─────────────────────────────────────────────────────────────────
export const ALL_ROLES = ['Maker', 'Verifier', 'Approver', 'Poster', 'Admin'];

/** Sidebar route path → canonical module name (kept for sidebar/route guards). */
export const MODULE_ROUTE_MAP = {
  'vouchers':      'Vouchers',
  'approvals':     'Approvals',
  'projections':   'Weekly Projections',
  'pay-schedule':  'Payment Schedule',
  'disbursements': 'Disbursements',
  'checks':        'Check Registry',
  'journal':       'Journal',
  'bank':          'Bank',
  'coa':           'Chart of Accounts',
  'tax':           'Tax',
  'financial':     'Financial Management',
  'assets':        'Fixed Assets',
  'billing':       'Billing Book',
  'invoices':      'Service Invoices',
  'collections':   'Collections',
  'contacts':      'Contacts',
  'settings':      'Settings',
};

/**
 * RBAC derived from the workspace role on the signed-in user's app_users row
 * (resolved by GET /auth/me — no Firestore). One role per workspace, expanded
 * to the action ladder the screens check with can(module, role):
 *
 *   maker    → Maker
 *   verifier → Maker + Verifier
 *   poster   → Maker + Verifier + Poster
 *   approver → Maker + Verifier + Approver + Poster
 *   admin    → everything (and Settings)
 *
 * Per-module grants (the old moduleAccess map) collapse to the workspace role
 * for now; module-level scoping can return as a later parity pass.
 */
const ROLE_LADDER = {
  maker:    ['Maker'],
  verifier: ['Maker', 'Verifier'],
  poster:   ['Maker', 'Verifier', 'Poster'],
  approver: ['Maker', 'Verifier', 'Approver', 'Poster'],
  admin:    ALL_ROLES,
};

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const { session, org, phase } = useAuth();
  const workspaceRole = (org?.role || '').toLowerCase();
  const roles = ROLE_LADDER[workspaceRole] || (session ? ['Maker'] : []);
  const isAdmin = workspaceRole === 'admin';

  const getModuleRoles = () => roles;
  const can = (_moduleName, role) => roles.includes(role);
  const hasAccess = (moduleName) => {
    if (moduleName === 'Settings') return isAdmin;
    if (moduleName === null) return true; // Dashboard — always open
    return roles.length > 0;
  };

  const value = {
    userRecord: session
      ? { email: session.user.email, roles, moduleAccess: {} }
      : null,
    loading: phase === 'loading' || phase === 'verifying',
    isAdmin,
    globalRoles: roles,
    can,
    hasAccess,
    getModuleRoles,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within <PermissionsProvider>.');
  return ctx;
}
