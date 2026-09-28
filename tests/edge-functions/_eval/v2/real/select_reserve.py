#!/usr/bin/env python3
"""Deterministic reserve selection for the software_product / ai_product shortfalls.

Evidence CATEGORIES are fixed here, before any model result exists, from the description text only:
  X  physical/hardware primary + explicit AI, no software words  -> software NEG and AI POS (overlap)
  Y  explicit AI + software words, no physical/service/media words -> AI POS and software POS
  Z  physical/service/media primary, no AI, no software words    -> software NEG and AI NEG
Order within a category is sha256(extraction key) — stable, and blind to company names or content.
Candidates are only CANDIDATES: each must still be labelled and approved before it enters the benchmark."""
import json, os, re, hashlib, sys
HERE = os.path.dirname(__file__)
AI = re.compile(r"\bAI\b|\bA\.I\.|artificial intelligence|machine learning|\bML\b|computer vision|deep learning|\bLLMs?\b|generative AI|neural networks?", re.I)
AI_CASE = re.compile(r"\bAI\b|\bML\b|\bLLMs?\b")  # the short tokens must be upper-case
AI_LONG = re.compile(r"artificial intelligence|machine learning|computer vision|deep learning|generative ai|neural networks?", re.I)
SOFTWARE = re.compile(r"\bsoftware\b|\bSaaS\b|\bAPIs?\b|\bapps?\b|\bapplications?\b|\bdashboards?\b|\bintegrations?\b|\bplug-?ins?\b|\bCRM\b|\bdeveloper tools?\b|\bplatform\b", re.I)
PHYSICAL = re.compile(r"\bmanufactur(er|ers|es|ing)\b|\bhardware\b|\brobots?\b|\brobotics\b|\bdevices?\b|\bequipment\b|\bvehicles?\b|\bdrones?\b|\bsensors?\b|\bfood\b|\bbeverages?\b|\bapparel\b|\bfurniture\b|\bcameras?\b", re.I)
SERVICE = re.compile(r"\bagency\b|\bconsulting firm\b|\bconsultancy\b|\bstaffing (agency|firm)\b|\blaw firm\b|\baccounting firm\b|\brecruiting firm\b|\bmanaged service provider\b", re.I)
MEDIA = re.compile(r"\bnews\b|\bmagazine\b|\bpublication\b|\bpublisher\b|\bnewsletter\b|\bjournalism\b", re.I)
ENGLISH = re.compile(r"\b(the|and|we|our|for|with)\b", re.I)

def has_ai(t): return bool(AI_CASE.search(t) or AI_LONG.search(t))

def category(t):
    ai, sw = has_ai(t), bool(SOFTWARE.search(t))
    phys, serv, media = bool(PHYSICAL.search(t)), bool(SERVICE.search(t)), bool(MEDIA.search(t))
    if phys and ai and not sw and not serv and not media: return "X"
    if ai and sw and not phys and not serv and not media: return "Y"
    if (phys or serv or media) and not ai and not sw: return "Z"
    return None

def main(need):
    recs = json.load(open(os.path.join(HERE, "companies.json")))["records"]
    PRIMARY = ("run-4250f181/task", "run-4250f181/lineage", "run-1e52d43c/lineage", "size-semantics")
    primary_names = {r["company"].lower() for r in recs if any(s.startswith(PRIMARY) for s in r["sources"])}
    pool = {"X": [], "Y": [], "Z": []}
    for r in recs:
        if any(s.startswith(PRIMARY) for s in r["sources"]): continue
        if r["company"].lower() in primary_names: continue          # no namesakes of the 50
        t = " ".join(e["text"] for e in r["evidence"])
        if not (150 <= len(t) <= 1500) or len(ENGLISH.findall(t)) < 3: continue
        name_free = t.replace(r["company"], "")                       # AI in the NAME is not evidence
        c = category(name_free)
        if c: pool[c].append((hashlib.sha256(r["key"].encode()).hexdigest(), r))
    for c in pool: pool[c].sort(key=lambda x: x[0])
    sw_pos, sw_neg, ai_pos, ai_neg = need
    take = {"X": min(len(pool["X"]), min(sw_neg, ai_pos))}
    sw_neg -= take["X"]; ai_pos -= take["X"]
    take["Y"] = min(len(pool["Y"]), max(sw_pos, ai_pos)); sw_pos -= take["Y"]; ai_pos -= take["Y"]
    take["Z"] = min(len(pool["Z"]), max(sw_neg, ai_neg)); sw_neg -= take["Z"]; ai_neg -= take["Z"]
    sel = [{"category": c, "company": r["company"], "key": r["key"], "domain": r["domain"],
            "text": " ".join(e["text"] for e in r["evidence"]), "provenance": r["evidence"][0]["provenance"],
            "source": f'{r["evidence"][0]["source_run"]}:{r["evidence"][0]["source_file"]}#{r["evidence"][0]["field"]}'}
           for c in ("X", "Y", "Z") for _, r in pool[c][:take[c]]]
    return {"available": {c: len(v) for c, v in pool.items()}, "taken": take, "unfilled_after": {"sw_pos": max(0, sw_pos), "sw_neg": max(0, sw_neg), "ai_pos": max(0, ai_pos), "ai_neg": max(0, ai_neg)}, "candidates": sel}

if __name__ == "__main__":
    need = tuple(int(x) for x in sys.argv[1:5]) if len(sys.argv) >= 5 else (4, 18, 12, 5)
    out = main(need)
    json.dump(out, open(os.path.join(HERE, "reserve-pools-preview.json"), "w"), indent=1, ensure_ascii=False)  # the vetted set is vet_reserve.py's
    print(json.dumps({k: out[k] for k in ("available", "taken", "unfilled_after")}))
    for s in out["candidates"]: print(f'\n[{s["category"]}] {s["company"]} | {s["domain"]} | {s["source"]}\n{s["text"][:900]}')
