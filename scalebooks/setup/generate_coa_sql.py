#!/usr/bin/env python3
"""Generate the ScaleBooks chart-of-accounts seed SQL from the source Excel export.

Source: a Zoho Books "Chart of Accounts" export. Re-run after updating the xlsx:
    python3 setup/generate_coa_sql.py <path-to.xlsx>
Writes setup/seed-chart-of-accounts.sql (idempotent; ON CONFLICT (org_id, name)).
"""
import sys, openpyxl

ORG_ID = "a0000000-0000-0000-0000-000000000001"
XLSX = sys.argv[1] if len(sys.argv) > 1 else \
    "/root/.claude/uploads/ba43e275-0678-5ad3-a854-42093752fa5c/cf8bafeb-Chart_of_Accounts_1.xlsx"
OUT = "setup/seed-chart-of-accounts.sql"

TYPE1_TO_ENUM = {
    "Asset": "asset", "Liability": "liability", "Equity": "equity",
    "Income": "income", "Expense": "expense",
    "Cost of Services": "expense",   # COGS-equivalent; kept distinct via subtype
}

def q(s):
    """SQL string literal (or NULL) with single quotes doubled."""
    if s is None or str(s).strip() == "":
        return "NULL"
    return "'" + str(s).strip().replace("'", "''") + "'"

wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb["Accounts"]
rows = []
for r in ws.iter_rows(min_row=2, values_only=True):
    if all(c is None or str(c).strip() == "" for c in r):
        continue
    cells = [(str(c).strip() if c is not None else "") for c in r]
    rows.append(cells)

records = []
parents = []  # (child_name, parent_name)
for c in rows:
    type1, name, code, desc, subtype = c[0], c[1], c[2], c[3], c[4]
    status, parent, dc = c[9], c[11], c[12]
    enum_type = TYPE1_TO_ENUM[type1]
    normal = "debit" if dc.lower().startswith("d") else "credit"
    is_active = "false" if status.strip().lower() == "inactive" else "true"
    records.append((code, name, enum_type, subtype, desc, normal, is_active))
    if parent:
        parents.append((name, parent))

lines = []
lines.append("-- ════════════════════════════════════════════════════════════════════════════")
lines.append("-- ScaleBooks — Chart of Accounts seed (GENERATED — do not edit by hand).")
lines.append("-- Source: Zoho Books export. Regenerate with setup/generate_coa_sql.py.")
lines.append(f"-- {len(records)} accounts for org {ORG_ID}.")
lines.append("-- Requires the accounts-table extension columns (see 0005_accounts_extend.sql).")
lines.append("-- ════════════════════════════════════════════════════════════════════════════")
lines.append("")
lines.append("INSERT INTO accounts (org_id, code, name, type, subtype, description, normal_balance, is_active) VALUES")
vals = []
for code, name, etype, subtype, desc, normal, active in records:
    vals.append(
        f"  ('{ORG_ID}',{q(code)},{q(name)},'{etype}',{q(subtype)},{q(desc)},'{normal}',{active})"
    )
lines.append(",\n".join(vals))
lines.append("ON CONFLICT (org_id, name) DO NOTHING;")
lines.append("")
lines.append("-- Resolve the parent hierarchy by name (parents are referenced by name in the export).")
lines.append("WITH parent_map (child_name, parent_name) AS (VALUES")
pvals = [f"  ({q(cn)},{q(pn)})" for cn, pn in parents]
lines.append(",\n".join(pvals))
lines.append(")")
lines.append("UPDATE accounts c")
lines.append("SET parent_id = p.id")
lines.append("FROM parent_map m")
lines.append(f"JOIN accounts p ON p.org_id = '{ORG_ID}' AND p.name = m.parent_name")
lines.append(f"WHERE c.org_id = '{ORG_ID}' AND c.name = m.child_name;")
lines.append("")

with open(OUT, "w") as f:
    f.write("\n".join(lines))
print(f"Wrote {OUT}: {len(records)} accounts, {len(parents)} parent links.")
