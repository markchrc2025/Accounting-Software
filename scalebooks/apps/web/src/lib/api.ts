/**
 * Thin typed API client. In dev it sends `x-user-id` (paired with the API's
 * AUTH_DEV_BYPASS); in production swap this for an `Authorization: Bearer <jwt>`.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID ?? "";

export interface AccountDto {
  id: string;
  code: string;
  name: string;
  type: string;
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (DEV_USER_ID) headers["x-user-id"] = DEV_USER_ID;
  if (init?.headers) Object.assign(headers, init.headers);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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

export const listAccounts = () =>
  apiFetch<{ accounts: AccountDto[] }>("/accounts").then((r) => r.accounts);

export const listJournalEntries = () =>
  apiFetch<{ entries: JournalEntryDto[] }>("/journal-entries").then((r) => r.entries);

export const createJournalEntry = (payload: CreateJournalEntry) =>
  apiFetch<{ id: string; entryNo: string }>("/journal-entries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
