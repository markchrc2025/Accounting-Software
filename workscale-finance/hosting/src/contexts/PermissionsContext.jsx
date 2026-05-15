import { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase.js';

// ── Constants ─────────────────────────────────────────────────────────────────
export const ALL_ROLES = ['Maker', 'Verifier', 'Approver', 'Poster', 'Admin'];

/**
 * Maps sidebar route path → canonical module name stored in Firestore moduleAccess.
 * Dashboard (empty path) and billing/:clientId share the 'Billing Book' module.
 */
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

// ── Context ───────────────────────────────────────────────────────────────────
const PermissionsContext = createContext(null);

/**
 * Wrap ScaleBooksApp (or any subtree that needs RBAC) with this provider.
 *
 * Permission model:
 *   • Admin global role  →  full access to every module & every action.
 *   • Other users        →  access only to modules explicitly granted in moduleAccess.
 *   • Settings module    →  Admin-only regardless of moduleAccess.
 *   • Dashboard          →  always accessible to every authenticated user.
 *
 * Firestore: collection `appUsers`, each doc keyed by email:
 *   { email, fullName, roles: string[], moduleAccess: { [moduleName]: string[] } }
 */
export function PermissionsProvider({ children }) {
  const [userRecord, setUserRecord] = useState(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    // Wait for auth to settle (AuthGuard already verified the user)
    const unsubAuth = onAuthStateChanged(auth, user => {
      if (!user) { setLoading(false); return; }

      const email = user.email.toLowerCase();
      const q     = query(collection(db, 'appUsers'), where('email', '==', email));

      const unsubSnap = onSnapshot(q, snap => {
        if (!snap.empty) {
          const docSnap = snap.docs[0];
          const data = docSnap.data();
          setUserRecord({ id: docSnap.id, ...data });
          // Auto-mark invite as accepted on first successful login
          if (data.inviteStatus === 'invited') {
            updateDoc(doc(db, 'appUsers', docSnap.id), { inviteStatus: 'active' }).catch(() => {});
          }
        } else {
          // Authenticated but not yet registered in appUsers → implicit Admin
          // (first-time owner / bootstrap scenario)
          setUserRecord({ email, roles: ['Admin'], moduleAccess: {}, _implicit: true });
        }
        setLoading(false);
      }, () => setLoading(false));

      return unsubSnap;
    });

    return unsubAuth;
  }, []);

  // ── Derived helpers ───────────────────────────────────────────────────────
  const isAdmin = Array.isArray(userRecord?.roles) && userRecord.roles.includes('Admin');

  /**
   * Returns the effective list of roles the current user has for a given module.
   * Admins always get the full set.
   */
  function getModuleRoles(moduleName) {
    if (isAdmin) return ALL_ROLES;
    const ma = userRecord?.moduleAccess;
    if (!ma || typeof ma !== 'object') return [];
    return Array.isArray(ma[moduleName]) ? ma[moduleName] : [];
  }

  /**
   * Returns true if the current user can perform a specific role action in a module.
   * e.g.  can('Vouchers', 'Maker')    → can create/edit vouchers
   *       can('Vouchers', 'Approver') → can approve vouchers
   */
  function can(moduleName, role) {
    if (isAdmin) return true;
    return getModuleRoles(moduleName).includes(role);
  }

  /**
   * Returns true if the current user has ANY access to the given module.
   * Used by sidebar filtering and route guards.
   */
  function hasAccess(moduleName) {
    if (moduleName === 'Settings') return isAdmin;   // Settings is Admin-only
    if (moduleName === null)        return true;       // Dashboard — always open
    if (isAdmin)                    return true;
    return getModuleRoles(moduleName).length > 0;
  }

  const value = {
    userRecord,
    loading,
    isAdmin,
    globalRoles: isAdmin ? ALL_ROLES : (Array.isArray(userRecord?.roles) ? userRecord.roles : []),
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

/**
 * Hook — call inside any component that needs permission checks.
 * Must be a descendant of <PermissionsProvider>.
 */
export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within <PermissionsProvider>.');
  return ctx;
}
