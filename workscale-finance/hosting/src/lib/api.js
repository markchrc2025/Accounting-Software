/**
 * API client for the Sentire Books Hono backend — the replacement for direct
 * Firestore access as this app is re-platformed onto Postgres.
 *
 * Auth model mirrors the rest of the ecosystem: a JWT (from Authenticize) is sent
 * as `Authorization: Bearer`, and the active workspace as `x-org-id`. On a 401 we
 * refresh once via the registered refresher, then bounce to login. Every module
 * calls these helpers instead of talking to Firestore; module-specific calls are
 * added here as each screen is rewired.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

let _accessToken = null;
export function setAccessToken(token) {
  _accessToken = token;
}

// Active workspace (an identity may belong to several). Sent as `x-org-id`.
let _orgId = null;
export function setActiveOrg(orgId) {
  _orgId = orgId;
}

// Registered by the auth provider; mints a fresh JWT (or redirects to login).
let _refresher = null;
export function setTokenRefresher(fn) {
  _refresher = fn;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }
  get detail() {
    const b = this.body || {};
    return b.detail ?? b.error ?? `Request failed (${this.status})`;
  }
}

export async function apiFetch(path, init, retried = false) {
  const headers = { 'content-type': 'application/json' };
  if (_accessToken) headers['authorization'] = `Bearer ${_accessToken}`;
  if (_orgId) headers['x-org-id'] = _orgId;
  if (init && init.headers) Object.assign(headers, init.headers);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401 && !retried && _accessToken && _refresher) {
    const fresh = await _refresher();
    if (fresh) {
      _accessToken = fresh;
      return apiFetch(path, init, true);
    }
  }

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── auth / workspace ─────────────────────────────────────────────────────────
export const getMe = () => apiFetch('/auth/me');
export const listWorkspaces = () => apiFetch('/auth/workspaces');
export const signInWithPassword = (email, password) =>
  apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ email, password }) });

// ── core ledger (backend already exists — used in Phase 1) ───────────────────
function periodQuery(p) {
  const s = new URLSearchParams();
  if (p && p.from) s.set('from', p.from);
  if (p && p.to) s.set('to', p.to);
  const q = s.toString();
  return q ? `?${q}` : '';
}

export const listAccounts = () => apiFetch('/accounts').then((r) => r.accounts);
export const createAccount = (payload) =>
  apiFetch('/accounts', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.account);
export const updateAccount = (id, payload) =>
  apiFetch(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.account);
export const deleteAccount = (id) => apiFetch(`/accounts/${id}`, { method: 'DELETE' });
export const importAccounts = (accounts) =>
  apiFetch('/accounts/import', { method: 'POST', body: JSON.stringify({ accounts }) });
export const listContacts = (type) =>
  apiFetch(`/contacts${type ? `?type=${type}` : ''}`).then((r) => r.contacts);
export const createContact = (payload) =>
  apiFetch('/contacts', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.contact);
export const listJournalEntries = () => apiFetch('/journal-entries').then((r) => r.entries);
export const createJournalEntry = (payload) =>
  apiFetch('/journal-entries', { method: 'POST', body: JSON.stringify(payload) });
export const listVouchers = () => apiFetch('/vouchers').then((r) => r.vouchers);
export const createVoucher = (payload) =>
  apiFetch('/vouchers', { method: 'POST', body: JSON.stringify(payload) });
export const getTrialBalance = (p) => apiFetch(`/reports/trial-balance${periodQuery(p)}`);
export const getProfitAndLoss = (p) => apiFetch(`/reports/profit-and-loss${periodQuery(p)}`);
