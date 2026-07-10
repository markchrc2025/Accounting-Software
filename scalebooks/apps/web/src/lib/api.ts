/**
 * Thin typed API client. In dev it sends `x-user-id` (paired with the API's
 * AUTH_DEV_BYPASS); in production it sends `Authorization: Bearer <jwt>`.
 */
import type { ImportAccount } from "@scalebooks/domain";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID ?? "";

// Current access token (a JWT from Authenticize), kept in sync by AuthProvider.
// When set, requests use `Authorization: Bearer …`; otherwise they fall back to
// the dev header.
let _accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

// AuthProvider registers a refresher that mints a fresh JWT from the identity
// provider's session cookie. The JWT is short-lived; on a 401 we refresh once
// and retry, so an expired token never surfaces to the user.
let _refresher: (() => Promise<string | null>) | null = null;
export function setTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  _refresher = fn;
}

export interface AccountDto {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype?: string | null;
  isActive: boolean;
}

export interface JournalEntryDto {
  id: string;
  entryNo: string;
  entryDate: string;
  memo: string | null;
  status: string;
  createdAt: string;
}

export interface CreateJournalLine {
  accountId: string;
  debitCents: number;
  creditCents: number;
  description?: string | undefined;
}

export interface CreateJournalEntry {
  entryDate: string;
  memo?: string | undefined;
  lines: CreateJournalLine[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
  get detail(): string {
    const b = this.body as { detail?: string; error?: string } | null;
    return b?.detail ?? b?.error ?? `Request failed (${this.status})`;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (_accessToken) headers["authorization"] = `Bearer ${_accessToken}`;
  else if (DEV_USER_ID) headers["x-user-id"] = DEV_USER_ID; // local dev only
  if (init?.headers) Object.assign(headers, init.headers);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  // Token likely expired — mint a fresh one from the session and retry once.
  if (res.status === 401 && !retried && _accessToken && _refresher) {
    const fresh = await _refresher();
    if (fresh) {
      _accessToken = fresh;
      return apiFetch<T>(path, init, true);
    }
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export interface MeDto {
  user: { id: string; email: string };
  org: { id: string; name: string; code: string };
  role: string;
}

/** The signed-in user's resolved workspace (org id, name, tenant code) + role. */
export const getMe = () => apiFetch<MeDto>("/auth/me");

export const listAccounts = () =>
  apiFetch<{ accounts: AccountDto[] }>("/accounts").then((r) => r.accounts);

export interface ImportAccountsResult {
  inserted: number;
  skipped: number;
  linked: number;
  total: number;
}

/** Bulk-import a parsed chart of accounts (admin only). */
export const importAccounts = (accounts: ImportAccount[]) =>
  apiFetch<ImportAccountsResult>("/accounts/import", {
    method: "POST",
    body: JSON.stringify({ accounts }),
  });

export interface UserDto {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  createdAt: string;
}
export interface InviteUserInput {
  email: string;
  role?: string | undefined;
  fullName?: string | undefined;
}

/** The workspace's user allowlist (admin only). */
export const listUsers = () => apiFetch<{ users: UserDto[] }>("/users").then((r) => r.users);

/** Add a user to the allowlist by email (admin only). */
export const inviteUser = (input: InviteUserInput) =>
  apiFetch<{ user: UserDto }>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((r) => r.user);

export const listJournalEntries = () =>
  apiFetch<{ entries: JournalEntryDto[] }>("/journal-entries").then((r) => r.entries);

export const createJournalEntry = (payload: CreateJournalEntry) =>
  apiFetch<{ id: string; entryNo: string }>("/journal-entries", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export interface Period {
  from?: string | undefined;
  to?: string | undefined;
}

function periodQuery(p?: Period): string {
  const params = new URLSearchParams();
  if (p?.from) params.set("from", p.from);
  if (p?.to) params.set("to", p.to);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface TrialBalanceRowDto {
  accountCode: string;
  accountName: string;
  accountType: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface TrialBalanceDto {
  from: string | null;
  to: string | null;
  rows: TrialBalanceRowDto[];
  totals: { debitCents: number; creditCents: number };
  balanced: boolean;
}

export interface ProfitAndLossDto {
  from: string | null;
  to: string | null;
  incomeCents: number;
  expenseCents: number;
  netProfitCents: number;
}

export const getTrialBalance = (p?: Period) =>
  apiFetch<TrialBalanceDto>(`/reports/trial-balance${periodQuery(p)}`);

export const getProfitAndLoss = (p?: Period) =>
  apiFetch<ProfitAndLossDto>(`/reports/profit-and-loss${periodQuery(p)}`);

export type ContactType = "vendor" | "customer" | "employee";

export interface ContactDto {
  id: string;
  type: ContactType;
  name: string;
  tin: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
}

export interface CreateContact {
  type: ContactType;
  name: string;
  tin?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
}

export const listContacts = (type?: ContactType) =>
  apiFetch<{ contacts: ContactDto[] }>(`/contacts${type ? `?type=${type}` : ""}`).then(
    (r) => r.contacts,
  );

export const createContact = (payload: CreateContact) =>
  apiFetch<{ contact: ContactDto }>("/contacts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export type VoucherType = "payment" | "receipt";

export interface VoucherDto {
  id: string;
  voucherNo: string;
  voucherType: VoucherType;
  voucherDate: string;
  memo: string | null;
  status: string;
  totalCents: number;
  contactName: string | null;
}

export interface CreateVoucherLine {
  accountId: string;
  description?: string | undefined;
  amountCents: number;
}

export interface CreateVoucher {
  type: VoucherType;
  contactId?: string | undefined;
  voucherDate: string;
  memo?: string | undefined;
  cashAccountId: string;
  lines: CreateVoucherLine[];
}

export const listVouchers = () =>
  apiFetch<{ vouchers: VoucherDto[] }>("/vouchers").then((r) => r.vouchers);

export const createVoucher = (payload: CreateVoucher) =>
  apiFetch<{ id: string; voucherNo: string; journalEntryId: string; entryNo: string }>("/vouchers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
