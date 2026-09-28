// BENCHMARK V2 — THE REAL-COMPANY GATE FIXTURES, AND THE SET THE LIVE RUN USES.
//
// Built from the adjudicated gate set (real/gate-set-sw-ai.json) and the texts
// its supporting phrases were verified against (real/gate-evidence-sw-ai.json).
// Nothing is re-labelled here and nothing is re-split: each fixture carries
// the gate set's HIGH labels and its deterministic tune/held-out assignment.
//
// A real fixture is labelled for software_product and ai_product ONLY, and only
// where that cell is HIGH. `scored` names those decisions; every other decision
// (and the category accuracies) skips the fixture, so the placeholder values
// the V2Answer shape needs are never scored. NOT_DETERMINABLE cells are absent
// from `scored` — excluded, neither right nor wrong.

import gateSet from "./real/gate-set-sw-ai.json" with { type: "json" };
import gateEvidence from "./real/gate-evidence-sw-ai.json" with { type: "json" };
import { PRODUCTION_V2, SYNTHETIC_V2, type Split, type V2Evidence, type V2Fixture } from "./fixtures.ts";
import type { PrimaryOffering } from "./contract.ts";

export const GATE_FACETS = ["software_product", "ai_product"] as const;
export type GateFacet = typeof GATE_FACETS[number];

interface GateRow {
  company: string; key: string; origin: string;
  software_product: "YES" | "NO" | null; ai_product: "YES" | "NO" | null;
  company_type: string; split: "tune" | "heldout";
}
interface EvidenceRow {
  key: string; company: string; domain: string | null; texts: string[]; evidence_ref: string | null;
  software_evidence: string | null; ai_evidence: string | null;
}

const COMFYUI_REF = "v2-production-fixture:comfyui";

function evidenceFor(e: EvidenceRow): V2Evidence {
  if (e.evidence_ref === COMFYUI_REF) {
    const f = PRODUCTION_V2.find((x) => x.id === "comfyui");
    if (!f) throw new Error("no V2 production fixture comfyui");
    return f.evidence;
  }
  if (e.evidence_ref !== null) throw new Error(`unknown evidence_ref ${e.evidence_ref}`);
  return { company_name: e.company, company_key: e.key, domain: e.domain ?? "", description: e.texts.join("\n\n"), pages: [] };
}

export const REAL_V2: V2Fixture[] = (() => {
  const ev = new Map((gateEvidence.companies as EvidenceRow[]).map((e) => [e.key, e]));
  return (gateSet.companies as GateRow[]).map((r): V2Fixture => {
    const e = ev.get(r.key);
    if (!e) throw new Error(`no gate evidence for ${r.key}`);
    const scored: GateFacet[] = [];
    if (r.software_product) scored.push("software_product");
    if (r.ai_product) scored.push("ai_product");
    const primary: PrimaryOffering = r.software_product === "YES" ? "software_product"
      : r.software_product === "NO" ? r.company_type as PrimaryOffering
      : "not_determinable";
    return {
      id: `real:${r.key}`,
      kind: "production",
      split: r.split as Split,
      evidence: evidenceFor(e),
      labels: {
        business_customer: false, consumer_customer: false, ai_product: r.ai_product === "YES",
        primary_offering: primary, delivery_model: "not_stated",
      },
      scored,
      expected_citations: {
        ...(r.ai_product === "YES" && e.ai_evidence ? { ai_product: [e.ai_evidence] } : {}),
        ...(r.software_product === "YES" && e.software_evidence ? { primary_offering: [e.software_evidence] } : {}),
      },
      notes: `${r.origin}: ${r.company}. Scored: ${scored.join(", ")}. Other label fields are placeholders and are never scored.`,
    };
  });
})();

/**
 * What the live run judges: the 82 real gate fixtures (tune / held-out from the
 * gate set), then the two full-contract production fixtures and the synthetic
 * cases as "dev" — they exercise the contract and hostile text, never a gate.
 */
export const BENCHMARK_V2_FIXTURES: V2Fixture[] = [
  ...REAL_V2,
  ...PRODUCTION_V2.map((f) => ({ ...f, split: "dev" as const })),
  ...SYNTHETIC_V2.map((f) => ({ ...f, split: "dev" as const })),
];

export const GATE_SPLIT_SHA256: string = gateSet.split_sha256;
