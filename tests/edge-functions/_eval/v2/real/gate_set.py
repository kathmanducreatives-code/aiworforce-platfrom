#!/usr/bin/env python3
"""The software_product / ai_product GATE SET and its tune/held-out split.

Counts only HIGH-confidence labels of REAL, COMMERCIAL companies (settled 50 + adjudicated reserve).
Excluded: synthetic fixtures, non-commercial dev cases, NOT_DETERMINABLE and REVIEW cells.
SPLIT: stratified by the (software, ai) label pair; within a stratum, companies are ordered by
sha256(key) and alternate held-out, tune, held-out, … — so each stratum's held-out share is the
ceiling of half. The split depends only on keys and labels, and is written before any V2 model result."""
import json, os, hashlib
HERE = os.path.dirname(__file__)

# CONTRACT EXCLUSIONS (USER 2026-09-28): software_product cells whose supporting line the V2
# platform-only guard refuses ("platform" with no software keyword). The label stands, but a judge
# citing it can never be credited under the frozen contract, so the cell is left out of the software
# gate; the company still counts for ai_product. The TS suite checks this list is exactly that set.
SOFTWARE_CONTRACT_EXCLUDED = {
    "Quartzy": "platform-only guard refuses the supporting line",
    "Braintrust": "platform-only guard refuses the supporting line",
    "Structured AI": "platform-only guard refuses the supporting line",
    "Effective AI": "platform-only guard refuses the supporting line",
    "Workday": "platform-only guard refuses the supporting line",
    "mlpal": "platform-only guard refuses the supporting line",
}
EXCLUSION_NOTE = "EXCLUDED (contract: platform-only guard; USER 2026-09-28)"

def evidence(eligible):
    """What each gate company's judges will read: every DISTINCT extracted description, in extraction
    order — the same texts its supporting phrases were verified against. ComfyUI's evidence is the V2
    production fixture's pages (referenced, not copied). Offline: read from companies.json only."""
    recs = {r["key"]: r for r in json.load(open(os.path.join(HERE, "companies.json")))["records"]}
    out = []
    for r in eligible:
        row = {"key": r["key"], "company": r["company"], "software_evidence": r["software_evidence"], "ai_evidence": r["ai_evidence"]}
        if r["key"] == "v2-fixture:comfyui":
            row.update({"evidence_ref": "v2-production-fixture:comfyui", "domain": None, "texts": []})
        else:
            rec, texts = recs[r["key"]], []
            for e in rec["evidence"]:
                if e["text"] not in texts: texts.append(e["text"])
            for q in (r["software_evidence"], r["ai_evidence"]):
                if q and not any(q in t for t in texts): raise SystemExit(f"not verbatim: {r['company']}: {q!r}")
            row.update({"evidence_ref": None, "domain": rec["domain"], "texts": texts})
        out.append(row)
    return {"version": "facet-benchmark-v2-gate-evidence-sw-ai", "companies": out}

def main():
    adj = json.load(open(os.path.join(HERE, "adjudication-sw-ai.json")))
    props = {p["company"]: p for p in json.load(open(os.path.join(HERE, "label-proposals.json")))}
    res = json.load(open(os.path.join(HERE, "reserve-candidates.json")))
    rows = []
    for a in adj:
        key = props[a["company"]]["extraction_key"] if a["company"] in props else "v2-fixture:comfyui"
        sw = a["software_product"] if a["sw_group"] == "A" and a["software_product"] in ("YES", "NO") else None
        ai = a["ai_product"] if a["ai_group"] == "A" and a["ai_product"] in ("YES", "NO") else None
        primary = ("software_product" if a["software_product"] == "YES" else
                   "not_determinable" if a["software_product"] == "NOT_DETERMINABLE" else
                   props[a["company"]]["primary_offering"] if a["company"] in props else "software_product")
        rows.append({"company": a["company"], "key": key, "origin": "settled_50", "software_product": sw, "ai_product": ai,
                     "software_raw": a["software_product"], "ai_raw": a["ai_product"], "company_type": primary,
                     "software_evidence": a["sw_evidence"] if sw else None, "ai_evidence": a["ai_evidence"] if ai else None})
    for c in res["candidates"]:
        sw = c["software_product"] if c["software_status"] == "HIGH" else None
        ai = c["ai_product"] if c["ai_status"] == "HIGH" else None
        rows.append({"company": c["company"], "key": c["key"], "origin": f"reserve_{c['category']}", "software_product": sw, "ai_product": ai,
                     "software_raw": f"{c['software_product']}/{c['software_status']}", "ai_raw": f"{c['ai_product']}/{c['ai_status']}",
                     "company_type": c["primary_offering"],
                     "software_evidence": c["software_evidence"] if sw else None, "ai_evidence": c["ai_evidence"] if ai else None})
    for r in rows:
        if r["company"] in SOFTWARE_CONTRACT_EXCLUDED:
            r["software_raw"] = f'{r["software_raw"]} {EXCLUSION_NOTE}'
            r["software_evidence_excluded"], r["software_product"], r["software_evidence"] = r["software_evidence"], None, None
    assert sum(r["company"] in SOFTWARE_CONTRACT_EXCLUDED for r in rows) == len(SOFTWARE_CONTRACT_EXCLUDED)
    eligible = [r for r in rows if r["software_product"] or r["ai_product"]]
    strata = {}
    for r in eligible:
        strata.setdefault((r["software_product"] or "-", r["ai_product"] or "-"), []).append(r)
    for k, group in strata.items():
        group.sort(key=lambda r: hashlib.sha256(r["key"].encode()).hexdigest())
        for i, r in enumerate(group): r["split"] = "heldout" if i % 2 == 0 else "tune"
    def tally(facet, split=None):
        rs = [r for r in eligible if r[facet] and (split is None or r["split"] == split)]
        return {"YES": sum(r[facet] == "YES" for r in rs), "NO": sum(r[facet] == "NO" for r in rs)}
    def dist(facet, value):
        out = {}
        for r in eligible:
            if r[facet] == value: out[r["company_type"]] = out.get(r["company_type"], 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))
    assignment = "\n".join(f"{r['key']}\t{r['split']}" for r in sorted(eligible, key=lambda r: r["key"]))
    out = {
        "version": "facet-benchmark-v2-gate-set-sw-ai",
        "created_before_model_results": True,
        "rule": "stratum=(software,ai); order=sha256(key); alternate heldout,tune,…",
        "split_sha256": hashlib.sha256(assignment.encode()).hexdigest(),
        "counts": {f: {"total": tally(f), "heldout": tally(f, "heldout"), "tune": tally(f, "tune")} for f in ("software_product", "ai_product")},
        "negatives_by_type": {"software_product_NO": dist("software_product", "NO"), "ai_product_NO": dist("ai_product", "NO")},
        "positives_by_type": {"software_product_YES": dist("software_product", "YES"), "ai_product_YES": dist("ai_product", "YES")},
        "excluded": [{"company": r["company"], "software": r["software_raw"], "ai": r["ai_raw"]} for r in rows if not (r["software_product"] and r["ai_product"])],
        "software_contract_excluded": [{"company": r["company"], "label": "YES", "supporting_line_phrase": r["software_evidence_excluded"],
                                        "reason": SOFTWARE_CONTRACT_EXCLUDED[r["company"]]} for r in rows if r["company"] in SOFTWARE_CONTRACT_EXCLUDED],
        "companies": [{k: r[k] for k in ("company", "key", "origin", "software_product", "ai_product", "company_type", "split")} for r in eligible],
    }
    json.dump(out, open(os.path.join(HERE, "gate-set-sw-ai.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(evidence(eligible), open(os.path.join(HERE, "gate-evidence-sw-ai.json"), "w"), indent=1, ensure_ascii=False)
    return out

if __name__ == "__main__":
    o = main()
    print(json.dumps({k: o[k] for k in ("split_sha256", "counts", "negatives_by_type", "positives_by_type")}, indent=1))
    print("eligible companies:", len(o["companies"]))
