import json, sys
TIER = "BRONZE"   # verified from /users/me -> plan.tier

def prices(pi):
    """Active pricing tier -> {event: usd}. Tiered prices resolve at TIER."""
    if not pi: return {"model": "NONE_LISTED", "events": {}}
    cur = pi[-1]                      # last entry = currently active
    m = cur.get("pricingModel")
    out = {"model": m, "events": {}, "startedAt": cur.get("startedAt"),
           "minimalMaxTotalChargeUsd": cur.get("minimalMaxTotalChargeUsd"),
           "apifyMarginPercentage": cur.get("apifyMarginPercentage")}
    if m == "PRICE_PER_DATASET_ITEM":
        out["events"]["dataset-item"] = cur.get("pricePerUnitUsd")
        return out
    for name, e in ((cur.get("pricingPerEvent") or {}).get("actorChargeEvents") or {}).items():
        p = e.get("eventPriceUsd")
        if p is None:
            t = (e.get("eventTieredPricingUsd") or {}).get(TIER) or {}
            p = t.get("tieredEventPriceUsd")
        out["events"][name] = p
    return out

inv = json.load(open(sys.argv[1]))
res = {"_meta": {"captured_at": "2026-08-01", "account_tier": TIER,
                 "note": "Prices resolved at the BRONZE tier of the account used. Other tiers differ."},
       "actors": {}}
for k, v in inv.items():
    sch = v.get("input_schema") or {}
    props = sch.get("properties") or {}
    r = (v.get("stats") or {}).get("publicActorRunStats30Days") or {}
    tot = r.get("TOTAL") or 0
    res["actors"][v["full_name"]] = {
        "actor_id": v["actor_id"],
        "slug": k.replace("~", "/"),
        "build": v["latest_build"].get("buildNumber"),
        "build_finished_at": v.get("build_finishedAt"),
        "modified_at": v.get("modifiedAt"),
        "deprecated": v.get("isDeprecated"),
        "total_users": (v.get("stats") or {}).get("totalUsers"),
        "total_runs": (v.get("stats") or {}).get("totalRuns"),
        "runs_30d": tot,
        "success_rate_30d_pct": round(100 * r.get("SUCCEEDED", 0) / tot, 2) if tot else None,
        "failed_30d": r.get("FAILED"), "timeout_30d": r.get("TIMED-OUT"),
        "pricing": prices(v.get("pricingInfos")),
        "input_field_count": len(props),
        "input_fields": sorted(props.keys()),
        "required_fields": sch.get("required") or [],
    }
json.dump(res, open(sys.argv[2], "w"), indent=2)
for n, a in res["actors"].items():
    ev = ", ".join(f"{k}=${v}" for k, v in a["pricing"]["events"].items())
    print(f"{n:44s} b{a['build']:8s} {a['pricing']['model']:22s} {ev}")
