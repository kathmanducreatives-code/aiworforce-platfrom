#!/usr/bin/env python3
"""Offline extraction of real-company evidence already committed under tests/fixtures/lead-v2.

Deterministic: files are read in a fixed order, records in document order, and the
first-seen record of a company is its primary; later records only add distinct text.
Reads nothing outside the repo and makes no network call."""
import json, re, os, hashlib
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(__file__), "../../../../fixtures/lead-v2")
OUT = os.path.join(os.path.dirname(__file__), "companies.json")

def domain_of(u):
    if not u or not isinstance(u, str): return None
    u = u.strip()
    if not re.match(r"^https?://", u): u = "https://" + u
    try: h = urlparse(u).hostname or ""
    except Exception: return None
    h = h.lower().removeprefix("www.")
    if not h or "linkedin.com" in h or "." not in h: return None
    return h

def slug_of(u):
    if not u or not isinstance(u, str): return None
    m = re.search(r"linkedin\.com/(?:company|school|showcase)/([^/?#]+)", u)
    return m.group(1).lower() if m else None

def norm_name(n):
    return re.sub(r"[^a-z0-9]+", "", re.sub(r"\(yc [^)]*\)", "", (n or "").lower()))

companies, order = {}, []
SLUG, NAME = {}, {}
def tokens(t): return set(re.findall(r"[a-z0-9]+", t.lower()[:400]))
def similar(a, b):
    x, y = tokens(a), tokens(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.5
RAW = {"records": 0}
def add(name, domain, linkedin, text, field, source_file, run, provenance, evidence_id=None, kind="company_description"):
    if not isinstance(text, str) or len(text.strip()) < 25: return
    RAW["records"] += 1
    key = domain or (("li:" + slug_of(linkedin)) if slug_of(linkedin) else None) or ("name:" + norm_name(name))
    if key in ("name:", None): return
    # SAME COMPANY, KEYED TWO WAYS. A LinkedIn page already seen under another key
    # is that company; so is the same name with near-identical text (one record
    # carrying a domain, the other only a LinkedIn page). Namesakes with different
    # text stay separate — LinkedIn's similar-organization lists are full of them.
    slug = slug_of(linkedin)
    if key not in companies and slug and slug in SLUG:
        key = SLUG[slug]
    if key not in companies:
        for k in NAME.get(norm_name(name), []):
            if any(similar(text, e["text"]) for e in companies[k]["evidence"]):
                key = k; break
    c = companies.get(key)
    if c is None:
        c = companies[key] = {"key": key, "company": name, "domain": domain, "linkedin_url": linkedin, "evidence": [], "sources": []}
        order.append(key)
    if slug: SLUG.setdefault(slug, key)
    if slug_of(c["linkedin_url"]): SLUG.setdefault(slug_of(c["linkedin_url"]), key)
    nn = norm_name(name)
    if nn and key not in NAME.setdefault(nn, []): NAME[nn].append(key)
    if not c["domain"] and domain: c["domain"] = domain
    if not c["linkedin_url"] and linkedin: c["linkedin_url"] = linkedin
    t = text.strip()
    if all(e["text"] != t for e in c["evidence"]):
        c["evidence"].append({"text": t, "field": field, "evidence_type": kind, "source_file": source_file,
                              "source_run": run, "provenance": provenance, "evidence_id": evidence_id})
    s = f"{source_file}#{field}"
    if s not in c["sources"]: c["sources"].append(s)

def snapshots(file, run, root_path):
    d = json.load(open(os.path.join(ROOT, file)))
    cur = d
    for k in root_path: cur = (cur or {}).get(k, {})
    for comp in (cur or {}).get("companies", []) or []:
        snap = comp.get("snapshot") or {}
        for part in ("company", "enriched"):
            c = snap.get(part) or {}
            if not isinstance(c, dict): continue
            dom = domain_of(c.get("canonical_domain")) or domain_of(c.get("website"))
            prov = {"actor": (c.get("raw_ref") or {}).get("actor_key"), "source_id": (c.get("raw_ref") or {}).get("source_id"),
                    "source_provenance": c.get("source_provenance"), "external_source_id": c.get("external_source_id"), "snapshot_part": part}
            add(c.get("company_name"), dom, c.get("linkedin_company_url"), c.get("description"), f"snapshot.{part}.description", file, run, prov,
                evidence_id=c.get("external_source_id"))
            yc = (c.get("startup_evidence") or {}) if isinstance(c.get("startup_evidence"), dict) else {}
            for f in ("one_liner", "long_description"):
                if isinstance(yc.get(f), str):
                    add(c.get("company_name"), dom, c.get("linkedin_company_url"), yc[f], f"snapshot.{part}.startup_evidence.{f}", file, run, prov, kind="yc_company_record")

snapshots("run-4250f181/task.json", "run-4250f181", ["result", "lead_resume_checkpoint"])
snapshots("run-4250f181/lineage.json", "run-4250f181", ["current_state", "lead_resume_checkpoint"])
snapshots("run-1e52d43c/lineage.json", "run-1e52d43c", ["current_state", "lead_resume_checkpoint"])

d = json.load(open(os.path.join(ROOT, "size-semantics-replay-2026-09-24/canary_companies.json")))
for comp in d.get("companies", []):
    for part in ("company_record_row", "discovery_row"):
        r = comp.get(part) or {}
        if isinstance(r, dict):
            add(r.get("name"), domain_of(r.get("website")), r.get("linkedinUrl"), r.get("description"), f"{part}.description",
                "size-semantics-replay-2026-09-24/canary_companies.json", "size-semantics-replay-2026-09-24",
                {"row": part, "provider_id": r.get("id")}, evidence_id=str(r.get("id")) if r.get("id") else None)

d = json.load(open(os.path.join(ROOT, "run-1e52d43c/apify_runs.json")))
for run_id in sorted(d.keys()):
    items = (d[run_id] or {}).get("dataset_items") or []
    actor = (d[run_id] or {}).get("actor") or (d[run_id] or {}).get("actor_id")
    for it in items:
        if not isinstance(it, dict): continue
        add(it.get("name"), domain_of(it.get("website")), it.get("linkedinUrl"), it.get("description"), "dataset_item.description",
            "run-1e52d43c/apify_runs.json", "run-1e52d43c", {"apify_run": run_id, "actor": actor, "role": "dataset_item", "provider_id": it.get("id")},
            evidence_id=str(it.get("id")) if it.get("id") else None)
        for s in it.get("similarOrganizations") or []:
            if isinstance(s, dict):
                add(s.get("name"), domain_of(s.get("website")), s.get("linkedinUrl"), s.get("description"), "similarOrganizations.description",
                    "run-1e52d43c/apify_runs.json", "run-1e52d43c", {"apify_run": run_id, "actor": actor, "role": "similar_organization_of", "of": it.get("name"), "provider_id": s.get("id")},
                    evidence_id=str(s.get("id")) if s.get("id") else None)

d = json.load(open(os.path.join(ROOT, "p3-job-discovery-probe.json")))
for actor, probe in (d.get("probes") or {}).items():
    for it in (probe or {}).get("items") or []:
        c = (it or {}).get("company") or {}
        add(c.get("name"), domain_of(c.get("website")), c.get("linkedinUrl"), c.get("description"), "job.company.description",
            "p3-job-discovery-probe.json", "p3-job-discovery-probe", {"actor": actor, "role": "job_posting_company", "provider_id": c.get("id")},
            evidence_id=str(c.get("id")) if c.get("id") else None)

records = [companies[k] for k in order]
raw_total = sum(len(c["sources"]) for c in records)
json.dump({"generated_by": "tests/edge-functions/_eval/v2/real/extract.py", "raw_company_records": RAW["records"], "unique_companies": len(records), "records": records},
          open(OUT, "w"), indent=1, ensure_ascii=False)
tier = lambda c: "primary" if any(s.startswith(("run-4250f181/task", "run-4250f181/lineage", "run-1e52d43c/lineage", "size-semantics")) for s in c["sources"]) else "reserve"
print(json.dumps({"raw_records": RAW["records"], "duplicates_removed": RAW["records"] - len(records), "unique": len(records), "primary": sum(tier(c)=="primary" for c in records), "reserve": sum(tier(c)=="reserve" for c in records),
                  "with_domain": sum(bool(c["domain"]) for c in records), "multi_source": sum(len(c["sources"])>1 for c in records)}))
