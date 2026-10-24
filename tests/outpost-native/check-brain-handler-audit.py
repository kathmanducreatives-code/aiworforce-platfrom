#!/usr/bin/env python3
"""Validate complete real-handler evidence; never relabel known failures PASS."""
import json
import re
import sys
from pathlib import Path

text = re.sub(r"\x1b\[[0-9;]*m", "", Path(sys.argv[1]).read_text())
rows = []
for line in text.splitlines():
    if line.startswith('{"handler":'):
        rows.append(json.loads(line))
scenarios = {"owner", "admin", "editor", "viewer", "revoked", "foreign", "logged_out", "member", "revoke_inflight", "demote_inflight", "logout_inflight"}
expected = {(h, c) for h in ("setup", "update") for c in scenarios}
assert len(rows) == len(expected), "Missing/duplicate actual handler receipts"
assert {(r["handler"], r["scenario"]) for r in rows} == expected
known = []
for row in rows:
    assert row["external_calls"] == 0, "External operation attempted"
    scenario = row["scenario"]
    if scenario in {"owner", "admin", "editor"}:
        assert row["status"] == 200 and row["changed"] and row["writes"] >= 1, "Positive control did not actually write"
    elif scenario.endswith("inflight"):
        assert row["revoked"], "Race was not actually committed"
        if row["status"] == 200 and row["changed"] and row["writes"] == 1:
            known.append((row["handler"], scenario))
        else:
            assert row["status"] in {401, 403} and not row["changed"], "Unexpected authorization behavior"
    else:
        assert row["status"] in {401, 403} and not row["changed"] and row["writes"] == 0, "Initial authorization control failed"
if known:
    assert len(known) == 6, "Partial/unexpected fix needs review, not an inferred PASS"
    assert "FAILED | 17 passed | 6 failed" in text, "Unexpected test failure or harness error"
    for handler, scenario in known:
        assert re.search(rf"Brain Edge {handler}: {scenario} authorization and native write \.\.\. FAILED", text), "Missing deterministic failing assertion"
    readiness = "FAIL"
else:
    assert "ok | 23 passed | 0 failed" in text, "Unreported assertion or harness failure"
    readiness = "PASS"
print(json.dumps({"audit_integrity": "PASS", "brain_edge_authorization": readiness,
                  "known_failures": known, "records": rows, "customer_pilot_ready": False}, indent=2))
print("BRAIN_EDGE_AUTH_READINESS=" + readiness + "; phase_1_complete=false; customer_pilot_ready=false")
