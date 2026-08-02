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

BUT the chart WE ship must not contain collisions. Posting code resolves accounts
by code, and a duplicate makes that resolution ambiguous — the export shipped
`2004001-3` twice each (equity vs payroll liability), which let an
opening-balance loan booking debit "Final Pay Payable Deployed" instead of
"Opening Balance Offset". `CODE_OVERRIDES` renumbers the export's collisions and
an assertion below fails the build if any survive. (Tenant-imported charts may
still collide; the API's `resolveAccountCodes()` fails closed on those.)

Run without an xlsx to regenerate from the committed TypeScript artifact:
    python3 setup/generate_coa_sql.py            # re-emits both files
    python3 setup/generate_coa_sql.py chart.xlsx # re-imports from the export
"""
import sys, os, json, re

ORG_ID = "a0000000-0000-0000-0000-000000000001"
XLSX = sys.argv[1] if len(sys.argv) > 1 else None
SQL_OUT = "setup/seed-chart-of-accounts.sql"
TS_OUT = "packages/domain/src/defaultChart.generated.ts"

TYPE1_TO_ENUM = {
    "Asset": "asset", "Liability": "liability", "Equity": "equity",
    "Income": "income", "Expense": "expense",
    "Cost of Services": "expense",   # COGS-equivalent; kept distinct via subtype
}

# ── Corrections applied to the source export ────────────────────────────────
# Keyed by (name, type) — the chart's real unique key — so a code change in the
# source can never silently repoint one of these at the wrong account.
#
# The export numbered three payroll liabilities into the equity block. Equity
# keeps 2004001-3; the liabilities move to the free 2005xxx range, beside the
# other employee-liability groups (2008 Social Agency Contribution, 2009
# Employee Benefit Claims). Mirrored by migration 0023_account_codes.sql for
# orgs that were provisioned before this fix.
CODE_OVERRIDES = {
    ("Salaries and Wages Payable", "liability"): "2005001",
    ("Final Pay Payable Deployed", "liability"): "2005002",
    ("Final Pay Payable", "liability"): "2005003",
}

# Accounts the software needs that the source export does not contain.
# Appended after the export's rows, in chart order. Kept in sync with
# migration 0023_account_codes.sql, which back-fills existing orgs.
EXTRA_ACCOUNTS = [
    {
        "code": "1009002", "name": "Creditable Withholding Tax",
        "type": "asset", "subtype": "Tax Asset", "normalBalance": "debit",
        "description": "Expanded withholding tax withheld by clients on our income "
                       "payments (BIR Form 2307), creditable against income tax due.",
        "isActive": True, "parentName": None,
    },
    {
        "code": "2003004", "name": "Percentage Tax Payable",
        "type": "liability", "subtype": "Tax Liability", "normalBalance": "credit",
        "description": "Percentage tax due under Sec. 116 for non-VAT registered taxpayers.",
        "isActive": True, "parentName": None,
    },
]


def q(s):
    """SQL string literal (or NULL) with single quotes doubled."""
    if s is None or str(s).strip() == "":
        return "NULL"
    return "'" + str(s).strip().replace("'", "''") + "'"


def load_from_xlsx(path):
    """Read the Zoho Books export. Order is preserved from the sheet."""
    import openpyxl
    ws = openpyxl.load_workbook(path, data_only=True)["Accounts"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if all(c is None or str(c).strip() == "" for c in r):
            continue
        c = [(str(x).strip() if x is not None else "") for x in r]
        type1, name, code, desc, subtype = c[0], c[1], c[2], c[3], c[4]
        status, parent, dc = c[9], c[11], c[12]
        out.append({
            "code": code,
            "name": name,
            "type": TYPE1_TO_ENUM[type1],
            "subtype": subtype or None,
            "description": desc or None,
            "normalBalance": "debit" if dc.lower().startswith("d") else "credit",
            "isActive": not (status.strip().lower() == "inactive"),
            "parentName": parent or None,
        })
    return out


def load_from_ts(path):
    """Read back the committed TypeScript artifact.

    Lets the chart be regenerated without the source spreadsheet — the xlsx is
    a one-off vendor export, not something the repo carries. Each emitted entry
    is one line of `key: <json>` pairs, so it round-trips exactly.
    """
    out = []
    for line in open(path):
        line = line.strip()
        if not (line.startswith("{ ") and line.endswith("},")):
            continue
        rec = {}
        for key, raw in re.findall(r'(\w+): ("(?:[^"\\]|\\.)*")', line):
            rec[key] = json.loads(raw)
        out.append({
            "code": rec["code"],
            "name": rec["name"],
            "type": rec["type"],
            "subtype": rec.get("subtype"),
            "description": rec.get("description"),
            "normalBalance": rec["normalBalance"],
            "isActive": True,   # the TS artifact only carries active accounts
            "parentName": rec.get("parentName"),
        })
    return out


if XLSX:
    records = load_from_xlsx(XLSX)
    source = XLSX
else:
    assert os.path.exists(TS_OUT), f"no xlsx given and {TS_OUT} is missing — nothing to read"
    records = load_from_ts(TS_OUT)
    source = TS_OUT

# Apply the corrections (§CODE_OVERRIDES) and append what the export lacks.
for r in records:
    override = CODE_OVERRIDES.get((r["name"], r["type"]))
    if override:
        r["code"] = override
have = {(r["name"], r["type"]) for r in records}
records += [r for r in EXTRA_ACCOUNTS if (r["name"], r["type"]) not in have]

parents = [(r["name"], r["parentName"]) for r in records if r["parentName"]]

# Integrity guards — fail loudly rather than emit a broken chart.
names = [r["name"] for r in records]
assert len(set(names)) == len(names), "account names must be unique (they are the key)"
nameset = set(names)
bad = [p for _, p in parents if p not in nameset]
assert not bad, f"unresolved parents: {bad}"

# The chart we ship must resolve unambiguously by code — posting code looks
# accounts up that way. Add to CODE_OVERRIDES if the export introduces a clash.
dupes = {}
for r in records:
    dupes.setdefault(r["code"], []).append(f'{r["name"]} ({r["type"]})')
clashes = {c: v for c, v in dupes.items() if len(v) > 1}
assert not clashes, (
    "duplicate account codes in the generated chart — posting resolves accounts "
    f"by code, so these are ambiguous: {clashes}"
)

unused = [k for k in CODE_OVERRIDES if k not in {(r["name"], r["type"]) for r in records}]
assert not unused, f"CODE_OVERRIDES entries match no account (renamed upstream?): {unused}"

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

print(f"Read {source}")
print(f"Wrote {SQL_OUT} and {TS_OUT}: {len(records)} accounts, {len(parents)} parent links, "
      f"{len(CODE_OVERRIDES)} code overrides, all codes unique.")
