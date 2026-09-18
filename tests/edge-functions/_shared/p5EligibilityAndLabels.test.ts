// LEAD V2 P5 — ELIGIBILITY, LABEL CEILINGS, WORKBENCH COUNTS.
//
// The plan's three exit gates:
//   SEM-1   preferences never reject; a disproven hard criterion is ineligible
//   WORTH-1 hard proven, anchor missing, funding proven ⇒ Worth Considering,
//           with a cited signal and code's own list of what is missing
//   WB-1    counts are mutually exclusive, sum to discovered, legacy keys agree
//
// Built on the real compiler and the real P4 evidence graph — the last test
// runs the actual engine and projects the view from its result.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  criteriaSections, deriveMissionCriteria, type MissionCriterion,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceDimension, EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import {
  applyReasoning, computeCeiling, LABEL_ORDER, type Label,
} from "../../../supabase/functions/_shared/opportunityLabel.ts";
import {
  buildWorkbenchMissionView, countsAreExclusive, legacyCountsFrom, type MissionCandidate,
} from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import {
  companyEvidenceItems, missionCandidatesFrom, runCapabilityPlan,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { jobEmployerToCompany, normalizeLinkedInJob } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  parseReasonerResult, reasonerPayload,
} from "../../../supabase/functions/_shared/gptOpportunityReasoner.ts";
import {
  candidatesToReason, reasonForCandidates,
} from "../../../supabase/functions/_shared/opportunityReasoningRun.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("P5 tests must not reach the network"); };

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
const MISSION = compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission;
// Hard: industry b2b saas + saas, geography United States, company_stage startup.
// Target: hiring (the anchor). "seed" compiles `unprovable_today` and is skipped.
const CRITERIA = deriveMissionCriteria(MISSION);

/** The same mission with the Brain's size PREFERENCE — a second, non-signal target. */
const CRITERIA_PREF = deriveMissionCriteria(
  compileLeadMission({ originalUserQuery: CANONICAL, proposal, companyBrain: { employee_min: 1, employee_max: 150 } }).final_mission);

/** "…bonus if they recently raised" — a second observable signal beside the anchor. */
const CRITERIA_BONUS = deriveMissionCriteria(compileLeadMission({
  originalUserQuery: "Find 1 B2B SaaS startup in the US hiring its first growth marketer; bonus if they recently raised.",
  proposal: { ...proposal, adjacent_signals: ["recently raised"], preferred_signals: ["hiring growth marketer", "recently raised"] },
}).final_mission);

let seq = 0;
function ev(dimension: EvidenceDimension, value: unknown, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidence_id: `ev_${dimension}_${++seq}`, company_key: "c1", dimension, value, status: "proven",
    source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc_1", url: "https://x.test/a", excerpt: null },
    method: "provider_field", observed_at: "2026-09-17T00:00:00.000Z", valid_until: null,
    confidence: "high", derived_from: [], mission_id: "task-p5", origin: "lead_mission", ...over,
  };
}
const graphOf = (items: EvidenceItem[], required: EvidenceDimension[] = []) =>
  buildCompanyEvidenceGraph("c1", items, { now: NOW, required });

/**
 * Every PROVABLE hard criterion of this mission: geography and industry.
 * "Company kind: startup" is `unprovable_today` and is disclosed, not enforced.
 */
const hardProven = () => [
  ev("geography", "San Francisco, CA, United States"),
  ev("industry", "b2b saas"),
];

// ── SEM-1 ───────────────────────────────────────────────────────────────────

Deno.test("SEM-1: a preference that fails never makes a candidate ineligible", () => {
  const sizePref = CRITERIA_PREF.find((c) => c.dimension === "company_size")!;
  assertEquals(sizePref.kind, "target", "the Brain's size band is a preference here");

  // Every hard criterion proven; the size PREFERENCE is violated outright
  // (4,000 people against a 1–150 band) and the anchor is proven.
  const g = graphOf([...hardProven(), ev("headcount", 4000), ev("hiring", true)]);
  const r = evaluateEligibility(CRITERIA_PREF, g);
  assertEquals(r.eligibility, "eligible", "a preference cannot reject");
  assertEquals(r.disproven, []);
  assertEquals(r.checks.find((c) => c.dimension === "company_size")!.result, "fail",
    "the failure is recorded — it just does not reject");

  // A DISPROVEN preference changes nothing either.
  const g2 = graphOf([...hardProven(), ev("headcount", 4000, { status: "disproven" }), ev("hiring", true)]);
  assertEquals(evaluateEligibility(CRITERIA_PREF, g2).eligibility, "eligible");
  // Only hard dimensions appear in the hard checks. `company_stage` is absent
  // because "Company kind: startup" is `unprovable_today` (P5.2) — disclosed on
  // the card rather than silently stranding every candidate in `pending`.
  assertEquals(Object.keys(r.hard_checks).sort(), ["geography", "industry"],
    "the size band here is a preference, and the company kind is unprovable");
});

Deno.test("SEM-1: a disproven hard criterion is ineligible; an unknown one is pending, not rejected", () => {
  const disproven = graphOf([
    ev("geography", "Berlin, Germany"), ev("industry", "b2b saas"),
  ]);
  const a = evaluateEligibility(CRITERIA, disproven);
  assertEquals(a.eligibility, "ineligible");
  assertEquals(a.hard_checks.geography, "fail");
  assert(a.disproven.length > 0, "the failing criterion is named");

  // Nothing proven at all: pending, with the gaps evidence completion should buy.
  const b = evaluateEligibility(CRITERIA, graphOf([]));
  assertEquals(b.eligibility, "pending");
  assertEquals(b.disproven, []);
  assert(b.gaps.includes("geography"), JSON.stringify(b.gaps));

  // A provider LABEL is not proof: it leaves the hard criterion unknown.
  const c = evaluateEligibility(CRITERIA, graphOf([
    ...hardProven().slice(0, 1),
    ev("industry", "Technology, Information and Internet", { status: "plausible", confidence: "medium" }),
  ]));
  assertEquals(c.eligibility, "pending");

  // Even a label whose WORDS match: `plausible` is a provider's opinion, and a
  // hard criterion is satisfied only by proof.
  const d = evaluateEligibility(CRITERIA, graphOf([
    ev("geography", "Austin, TX, United States"), ev("company_stage", "startup"),
    ev("industry", "b2b saas", { status: "plausible", confidence: "medium" }),
  ]));
  assertEquals(d.eligibility, "pending", "a plausible industry does not satisfy a hard industry rule");
  assertEquals(d.checks.find((x) => x.dimension === "industry")!.result, "unknown");
});

Deno.test("SEM-1: expired evidence proves nothing — the candidate goes back to pending", () => {
  const stale = { valid_until: "2026-08-01T00:00:00.000Z" };
  const g = graphOf([...hardProven(), ev("hiring", true, stale)], ["hiring"]);
  assertEquals(g.claims.find((c) => c.dimension === "hiring")!.current, null);
  const ceiling = computeCeiling({ criteria: CRITERIA, graph: g, eligibility: evaluateEligibility(CRITERIA, g), anchor: "hiring" });
  assertFalse(ceiling.anchor_proven, "a 48-day-old posting is not a current anchor");
});

Deno.test("a hard anchor gates the label: unproven ⇒ no label, and an empty target list is never an Exact Match", () => {
  // Built here rather than compiled: today P1 compiles every hiring signal as a
  // `target` (see the P5 report), and this is P5's rule, not P1's — the ceiling
  // must depend on the ANCHOR being proven, not merely on there being no
  // unproven targets.
  const hardHiring: MissionCriterion[] = [
    ...CRITERIA.filter((c) => c.kind === "hard"),
    { ...CRITERIA.find((c) => c.dimension === "hiring")!, kind: "hard" },
  ];
  assertEquals(hardHiring.filter((c) => c.kind === "target").length, 0, "no targets remain");

  const unproven = graphOf(hardProven(), ["hiring"]);
  const e = evaluateEligibility(hardHiring, unproven);
  assertEquals(e.eligibility, "pending", "the hard anchor is unknown");
  assertEquals(computeCeiling({ criteria: hardHiring, graph: unproven, eligibility: e, anchor: "hiring" }).ceiling, null);

  const proven = graphOf([...hardProven(), ev("hiring", true)]);
  const e2 = evaluateEligibility(hardHiring, proven);
  const c2 = computeCeiling({ criteria: hardHiring, graph: proven, eligibility: e2, anchor: "hiring" });
  assertEquals([e2.eligibility, c2.ceiling, c2.targets_total], ["eligible", "strong_opportunity", 0],
    "an empty target list cannot manufacture an Exact Match");

  // A stale anchor is not a proven one.
  const stale = graphOf([...hardProven(), ev("hiring", true, { valid_until: "2026-08-01T00:00:00.000Z" })], ["hiring"]);
  const e3 = evaluateEligibility(hardHiring, stale);
  assertEquals(computeCeiling({ criteria: hardHiring, graph: stale, eligibility: e3, anchor: "hiring" }).ceiling, null);
});

// ── WORTH-1 ─────────────────────────────────────────────────────────────────

Deno.test("WORTH-1: hard proven, anchor missing, funding proven ⇒ Worth Considering with a cited signal", () => {
  const funding = ev("funding", { round: "seed", announced: "2026-08-01" });
  const g = graphOf([...hardProven(), funding], ["hiring"]);
  const eligibility = evaluateEligibility(CRITERIA_BONUS, g);
  assertEquals(eligibility.eligibility, "eligible");

  const ceiling = computeCeiling({ criteria: CRITERIA_BONUS, graph: g, eligibility, anchor: "hiring" });
  assertEquals(ceiling.ceiling, "worth_considering");
  assertFalse(ceiling.anchor_proven);
  assert(ceiling.missing_evidence.some((m) => /hiring/i.test(m)), JSON.stringify(ceiling.missing_evidence));
  assert(ceiling.citable_ids.includes(funding.evidence_id));

  const r = applyReasoning(ceiling, {
    label: "worth_considering",
    why_surfaced: [{ text: "Raised a seed round in August 2026.", evidence_ids: [funding.evidence_id] }],
  });
  assertEquals(r.label, "worth_considering");
  assertEquals(r.why_surfaced.length, 1);
  assertEquals(r.why_surfaced[0].evidence_ids, [funding.evidence_id]);
  // Code's missing list travels with the lead; the reasoner cannot shorten it.
  assertEquals(r.missing_evidence, ceiling.missing_evidence);
});

Deno.test("the ceiling rises with the evidence, and pending or ineligible have no label at all", () => {
  const hiring = ev("hiring", true);
  const ceilingFor = (criteria: MissionCriterion[], items: EvidenceItem[]) => {
    const g = graphOf(items, ["hiring"]);
    return computeCeiling({ criteria, graph: g, eligibility: evaluateEligibility(criteria, g), anchor: "hiring" });
  };
  // Anchor proven and every usable target proven (size within the band).
  const exact = ceilingFor(CRITERIA_PREF, [...hardProven(), hiring, ev("headcount", 20)]);
  assertEquals(exact.ceiling, "exact_match", JSON.stringify(exact.targets_unproven));

  // Anchor proven, headcount unknown — one unproven target.
  const strong = ceilingFor(CRITERIA_PREF, [...hardProven(), hiring]);
  assertEquals([strong.ceiling, strong.targets_unproven.length], ["strong_opportunity", 1]);

  // Eligible, no anchor and no other proven signal.
  const low = ceilingFor(CRITERIA, hardProven());
  assertEquals(low.ceiling, "low_priority", "eligible, but nothing fresh to say about it");

  const pending = ceilingFor(CRITERIA, []);
  assertEquals(pending.ceiling, null);
  assertEquals(applyReasoning(pending, { label: "exact_match", why_surfaced: [] }).label, null,
    "a pending candidate cannot be talked into being a match");
});

// ── THE REASONER IS BOUNDED ─────────────────────────────────────────────────

Deno.test("GPT may not promote past the ceiling, cite what does not exist, or hide a gap", () => {
  const funding = ev("funding", { round: "seed" });
  const g = graphOf([...hardProven(), funding], ["hiring"]);
  const ceiling = computeCeiling({ criteria: CRITERIA_BONUS, graph: g, eligibility: evaluateEligibility(CRITERIA_BONUS, g), anchor: "hiring" });

  const promoted = applyReasoning(ceiling, {
    label: "exact_match",
    why_surfaced: [{ text: "Raised seed.", evidence_ids: [funding.evidence_id] }],
  });
  assertEquals([promoted.label, promoted.capped_from], ["worth_considering", "exact_match"]);

  const fabricated = applyReasoning(ceiling, {
    label: "worth_considering",
    why_surfaced: [
      { text: "They are hiring three growth marketers.", evidence_ids: ["ev_does_not_exist"] },
      { text: "Great fit.", evidence_ids: [] },
    ],
  });
  assertEquals(fabricated.why_surfaced, [], "no sentence survives without a real citation");
  assertEquals(fabricated.dropped.map((d) => d.reason), ["unknown_evidence_id", "no_citation"]);
  assertEquals([fabricated.label, fabricated.dropped_a_level], ["low_priority", true],
    "the label drops a level when nothing survives");
  assertEquals(fabricated.missing_evidence, ceiling.missing_evidence);
});

Deno.test("a reasoner that declines to promote is honoured, and a missing reasoner still explains", () => {
  const hiring = ev("hiring", true);
  const g = graphOf([...hardProven(), hiring, ev("headcount", 20)]);
  const ceiling = computeCeiling({ criteria: CRITERIA_PREF, graph: g, eligibility: evaluateEligibility(CRITERIA_PREF, g), anchor: "hiring" });
  assertEquals(ceiling.ceiling, "exact_match");
  const modest = applyReasoning(ceiling, {
    label: "strong_opportunity",
    why_surfaced: [{ text: "Open growth role.", evidence_ids: [hiring.evidence_id] }],
  });
  assertEquals([modest.label, modest.capped_from], ["strong_opportunity", null], "below the ceiling is allowed");

  const none = applyReasoning(ceiling, null);
  assertEquals(none.label, "exact_match", "no reasoner ⇒ the ceiling stands");
  assertEquals(none.dropped_a_level, false);
  assertEquals(LABEL_ORDER.indexOf(none.label as Label) >= 0, true);
});

// ── WB-1 ────────────────────────────────────────────────────────────────────

function candidate(key: string, over: Partial<MissionCandidate> = {}): MissionCandidate {
  return {
    company_key: key, name: key, domain: `${key}.test`, linkedin_url: `https://www.linkedin.com/company/${key}`,
    found_by: ["job_discovery:apify_linkedin_job_search"], screened_out: null, identity_resolved: true,
    investigated: true, graph: graphOf([...hardProven(), ev("hiring", true)]), ...over,
  };
}

Deno.test("WB-1: every discovered company lands in exactly one bucket, and the legacy keys agree", () => {
  const view = buildWorkbenchMissionView({
    mission: { requested_count: 1, execution_limit: 1, anchor: "hiring" },
    criteria: CRITERIA_BONUS, stage: "complete",
    candidates: [
      // Under CRITERIA_BONUS the targets are the anchor (hiring) and funding.
      candidate("exact", { graph: graphOf([...hardProven(), ev("hiring", true), ev("funding", { round: "seed" })]) }),
      candidate("strong", { graph: graphOf([...hardProven(), ev("hiring", true)], ["funding"]) }),
      candidate("worth", { graph: graphOf([...hardProven(), ev("funding", { round: "seed" })], ["hiring"]) }),
      candidate("low", { graph: graphOf(hardProven()) }),
      candidate("pending", { graph: graphOf([]) }),
      candidate("ineligible", { graph: graphOf([ev("geography", "Berlin, Germany"), ev("industry", "b2b saas")]) }),
      candidate("screened", { screened_out: "employee_size" }),
      candidate("noid", { identity_resolved: false }),
      candidate("working", { investigated: false, graph: graphOf(hardProven()) }),
    ],
  });
  const c = view.counts;
  assertEquals(c.discovered, 9);
  assert(countsAreExclusive(c), JSON.stringify(c));
  assertEquals(
    [c.exact_match, c.strong_opportunity, c.worth_considering, c.low_priority, c.pending, c.ineligible, c.screened_out, c.identity_unresolved, c.investigating],
    [1, 1, 1, 1, 1, 1, 1, 1, 1]);

  // Only surfaced labels carry a label; dispositions do not.
  const byKey = new Map(view.leads.map((l) => [l.company.key, l]));
  assertEquals(byKey.get("pending")!.label, null);
  assert(byKey.get("pending")!.missing_evidence.length > 0,
    "a pending lead still shows code's list of what is missing");
  assertEquals(byKey.get("ineligible")!.label, null);
  assertEquals(byKey.get("exact")!.label, "exact_match");
  assert(byKey.get("pending")!.caveats.some((x) => /not a match yet/.test(x)));
  assertEquals(byKey.get("ineligible")!.hard_checks.geography, "fail");

  const legacy = legacyCountsFrom(view);
  assertEquals(legacy.discovered, c.discovered);
  assertEquals(legacy.qualified, 4, "the four surfaced labels");
  assertEquals(legacy.rejected, 1, "only a disproven hard criterion is a rejection");
  assertEquals(legacy.unknown_pending_evidence, 1, "pending is not rejection");
  assertEquals(legacy.evaluated, legacy.qualified + legacy.rejected + legacy.unknown_pending_evidence);
});

Deno.test("WB-1: a screened-out company is counted once, even when its evidence would fail too", () => {
  const view = buildWorkbenchMissionView({
    mission: { requested_count: 1, execution_limit: null, anchor: "hiring" },
    criteria: CRITERIA, stage: "stopped",
    candidates: [candidate("both", {
      screened_out: "employee_size", identity_resolved: false,
      graph: graphOf([ev("geography", "Berlin, Germany")]),
    })],
  });
  assertEquals(view.counts.screened_out, 1);
  assertEquals([view.counts.ineligible, view.counts.identity_unresolved], [0, 0]);
  assert(countsAreExclusive(view.counts));
});

// ── WB-1 ON A REAL RUN ──────────────────────────────────────────────────────

const PROBE = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/p3-job-discovery-probe.json", import.meta.url)));
const ROWS = PROBE.probes["harvestapi~linkedin-job-search"].items as Record<string, unknown>[];

Deno.test("WB-1: the view of a real engine run reconciles — one bucket each, summing to discovered", async () => {
  const sent: Array<{ actor: string; input: Record<string, unknown> }> = [];
  const byUrl = new Map(ROWS.map((r) => [(r.company as { linkedinUrl: string }).linkedinUrl, r.company as Record<string, unknown>]));
  const run = await runCapabilityPlan({
    planDiscovery: emptyDiscoverySelector() as never,
    planExecution: () => Promise.resolve({
      reasoning: "p5", steps: [
        { capability: "job_discovery", actor_key: "apify_linkedin_job_search", purpose: "open roles", input: { jobTitles: ['"growth marketer"'], locations: ["United States"], postedLimit: "month", maxItems: 10 }, depends_on: [] },
        { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "details", input: { companies: ["{{url}}"] }, depends_on: [1] },
        { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [2] },
      ],
    }),
    invoke: (call: { actorKey: string; input: unknown; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      sent.push({ actor: call.actorKey, input: call.input as Record<string, unknown> });
      call.onProviderRun?.({ run_id: `run-${sent.length}`, dataset_id: null });
      const input = call.input as Record<string, unknown>;
      if (call.actorKey === "apify_linkedin_job_search") return Promise.resolve(input.company ? [] : ROWS);
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((input.companies as string[]) ?? []).map((u) => {
          const c = byUrl.get(u)!;
          return { id: c.id, name: c.name, linkedinUrl: u, website: c.website, employeeCount: c.employeeCount, description: c.description, industries: c.industries, locations: c.locations };
        }));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as never, {
    mission: MISSION, plan: buildCapabilityGraph(MISSION, { executability: "enforce" }), maxCandidates: 10,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-p5", lineage_id: "lineage-p5" },
  } as never) as never as { companies: unknown[]; state: Record<string, unknown> };

  const candidates = missionCandidatesFrom(run as never, { missionId: "task-p5", now: NOW });
  assertEquals(candidates.length, run.companies.length, "one candidate per discovered company");
  const view = buildWorkbenchMissionView({
    mission: { requested_count: 1, execution_limit: 1, anchor: "hiring" },
    criteria: CRITERIA, stage: "complete", candidates,
    waves: (run.state.research_waves ?? []) as never,
  });
  assertEquals(view.counts.discovered, candidates.length);
  assert(countsAreExclusive(view.counts), JSON.stringify(view.counts));
  assertEquals(view.leads.length, view.counts.discovered, "every company is in the view, not just the matches");
  const legacy = legacyCountsFrom(view);
  assertEquals(legacy.discovered, view.counts.discovered);
  assertEquals(legacy.qualified + legacy.rejected + legacy.unknown_pending_evidence, legacy.evaluated);
  // Real employers carry a job posting, so the anchor is proven and every
  // surfaced lead cites something.
  for (const lead of view.leads) {
    if (lead.label === null) continue;
    assert(lead.why_surfaced.length > 0, `${lead.company.key} surfaced with no reason`);
    for (const s of lead.why_surfaced) assert(s.evidence_ids.length > 0);
  }
  // Routes come from the wave summaries, not a second count.
  if (view.routes.length > 0) assertEquals(view.routes[0].anchor, "job_discovery");
});

// ── THE REASONER'S BATCH ────────────────────────────────────────────────────

Deno.test("only eligible candidates are worth a model call, best evidence first", async () => {
  const eligibleRich = candidate("rich", { graph: graphOf([...hardProven(), ev("hiring", true), ev("funding", { round: "seed" })]) });
  const eligibleThin = candidate("thin", { graph: graphOf(hardProven()) });
  const pending = candidate("pending", { graph: graphOf([]) });
  const ineligible = candidate("ineligible", { graph: graphOf([ev("geography", "Berlin, Germany"), ev("industry", "b2b saas")]) });
  const screened = candidate("screened", { screened_out: "employee_size" });
  const noId = candidate("noid", { identity_resolved: false });

  const batch = candidatesToReason(CRITERIA_BONUS, [eligibleThin, pending, ineligible, screened, noId, eligibleRich], "hiring");
  assertEquals(batch.map((b) => b.company_key), ["rich", "thin"], "eligible only, richest first");
  assertEquals(batch[0].ceiling.ceiling, "exact_match");

  // The payload carries evidence, never raw provider rows.
  const payload = reasonerPayload({ request: CANONICAL, candidates: batch }) as { candidates: Array<Record<string, unknown>> };
  const first = payload.candidates[0];
  assertEquals(first.company_key, "rich");
  assert(Array.isArray(first.citable_evidence) && (first.citable_evidence as unknown[]).length > 0);
  assertEquals(JSON.stringify(payload).includes("raw_ref"), false);

  // Disabled, or with nothing eligible, it never calls the model.
  let called = 0;
  const reason = () => { called++; return Promise.resolve({}); };
  assertEquals(await reasonForCandidates({ request: "q", criteria: CRITERIA_BONUS, anchor: "hiring", candidates: [eligibleRich], enabled: false, reason }), {});
  assertEquals(await reasonForCandidates({ request: "q", criteria: CRITERIA_BONUS, anchor: "hiring", candidates: [pending], enabled: true, reason }), {});
  assertEquals(called, 0);

  // A throwing reasoner leaves the run on code's own labels.
  assertEquals(
    await reasonForCandidates({
      request: "q", criteria: CRITERIA_BONUS, anchor: "hiring", candidates: [eligibleRich], enabled: true,
      reason: () => { throw new Error("model down"); },
    }), {});
});

Deno.test("a reasoner answer about a company that is not in the batch is discarded", () => {
  const parsed = parseReasonerResult({
    candidates: [
      { company_key: "known", label: "strong_opportunity", why_surfaced: [{ text: "x", evidence_ids: ["e1"] }] },
      { company_key: "smuggled", label: "exact_match", why_surfaced: [] },
    ],
  }, new Set(["known"]));
  assertEquals(Object.keys(parsed), ["known"]);
  assertEquals(parseReasonerResult(null, new Set(["known"])), {});
  assertEquals(parseReasonerResult({ candidates: "nope" }, new Set(["known"])), {});
});

// ── P5.2 ────────────────────────────────────────────────────────────────────

Deno.test("P5.2: an unprovable hard criterion is disclosed, not enforced — it cannot strand every candidate", () => {
  const kind = CRITERIA.find((c) => c.label === "Company kind: startup")!;
  assertEquals([kind.kind, kind.status], ["hard", "unprovable_today"]);
  // It reaches the user as a stated limitation, in the same section as "seed".
  const unsupported = criteriaSections(MISSION).unsupported.join(" | ");
  assert(/Company kind: startup \(hard\) — no current source proves it/.test(unsupported), unsupported);

  // And it no longer decides eligibility: geography + industry proven ⇒ eligible.
  const g = graphOf([...hardProven(), ev("hiring", true)]);
  const e = evaluateEligibility(CRITERIA, g);
  assertEquals(e.eligibility, "eligible");
  assertFalse(e.gaps.includes("company_stage"));
});

Deno.test("P5.2: a business model the company's own words prove satisfies the industry criterion", () => {
  // A LinkedIn label alone leaves it unknown …
  const labelOnly = graphOf([
    ev("geography", "Austin, TX, United States"),
    ev("industry", "Technology, Information and Internet", { status: "plausible", confidence: "medium" }),
  ]);
  assertEquals(evaluateEligibility(CRITERIA, labelOnly).eligibility, "pending");

  // … and a VERIFIED reading of the company's own description proves it.
  const grounded = ev("business_model", "b2b saas", {
    evidence_id: "grd_c1_business_model", method: "model_extraction", confidence: "medium", origin: "web",
    source: { provider: "engine", actor: "grounded_evidence_evaluation", provider_call_id: null, url: null, excerpt: "We sell B2B SaaS to revenue teams." },
  });
  const proven = graphOf([
    ev("geography", "Austin, TX, United States"),
    ev("industry", "Technology, Information and Internet", { status: "plausible", confidence: "medium" }),
    grounded,
  ]);
  const e = evaluateEligibility(CRITERIA, proven);
  assertEquals(e.eligibility, "eligible");
  const check = e.checks.find((c) => c.dimension === "industry" && c.kind === "hard")!;
  assertEquals([check.result, check.evidence_ids], ["pass", ["grd_c1_business_model"]]);

  // A provider field still outranks it where they disagree: `compareEvidence`
  // puts provider_field first, so the graph's current business-model claim is
  // the provider's when one exists.
  const contested = graphOf([grounded, ev("business_model", "consumer")]);
  assertEquals(contested.claims.find((c) => c.dimension === "business_model")!.current!.method, "provider_field");
});

Deno.test("P5.2: only a VERIFIED self-description becomes evidence, and never as a provider field", () => {
  const company = (grounded: unknown) => ({
    key: "c1", company: { company_name: "Acme", linkedin_company_url: null, canonical_domain: null, website: null, geography: null, external_source_id: "x" },
    observations: [], evidence_registry: null, hiring_jobs: [], hiring_assessment: null,
    first_in_function: null, enriched: null, identity: null, found_by: [], grounded,
  }) as never;
  const claim = {
    claim: "Acme sells B2B SaaS to revenue teams", claim_type: "business_model",
    evidence_ids: ["reg_desc_1"], evidence_excerpts: [{ evidence_id: "reg_desc_1", excerpt: "B2B SaaS for revenue teams" }],
  };
  const pass = {
    version: "grounded-claims-v1", classifier_result: { business_model: { value: "b2b_saas", confidence: 0.9, claims: [claim] } },
    validated_claims: [claim], rejected_claims: [], grounding_score: 1, final_grounded_decision: "pass",
    downgrade_reasons: [], unacknowledged_conflicts: [],
  };
  const item = companyEvidenceItems(company(pass), "task-p5").find((e) => e.evidence_id === "grd_c1_business_model")!;
  assert(item, "a verified reading of the company's own words is evidence");
  assertEquals([item.dimension, item.value, item.status], ["business_model", "b2b saas", "proven"]);
  assertEquals([item.method, item.confidence, item.origin], ["model_extraction", "medium", "web"],
    "ranked BELOW a provider field, so a contradicting provider claim wins");
  assertEquals(item.derived_from, ["reg_desc_1"], "it cites the hard fact it was read from");
  assert(item.source.excerpt?.includes("B2B SaaS"), "the company's own words travel with it");

  const has = (g: unknown) => companyEvidenceItems(company(g), null).some((e) => e.evidence_id === "grd_c1_business_model");
  // A verification that FAILED proves nothing.
  assertFalse(has({ ...pass, final_grounded_decision: "fail" }));
  // A claim the excerpt check rejected is not a validated claim, so nothing is emitted.
  assertFalse(has({ ...pass, validated_claims: [], rejected_claims: [claim] }));
  // And "unknown" is not a business model.
  assertFalse(has({ ...pass, classifier_result: { business_model: { value: "unknown", confidence: 0.2, claims: [] } } }));
  assertFalse(has(null));
});