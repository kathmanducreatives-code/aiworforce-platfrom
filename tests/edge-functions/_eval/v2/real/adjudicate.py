#!/usr/bin/env python3
"""Offline adjudication of software_product and ai_product for the 50 real companies, under the
user's strict rules (2026-09-28). Group A = safe to freeze, B = needs the user's decision,
C = NOT_DETERMINABLE from current evidence (excluded from the gate). Quotes are verified verbatim.
software_product follows the V2 contract: the PRIMARY offering is software."""
import json, os
HERE = os.path.dirname(__file__)
Y, N, ND, DEC = "YES", "NO", "NOT_DETERMINABLE", "DECISION"
# company: (sw, sw_quote, ai, ai_quote, note)   — sw/ai: YES | NO | NOT_DETERMINABLE | DECISION:<policy>
A = {
 "Fuse AI": (Y, "With powerful integrations and intelligent workflows", Y, "AI-native sales platform", ""),
 "PropelAuth": (Y, "they can use our APIs and component libraries", N, None, ""),
 "SafetyKit": (Y, "rely on SafetyKit in production", Y, "We build AI agents for teams tackling fraud & abuse", ""),
 "Nango": (Y, "Leverage hundreds of pre-built integrations", N, None, ""),
 "Pasito": (Y, "all from a single intelligent database", Y, "Pasito builds AI agents for insurance and benefits", ""),
 "FurtherAI": (Y, "automates complex workflows like submission intake", Y, "FurtherAI is a domain-specific AI for the insurance industry", ""),
 "Poly": (Y, "Browse with a lightning fast interface", N, None, "USER P3 2026-09-28: natural-language/multimodal search is not explicit AI"),
 "Streak": (Y, "Streak is the only CRM integrated entirely within your Gmail inbox", N, None, ""),
 "Deepgram": (Y, "with just an API call", Y, "most advanced speech AI transcription", ""),
 "Mux": (Y, "Mux Video is a simple API to advanced video streaming", N, None, ""),
 "Bitmovin": (Y, "Bitmovin products are completely in-house developed, easy and fast to integrate", N, None, ""),
 "SnapMagic": (Y, "Our new AI-assisted design tool", Y, "Our new AI-assisted design tool", ""),
 "Tara AI": (Y, "lightning-fast project management that helps teams ship product", Y, "fine-tuned, secure LLMs trained on source control and project data", ""),
 "Zentail": (Y, "automates away all of the work getting a listing formatted for different marketplaces", N, None, ""),
 "Marble": (Y, "Marble replaces that entire stack with one system", Y, "Computer vision and voice AI capture real-time inventory levels", ""),
 "Semble": (Y, "It's a live platform that keeps the office and the field in sync on every project", Y, "provides AI agents to run the workflows your business depends on", ""),
 "Hemut": (Y, "Next-generation truck management software", Y, "AI agents to automate inbound/outbound calls", ""),
 "Ergo": (Y, "We connect the conversations your team is already having, across calls, email, Slack, and more", N, None, ""),
 "SalesPatriot": (Y, "SalesPatriot is a back-office operating system for distributors and OEMS", Y, "We build custom AI workflows", "'custom' could mean bespoke work; the operating-system statement is the product."),
 "Woz": (Y, "Available via Claude Code Plugin", Y, "AI coding agent", ""),
 "Quartzy": (Y, "We help scientists easily organize orders, manage inventory", N, None, "Functionality beyond 'platform'."),
 "Moss": (Y, "optimized vector index built in Rust and WebAssembly", N, None, "USER P3 2026-09-28: serving AI products does not make Moss an AI product"),
 "Hyperspell": (Y, "Hyperspell connects your tools and synthesizes documents and conversations", N, None, "USER P1 2026-09-28: the agents are customers' agents, not Hyperspell's capability"),
 "Tasklet": (Y, "The product is deliberately simple: a chat interface", Y, "Tasklet is the AI agent that actually does the work", ""),
 "Nixo": (Y, "Nixo automatically captures the full history and live health of every account", Y, "Our agents use that context to find, scope, and prioritize work", "USER P1 2026-09-28: the company's own agents are the product capability"),
 "Gojiberry AI": (Y, "Gojiberry turns it into one AI team that finds buyers and books meetings", Y, "Gojiberry is building the AI GTM team for B2B companies", "USER P2 2026-09-28: the offering itself is an AI system doing the work"),
 "Uplane": (Y, "Uplane runs your entire marketing on one AI system", Y, "Uplane replaces marketing agencies with AI", "USER P2 2026-09-28: the offering itself is an AI system doing the work"),
 "10x Science": (Y, "Our AI-native platform automates it", Y, "10x Science develops frontier AI models", "USER P4 2026-09-28: platform plus end-to-end product statement"),
 "Contrario": (N, "Contrario is a network of expert recruiters supercharged by vertical AI agents purpose-built for hiring", N, None, "USER P5 2026-09-28: recruiter network is the primary offering; AI supports it"),
 "Braintrust": (Y, "the world's first and only end-to-end AI recruiting platform", Y, "the world's first and only end-to-end AI recruiting platform", "USER P5 2026-09-28: AI recruiting platform is a software product"),
 "BigRio": (N, "BigRio is a technology consulting firm", N, None, "USER P6 2026-09-28: ML expertise of a consultancy is not an AI product"),
 "Lab0": (ND, "Lab0 builds agentic systems that automate this layer", Y, "Lab0 builds agentic systems", "USER P1 2026-09-28: agentic systems are the product's own capability; software stays NOT_DETERMINABLE"),
 "LemonLime": (ND, "LemonLime runs fully automated sales and marketing for small businesses.", N, None, "Vague automation: product vs done-for-you not stated; no AI word"),
 "Every": (ND, "Every provides you with the tools and expert support", N, None, "Banking, bookkeeping/tax and tools with expert support: primary not established"),
 "ShipBob": (ND, "outsource fulfillment to have their orders picked, packed, and shipped", N, None, "WMS software AND outsourced fulfillment: primary not established"),
 "Mason": (ND, "Mason offloads hardware investment risks and logistics", N, None, "Device infrastructure, hardware logistics and tablets: primary not established"),
 "Auctor": (ND, "Auctor brings alignment and intelligence to software implementation", N, None, "'intelligence' is vague language"),
 "How to AI": (ND, "Subscribe for free at https://how-to-ai.guide", N, None, "Nothing but a subscribe link; the name is not evidence"),
 "Gemnote": (N, "Gemnote creates custom merch, swag and gifts for the modern business", N, None, "Software ('proprietary technology') supports the merch service; not the product"),
 "Mashgin": (N, "We’ve built a self-checkout kiosk", Y, "uses computer vision to scan multiple items without barcodes", "Computer vision explicitly in the product"),
 "Manicule": (N, "We own developer documentation and technical content across social channels, end-to-end", N, None, "AI is the channel it markets to, not a product capability"),
 "ByteByteGo": (N, "A popular weekly newsletter", N, None, ""),
 "Psychology Today": (N, "Our magazine, first launched in 1967, continues to thrive", N, None, ""),
 "Deadline Hollywood": (N, "the premier news source covering the business of entertainment", N, None, ""),
 "Recode": (N, "Recode is a tech news, reviews and analysis site", N, None, ""),
 "Design Milk": (N, "exceptional, award-winning content", N, None, ""),
 "DeepLearning.AI": (N, "making a world-class AI education accessible", N, None, "Teaches AI; AI is not a product capability"),
 "Wall Street Oasis": (N, "the largest online community and career platform", N, None, ""),
 "Inman": (N, "Inman is the leading source of news, events, insights, and community", N, None, ""),
}
COMFY = {"company": "ComfyUI", "sw": Y, "sw_quote": "Comfy Cloud runs your ComfyUI workflows on cloud GPUs, with nothing to install.",
         "ai": N, "ai_quote": None, "note": "V2 production fixture (pages); AI not explicit"}

def group(v): return "B" if v.startswith("DECISION") else "C" if v == ND else "A"

def build():
    recs = json.load(open(os.path.join(HERE, "companies.json")))["records"]
    props = {p["company"]: p for p in json.load(open(os.path.join(HERE, "label-proposals.json")))}
    out, problems = [], []
    for name, (sw, swq, ai, aiq, note) in A.items():
        p = props[name]
        r = next(x for x in recs if x["key"] == p["extraction_key"])
        texts = [e["text"] for e in r["evidence"]]
        for q in (swq, aiq):
            if q and not any(q in t for t in texts): problems.append(f"{name}: not verbatim: {q!r}")
        out.append({"company": name, "software_product": sw, "sw_group": group(sw), "sw_evidence": swq,
                    "ai_product": ai, "ai_group": group(ai), "ai_evidence": aiq, "note": note,
                    "previous": {"primary_offering": p["primary_offering"], "ai_product": p["ai_product"], "confidence": p["human_label_confidence"]}})
    out.append({"company": COMFY["company"], "software_product": Y, "sw_group": "A", "sw_evidence": COMFY["sw_quote"], "ai_product": N, "ai_group": "A",
                "ai_evidence": None, "note": COMFY["note"], "previous": {"primary_offering": "software_product", "ai_product": False, "confidence": "high"}})
    return out, problems

if __name__ == "__main__":
    out, problems = build()
    json.dump(out, open(os.path.join(HERE, "adjudication-sw-ai.json"), "w"), indent=1, ensure_ascii=False)
    def tally(f):
        from collections import Counter
        c = Counter(("DECISION" if x[f].startswith("DECISION") else x[f]) for x in out); return dict(c)
    print(json.dumps({"companies": len(out), "problems": problems, "software_product": tally("software_product"), "ai_product": tally("ai_product")}, indent=1))
