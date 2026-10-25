#!/usr/bin/env python3
"""Check metadata evidence completeness. This is never isolation acceptance."""
import json
import sys
from pathlib import Path

raw = Path(sys.argv[1]).read_text()
start = raw.index("CLIENT_CONTRACT_JSON_BEGIN") + len("CLIENT_CONTRACT_JSON_BEGIN")
end = raw.index("CLIENT_CONTRACT_JSON_END", start)
report = json.loads(raw[start:end])
assert report["read_only"] == "on", "Native audit must be read only"
expected = {"public." + name for name in report["registry"].values()} | {"public.messages"}
actual = {row["table"] for row in report["descendants"]}
assert actual == expected and len(actual) == len(report["descendants"]), "Resource registry coverage drift"
assert {r["table"] for r in report["prerequisites"]} == {"public.client_accounts", "public.client_access_grants", "public.client_company_brain"}
assert report["phase_1"] == "FAIL" and report["customer_pilot_ready"] is False
assert report["same_workspace_isolation"] == "NOT_TESTED"
assert all(row["behavioral_isolation"] == "NOT_TESTED" for row in report["descendants"])
assert report["structural_prerequisites"] in {"FAIL", "BLOCKED", "STRUCTURAL_ONLY"}
print(json.dumps({"audit_integrity":"PASS", "structural_prerequisites":report["structural_prerequisites"],
                  "canonical_tables_missing":[r["table"] for r in report["prerequisites"] if r["status"]=="BLOCKED"],
                  "resources_inventoried":len(actual), "direct_canonical_parents":sum(bool(r["direct_canonical_fk"]) for r in report["descendants"]),
                  "same_workspace_isolation":"NOT_TESTED", "phase_1":"FAIL", "customer_pilot_ready":False}, indent=2))
