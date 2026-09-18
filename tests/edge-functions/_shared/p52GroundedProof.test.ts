// LEAD V2 P5.2 — GROUNDED PROOF FOR HARD CRITERIA, AND WHAT MAY NEVER BECOME IT.
//
// The audit of 02808b4d found five things, fixed here and pinned here:
//
//   BRAIN-1  the Company Brain rewrote the user's hard criterion ("B2B SaaS" →
//            "b2b saas (founder-led or small teams)", still user-explicit), so
//            canary 62c8b188 could never surface a lead
//   SEM-2    verified contradictory evidence left a hard rule `unknown`, so a
//            ruled-out company sat in `pending` forever
//   REVIEW-1 a `review` grounding was admitted as proof — and then (canary
//            c584fd77) the whole-company verdict blocked every business model;
//            the business-model claim now has its own decision
//   HEAD-0   LinkedIn's employeeCount 0 ("no number") became a verified FAIL
//   MATCH-1  industry matching was substring: "AI" matched "Retail"
//   E2E-1    persistence was checked by grepping source; this runs the real
//            engine through checkpoint → restore → Stage-2 rebuild → view
//   VOCAB-1  (canary e4da3d5a) the grounding prompts never named the business-
//            model codes and the parser accepted only exact codes, so a
//            validated "B2B SaaS" answer parsed as "unknown" — every time
//
// Offline. No provider, model or database is reached.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  mergeCompanyBrainIntoMission, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  criteriaSections, deriveMissionCriteria, type MissionCriterion,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceDimension, EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { checkCriterion, evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import {
  BUSINESS_MODEL_CODES, canonicalBusinessModel, matchBusinessModel,
} from "../../../supabase/functions/_shared/businessModelMatch.ts";
import {
  GROUNDED_CLASSIFIER_PROMPT, GROUNDED_RESPONSE_SHAPE, parseGroundedResult,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import {
  BATCH_EVALUATION_PROMPT, buildBatchPayload, evaluateBatchResponse,
} from "../../../supabase/functions/_shared/groundedBatchEvaluation.ts";
import { buildWorkbenchMissionView } from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import {
  checkpointSnapshot, companyEvidenceItems, missionCandidatesFrom, runCapabilityPlan,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";
import { usableHeadcount } from "../../../supabase/functions/_shared/headcountValue.ts";
import {
  jobEmployerToCompany, normalizeLinkedInCompanyCandidate, normalizeLinkedInCompanyEnriched,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { normalizeApifyJobRow } from "../../../supabase/functions/_shared/apifyJobsNormalizer.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { observationFromCompany } from "../../../supabase/functions/_shared/candidateObservation.ts";

globalThis.fetch = () => { throw new Error("P5.2 tests must not reach the network"); };

const NOW = new Date("2026-09-18T12:00:00.000Z");
const CANONICAL = "Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.";
const proposal = {
  requested_opportunity_count: 1, requested_contact_ready_count: null, company_types: ["B2B SaaS"],
  geographies: ["United States"], geography_is_hard: true, employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
  preferred_signals: ["hiring growth marketer"], required_signal_terms: ["growth marketer"],
  adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: [], required_evidence: [], required_capabilities: ["startup_company_discovery", "hiring_verification"],
  preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [],
};
/** The canary workspace's Brain, as pilot-chat reads it: an ICP industry and its enforced size rule. */
const CANARY_BRAIN = {
  industries: ["B2B SaaS (founder-led or small teams)"], employee_min: 1, employee_max: 150, employee_policy: true,
};

const hard = (cs: readonly MissionCriterion[]) => cs.filter((c) => c.kind === "hard" && c.status === "ok");
const targets = (cs: readonly MissionCriterion[]) => cs.filter((c) => c.kind === "target");

let seq = 0;
function ev(dimension: EvidenceDimension, value: unknown, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidence_id: `ev_${dimension}_${++seq}`, company_key: "c1", dimension, value, status: "proven",
    source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc_1", url: null, excerpt: null },
    method: "provider_field", observed_at: "2026-09-17T00:00:00.000Z", valid_until: null,
    confidence: "high", derived_from: [], mission_id: "task", origin: "lead_mission", ...over,
  };
}
/** A grounded business-model item as the engine builds it: `bm` is the claim's own decision. */
const grounded = (value: string, bm: "accepted" | "review", verdict: "pass" | "review" | "fail" = "review") => ev("business_model", value, {
  evidence_id: "grd_c1_business_model", method: "model_extraction", origin: "web",
  status: bm === "accepted" ? "proven" : "plausible", confidence: bm === "accepted" ? "medium" : "low",
  source: { provider: "engine", actor: "grounded_evidence_evaluation", provider_call_id: null, url: null, excerpt: "We sell…" },
  assessment: { decision: verdict, grounding_score: 1, validated_claims: 1, business_model_decision: bm, business_model_reasons: [] },
});
const graphOf = (items: EvidenceItem[]) => buildCompanyEvidenceGraph("c1", items, { now: NOW });
const US = () => ev("geography", "Austin, TX, United States");
const SMALL = () => ev("headcount", 20);

// ═══════════════════════════════════════════════════════════════ BRAIN-1 ══

Deno.test("BRAIN-1: the canary's Brain refinement never rewrites the user's hard criterion", () => {
  // The path pilot-chat takes: compile with the Brain, then merge again.
  const compiled = compileLeadMission({ originalUserQuery: CANONICAL, proposal, companyBrain: CANARY_BRAIN as never }).final_mission;
  const mission = mergeCompanyBrainIntoMission(compiled, CANARY_BRAIN).mission;

  // The user's values, exactly — the compiler reads both "b2b saas" and "saas" from the sentence.
  assertEquals(mission.company_profile.verticals.map((v) => v.toLowerCase()), ["b2b saas", "saas"], "the user's values, exactly");
  assertEquals(mission.field_provenance["company_profile.verticals"], "explicit_user_request");
  assertEquals(mission.brain_refinements?.length, 1, "recorded once, even though the Brain was merged twice");
  assertEquals(mission.brain_refinements![0].qualifier, "founder-led or small teams");

  const cs = deriveMissionCriteria(mission);
  const industry = hard(cs).filter((c) => c.dimension === "industry");
  assertEquals(industry.map((c) => [String(c.value).toLowerCase(), c.source]), [["b2b saas", "user_explicit"], ["saas", "user_explicit"]]);
  assertFalse(hard(cs).some((c) => /founder|small teams/i.test(String(c.value))), "no Brain words in any hard rule");

  const pref = targets(cs).find((c) => c.value === "founder-led or small teams")!;
  assert(pref, "the Brain's qualifier is a target");
  assertEquals([pref.dimension, pref.source, pref.status], ["industry", "company_brain_preference", "unprovable_today"]);

  // The size rule IS enforced policy, so it alone stays hard.
  const size = cs.find((c) => c.dimension === "company_size")!;
  assertEquals([size.kind, size.source], ["hard", "company_brain_policy"]);

  // The card says both, in the right sections.
  const card = criteriaSections({ ...mission, criteria: cs });
  assert(card.hard.some((l) => /^Industry: b2b saas ·/i.test(l)), card.hard.join(" | "));
  assert(card.target.some((l) => /founder-led or small teams/.test(l)), card.target.join(" | "));
});

Deno.test("BRAIN-1: the approved canary 62c8b188 mission, verbatim, now derives hard B2B SaaS + a target", () => {
  const raw = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/canary-62c8b188-mission.json", import.meta.url)));
  delete raw._source;
  const mission = raw as LeadMissionV1;
  const cs = deriveMissionCriteria(mission);

  assertEquals(hard(cs).filter((c) => c.dimension === "industry").map((c) => [c.value, c.source]), [["b2b saas", "user_explicit"]]);
  const pref = targets(cs).find((c) => c.dimension === "industry")!;
  assertEquals([pref.value, pref.status], ["founder-led or small teams", "unprovable_today"]);
  assertFalse(pref.source === "user_explicit", "words the request does not say are never user-explicit");

  // And the candidate the canary could never surface now can.
  const e = evaluateEligibility(cs, graphOf([US(), SMALL(), grounded("b2b saas", "accepted")]));
  assertEquals(e.eligibility, "eligible", JSON.stringify(e.checks.filter((c) => c.kind === "hard")));
});

Deno.test("BRAIN-1: a broader Brain value, an open field and a word-inside-a-word", () => {
  const user = compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission;
  // Broader ("saas" under "b2b saas"): nothing to add, and the user's value stands.
  const broader = mergeCompanyBrainIntoMission(user, { industries: ["SaaS"] }).mission;
  assertEquals(broader.company_profile.verticals.map((v) => v.toLowerCase()), ["b2b saas", "saas"]);
  assertEquals(broader.brain_refinements, undefined);

  // "ai" is not inside "retail": a different industry is a widening, rejected.
  const aiUser = { ...user, company_profile: { ...user.company_profile, verticals: ["ai"] } };
  const retail = mergeCompanyBrainIntoMission(aiUser, { industries: ["Retail"] });
  assertEquals(retail.mission.company_profile.verticals, ["ai"]);
  assert(retail.rejected_broadening.some((r) => r.values.includes("retail")));

  // A field the user left open is still filled — as a Brain preference, never hard.
  const open = { ...user, company_profile: { ...user.company_profile, verticals: [] }, field_provenance: { ...user.field_provenance } };
  delete open.field_provenance["company_profile.verticals"];
  const filled = mergeCompanyBrainIntoMission(open, { industries: ["B2B SaaS"] }).mission;
  const c = deriveMissionCriteria(filled).find((x) => x.dimension === "industry")!;
  assertEquals([c.kind, c.source], ["target", "company_brain_preference"]);
});

// ═════════════════════════════════════════════════════════════════ SEM-2 ══

Deno.test("SEM-2: supporting proof passes, verified contradiction fails, missing or unverified is pending", () => {
  const mission = compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission;
  const cs = deriveMissionCriteria(mission);
  const industry = (items: EvidenceItem[]) => evaluateEligibility(cs, graphOf([US(), ...items])).hard_checks.industry;

  assertEquals(industry([grounded("b2b saas", "accepted")]), "pass");
  assertEquals(industry([grounded("consumer", "accepted")]), "fail", "verified consumer rules out B2B SaaS");
  assertEquals(industry([grounded("b2b service", "accepted")]), "fail", "a services firm is not SaaS");
  assertEquals(industry([]), "unknown");
  assertEquals(industry([ev("industry", "Consumer Services", { status: "plausible", confidence: "medium" })]), "unknown",
    "an unverified label that disagrees is not a contradiction");
  assertEquals(industry([grounded("ai saas", "accepted")]), "unknown", "AI SaaS neither shows nor rules out B2B");

  const e = evaluateEligibility(cs, graphOf([US(), grounded("consumer", "accepted")]));
  assertEquals(e.eligibility, "ineligible");
  assertEquals(e.disproven.length, 1);

  // The same rule for geography and headcount: only VERIFIED contradiction rejects.
  assertEquals(evaluateEligibility(cs, graphOf([ev("geography", "Berlin, Germany")])).hard_checks.geography, "fail");
  assertEquals(evaluateEligibility(cs, graphOf([ev("geography", "Berlin, Germany", { status: "plausible" })])).hard_checks.geography, "unknown");
  const sized = deriveMissionCriteria(mergeCompanyBrainIntoMission(mission, CANARY_BRAIN).mission);
  assertEquals(evaluateEligibility(sized, graphOf([ev("headcount", 4000)])).hard_checks.company_size, "fail");
  assertEquals(evaluateEligibility(sized, graphOf([ev("headcount", 4000, { status: "plausible" })])).hard_checks.company_size, "unknown");
});

// ══════════════════════════════════════════════════════════════ REVIEW-1 ══

Deno.test("REVIEW-1: the business model's OWN decision proves; the whole-company verdict never does", () => {
  const cs = deriveMissionCriteria(compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission);
  const industryCheck = (g: EvidenceItem) => evaluateEligibility(cs, graphOf([US(), g])).checks.find((c) => c.dimension === "industry" && c.kind === "hard")!;

  // Canary c584fd77's shape: the company verdict is `review`, the business-model claim is accepted.
  const pass = industryCheck(grounded("b2b saas", "accepted", "review"));
  assertEquals(pass.result, "pass");
  assertEquals(pass.provenance, {
    evidence_id: "grd_c1_business_model", dimension: "business_model", status: "proven",
    method: "model_extraction", confidence: "medium", actor: "grounded_evidence_evaluation",
    grounding_decision: "review", business_model_decision: "accepted",
  });
  const review = industryCheck(grounded("b2b saas", "review", "pass"));
  assertEquals(review.result, "unknown", "a business model under review is never proof, whatever the company verdict");
  assertEquals([review.provenance?.status, review.provenance?.business_model_decision], ["plausible", "review"]);
  assertEquals(industryCheck(grounded("consumer", "accepted", "fail")).result, "fail");

  // The builder: the company verdict is recorded, the claim decides.
  const DESC = "company_description:linkedin:aa11";
  const company = (over: Record<string, unknown> = {}, bm: Record<string, unknown> = {}) => ({
    key: "c1", company: { company_name: "Acme", linkedin_company_url: null, canonical_domain: null, website: null, geography: null, external_source_id: "x" },
    observations: [], evidence_registry: null, hiring_jobs: [], hiring_assessment: null, first_in_function: null,
    enriched: null, identity: null, found_by: [],
    grounded: {
      version: "grounded-claims-v1", classifier_result: { business_model: { value: "b2b_saas", confidence: 0.9, claims: [], ...bm } },
      validated_claims: [{ claim: "x", claim_type: "business_model", evidence_ids: [DESC], evidence_excerpts: [{ evidence_id: DESC, excerpt: "sells" }] }],
      rejected_claims: [], grounding_score: 0.8, final_grounded_decision: "review", downgrade_reasons: [], unacknowledged_conflicts: [],
      ...over,
    },
  }) as never;
  const item = (over: Record<string, unknown> = {}, bm: Record<string, unknown> = {}) =>
    companyEvidenceItems(company(over, bm)).find((e) => e.evidence_id === "grd_c1_business_model")!;
  for (const verdict of ["pass", "review", "fail"]) {
    assertEquals(item({ final_grounded_decision: verdict }).status, "proven", `verdict ${verdict} does not decide`);
  }
  assertEquals(item().assessment, {
    decision: "review", grounding_score: 0.8, validated_claims: 1, business_model_decision: "accepted", business_model_reasons: [],
  });
  // What DOES keep it under review — each a fact about the business-model claim itself.
  const reviewed = (over: Record<string, unknown>, bm: Record<string, unknown> = {}) => {
    const i = item(over, bm);
    return [i.status, i.assessment?.business_model_decision, i.assessment?.business_model_reasons?.[0]];
  };
  assertEquals(reviewed({}, { confidence: 0.4 }), ["plausible", "review", "low_model_confidence"]);
  assertEquals(reviewed({ rejected_claims: [{ claim: "y", claim_type: "business_model", reason: "excerpt_not_found", detail: "" }] }),
    ["plausible", "review", "business_model_claim_rejected:excerpt_not_found"]);
  assertEquals(reviewed({ unacknowledged_conflicts: [DESC] }), ["plausible", "review", `unacknowledged_conflict:${DESC}`]);
  // …and what does not: a claim that merely cited the wrong KIND of evidence, or a conflict elsewhere.
  assertEquals(item({ rejected_claims: [{ claim: "z", claim_type: "business_model", reason: "unsupported_evidence_type", detail: "" }] }).status, "proven");
  assertEquals(item({ unacknowledged_conflicts: ["employee_count:linkedin:bb22"] }).status, "proven");

  // A pre-P5.2 checkpoint item (no assessment; review stored as proven/low) is read as plausible.
  const legacy = grounded("b2b saas", "accepted");
  delete legacy.assessment;
  const restored = { ...(company() as object), grounded: null, observations: [{ evidence: [{ ...legacy, confidence: "low" }] }] } as never;
  const r = companyEvidenceItems(restored).find((e) => e.evidence_id === "grd_c1_business_model")!;
  assertEquals(r.status, "plausible");
});

// ═══════════════════════════════════════════════════════════════ MATCH-1 ══

Deno.test("MATCH-1: controlled vocabulary, whole words, no substrings", () => {
  const cases: Array<[string, string, string]> = [
    ["AI", "Retail", "unknown"],
    ["AI", "ai saas", "pass"],
    ["B2B SaaS", "b2b saas", "pass"],
    ["B2B SaaS", "B2B software-as-a-service", "pass"],
    ["B2B SaaS", "consumer", "fail"],
    ["B2B SaaS", "b2b service", "fail"],
    ["B2B SaaS", "b2b software", "unknown"],
    ["B2B SaaS", "ai saas", "unknown"],
    ["B2B software", "b2b saas", "pass"],
    ["SaaS", "consumer", "unknown"],
    ["fintech", "fintech", "pass"],
    ["fintech", "b2b saas", "unknown"],
    ["healthcare SaaS", "b2b saas", "unknown"],
    ["b2b saas or b2b service", "b2b service", "pass"],
    ["b2b saas or consumer", "b2b service", "fail"],
    ["enterprise software", "consumer", "fail"],
  ];
  for (const [req, got, want] of cases) assertEquals(matchBusinessModel(req, got), want, `${req} vs ${got}`);

  // Through eligibility: a PROVEN "Retail" does not satisfy an "AI" requirement.
  const g = graphOf([ev("industry", "Retail")]);
  assertEquals(checkCriterion({ id: "i", dimension: "industry", kind: "hard", value: "AI", status: "ok" } as never, g).result, "unknown");
});

// ═════════════════════════════════════════════════════════════════ E2E-1 ══

const PROBE = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/p3-job-discovery-probe.json", import.meta.url)));
const ROWS = PROBE.probes["harvestapi~linkedin-job-search"].items as Array<Record<string, unknown>>;
/** What the grounded evaluator concludes per employer — one of each outcome. */
const VERDICT: Record<string, { value: string; decision: "pass" | "review" | "fail"; confidence?: number }> = {
  "LinkedIn": { value: "b2b_saas", decision: "pass" },
  // The canary's shape: whole-company verdict `review`, business model plainly stated.
  "Audicus": { value: "b2b_saas", decision: "review" },
  "Bevi": { value: "consumer", decision: "fail" },
  "nothing else": { value: "consumer", decision: "fail" },
  // The model is not sure what it sells: the business model itself stays under review.
  "Bobyard": { value: "b2b_saas", decision: "review", confidence: 0.4 },
};

Deno.test("E2E-1: grounded proof survives checkpoint → restore → Stage-2 rebuild → eligibility → Workbench", async () => {
  const mission = compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission;
  const criteria = deriveMissionCriteria(mission);
  const plan = buildCapabilityGraph(mission, { executability: "enforce" });
  const byUrl = new Map(ROWS.map((r) => [(r.company as { linkedinUrl: string }).linkedinUrl, r.company as Record<string, unknown>]));
  let batchCalls = 0;
  const evaluateBatch = (members: Array<{ company_key: string; company_name: string | null; registry: { items: Array<Record<string, unknown>> } }>) => {
    batchCalls++;
    return Promise.resolve({
      version: "test", foreign_results: [], evaluated: members.length, failed: 0,
      outcomes: members.map((m) => {
        const v = VERDICT[String(m.company_name)];
        const desc = m.registry.items.find((x) => x.evidence_type === "company_description");
        if (!v || !desc) return { company_key: m.company_key, verification: null, failure: "malformed_result", detail: null };
        const claim = {
          claim: "the company's own description", claim_type: "business_model", evidence_ids: [String(desc.evidence_id)],
          evidence_excerpts: [{ evidence_id: String(desc.evidence_id), excerpt: String(desc.source_text).slice(0, 24) }],
        };
        return {
          company_key: m.company_key, failure: null, detail: null, verification: {
            version: "grounded-claims-v1",
            classifier_result: { business_model: { value: v.value, confidence: v.confidence ?? 0.9, claims: [claim] } },
            validated_claims: [claim], rejected_claims: [], grounding_score: 1, final_grounded_decision: v.decision,
            downgrade_reasons: [], unacknowledged_conflicts: [],
          },
        };
      }),
    });
  };
  const deps = (restored?: Map<string, unknown>) => ({
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => Promise.resolve({
      reasoning: "e2e", steps: [
        { capability: "job_discovery", actor_key: "apify_linkedin_job_search", purpose: "roles", input: { jobTitles: ['"growth marketer"'], locations: ["United States"], postedLimit: "month", maxItems: 10 }, depends_on: [] },
        { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "details", input: { companies: ["{{url}}"] }, depends_on: [1] },
        { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [2] },
      ],
    }),
    invoke: (call: { actorKey: string; input: Record<string, unknown>; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      call.onProviderRun?.({ run_id: `run-${call.actorKey}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_job_search") return Promise.resolve(call.input.company ? [] : ROWS);
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((call.input.companies as string[]) ?? []).map((u) => {
          const c = byUrl.get(u)!;
          return { id: c.id, name: c.name, linkedinUrl: u, website: c.website, employeeCount: c.employeeCount, description: c.description, industries: c.industries, locations: c.locations };
        }));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    evaluateBatch,
    ...(restored ? { restoredGroundedResults: restored } : {}),
  });
  const opts = (extra: Record<string, unknown> = {}) => ({
    mission, plan, maxCandidates: 10,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-p52", lineage_id: "lineage-p52" }, ...extra,
  });
  type Run = { companies: Array<Record<string, unknown> & { key: string; company: { company_name: string } }>; state: Record<string, unknown> };
  const project = (run: Run) => {
    const candidates = missionCandidatesFrom(run as never, { missionId: "task-p52", now: NOW });
    const view = buildWorkbenchMissionView({
      mission: { requested_count: 1, execution_limit: 1, anchor: "hiring" }, criteria, stage: "complete", candidates,
    });
    const byName = new Map(run.companies.map((c) => [c.company.company_name, c.key]));
    const lead = (name: string) => view.leads.find((l) => l.company.key === byName.get(name))!;
    return { view, lead };
  };

  // ── SLICE 1: discovery, enrichment, Stage-2 grounding, qualification ──
  const run1 = await runCapabilityPlan(deps() as never, opts() as never) as unknown as Run;
  assertEquals(batchCalls, 1);
  const one = project(run1);
  // One of each: PASS on an accepted business model under a `review` company
  // verdict, FAIL on a verified consumer model, PENDING on a business model the
  // model itself was unsure of.
  const industryOf = (p: typeof one, name: string) => p.lead(name).hard_check_details.find((d) => d.dimension === "industry")!;
  assertEquals(one.lead("Audicus").hard_checks.industry, "pass");
  assertEquals(one.lead("Bevi").hard_checks.industry, "fail");
  assertEquals(one.lead("Bevi").bucket, "ineligible");
  assertEquals(one.lead("Bobyard").hard_checks.industry, "unknown");
  assertEquals(one.lead("Bobyard").bucket, "pending");
  // Provenance carries BOTH decisions: the company verdict, and the one that proved.
  assertEquals([industryOf(one, "Audicus").provenance?.grounding_decision, industryOf(one, "Audicus").provenance?.business_model_decision], ["review", "accepted"]);
  assertEquals([industryOf(one, "Bevi").provenance?.grounding_decision, industryOf(one, "Bevi").provenance?.business_model_decision], ["fail", "accepted"]);
  assertEquals([industryOf(one, "Bobyard").provenance?.grounding_decision, industryOf(one, "Bobyard").provenance?.business_model_decision], ["review", "review"]);
  assert(one.view.leads.some((l) => l.label !== null), "a lead surfaces");

  // ── THE CHECKPOINT: what a slice stopped mid-qualification leaves ──────
  const snap = checkpointSnapshot(run1.state as never, run1.companies as never);
  assert(snap.coherent, String(snap.incoherence));
  const records = JSON.parse(JSON.stringify(snap.resume_records));
  const state = JSON.parse(JSON.stringify(snap.state));
  state.completed_capabilities = state.completed_capabilities.filter((c: string) => c !== "company_brain_qualification");
  if (!state.pending_capabilities.includes("company_brain_qualification")) {
    state.pending_capabilities = ["company_brain_qualification", ...state.pending_capabilities];
  }
  // run-agent restores Stage-2 results from the checkpoint the same way.
  const restoredGrounded = new Map(run1.companies
    .filter((c) => c.grounded).map((c) => [c.key, JSON.parse(JSON.stringify(c.grounded))]));

  // ── SLICE 2: a fresh process, from the checkpoint only ─────────────────
  batchCalls = 0;
  const run2 = await runCapabilityPlan(deps(restoredGrounded) as never, opts({
    state, resume: { workspace_id: "ws-p52", lineage_root_task_id: "task-p52", records },
  }) as never) as unknown as Run;
  assertEquals(run2.companies.map((c) => c.key).sort(), run1.companies.map((c) => c.key).sort(),
    "the job-first working set is restored, not lost");
  assertEquals(batchCalls, 0, "nothing already grounded is bought again");
  for (const c of run2.companies) {
    assertEquals(c.evaluation_path, "restored_decision");
    assert(c.evidence_registry, `${c.company.company_name}: Stage 2 rebuilt the registry`);
    assertEquals(c.grounded, null, "`grounded` itself is not carried — the observation is");
  }

  const two = project(run2);
  // PASS, FAIL and PENDING all survive, with the same provenance.
  for (const name of ["Audicus", "LinkedIn", "Bevi", "nothing else", "Bobyard"]) {
    assertEquals(two.lead(name).bucket, one.lead(name).bucket, `${name}: bucket`);
    assertEquals(two.lead(name).hard_checks, one.lead(name).hard_checks, `${name}: hard checks`);
    assertEquals(industryOf(two, name).provenance, industryOf(one, name).provenance, `${name}: provenance`);
  }
  assertEquals(two.view.counts, one.view.counts, "the Workbench view is identical after a continuation");
  // The grounded claim itself came back from the checkpoint, not the live run.
  const audicus = run2.companies.find((c) => c.company.company_name === "Audicus")!;
  const bm = companyEvidenceItems(audicus as never).find((e) => e.dimension === "business_model")!;
  assertEquals([bm.status, bm.source.actor, bm.assessment?.decision, bm.assessment?.business_model_decision],
    ["proven", "grounded_evidence_evaluation", "review", "accepted"]);
  assert(bm.derived_from.length > 0 && bm.source.excerpt, "it still cites the company's own words");
});


// ═══════════════════════════════════════════════════════════════ VOCAB-1 ══

Deno.test("VOCAB-1: a free-text business-model answer is read into its code, never guessed", () => {
  const cases: Array<[string, string]> = [
    ["b2b_saas", "b2b_saas"], ["B2B SaaS", "b2b_saas"], ["b2b saas", "b2b_saas"],
    ["B2B SaaS platform for financial firms", "b2b_saas"], ["B2B software-as-a-service", "b2b_saas"],
    ["enterprise software", "b2b_software"], ["B2B services agency", "b2b_service"],
    ["consumer app", "consumer"], ["B2C marketplace", "consumer"], ["AI SaaS", "ai_saas"],
    ["B2B AI SaaS", "b2b_saas"],
    // Refused: ambiguous, mixed, negated or silent.
    ["SaaS", "unknown"], ["B2B", "unknown"], ["B2B and B2C", "unknown"], ["B2B and B2C SaaS", "unknown"], ["not B2B SaaS", "unknown"],
    ["non-SaaS B2B", "unknown"], ["software and services", "unknown"], ["Retail", "unknown"], ["", "unknown"],
  ];
  for (const [raw, want] of cases) assertEquals(canonicalBusinessModel(raw), want, JSON.stringify(raw));
  assertEquals(parseGroundedResult({ business_model: { value: "B2B SaaS", confidence: 0.94, claims: [] } }).business_model.value, "b2b_saas");

  // Both grounding routes now NAME the codes, in the prompt and in the shape.
  const batchShape = JSON.stringify((buildBatchPayload({ batch: [], originalUserQuery: null }) as { response_shape: unknown }).response_shape);
  for (const code of BUSINESS_MODEL_CODES) {
    assert(GROUNDED_CLASSIFIER_PROMPT.includes(code), `single-company prompt names ${code}`);
    assert(BATCH_EVALUATION_PROMPT.includes(code), `batch prompt names ${code}`);
    assert(JSON.stringify(GROUNDED_RESPONSE_SHAPE).includes(code), `single-company shape names ${code}`);
    assert(batchShape.includes(code), `batch shape names ${code}`);
  }
});

Deno.test("VOCAB-1: free-text answers through the REAL batch verifier reach eligibility as PASS, FAIL and PENDING", async () => {
  const mission = compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission;
  const criteria = deriveMissionCriteria(mission);
  const byUrl = new Map(ROWS.map((r) => [(r.company as { linkedinUrl: string }).linkedinUrl, r.company as Record<string, unknown>]));
  /** What the MODEL says, in its own words — never the code. */
  const SAYS: Record<string, { value: string; fit: "pass" | "review" | "fail"; confidence?: number }> = {
    // Exactly canary c584fd77: a plain "B2B SaaS" under a `review` company verdict.
    "Audicus": { value: "B2B SaaS", fit: "review" },
    "Bevi": { value: "Consumer hardware brand", fit: "fail" },
    "Bobyard": { value: "B2B SaaS platform", fit: "review", confidence: 0.4 },
  };
  const evaluateBatch = (members: Parameters<typeof evaluateBatchResponse>[0]["batch"]) => {
    const rows = members.flatMap((m) => {
      const says = SAYS[String(m.company_name)];
      const desc = m.registry.items.find((x) => x.evidence_type === "company_description");
      if (!says || !desc?.source_text) return [];
      const claim = {
        claim: "the company describes itself", claim_type: "business_model", evidence_ids: [desc.evidence_id],
        evidence_excerpts: [{ evidence_id: desc.evidence_id, excerpt: desc.source_text.slice(0, 24) }],
      };
      // A hiring mission's PASS must also ground the current signal (the
      // verifier downgrades a pass without one), so cite the posting verbatim.
      const job = m.registry.items.find((x) => (x.evidence_type === "job_posting" || x.evidence_type === "yc_job") && x.source_text);
      const signal = job ? [{
        claim: "the company has an open marketing role", claim_type: "commercial_signal", evidence_ids: [job.evidence_id],
        evidence_excerpts: [{ evidence_id: job.evidence_id, excerpt: String(job.source_text).slice(0, 20) }],
      }] : [];
      return [{
        company_key: m.company_key, business_model: { value: says.value, confidence: says.confidence ?? 0.9, claims: [claim] },
        company_fit: says.fit, agentory_use_case: "plausible",
        mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
        supporting_claims: signal, conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [], confidence: 0.9, reason: "",
      }];
    });
    return Promise.resolve(evaluateBatchResponse({ batch: members, raw: { results: rows } }));
  };
  const run = await runCapabilityPlan({
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => Promise.resolve({
      reasoning: "vocab", steps: [
        { capability: "job_discovery", actor_key: "apify_linkedin_job_search", purpose: "roles", input: { jobTitles: ['"growth marketer"'], locations: ["United States"], postedLimit: "month", maxItems: 10 }, depends_on: [] },
        { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "details", input: { companies: ["{{url}}"] }, depends_on: [1] },
        { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [2] },
      ],
    }),
    invoke: (call: { actorKey: string; input: Record<string, unknown>; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      call.onProviderRun?.({ run_id: `run-${call.actorKey}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_job_search") return Promise.resolve(call.input.company ? [] : ROWS);
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((call.input.companies as string[]) ?? []).map((u) => {
          const c = byUrl.get(u)!;
          return { id: c.id, name: c.name, linkedinUrl: u, website: c.website, employeeCount: c.employeeCount, description: c.description, industries: c.industries, locations: c.locations };
        }));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    evaluateBatch,
  } as never, {
    mission, plan: buildCapabilityGraph(mission, { executability: "enforce" }), maxCandidates: 10,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-vocab", lineage_id: "lineage-vocab" },
  } as never) as unknown as { companies: Array<Record<string, unknown> & { key: string; company: { company_name: string } }> };

  const bmOf = (name: string) => companyEvidenceItems(run.companies.find((c) => c.company.company_name === name) as never)
    .find((e) => e.dimension === "business_model");
  // The model never said a code; each answer still became evidence.
  assertEquals([bmOf("Audicus")?.value, bmOf("Audicus")?.status], ["b2b saas", "proven"]);
  assertEquals([bmOf("Bevi")?.value, bmOf("Bevi")?.status], ["consumer", "proven"]);
  assertEquals([bmOf("Bobyard")?.value, bmOf("Bobyard")?.status], ["b2b saas", "plausible"]);

  const industry = (name: string) => {
    const [cand] = missionCandidatesFrom({ companies: [run.companies.find((c) => c.company.company_name === name)!] } as never, { now: NOW });
    return evaluateEligibility(criteria, cand.graph).hard_checks.industry;
  };
  assertEquals(industry("Audicus"), "pass", "an accepted \"B2B SaaS\" proves the criterion, whatever the company verdict");
  assertEquals(industry("Bevi"), "fail", "a verified consumer reading rules it out");
  assertEquals(industry("Bobyard"), "unknown", "a business model the model was unsure of stays pending");
});


// ════════════════════════════════════════════════════════════════ HEAD-0 ══

Deno.test("HEAD-0: LinkedIn's employeeCount 0 is a missing number — unknown at every layer, never a FAIL", () => {
  // The rule.
  for (const v of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, "12", null, undefined]) {
    assertEquals(usableHeadcount(v), null, String(v));
  }
  assertEquals(usableHeadcount(57), 57);

  // Where a count ENTERS: every normalizer that reads employeeCount.
  const li = "https://www.linkedin.com/company/dime9";
  assertEquals(normalizeLinkedInCompanyEnriched({ name: "Dime9", linkedinUrl: li, employeeCount: 0 }).employee_count, null);
  assertEquals(normalizeLinkedInCompanyEnriched({ name: "Dime9", linkedinUrl: li, employeeCount: 57 }).employee_count, 57);
  assertEquals(normalizeLinkedInCompanyCandidate({ name: "Dime9", linkedinUrl: li, employeeCount: 0 })?.employee_count ?? null, null);
  assertEquals(jobEmployerToCompany({ company: { name: "Dime9", linkedinUrl: li, employeeCount: 0 } })?.employee_count ?? null, null);
  const job = JSON.stringify(normalizeApifyJobRow({ companyName: "Dime9", companyEmployeesCount: 0, title: "Growth Marketer", link: "https://x.test/j" }));
  assertFalse(/"employee_count":0\b/.test(job), "the job-row normalizer does not emit a zero count");

  // Where a count DECIDES, even if a zero slips past a normalizer.
  const zero = { company_name: "Dime9", linkedin_company_url: li, canonical_domain: null, website: null, geography: null,
    external_source_id: "li:dime9", employee_count: 0 } as never;
  const record = buildCompanyEvidence({ company_key: li, source_capability: "job_discovery" as never, company: zero, enriched: zero, identity_state: "resolved" });
  assertEquals(record.employee_evidence, null, "the registry holds no verified count");
  const obs = observationFromCompany(zero, { capability: "job_discovery", actor_key: "apify_linkedin_job_search", provider: "apify",
    route_id: null, plan_version: null, provider_call_id: null, mission_id: null, observed_at: "2026-09-18T00:00:00Z" });
  assertFalse(obs.evidence.some((e) => e.dimension === "headcount"), "no headcount observation from a zero");

  // And eligibility: a proven zero is unknown (pending), a proven 4,000 still fails.
  const sized = deriveMissionCriteria(mergeCompanyBrainIntoMission(
    compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission, CANARY_BRAIN).mission);
  const size = (n: number) => evaluateEligibility(sized, graphOf([ev("headcount", n)])).hard_checks.company_size;
  assertEquals(size(0), "unknown");
  assertEquals(size(4000), "fail");
  assertEquals(size(20), "pass");
  assertFalse(evaluateEligibility(sized, graphOf([US(), grounded("b2b saas", "accepted"), ev("headcount", 0)])).eligibility === "ineligible");
});
