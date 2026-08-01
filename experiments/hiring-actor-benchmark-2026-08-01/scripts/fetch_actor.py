import json, sys, time
sys.path.insert(0, __file__.rsplit("/",1)[0])
from apify import call

ACTORS = ["memo23~y-combinator-scraper","solidcode~ycombinator-scraper",
 "harvestapi~linkedin-company-search","harvestapi~linkedin-job-search",
 "harvestapi~linkedin-company-employees","harvestapi~linkedin-profile-search",
 "harvestapi~linkedin-company"]

inv = {}
for a in ACTORS:
    meta, code = call(f"acts/{a}")
    if code != 200:
        inv[a] = {"__fetch_error__": code, "body": str(meta)[:300]}
        print(f"  {a}: HTTP {code}"); continue
    d = meta["data"]
    latest = (d.get("taggedBuilds") or {}).get("latest") or {}
    bd = {}
    if latest.get("buildId"):
        b, bc = call(f"actor-builds/{latest['buildId']}")
        bd = b.get("data", {}) if bc == 200 else {}
    inv[a] = {
        "actor_id": d.get("id"), "full_name": f"{d['username']}/{d['name']}",
        "title": d.get("title"), "description": d.get("description"),
        "isPublic": d.get("isPublic"), "isDeprecated": d.get("isDeprecated"),
        "createdAt": d.get("createdAt"), "modifiedAt": d.get("modifiedAt"),
        "stats": d.get("stats"), "pricingInfos": d.get("pricingInfos"),
        "defaultRunOptions": d.get("defaultRunOptions"),
        "latest_build": latest,
        "build_finishedAt": bd.get("finishedAt"),
        "input_schema": (bd.get("inputSchema") if isinstance(bd.get("inputSchema"), dict)
                         else (json.loads(bd["inputSchema"]) if bd.get("inputSchema") else None)),
    }
    print(f"  {a}: build {latest.get('buildNumber')} OK")
    time.sleep(0.2)
json.dump(inv, open(sys.argv[1], "w"), indent=2)
print("wrote", sys.argv[1])
