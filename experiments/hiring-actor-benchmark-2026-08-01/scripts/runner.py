"""Run an Apify actor, wait, persist raw output + ACTUAL cost. Enforces a hard
cumulative spend ceiling. Never persists the token."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify import call

CEILING_USD = 5.00
LEDGER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spend_ledger.json")

def ledger():
    try: return json.load(open(LEDGER))
    except Exception: return {"ceiling_usd": CEILING_USD, "runs": []}

def spent(l): return round(sum(r.get("actual_cost_usd") or 0 for r in l["runs"]), 6)

def run_actor(actor, inp, label, est_max, timeout_s=600):
    l = ledger()
    cum = spent(l)
    if cum + est_max > CEILING_USD:
        raise SystemExit(f"BLOCKED: {cum:.4f} + est {est_max:.4f} would exceed ${CEILING_USD}")
    print(f"[{label}] est_max=${est_max:.4f} cum_spent=${cum:.4f} -> starting {actor}")
    t0 = time.time()
    res, code = call(f"acts/{actor}/runs", "POST", inp)
    if code not in (200, 201):
        print(f"  START FAILED http={code} {str(res)[:400]}")
        l["runs"].append({"label": label, "actor": actor, "status": "START_FAILED",
                          "http": code, "error": str(res)[:500], "actual_cost_usd": 0,
                          "estimated_max_usd": est_max, "input": inp})
        json.dump(l, open(LEDGER, "w"), indent=2); return None
    rid = res["data"]["id"]
    while time.time() - t0 < timeout_s:
        time.sleep(5)
        st, _ = call(f"actor-runs/{rid}")
        s = st["data"]["status"]
        if s in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"): break
        print(f"  ...{s} {int(time.time()-t0)}s", flush=True)
    d = st["data"]
    cost = d.get("usageTotalUsd") or 0
    items = []
    if d.get("defaultDatasetId"):
        got, gc = call(f"datasets/{d['defaultDatasetId']}/items?clean=true&limit=1000")
        items = got if isinstance(got, list) else []
    rec = {"label": label, "actor": actor, "run_id": rid, "status": d["status"],
           "latency_s": round(time.time() - t0, 1), "estimated_max_usd": est_max,
           "actual_cost_usd": cost, "rows": len(items),
           "usage": d.get("usageUsd"), "input": inp,
           "startedAt": d.get("startedAt"), "finishedAt": d.get("finishedAt")}
    l["runs"].append(rec); json.dump(l, open(LEDGER, "w"), indent=2)
    print(f"  {d['status']} rows={len(items)} cost=${cost:.4f} in {rec['latency_s']}s  cum=${spent(l):.4f}")
    return {"meta": rec, "items": items}

def save(out, path):
    json.dump(out, open(path, "w"), indent=2)
    print("  saved", os.path.basename(path))
