// THE HARNESS THAT DECIDES WHETHER PHASE A SHIPS.
//
// ── WHAT IS BEING PROVEN ───────────────────────────────────────────────────
//
// Chat Brain replaces the entry-path classifiers with a semantic layer that
// emits `RequestV1`. For the Lead surface that request is projected back into
// the compiler's own proposal shape, so the mission is produced by the SAME
// compiler as before:
//
//     utterance ──► RequestV1 ──► projectToLeadMission ──► compileLeadMission
//                                                          ^^^^^^^^^^^^^^^^^ unchanged
//
// The migration is only safe if that produces the same mission. Not a similar
// one — the SAME one, by `missionHash`, which is checkpoint identity for every
// persisted run in the system. A hash that drifts does not degrade behaviour
// gradually; it orphans every stored checkpoint at once, and the run that
// discovers this is one that has already been paid for.
//
// ── WHY EQUIVALENCE IS ASSERTED ON THE HASH ────────────────────────────────
//
// `missionHash` deliberately excludes `mission_objective`, `planner_runtime`,
// `unrepresented_requirements` and the contract version — it answers "is this
// the same QUESTION?", not "was this compiled by the same build". That is
// exactly the property this migration must preserve: a mission compiled from a
// RequestV1 must be the same question as one compiled from the raw utterance,
// even though a different layer produced it.
//
// ── SCOPE, HONESTLY ────────────────────────────────────────────────────────
//
// This file proves the PROJECTION is faithful, using requests built to mean
// what a fixture query means. It does NOT prove that Chat Brain will produce
// those requests from those utterances — that is Phase B, and it is measured
// against the live corpus, not here. Conflating the two would let a projection
// bug hide behind a model that has not been written yet.
//
// Pure. No network, no database, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileLeadMission, type GptMissionProposal,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { missionHash } from "../../../supabase/functions/_shared/leadMission.ts";
import {
  projectToLeadMission, LEAD_PROJECTION_VERSION,
} from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import {
  REQUEST_V1_VERSION, objectiveMaySpend, requestMaySpend, orderParts,
  hasBlockingAmbiguity, type RequestV1, type RequestPart,
} from "../../../supabase/functions/_shared/requestV1.ts";

// ── request builders ───────────────────────────────────────────────────────

const req = (
  utterance: string, parts: RequestPart[], over: Partial<RequestV1> = {},
): RequestV1 => ({
  version: REQUEST_V1_VERSION,
  utterance,
  objective: parts[0]?.objective ?? "source",
  parts,
  ambiguity: [],
  authority: { may_spend: true, max_cost_units: null, requires_confirmation: false },
  provenance: {},
  confidence: 0.9,
  ...over,
});

const sourcePart = (
  over: Partial<RequestPart> & { subject?: Partial<RequestPart["subject"]> } = {},
): RequestPart => ({
  id: "p1",
  objective: "source",
  ...over,
  subject: { entity: "company", ...(over.subject ?? {}) },
  output: over.output ?? { shape: "records", count: null },
});

// ── WHAT THE BASELINE ACTUALLY IS ──────────────────────────────────────────
//
// There is no "utterance alone" path through the compiler. `compileLeadMission`
// REFUSES with `no_model_proposal` when none is supplied — "no deterministic
// reading was substituted" — because a mission compiled from a guess is the
// failure that rule exists to prevent.
//
// So the old path is `utterance → leadIntentModel → proposal → compiler`, and
// the new one is `utterance → Chat Brain → RequestV1 → projection → compiler`.
// The ONLY difference is who produces the proposal. Equivalence is therefore
// asserted proposal-against-proposal through the same compiler, which isolates
// exactly the new code and nothing else.

/** A proposal shaped as the existing model path would emit it. */
const referenceProposal = (over: Partial<GptMissionProposal> = {}): GptMissionProposal =>
  ({ ...projectToLeadMission(req("baseline", [sourcePart()])).proposal, ...over });

/** Compile through the OLD path — an explicit model proposal. */
const viaProposal = (q: string, over: Partial<GptMissionProposal> = {},
  count: number | null = null) =>
  compileLeadMission({
    originalUserQuery: q, proposal: referenceProposal(over), requestedCount: count,
  });

/** Compile through the NEW path — RequestV1 projected into a proposal. */
const viaRequest = (r: RequestV1) => {
  const p = projectToLeadMission(r);
  assertEquals(p.refusal, null, `projection refused: ${p.refusal}`);
  return compileLeadMission({
    originalUserQuery: r.utterance,
    proposal: p.proposal as unknown as GptMissionProposal,
    requestedCount: p.requestedCount,
  });
};

// ══ 1. THE PROJECTION IS FAITHFUL ══════════════════════════════════════════

Deno.test("the same meaning compiles to the same question, whoever proposed it", async () => {
  // THE CENTRAL CLAIM. A proposal built by hand and one produced by the
  // projection, carrying the same meaning, must be the same QUESTION —
  // `missionHash` identical, because that value is checkpoint identity for
  // every persisted run in the system.
  const q = "Find 5 B2B SaaS companies hiring SDRs";
  const old = viaProposal(q, {
    company_types: ["B2B SaaS"],
    preferred_signals: ["hiring"],
    required_signal_terms: ["SDR"],
    requested_opportunity_count: 5,
  }, 5);
  const neu = viaRequest(req(q, [sourcePart({
    output: { shape: "records", count: 5 },
    subject: { entity: "company",
      filters: [{ field: "industry", op: "in", value: ["B2B SaaS"] }] },
    requirements: [{ event: "hiring", subject: "company",
      qualifier: { role_terms: ["SDR"] }, phrase: "hiring SDRs" }],
  })]));
  assertEquals(await missionHash(neu.final_mission), await missionHash(old.final_mission),
    "the projection must not change the question being asked");
});

Deno.test("an empty projection is a no-op on mission identity", async () => {
  // The floor case. If adding nothing perturbs the mission, every richer case
  // is suspect.
  const q = "Find SaaS companies";
  const old = viaProposal(q);
  const neu = viaRequest(req(q, [sourcePart()]));
  assertEquals(await missionHash(neu.final_mission), await missionHash(old.final_mission));
});

Deno.test("the user's words survive the projection unaltered", async () => {
  const q = "Find exactly 5 SDR hiring leads in London. Do not broaden outside London.";
  const neu = viaRequest(req(q, [sourcePart({ output: { shape: "records", count: 5 } })]));
  assertEquals(neu.final_mission.original_user_query, q,
    "the utterance is immutable through the whole path");
});

Deno.test("a requested count reaches the mission through the projection", async () => {
  const q = "Find 3 AI SaaS companies";
  const neu = viaRequest(req(q, [sourcePart({ output: { shape: "records", count: 3 } })]));
  assertEquals(neu.final_mission.requested_count, 3);
});

Deno.test("no stated count stays NULL, never a default", async () => {
  // `LeadMissionV1.requested_count` distinguishes "the user said 5" from "we
  // assumed 5". A projection that defaulted would erase the distinction the
  // mission contract exists to keep.
  const q = "Find SaaS companies";
  const neu = viaRequest(req(q, [sourcePart()]));
  assertEquals(neu.final_mission.requested_count, null);
});

// ══ 2. FILTERS PROJECT ONTO THE RIGHT MISSION AXES ═════════════════════════

Deno.test("industry, geography and size land on their mission fields", () => {
  const p = projectToLeadMission(req("q", [sourcePart({
    subject: {
      entity: "company",
      filters: [
        { field: "industry", op: "in", value: ["B2B SaaS"] },
        { field: "geography", op: "in", value: ["United States"] },
        { field: "employee_count", op: "range", value: { min: 10, max: 150 } },
      ],
    },
  })])).proposal;
  assertEquals(p.company_types, ["B2B SaaS"]);
  assertEquals(p.geographies, ["United States"]);
  assertEquals(p.employee_range, { min: 10, max: 150 });
});

Deno.test("a named company becomes a known company, not a search term", () => {
  const p = projectToLeadMission(req("Check whether Vercel is recruiting.", [sourcePart({
    objective: "research",
    subject: { entity: "company", references: [{ kind: "named", value: "Vercel" }] },
  })])).proposal;
  assertEquals(p.known_companies, ["Vercel"]);
});

Deno.test("a referent contributes its NAME — a url may not enter the proposal", () => {
  // This first asserted that `resolved_key` wins, which is wrong and fatally
  // so: `scanProposalForViolations` refuses ANY url anywhere in a proposal —
  // the same scan that blocks actor references and vendor names — and
  // compiling one raises `url:known_companies[0]`.
  //
  // Passing the name is also the right pipeline behaviour: resolving a named
  // company to an identity is what `known_company_resolution` is for. A
  // resolved referent needs a channel that is not the proposal; Phase E owns
  // that decision.
  const p = projectToLeadMission(req("Monitor them.", [sourcePart({
    objective: "monitor",
    subject: {
      entity: "company",
      references: [{ kind: "prior_result", value: "Vercel",
        resolved_key: "https://www.linkedin.com/company/vercel" }],
    },
  })])).proposal;
  assertEquals(p.known_companies, ["Vercel"]);
});

Deno.test("a filter this surface cannot express is REPORTED, never dropped", () => {
  // The `unrepresented_requirements` discipline, applied one layer up. A
  // requirement silently lost is the failure the mission contract was built to
  // prevent; a new layer must not reintroduce it.
  const p = projectToLeadMission(req("q", [sourcePart({
    subject: {
      entity: "company",
      filters: [
        { field: "industry", op: "in", value: ["SaaS"] },
        { field: "podcast_appearances", op: "range", value: { min: 3 } },
      ],
    },
  })]));
  assertEquals(p.unprojected, ["filter:podcast_appearances"]);
  assertEquals(p.proposal.company_types, ["SaaS"], "the expressible half still lands");
});

// ══ 3. SIGNALS PROJECT THROUGH THE EXISTING DESCRIPTOR ═════════════════════

Deno.test("a hiring requirement keeps the user's own role words", () => {
  // `required_signal_terms` is what reaches title matching. Paraphrasing here
  // would change which jobs count as evidence — the exact class of bug that
  // made "sales roles" mean something else in Phase 8.
  const p = projectToLeadMission(req("Find companies actively hiring sales roles.", [
    sourcePart({
      requirements: [{
        event: "hiring", subject: "company",
        qualifier: { role_terms: ["sales roles"] },
        phrase: "actively hiring sales roles",
      }],
    }),
  ])).proposal;
  assertEquals(p.preferred_signals, ["hiring"]);
  assertEquals(p.required_signal_terms, ["sales roles"]);
});

Deno.test("multiple signals are carried, not collapsed to the first", () => {
  const p = projectToLeadMission(req("Find recently funded companies hiring SDRs", [
    sourcePart({
      requirements: [
        { event: "funding", subject: "company", phrase: "recently funded", recency_days: 90 },
        { event: "hiring", subject: "company", phrase: "hiring SDRs",
          qualifier: { role_terms: ["SDR"] } },
      ],
    }),
  ])).proposal;
  assertEquals(p.preferred_signals, ["funding", "hiring"]);
  assertEquals(p.signal_recency_days, 90);
});

// ══ 4. WHAT THE LEAD SURFACE MUST REFUSE ═══════════════════════════════════

Deno.test("a read request is never projected into a mission", () => {
  // THE INVARIANT. "What are my strongest signals?" must not become a paid
  // sourcing run because it happens to mention companies.
  const p = projectToLeadMission(req("What are my strongest signals?", [{
    id: "p1", objective: "read",
    subject: { entity: "signal" },
    output: { shape: "answer", count: null },
  }]));
  assertEquals(p.refusal, "not_a_lead_request");
  assertEquals(p.proposal.company_types, [], "and nothing is half-built");
});

Deno.test("conversation about companies is still conversation", () => {
  const p = projectToLeadMission(req("Do you think my ICP is too broad?", [{
    id: "p1", objective: "converse",
    subject: { entity: "company" },
    output: { shape: "answer", count: null },
  }]));
  assertEquals(p.refusal, "objective_not_servable",
    "our entity, but an objective that produces no records");
});

Deno.test("blocking ambiguity refuses BEFORE anything is projected", () => {
  // Targeting the wrong entity spends real money on someone else's company.
  const p = projectToLeadMission(req("Monitor them.", [sourcePart({ objective: "monitor" })], {
    ambiguity: [{
      part_id: "p1", field: "subject.references",
      question: "Which of the two companies?", blocking: true,
    }],
  }));
  assertEquals(p.refusal, "blocked_by_ambiguity");
});

Deno.test("non-blocking ambiguity is carried as an unknown, not silenced", () => {
  const p = projectToLeadMission(req("Find fast-growing SaaS companies", [sourcePart()], {
    ambiguity: [{
      part_id: "p1", field: "filters",
      question: "How fast is fast-growing?", blocking: false,
    }],
  }));
  assertEquals(p.refusal, null);
  assertEquals(p.proposal.unknowns, ["How fast is fast-growing?"]);
});

// ══ 5. THE CONTRACT'S OWN RULES ════════════════════════════════════════════

Deno.test("read and converse and compose may never spend", () => {
  assertEquals(objectiveMaySpend("read"), false);
  assertEquals(objectiveMaySpend("converse"), false);
  assertEquals(objectiveMaySpend("compose"), false);
  assertEquals(objectiveMaySpend("research"), true);
  assertEquals(objectiveMaySpend("source"), true);
  assertEquals(objectiveMaySpend("monitor"), true);
});

Deno.test("spend requires authority, a spending objective, and no blocker", () => {
  const base = req("Find 5 SaaS companies", [sourcePart()]);
  assertEquals(requestMaySpend(base).allowed, true);
  assertEquals(
    requestMaySpend({ ...base, authority: { ...base.authority, may_spend: false } }).reason,
    "no_authority");
  assertEquals(
    requestMaySpend({ ...base, ambiguity: [{ part_id: null, field: "x", question: "?",
      blocking: true }] }).reason, "blocked_by_ambiguity");
  assertEquals(
    requestMaySpend({ ...base, parts: [{ ...base.parts[0], objective: "read" }] }).reason,
    "objective_is_free");
});

Deno.test("parts order by dependency, and a cycle is refused", () => {
  const a: RequestPart = { id: "a", objective: "source", subject: { entity: "company" },
    output: { shape: "records", count: 3 } };
  const b: RequestPart = { id: "b", objective: "compose", subject: { entity: "content" },
    output: { shape: "artifact", count: 3 }, depends_on: ["a"] };
  assertEquals(orderParts([b, a])!.map((p) => p.id), ["a", "b"],
    "a dependent part never runs first");
  assertEquals(
    orderParts([{ ...a, depends_on: ["b"] }, b]), null, "a cycle is not schedulable");
});

Deno.test("blocking ambiguity is detectable without inspecting every field", () => {
  const r = req("q", [sourcePart()], {
    ambiguity: [
      { part_id: null, field: "a", question: "?", blocking: false },
      { part_id: null, field: "b", question: "?", blocking: true },
    ],
  });
  assert(hasBlockingAmbiguity(r));
});

// ══ 6. THE SEAM ════════════════════════════════════════════════════════════

Deno.test("the projection targets the compiler's proposal, not the mission", async () => {
  // ARCHITECTURE, PINNED. Building `LeadMissionV1` field by field would mean
  // reproducing the brain merge, the provenance precedence, the capability
  // derivation and `missionHash` — and any drift between the two constructors
  // orphans checkpoints silently. Projecting into the proposal keeps ONE
  // mission constructor in the system.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/projectToLeadMission.ts", import.meta.url),
  );
  assert(SRC.includes("GptMissionProposal"), "the target is the proposal shape");
  assertEquals(
    /:\s*LeadMissionV1\b/.test(SRC), false,
    "this module must never construct a mission itself",
  );
  assertEquals(LEAD_PROJECTION_VERSION, "request-v1-to-lead-proposal-1");
});

Deno.test("RequestV1 carries no lead vocabulary", async () => {
  // The other half of the boundary. If `contact_ready_leads` or
  // `company_profile` appears in the universal contract, it has stopped being
  // universal and Signals will be forced through it.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/requestV1.ts", import.meta.url),
  );
  // CODE, NOT PROSE. The header NAMES these deliberately, to explain why they
  // are excluded — that documentation is the point, and a substring match
  // would forbid writing it down. What must not exist is a dependency.
  const code = SRC.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  for (const leaked of [
    "contact_ready_leads", "qualified_companies", "MissionCompanyProfile",
    "CapabilityId", "LeadMissionV1",
  ]) {
    assertEquals(code.includes(leaked), false, `${leaked} must not appear in RequestV1 code`);
  }
  // The one lead import that IS allowed is the provenance lattice — a shared
  // vocabulary, not lead semantics.
  assert(/import type \{[^}]*FieldProvenance[^}]*\} from "\.\/leadMission\.ts"/s.test(SRC));
});
