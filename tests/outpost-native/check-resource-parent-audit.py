#!/usr/bin/env python3
"""Verify native positive/negative evidence without converting a gap to PASS."""
import json
import sys
from pathlib import Path
raw=Path(sys.argv[1]).read_text()
start=raw.index("RESOURCE_PARENT_JSON_BEGIN")+len("RESOURCE_PARENT_JSON_BEGIN")
end=raw.index("RESOURCE_PARENT_JSON_END",start)
r=json.loads(raw[start:end])
assert r["network_effects"]["local_requests"]>=5
assert r["network_effects"]["external_attempts"]==0
assert len(r["network_effects"]["events"])==r["network_effects"]["local_requests"]
assert all(e["kind"]=="local_request" for e in r["network_effects"]["events"])
assert r["foreign_parent_visible"] is False and r["auth_requests"]==2
assert len(r["traces"])==2
own,foreign=r["traces"]
assert own["scenario"]=="own_parent" and own["raw_api_status"]==201 and own["persisted_rows"]==1
assert own["pilot_prepare_status"]==200 and own["signed"] and own["binding_count"]==1
assert foreign["scenario"]=="foreign_parent" and foreign["pilot_prepare_status"] in {403,404,409}
assert foreign["signed"] is False and foreign["binding_count"]==0
assert len(foreign["stored_parent_rows"])==foreign["persisted_rows"]
if foreign["persisted_rows"]:
    assert foreign["raw_api_status"]==201 and r["raw_parent_integrity"]=="FAIL"
else:
    assert foreign["raw_api_status"] in {400,403,409} and r["raw_parent_integrity"]=="PASS"
assert r["same_workspace_client_isolation"]=="NOT_TESTED" and r["phase_1"]=="FAIL" and r["customer_pilot_ready"] is False
print(json.dumps({"audit_integrity":"PASS","raw_parent_integrity":r["raw_parent_integrity"],"pilot_parent_integrity":r["pilot_parent_integrity"],"phase_1":"FAIL","customer_pilot_ready":False},indent=2))
