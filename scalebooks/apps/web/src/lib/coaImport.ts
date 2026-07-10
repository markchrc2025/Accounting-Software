import * as XLSX from "xlsx";
import type { AccountType, ImportAccount } from "@scalebooks/domain";

/**
 * Parse an uploaded Chart-of-Accounts spreadsheet (the Zoho Books export format)
 * into import rows. Header matching is case-insensitive and tolerant of the
 * common column aliases, so a hand-tidied export still works.
 */
const TYPE1_TO_ENUM: Record<string, AccountType> = {
  asset: "asset",
  liability: "liability",
  equity: "equity",
  income: "income",
  expense: "expense",
  "cost of services": "expense", // COGS-equivalent; the subtype keeps the detail
};

export interface ParsedCoa {
  accounts: ImportAccount[];
  total: number; // data rows seen
  skipped: number; // rows that couldn't be mapped (missing name/type)
}

/** First non-empty value among the given header aliases (case/space-insensitive). */
function pick(row: Record<string, unknown>, ...names: string[]): string {
  const lookup = new Map<string, unknown>();
  for (const key of Object.keys(row)) lookup.set(key.trim().toLowerCase(), row[key]);
  for (const name of names) {
    const value = lookup.get(name.toLowerCase());
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export async function parseCoaFile(file: File): Promise<ParsedCoa> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) return { accounts: [], total: 0, skipped: 0 };

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const accounts: ImportAccount[] = [];
  let skipped = 0;

  for (const row of rows) {
    const name = pick(row, "Account Name", "Name");
    const type = TYPE1_TO_ENUM[pick(row, "Type1", "Type").toLowerCase()];
    if (!name || !type) {
      skipped++;
      continue;
    }
    const acc: ImportAccount = { code: pick(row, "Account Code", "Code"), name, type };

    const subtype = pick(row, "Account Type", "Subtype", "Sub Type");
    if (subtype) acc.subtype = subtype;
    const description = pick(row, "Description");
    if (description) acc.description = description;
    const dc = pick(row, "Debit or Credit", "Normal Balance").toLowerCase();
    if (dc) acc.normalBalance = dc.startsWith("d") ? "debit" : "credit";
    const parent = pick(row, "Parent Account", "Parent");
    if (parent && parent.toLowerCase() !== name.toLowerCase()) acc.parentName = parent;

    accounts.push(acc);
  }

  return { accounts, total: rows.length, skipped };
}
