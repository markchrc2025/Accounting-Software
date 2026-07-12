import { describe, it, expect } from "vitest";
import { buildVoucherJournalLines, voucherTotal, zVoucherInput, type VoucherInput } from "./vouchers";
import { isBalanced } from "./journal";
import { pesos } from "./money";

const CASH = "11111111-1111-1111-1111-111111111111";
const EXP = "22222222-2222-2222-2222-222222222222";
const INC = "33333333-3333-3333-3333-333333333333";

describe("vouchers", () => {
  it("a payment debits the expense lines and credits cash, balanced", () => {
    const input: VoucherInput = {
      type: "payment",
      voucherDate: "2026-06-16",
      cashAccountId: CASH,
      lines: [
        { accountId: EXP, amountCents: pesos(700) },
        { accountId: EXP, amountCents: pesos(300) },
      ],
    };
    const lines = buildVoucherJournalLines(input);
    expect(voucherTotal(input.lines)).toBe(pesos(1000));
    expect(isBalanced(lines)).toBe(true);
    // cash credited for the total
    const cash = lines.find((l) => l.accountId === CASH)!;
    expect(cash.creditCents).toBe(pesos(1000));
    expect(cash.debitCents).toBe(0);
  });

  it("a receipt credits the income lines and debits cash, balanced", () => {
    const input: VoucherInput = {
      type: "receipt",
      voucherDate: "2026-06-16",
      cashAccountId: CASH,
      lines: [{ accountId: INC, amountCents: pesos(500) }],
    };
    const lines = buildVoucherJournalLines(input);
    expect(isBalanced(lines)).toBe(true);
    const cash = lines.find((l) => l.accountId === CASH)!;
    expect(cash.debitCents).toBe(pesos(500));
  });

  it("rejects a non-positive line amount", () => {
    const r = zVoucherInput.safeParse({
      type: "payment",
      voucherDate: "2026-06-16",
      cashAccountId: CASH,
      lines: [{ accountId: EXP, amountCents: 0 }],
    });
    expect(r.success).toBe(false);
  });
});
