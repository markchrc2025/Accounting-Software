/**
 * Account resolution by code — fail-closed on ambiguity (M2.0).
 *
 * Account `code` is NOT unique. That is deliberate and documented:
 * `setup/generate_coa_sql.py` notes "real charts reuse the same numeric `code`
 * across types, so the unique key is the account NAME", and
 * `0005_accounts_extend.sql` implements exactly that — it drops uniqueness on
 * (org_id, code) and moves it to (org_id, name), leaving code on a plain index.
 * Tenants also import their own charts, so duplicate codes can arrive at any
 * time.
 *
 * The bug this replaces: callers resolved codes with
 *
 *     const byCode = new Map(rows.map((a) => [a.code, a.id]));
 *
 * which silently keeps the LAST row for a duplicated key. In the default chart,
 * `2004002` was both "Opening Balance Offset" (equity) and "Final Pay Payable
 * Deployed" (liability), so an opening-balance loan booking debited a payroll
 * liability instead of equity. The entry still balanced, so every ledger
 * invariant held while the balance sheet was wrong — the trial balance cannot
 * catch a line posted to the wrong account.
 *
 * So: never guess. A duplicate code is a 409 that names both candidates and
 * asks the user to pick, which is invariant #4 (fail-closed defaults) applied
 * to account resolution.
 *
 * A code with no match is NOT an error here — it is simply absent from the
 * returned map. Callers already distinguish "unset" from "wrong" and answer
 * `accounts_unset` with an actionable message.
 */
import { and, eq, inArray } from "drizzle-orm";
import { accounts, type Tx } from "@sentire-books/db";

/** One candidate account for an ambiguous code. */
export interface AccountCandidate {
  id: string;
  name: string;
  type: string;
}

/**
 * A code matched more than one account. Carries every candidate so the response
 * can name them — "2004002 matches Opening Balance Offset (equity) and Final Pay
 * Payable Deployed (liability)" is actionable; "invalid account" is not.
 */
export class AmbiguousAccountCodeError extends Error {
  constructor(
    public readonly code: string,
    public readonly candidates: readonly AccountCandidate[],
  ) {
    super(`Account code ${code} matches ${candidates.length} accounts`);
    this.name = "AmbiguousAccountCodeError";
  }

  /** Human-readable candidate list, e.g. `Owner's Equity (equity), …`. */
  get candidateSummary(): string {
    return this.candidates.map((c) => `${c.name} (${c.type})`).join(", ");
  }
}

/**
 * Resolve account codes to ids within one org.
 *
 * @throws {AmbiguousAccountCodeError} if any requested code matches >1 account.
 * @returns Map of code → account id. Unmatched codes are absent from the map.
 */
export async function resolveAccountCodes(
  tx: Tx,
  orgId: string,
  codes: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(codes.filter((c): c is string => !!c))];
  if (!wanted.length) return new Map();

  const rows = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), inArray(accounts.code, wanted)));

  const byCode = new Map<string, AccountCandidate[]>();
  for (const r of rows) {
    const list = byCode.get(r.code);
    if (list) list.push({ id: r.id, name: r.name, type: r.type });
    else byCode.set(r.code, [{ id: r.id, name: r.name, type: r.type }]);
  }

  // Report the ambiguity in the caller's own code order, so repeated runs on the
  // same input fail identically rather than on whichever row the planner sorted
  // first.
  for (const code of wanted) {
    const candidates = byCode.get(code);
    if (candidates && candidates.length > 1) {
      throw new AmbiguousAccountCodeError(code, candidates);
    }
  }

  return new Map([...byCode].map(([code, [first]]) => [code, first!.id]));
}

/** The 409 body for an ambiguous code — shared by every route that resolves one. */
export function ambiguousAccountResponse(err: AmbiguousAccountCodeError) {
  return {
    body: {
      error: "ambiguous_account_code" as const,
      detail:
        `Account code ${err.code} matches ${err.candidates.length} accounts: ${err.candidateSummary}. ` +
        `Rename or renumber one of them so the code identifies a single account.`,
      code: err.code,
      candidates: err.candidates,
    },
    status: 409 as const,
  };
}
