import { describe, it, expect } from "vitest";
import { isBalanced, assertBalanced, zJournalEntryInput, UnbalancedEntryError } from "./journal";
import { pesos } from "./money";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const ORG = "33333333-3333-3333-3333-333333333333";

describe("journal — double-entry invariant", () => {
  it("balanced when debits equal credits and total > 0", () => {
    expect(
      isBalanced([
        { debitCents: pesos(1000), creditCents: 0 },
        { debitCents: 0, creditCents: pesos(1000) },
      ]),
    ).toBe(true);
  });

  it("rejects a zero-total entry (both sides 0)", () => {
    expect(isBalanced([{ debitCents: 0, creditCents: 0 }])).toBe(false);
  });

  it("assertBalanced throws on imbalance", () => {
    expect(() =>
      assertBalanced([
        { debitCents: pesos(1000), creditCents: 0 },
        { debitCents: 0, creditCents: pesos(999.99) },
      ]),
    ).toThrow(UnbalancedEntryError);
  });

  it("schema rejects a line with both debit and credit set", () => {
    const r = zJournalEntryInput.safeParse({
      orgId: ORG,
      entryDate: "2026-06-14",
      lines: [
        { accountId: A, debitCents: 500, creditCents: 500 },
        { accountId: B, creditCents: 0, debitCents: 0 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("schema rejects an unbalanced entry", () => {
    const r = zJournalEntryInput.safeParse({
      orgId: ORG,
      entryDate: "2026-06-14",
      lines: [
        { accountId: A, debitCents: 1000 },
        { accountId: B, creditCents: 900 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("schema accepts a valid balanced entry", () => {
    const r = zJournalEntryInput.safeParse({
      orgId: ORG,
      entryDate: "2026-06-14",
      memo: "Office supplies",
      lines: [
        { accountId: A, debitCents: 1000 },
        { accountId: B, creditCents: 1000 },
      ],
    });
    expect(r.success).toBe(true);
  });
});
