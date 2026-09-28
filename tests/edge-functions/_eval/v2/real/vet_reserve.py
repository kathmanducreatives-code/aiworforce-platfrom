#!/usr/bin/env python3
"""The reserve candidate set: select_reserve.py's fixed categories and order, plus a HUMAN VETO LOG.
Walk each category in its sha256 order, skip vetoed candidates (reason recorded), take the next
until the shortfall is met. Needs are the CONSERVATIVE ones (pending decisions not counted).
Candidates are not labels: each still needs labelling and approval before entering the benchmark."""
import json, os, re, sys, hashlib
HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
import select_reserve as s

VETO = {  # company: reason (evidence-based, decided before any model result)
 "World Labs": "X: 'robotics' is an application area; the product is AI research/world models, not physical goods",
 "Hypercubic": "X: 'manufacturing' is a customer industry; mainframe modernization is software/services",
 "3i Infotech Ltd.": "X: IT services company leveraging AI — an agency using AI does not count",
 "Fearn": "X: foundation models; licensed-models vs software primary is not established",
 "University of Toronto Robotics Institute": "X: a research institute; AI is not stated as a product capability",
 "Hiro Robotics": "X: e-waste processing that uses AI internally — AI is not the product sold",
 "SureBright": "Y: primary is warranties/insurance embedded at checkout, not clearly software",
 "RentAHuman": "Y: a marketplace where AI agents pay people; AI is the user, not the capability",
 "Synkka AI": "Y: 'AI workforce' that builds integrations — service vs software not established",
 "Skill": "Y: operates a full-service staffing business; its AI powers its own operations",
 "DiligenceSquared (YC F25)": "Y: produces due-diligence reports — service vs software not established",
 "Clicks Health": "Y: AI agents that do the work — the same question as pending decision P2",
 "Snowflake": "Y: 'AI Data Cloud' is branding; no AI capability described",
 "Indeed": "Y: a job marketplace; AI matching is secondary",
 "Benchling": "Y: AI is context ('for the AI era'); no AI product capability described",
 "Cooper": "Y: AI coworker doing the work — pending decision P2",
 "Pace": "Y: agentic workforce replacing BPOs — pending decision P2",
 "Scale AI": "Y: data services plus a platform — primary mixed",
 "Crossing Hurdles": "Y: a talent network connecting professionals — not software",
 "Phinomics": "Y: biology/data company; primary offering not established",
 "JLL": "Y: real-estate services company",
 "Confident AI": "Y: tooling FOR AI systems — the same question as pending decision P3",
 "Blueberry": "Y: 'AI marketing platform' with vague functionality — platform alone",
 "Opus Recruitment Solutions": "Y: recruitment/staffing firm",
 "Allied Cloud Solutions": "Y: AI implementation services for NetSuite (also caught by the non-commercial rule via a partner's description)",
 "GREENBOX Labs": "Z: sells prediction models — software/AI-ish, not a clean negative",
}

# NON-COMMERCIAL ORGANISATIONS never count toward the 30/30 gate (user, 2026-09-28): they are
# valid negatives but over-easy and unlike Agentory's target population. A fixed rule, applied
# to the description and the name, BEFORE any model result; residual misses go in VETO.
NONCOMMERCIAL_TEXT = re.compile(r"\bnon-?profit\b|\bnot-for-profit\b|\bcharit(y|ies|able)\b|\bdonat(e|es|ion|ions)\b|\bdonors?\b|\bvolunteers?\b|hunger[- ]relief|\bfood (pantry|shelves|bank)\b|\bchild hunger\b|\bend hunger\b", re.I)
NONCOMMERCIAL_NAME = re.compile(r"\buniversity\b|\bcollege\b|\bschool of\b|\binstitute\b|\bfoundation\b|\bsociety\b|\bassociation\b", re.I)

def non_commercial(r, text):
    return bool(NONCOMMERCIAL_TEXT.search(text) or NONCOMMERCIAL_NAME.search(r["company"]))

# ADJUDICATION of selected candidates, software_product / ai_product only (2026-09-28).
# (sw, sw_quote, ai, ai_quote, primary, reason). Status per facet: YES/NO count (HIGH);
# NOT_DETERMINABLE is excluded; REVIEW needs the user. Quotes are verified verbatim.
H, ND, RV = "HIGH", "NOT_DETERMINABLE", "REVIEW"
ADJ = {
 "Matic Robots": (("NO", H), "a remarkably smart, proactive, and secure floor-cleaning robot", ("YES", H), "home robots using AI and computer vision", "physical_product_or_hardware", "A robot is the product; AI and computer vision are its stated capabilities."),
 "Lovable": (("YES", H), "a platform that lets you build apps and websites by chatting with AI", ("YES", H), "by chatting with AI", "software_product", ""),
 "GitHub": (("YES", H), "the complete AI-powered developer platform to build, scale, and deliver secure software", ("YES", RV), "AI-powered developer platform", "software_product", "AI: only the adjective 'AI-powered' — no AI capability described (policy Q-A)."),
 "Structured AI": (("YES", H), "Run compliance reviews across thousands of pages in minutes", ("YES", H), "Our AI agents learn your firm's standards", "software_product", ""),
 "Fuse AI Workforce": (("YES", H), "Our platform includes AI-powered voice and text assistants", ("YES", H), "24/7 AI receptionists", "software_product", "A different company from Fuse AI."),
 "Effective AI": (("YES", RV), "Effective AI is the agent platform for the teams that price risk", ("YES", H), "long-context reasoning, formal verification, multi-agent coordination", "software_product", "Software: 'agent platform' / 'code-first autonomy' with little functionality described."),
 "Workday": (("YES", H), "unifying HR and Finance on an open, trusted platform powered by AI", ("YES", H), "puts AI agents to work for you and your people", "software_product", ""),
 "Salesforce": (("YES", H), "Customer 360 apps on one platform", ("YES", H), "We're the #1 AI CRM", "software_product", "Agents with AI are the product's own capability (P1 rule)."),
 "Emergent": (("YES", H), "an AI app builder that turns your ideas into monetizable software", ("YES", H), "We build autonomous coding agents", "software_product", ""),
 "Barracuda": (("YES", H), "Our AI-powered BarracudaONE platform secures email, data, applications and networks", ("YES", RV), "AI-powered BarracudaONE platform", "software_product", "AI: only 'AI-powered' (policy Q-A)."),
 "mlpal": (("YES", H), "Our platform brings together agents, memory, model building, secure data access, and inference optimization", ("YES", RV), "helps enterprises build, deploy, and scale AI systems", "software_product", "AI: a platform for building AI systems — infrastructure for AI vs AI product (policy Q-B)."),
 "Ruley, the E-Referee": (("YES", H), "Our API delivers accurate, real-time answers to complex rules questions", ("YES", RV), "AI-powered sports rules engine", "software_product", "AI: only 'AI-powered' (policy Q-A)."),
 "Datatruck": (("YES", H), "Datatruck is an all-in-one Transportation Management System (TMS)", ("YES", RV), "Our AI-powered platform helps carriers and brokers streamline workflows", "software_product", "AI: only 'AI-powered' (policy Q-A)."),
 "Kestra": (("YES", H), "Kestra is the open-source orchestration platform", ("YES", RV), "govern all your workflows - data, AI, infrastructure, and business", "software_product", "AI: orchestrates AI workflows; 'with AI' capability not described (policy Q-B)."),
 "Tempus AI": (("NOT_DETERMINABLE", ND), "an operating system to make that data accessible and useful", ("YES", H), "the practical application of artificial intelligence in healthcare", "not_determinable", "Software: data library, operating system and precision-medicine solutions — primary not established."),
 "Upstart": (("NO", H), "the leading AI lending marketplace", ("YES", H), "leverage Upstart’s AI models", "marketplace", "A lending marketplace whose AI models are part of what lenders use."),
 "DIVE-Turbine": (("NO", H), "The DIVE-Turbine is an innovative turbine concept for hydropower plants", ("NO", H), None, "physical_product_or_hardware", ""),
 "Plantible": (("NO", H), "develop the most functional and applicable plant-based protein", ("NO", H), None, "physical_product_or_hardware", "A food ingredient; 'food technology' is not software."),
 "TALENTS BOUTIQUE - E-commerce Recruiting agency": (("NO", H), "We are an E-commerce recruitment agency", ("NO", H), None, "human_delivered_service", "'data-driven tools' is not AI."),
 "Torkildson Katz, A Law Corporation": (("NO", H), "the law firm of Torkildson Katz", ("NO", H), None, "human_delivered_service", ""),
 "NanoNord A/S": (("NO", H), "We specialize in the development of low-field NMR analysis systems", ("NO", H), None, "physical_product_or_hardware", ""),
 "RapidDx Inc.": (("NO", H), "handheld diagnostic device", ("NO", H), None, "physical_product_or_hardware", ""),
 "Chomps": (("NO", H), "Chomps is a best-for-you meat snack brand", ("NO", H), None, "physical_product_or_hardware", ""),
 "Gartner": (("NO", H), "We deliver actionable, objective business and technology insights", ("NO", H), None, "media_or_content", "Research and advisory (professional information); 'tools' are secondary."),
 "US Brick": (("NO", H), "brick manufacturer", ("NO", H), None, "physical_product_or_hardware", ""),
 "Cherry Bekaert": (("NO", H), "a top-ranked U.S. CPA and advisory firm", ("NO", H), None, "human_delivered_service", ""),
 "Blue Square X": (("NO", H), "premium digital display systems", ("NO", H), None, "physical_product_or_hardware", ""),
 "Alp Glass Cam Sanayi ve Ticaret Limited Şirketi": (("NO", H), "the production of aluminum glass balconies, door and window systems", ("NO", H), None, "physical_product_or_hardware", ""),
 "Imidia Digital Technologies": (("NOT_DETERMINABLE", ND), "We provide digital printing solutions", ("NO", H), None, "not_determinable", "Two sentences: 'digital printing solutions' plus distribution — primary not established."),
 "C-SUITE ASSISTANTS": (("NO", H), "a specialist executive assistant recruitment agency", ("NO", H), None, "human_delivered_service", ""),
 "Every Brand Apparel, Inc.": (("NO", H), "THE Apparel, tee prize, and insurance resource for 450+ golf tournaments", ("NO", H), None, "physical_product_or_hardware", "Apparel supply."),
 "NordicWorkflow ApS": (("NO", H), "NordicWorkflow is a consultancy", ("NO", H), None, "human_delivered_service", "'cutting-edge technology' is not a software product or AI."),
}

# USER RESOLUTIONS of the REVIEW cells (2026-09-28), applied AFTER selection. The walk above ran on
# the statuses in ADJ (REVIEW did not count toward a need); resolving a cell changes its label, never
# which companies were selected — re-walking with resolved labels would reselect after adjudication.
# company: {facet: (value, reason)} — the resolved cell becomes HIGH.
RESOLVED = {
 "GitHub": {"ai": ("YES", "USER Q-A 2026-09-28: 'AI-powered developer platform' is explicit product-level AI wording about its own product.")},
 "Barracuda": {"ai": ("YES", "USER Q-A 2026-09-28: 'AI-powered BarracudaONE platform' is explicit product-level AI wording about its own product.")},
 "Ruley, the E-Referee": {"ai": ("YES", "USER Q-A 2026-09-28: 'AI-powered sports rules engine' is explicit product-level AI wording about its own product.")},
 "Datatruck": {"ai": ("YES", "USER Q-A 2026-09-28: 'Our AI-powered platform' is explicit product-level AI wording about its own product.")},
 "mlpal": {"ai": ("YES", "USER Q-B 2026-09-28: built specifically to help customers build, deploy and scale AI systems; AI is central to its function.")},
 "Kestra": {"ai": ("NO", "USER Q-B 2026-09-28: generic orchestration that merely supports AI workloads; AI is not itself a substantive capability.")},
 "Effective AI": {"sw": ("YES", "USER 2026-09-28: 'agent platform' plus described capabilities (long-context reasoning, formal verification, multi-agent coordination) establishes software.")},
}

def resolve(c):
    """A selected candidate's FINAL labels: its selection-time adjudication plus any user resolution."""
    r = RESOLVED.get(c["company"], {})
    for facet, field in (("sw", "software"), ("ai", "ai")):
        if facet in r:
            value, why = r[facet]
            c[f"{field}_at_selection"] = f'{c["software_product" if field == "software" else "ai_product"]}/{c[f"{field}_status"]}'
            c["software_product" if field == "software" else "ai_product"] = value
            c[f"{field}_status"] = H
            c[f"{field}_resolution"] = why
    return c

def pools():
    recs = json.load(open(os.path.join(HERE, "companies.json")))["records"]
    PRIMARY = ("run-4250f181/task", "run-4250f181/lineage", "run-1e52d43c/lineage", "size-semantics")
    prim = {r["company"].lower() for r in recs if any(x.startswith(PRIMARY) for x in r["sources"])}
    out = {"X": [], "Y": [], "Z": []}
    for r in recs:
        if any(x.startswith(PRIMARY) for x in r["sources"]) or r["company"].lower() in prim: continue
        t = " ".join(e["text"] for e in r["evidence"])
        if not (150 <= len(t) <= 1500) or len(s.ENGLISH.findall(t)) < 3: continue
        c = s.category(t.replace(r["company"], ""))
        if c: out[c].append((hashlib.sha256(r["key"].encode()).hexdigest(), r))
    for c in out: out[c].sort(key=lambda x: x[0])
    return out

def select(sw_pos, sw_neg, ai_pos, ai_neg):
    """Walk X, then Y, then Z in their fixed orders. A candidate counts toward a need only when its
    label for that facet is HIGH-confidence; each walk stops once its needs are met in HIGH labels."""
    P, chosen, vetoed, dev_only = pools(), [], [], []
    got = {"sw_pos": 0, "sw_neg": 0, "ai_pos": 0, "ai_neg": 0}
    def counts(company):
        a = ADJ[company]
        return {"sw_pos": a[0] == ("YES", H), "sw_neg": a[0] == ("NO", H), "ai_pos": a[2] == ("YES", H), "ai_neg": a[2] == ("NO", H)}
    def walk(cat, done, fills):
        n = 0
        for _, r in P[cat]:
            if done(): break
            t = " ".join(e["text"] for e in r["evidence"])
            if non_commercial(r, t):
                dev_only.append({"category": cat, "company": r["company"], "reason": "non-commercial (rule): dev/stress only, never gate"}); continue
            if r["company"] in VETO:
                vetoed.append({"category": cat, "company": r["company"], "reason": VETO[r["company"]]}); continue
            if r["company"] not in ADJ:
                raise SystemExit(f"STOP: {r['company']} is next in order and not yet adjudicated")
            a = ADJ[r["company"]]
            texts = [e["text"] for e in r["evidence"]]
            for q in (a[1], a[3]):
                if q and not any(q in t for t in texts): raise SystemExit(f"not verbatim: {r['company']}: {q!r}")
            for k, v in counts(r["company"]).items(): got[k] += v
            chosen.append({"category": cat, "fills": fills, "company": r["company"], "key": r["key"], "domain": r["domain"],
                           "description": " ".join(texts),
                           "source": f'{r["evidence"][0]["source_run"]}:{r["evidence"][0]["source_file"]}#{r["evidence"][0]["field"]}',
                           "provenance": r["evidence"][0]["provenance"],
                           "software_product": a[0][0], "software_status": a[0][1], "software_evidence": a[1],
                           "ai_product": a[2][0], "ai_status": a[2][1], "ai_evidence": a[3],
                           "primary_offering": a[4], "reason": a[5], "status": "ADJUDICATED_NOT_FROZEN"})
            n += 1
        return n
    x = walk("X", lambda: got["sw_neg"] >= sw_neg or got["ai_pos"] >= ai_pos, ["software_product NO", "ai_product YES"])
    y = walk("Y", lambda: got["ai_pos"] >= ai_pos and got["sw_pos"] >= sw_pos, ["ai_product YES", "software_product YES"])
    z = walk("Z", lambda: got["sw_neg"] >= sw_neg and got["ai_neg"] >= ai_neg, ["software_product NO", "ai_product NO"])
    return {"needs": [sw_pos, sw_neg, ai_pos, ai_neg], "high_counted": got,
            "taken": {"X": x, "Y": y, "Z": z},
            "unfilled": [max(0, need - got[k]) for need, k in zip((sw_pos, sw_neg, ai_pos, ai_neg), ("sw_pos", "sw_neg", "ai_pos", "ai_neg"))],
            "candidates": chosen, "vetoed_in_order": vetoed, "non_commercial_skipped": dev_only}

if __name__ == "__main__":
    # Needs after the user's P0–P6 decisions (2026-09-28): software 30 YES / 13 NO settled,
    # AI 20 YES / 30 NO settled → software needs 17 NO, AI needs 10 YES.
    out = select(0, 17, 10, 0)
    out["candidates"] = [resolve(c) for c in out["candidates"]]
    unresolved = [c["company"] for c in out["candidates"] if RV in (c["software_status"], c["ai_status"])]
    if unresolved: raise SystemExit(f"STOP: unresolved REVIEW cells: {unresolved}")
    json.dump(out, open(os.path.join(HERE, "reserve-candidates.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: out[k] for k in ("taken", "high_counted", "unfilled")}), "vetoed:", len(out["vetoed_in_order"]), "non-commercial skipped:", len(out["non_commercial_skipped"]))
    for c in out["candidates"]: print(f'[{c["category"]}] {c["company"]}: sw {c["software_product"]}/{c["software_status"]}  ai {c["ai_product"]}/{c["ai_status"]}')
