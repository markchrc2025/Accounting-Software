#!/usr/bin/env python3
"""Generate the ScaleBooks default chart of accounts from the source Excel export.

Source: a Zoho Books "Chart of Accounts" export. Re-run after updating the xlsx:
    python3 setup/generate_coa_sql.py <path-to.xlsx>

Emits two artifacts from one source of truth:
  • setup/seed-chart-of-accounts.sql            — org bootstrap (Supabase setup)
  • packages/domain/src/defaultChart.generated.ts — the software's default chart
                                                     (used to provision every org)

Real charts reuse the same numeric `code` across types, so the unique key is the
account NAME; `code` is a non-unique display label.
"""
import sys, json, openpyxl

ORG_ID = "a0000000-0000-0000-0000-000000000001"
XLSX = sys.argv[1] if len(sys.argv) > 1 else \
    "/root/.claude/uploads/ba43e275-0678-5ad3-a854-42093752fa5c/bf78bbb2-Chart_of_Accounts.xlsx"
SQL_OUT = "setup/seed-chart-of-accounts.sql"
TS_OUT = "packages/domain/src/defaultChart.generated.ts"

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

# Normalize each row into a record. Order is preserved from the export.
records = []  # dicts: code,name,type,subtype,description,normal_balance,is_active,parent
for c in rows:
    type1, name, code, desc, subtype = c[0], c[1], c[2], c[3], c[4]
    status, parent, dc = c[9], c[11], c[12]
    records.append({
        "code": code,
        "name": name,
        "type": TYPE1_TO_ENUM[type1],
        "subtype": subtype or None,
        "description": desc or None,
        "normalBalance": "debit" if dc.lower().startswith("d") else "credit",
        "isActive": not (status.strip().lower() == "inactive"),
        "parentName": parent or None,
    })

parents = [(r["name"], r["parentName"]) for r in records if r["parentName"]]

# Integrity guards — fail loudly rather than emit a broken chart.
names = [r["name"] for r in records]
assert len(set(names)) == len(names), "account names must be unique (they are the key)"
nameset = set(names)
bad = [p for _, p in parents if p not in nameset]
assert not bad, f"unresolved parents: {bad}"

# ── SQL artifact (org bootstrap) ────────────────────────────────────────────
lines = []
lines.append("-- ════════════════════════════════════════════════════════════════════════════")
lines.append("-- ScaleBooks — default Chart of Accounts seed (GENERATED — do not edit by hand).")
lines.append("-- Source: Zoho Books export. Regenerate with setup/generate_coa_sql.py.")
lines.append(f"-- {len(records)} accounts for org {ORG_ID}.")
lines.append("-- Requires the accounts-table extension columns (see 0005_accounts_extend.sql).")
lines.append("-- ════════════════════════════════════════════════════════════════════════════")
lines.append("")
lines.append("INSERT INTO accounts (org_id, code, name, type, subtype, description, normal_balance, is_active) VALUES")
vals = []
for r in records:
    vals.append(
        f"  ('{ORG_ID}',{q(r['code'])},{q(r['name'])},'{r['type']}',"
        f"{q(r['subtype'])},{q(r['description'])},'{r['normalBalance']}',"
        f"{'true' if r['isActive'] else 'false'})"
    )
lines.append(",\n".join(vals))
lines.append("ON CONFLICT (org_id, name) DO NOTHING;")
lines.append("")
lines.append("-- Resolve the parent hierarchy by name (parents are referenced by name in the export).")
lines.append("WITH parent_map (child_name, parent_name) AS (VALUES")
lines.append(",\n".join(f"  ({q(cn)},{q(pn)})" for cn, pn in parents))
lines.append(")")
lines.append("UPDATE accounts c")
lines.append("SET parent_id = p.id")
lines.append("FROM parent_map m")
lines.append(f"JOIN accounts p ON p.org_id = '{ORG_ID}' AND p.name = m.parent_name")
lines.append(f"WHERE c.org_id = '{ORG_ID}' AND c.name = m.child_name;")
lines.append("")
with open(SQL_OUT, "w") as f:
    f.write("\n".join(lines))

# ── TypeScript artifact (software default, provisions every org) ─────────────
def ts_obj(r):
    parts = [
        f'code: {json.dumps(r["code"])}',
        f'name: {json.dumps(r["name"])}',
        f'type: {json.dumps(r["type"])}',
        f'normalBalance: {json.dumps(r["normalBalance"])}',
    ]
    if r["subtype"]:
        parts.append(f'subtype: {json.dumps(r["subtype"])}')
    if r["description"]:
        parts.append(f'description: {json.dumps(r["description"])}')
    if r["parentName"]:
        parts.append(f'parentName: {json.dumps(r["parentName"])}')
    return "  { " + ", ".join(parts) + " },"

ts = []
ts.append("// ════════════════════════════════════════════════════════════════════════════")
ts.append("// GENERATED — do not edit by hand. Regenerate with setup/generate_coa_sql.py.")
ts.append("// The default Chart of Accounts the software provisions for every organization.")
ts.append(f"// {len(records)} accounts. `code` is a display label (it repeats across types);")
ts.append("// the unique key is `name`. Parents are referenced by `parentName`.")
ts.append("// ════════════════════════════════════════════════════════════════════════════")
ts.append('import type { ChartAccount } from "./accounts";')
ts.append("")
ts.append("export const DEFAULT_CHART_OF_ACCOUNTS: readonly ChartAccount[] = [")
ts.extend(ts_obj(r) for r in records)
ts.append("];")
ts.append("")
with open(TS_OUT, "w") as f:
    f.write("\n".join(ts))

print(f"Wrote {SQL_OUT} and {TS_OUT}: {len(records)} accounts, {len(parents)} parent links.")
