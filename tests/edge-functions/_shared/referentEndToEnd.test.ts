// FROM THE LIST THE USER SAW TO THE COMPANY THE ENGINE INVESTIGATES.
//
// ── WHAT THESE TESTS ARE FOR ────────────────────────────────────────────────
//
// `referentBinding.test.ts` proves the resolver decides correctly when handed a
// list. That is necessary and not sufficient: every defect this phase exists to
// prevent lives in a SEAM, not in a function.
//
//   the list is persisted in a different order than it was displayed
//   the resolver is never called, so a pronoun routes on the model's guess
//   the binding resolves and then nothing downstream reads it
//   the mission carries the literal phrase "the second company" as a name
//   a bound company is resolved a second time, at a price
//   a checkpoint for one company resumes against another
//
// So each test below crosses at least one real boundary — persistence to
// lookup, lookup to resolver, resolver to router, router to projection,
// projection to engine, engine to checkpoint — using the real modules on both
// sides of it.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPresentedReferents, readPresentedReferents, presentedFromIdentifier,
  requestHasBackReference, PRESENTED_REFERENTS_KEY,
} from "../../../supabase/functions/_shared/referentPersistence.ts";
import {
  loadLatestReferents,
} from "../../../supabase/functions/_shared/referentLookup.ts";
import {
  resolveReferents, bindingFingerprint,
  type ResolvedReferentBinding,
} from "../../../supabase/functions/_shared/referentBinding.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import {
  planRead, executeRead, renderReadAnswer,
} from "../../../supabase/functions/_shared/readSurface.ts";
import {
  planMonitor, executeMonitor,
} from "../../../supabase/functions/_shared/monitorSurface.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { readPersistedBindings } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestObjective, type RequestReference,
} from "../../../supabase/functions/_shared/requestV1.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// ══ FIXTURES ═══════════════════════════════════════════════════════════════

/**
 * The three companies a lead run showed, in the order Workbench rendered them.
 *
 * Shaped as `run-agent` shapes them — `account.name / domain / linkedin_url`
 * off `leadRows` — so the mapping under test is the one that actually ships.
 */
const SHOWN = [
  { label: "Acme", name: "Acme", domain: "acme.com",
    linkedin_url: "https://www.linkedin.com/company/acme" },
  { label: "Linear", name: "Linear", domain: "linear.app",
    linkedin_url: "https://www.linkedin.com/company/linear" },
  { label: "Vercel", name: "Vercel", domain: "vercel.com",
    linkedin_url: "https://www.linkedin.com/company/vercel" },
];

/** A message row exactly as `pilot-chat` and `run-agent` write one. */
const resultMessage = (
  id: string, entities: typeof SHOWN, createdAt: string,
) => ({
  id,
  created_at: createdAt,
  metadata: {
    ui_panel: { kind: "lead_results" },
    [PRESENTED_REFERENTS_KEY]: buildPresentedReferents(entities, "lead_results"),
  },
});

/** A conversation, newest first — the order the lookup's query returns. */
const conversation = (rows: Array<Record<string, unknown>>) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    }),
  }),
});

const req = (
  objective: RequestObjective, references: RequestReference[], utterance = "u",
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance, objective,
  parts: [{
    id: "p1", objective,
    subject: { entity: "company", references },
    requirements: [{ event: "hiring", subject: "company", phrase: "hiring" }],
    output: { shape: "records", count: null },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

/**
 * The whole read path, as `pilot-chat` runs it: load the newest presented set
 * from the conversation, then resolve the request's references against it.
 */
async function resolveAgainstConversation(
  request: RequestV1, rows: Array<Record<string, unknown>>,
) {
  // deno-lint-ignore no-explicit-any
  const found = await loadLatestReferents(conversation(rows) as any, "c1");
  return { found, ...resolveReferents(request, found.source) };
}

// ══ 1. PERSISTENCE → LOOKUP → RESOLVER ═════════════════════════════════════

Deno.test("1. an ordinal resolves to the company that was displayed second", async () => {
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the second company" }]),
    [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")],
  );
  assertEquals(r.failures, []);
  assertEquals(r.bindings.length, 1);
  assertEquals(r.bindings[0].label, "Linear");
  assertEquals(r.bindings[0].entity_key, "domain:linear.app");
  // AND IT SAYS WHERE IT CAME FROM. A binding nobody can audit back to a
  // displayed row is a binding nobody can check.
  assertEquals(r.bindings[0].source.message_id, "m1");
  assertEquals(r.bindings[0].source.result_index, 1);
});

Deno.test("2. the persisted order is the DISPLAYED order, not the row order", async () => {
  // The property the ordinal depends on. If persistence ever sorted, filtered
  // or re-queried, "the second company" would silently name a different one —
  // and every test above would still pass while doing the wrong thing.
  const set = buildPresentedReferents(SHOWN, "lead_results");
  assertEquals(set.entities.map((e) => e.position), [1, 2, 3]);
  assertEquals(set.entities.map((e) => e.label), ["Acme", "Linear", "Vercel"]);
  const round = readPresentedReferents({ [PRESENTED_REFERENTS_KEY]: set });
  assertEquals(round!.entities.map((e) => e.label), ["Acme", "Linear", "Vercel"]);
});

Deno.test("3. an exact name resolves; a near name does NOT", async () => {
  const rows = [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")];
  const hit = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "Vercel" }]), rows);
  assertEquals(hit.bindings[0].entity_key, "domain:vercel.com");

  // "Vercel Inc" is a DIFFERENT string. A nearest-name fallback is how a
  // follow-up investigates a company the user never mentioned.
  const miss = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "Vercel Inc" }]), rows);
  assertEquals(miss.bindings, []);
  assertEquals(miss.failures[0].reason, "ambiguous_referent");
});

Deno.test("4. one prior company and 'them' resolves; three and 'them' asks", async () => {
  const one = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "them" }]),
    [resultMessage("m1", [SHOWN[1]], "2026-08-27T10:00:00Z")]);
  assertEquals(one.failures, []);
  assertEquals(one.bindings[0].label, "Linear");

  const many = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "them" }]),
    [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(many.bindings, []);
  assertEquals(many.failures[0].reason, "ambiguous_referent");
  // AND THE QUESTION IS ASKABLE. A failure with no question is a dead end.
  assert(many.failures[0].question.length > 0);
});

Deno.test("5. a conversation with no presented set asks, it does not guess", async () => {
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "them" }]),
    [{ id: "m1", created_at: "2026-08-27T10:00:00Z", metadata: { ui_card: {} } }]);
  assertEquals(r.found.source, null);
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "no_prior_results");
});

Deno.test("6. a STALE entry keeps its position and refuses to bind", async () => {
  // The company that was displayed second no longer carries anything
  // identifiable. Dropping it would renumber the list and make "the second
  // company" resolve to Vercel — acting on a company the user did not point at.
  const broken = [SHOWN[0], { label: "Linear", name: null, domain: null,
    linkedin_url: null }, SHOWN[2]];
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the second company" }]),
    [resultMessage("m1", broken as typeof SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "unidentifiable_entity");
  // The third company is still the third.
  const third = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the third company" }]),
    [resultMessage("m1", broken as typeof SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(third.bindings[0].label, "Vercel");
});

Deno.test("7. an out-of-range ordinal asks rather than taking the last one", async () => {
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the fifth company" }]),
    [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "ordinal_out_of_range");
});

Deno.test("8. the NEWEST presented set wins, and sets are never merged", async () => {
  // Two lists in one conversation. Merging them would renumber both, so the
  // second company of the merge is the second company of neither.
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the second company" }]),
    [
      resultMessage("m2", [SHOWN[2], SHOWN[0]], "2026-08-27T11:00:00Z"),
      resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z"),
    ]);
  assertEquals(r.found.message_id, "m2");
  assertEquals(r.bindings[0].label, "Acme");
});

Deno.test("9. a WEAK identity refuses to bind, however it was displayed", async () => {
  // A name and a city is not an identity: `known_company_resolution` would have
  // had to resolve it anyway, so binding it claims a certainty nobody has.
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "them" }]),
    [resultMessage("m1", [{ label: "Apollo", name: "Apollo", domain: null,
      linkedin_url: null }] as unknown as typeof SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "unidentifiable_entity");
});

Deno.test("10. a forged resolved_key is ignored in favour of the displayed row", async () => {
  // `resolved_key` arrives from the MODEL. If it could steer the binding, a
  // model could point a paid run at any company it liked.
  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the second company",
      resolved_key: "https://www.linkedin.com/company/attacker" }]),
    [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(r.bindings[0].entity_key, "domain:linear.app");
  assertFalse(/attacker/.test(JSON.stringify(r.bindings)));
});

Deno.test("11. a request that names its own subject needs no lookup at all", () => {
  // The guard that keeps a database read off every turn.
  assertFalse(requestHasBackReference(
    req("research", [{ kind: "named", value: "Vercel" }])));
  assert(requestHasBackReference(
    req("research", [{ kind: "prior_result", value: "them" }])));
});

// ══ 2. RESOLVER → ROUTER → PROJECTION ══════════════════════════════════════

Deno.test("12. the mission carries the COMPANY'S NAME, never the phrase", async () => {
  // Without the sidecar the projection put the literal string "the second
  // company" into `known_companies`, and the pipeline went looking for a
  // company by that name.
  const request = req("research", [{ kind: "prior_result", value: "the second company" }]);
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);

  const route = routeRequest(request, { spendAllowed: true, bindings });
  assertEquals(route.kind, "lead_mission");
  assertEquals(route.lead!.proposal.known_companies, ["Linear"]);
});

Deno.test("13. the exact identity does NOT enter the proposal", async () => {
  // `scanProposalForViolations` refuses any URL anywhere in a proposal — the
  // same scan that blocks actor references and vendor names. The binding
  // carries linear.app and a LinkedIn URL; neither may cross this seam.
  const request = req("research", [{ kind: "prior_result", value: "the second company" }]);
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  const route = routeRequest(request, { spendAllowed: true, bindings });
  const json = JSON.stringify(route.lead!.proposal);
  assertFalse(/https?:\/\//.test(json), "no URL may reach the proposal");
  assertFalse(/linkedin/i.test(json), "and no LinkedIn reference either");
});

Deno.test("14. a bound research request stays research — it never becomes source", async () => {
  const request = req("research", [{ kind: "prior_result", value: "the second company" }]);
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  const route = routeRequest(request, { spendAllowed: true, bindings });
  assertEquals(route.reason, "named_entity_investigation");

  // AND THE GRAPH AGREES. A research mission enters at known-company
  // resolution and schedules no general discovery, whatever the router said.
  const plan = buildCapabilityGraph(missionNaming(["Linear"]) as never);
  assertEquals(plan.entry_capability, "known_company_resolution");
  assertFalse(plan.steps.some((s) => /general_company_discovery/.test(s.capability)),
    "a bound research run must never open general discovery");
});

Deno.test("15. an UNRESOLVED referent never reaches the router at all", async () => {
  // The ordering that makes the refusal cheap: resolution happens before a
  // surface is chosen, so an ambiguous pronoun costs a question rather than a
  // mission, a credit reservation and a provider call.
  const request = req("research", [{ kind: "prior_result", value: "them" }]);
  const r = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assert(r.failures.length > 0, "this request must not be routable");

  // Proven at the call site: pilot-chat returns on a failure, before routing.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const resolveAt = SRC.indexOf("const resolution = resolveReferents(");
  const routeAt = SRC.indexOf("brainRoute = routeRequest(");
  assert(resolveAt > 0 && routeAt > resolveAt,
    "referents must be resolved BEFORE the router runs");
  const between = SRC.slice(resolveAt, routeAt);
  assert(between.includes("resolution.failures.length > 0"),
    "a resolution failure must be handled before routing");
  assert(between.includes("return json("),
    "and it must RETURN, not fall through into a route");
  // COMMENTS STRIPPED FIRST. The prose in this region explains that nothing has
  // been reserved yet, and scanning it as code would match its own explanation.
  const code = between.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(/delegateToOrchestrate|creditAuthorization|reserveCredits/i.test(code),
    "nothing may be spent between resolving and asking");
});

// ══ 3. PROJECTION → ENGINE: THE REDUNDANT LOOKUP IS GONE ═══════════════════

function missionNaming(names: string[]): LeadMissionV1 {
  return {
    version: "lead-mission-v1",
    original_user_query: `Check ${names.join(" and ")} for hiring.`,
    mission_type: "company_research",
    target_entity: "company",
    requested_output: "qualified_companies",
    requested_count: 5,
    company_profile: {
      business_models: [], verticals: [], stages: [], locations: [],
      known_companies: names,
    },
    required_signals: [{ type: "hiring", timeframe_days: 90 }],
    decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {},
    required_capabilities: [], prohibited_capabilities: [],
    confidence: 1,
  } as unknown as LeadMissionV1;
}

interface Call { actorKey: string }

async function runWith(
  mission: LeadMissionV1,
  bindings: readonly ResolvedReferentBinding[],
  state: unknown = null,
) {
  const calls: Call[] = [];
  const deps = {
    invoke: (call: CompiledActorCall<unknown>) => {
      calls.push({ actorKey: call.actorKey });
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
  } as unknown as CapabilityEngineDeps;
  const plan = buildCapabilityGraph(mission as never);
  const run = await runCapabilityPlan(
    // deno-lint-ignore no-explicit-any
    deps, { mission, plan, bindings, state, maxCandidates: 25 } as any);
  return { run, calls };
}

/** The binding a resolved "the second company" produces, built by the resolver. */
async function bindingFor(entity: typeof SHOWN[number], partId = "p1") {
  const request = req("research", [{ kind: "prior_result", value: "them" }]);
  request.parts[0].id = partId;
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", [entity], "2026-08-27T10:00:00Z")]);
  assertEquals(bindings.length, 1, "fixture failed to bind");
  return bindings[0];
}

Deno.test("16. a BOUND company reaches the engine already identified", async () => {
  const bound = await bindingFor(SHOWN[1]);
  const { run } = await runWith(missionNaming(["Linear"]), [bound]);

  const seeded = run.capability_outcomes.find(
    (o) => o.capability === "known_company_resolution");
  assertEquals(seeded!.status, "complete");
  assertEquals(seeded!.rows, 1);
  // The seeding capability still buys nothing — that has not changed.
  assertEquals(seeded!.providers_used, []);

  const company = run.companies[0];
  assertEquals(company.company.canonical_domain, "linear.app");
  assertEquals(company.company.linkedin_company_url,
    "https://www.linkedin.com/company/linear");
});

Deno.test("17. THE REDUNDANT IDENTITY LOOKUP IS ELIMINATED", async () => {
  // The claim this whole seam exists to make. An unbound run must pay a
  // LinkedIn company search to find out which "Linear" the mission meant; a
  // bound one must not, because the answer was established deterministically
  // from a result this system itself produced.
  const bound = await bindingFor(SHOWN[1]);

  const unbound = await runWith(missionNaming(["Linear"]), []);
  const withBinding = await runWith(missionNaming(["Linear"]), [bound]);

  const searches = (calls: Call[]) =>
    calls.filter((c) => c.actorKey === "apify_linkedin_company_search").length;

  assert(searches(unbound.calls) > 0,
    "without a binding the name must still be resolved at a price");
  assertEquals(searches(withBinding.calls), 0,
    "a bound company must never be resolved a second time");

  // AND IT IS RESOLVED, not merely unpaid-for. A skipped call that left the
  // company unidentified would be a regression wearing this test's colours.
  const identity = withBinding.run.companies[0].identity;
  assertEquals(identity?.status, "verified_match");
  assertEquals(identity?.linkedin_company_url,
    "https://www.linkedin.com/company/linear");
  assertEquals(identity?.evidence, ["source_supplied_canonical_linkedin_url"]);
});

Deno.test("18. a binding never widens the run past what the mission named", async () => {
  // The mission decides scope. A sidecar that could add a company would be a
  // second authority over what gets investigated — and paid for.
  const other = await bindingFor(SHOWN[2]);
  const { run } = await runWith(missionNaming(["Linear"]), [other]);
  assertEquals(run.companies.length, 1);
  assertFalse(run.companies.some((c) => /vercel/i.test(JSON.stringify(c.company))),
    "a binding matching no named company adds nothing");
});

// ══ 4. CONTINUATION INTEGRITY, THROUGH THE ENGINE ══════════════════════════

Deno.test("19. the same binding resumes the same run", async () => {
  const bound = await bindingFor(SHOWN[1]);
  const first = await runWith(missionNaming(["Linear"]), [bound]);
  const again = await runWith(missionNaming(["Linear"]), [bound], first.run.state);

  const seeded = again.run.capability_outcomes.find(
    (o) => o.capability === "known_company_resolution");
  assertEquals(seeded!.status, "skipped_resumed",
    "the checkpoint must be accepted and its work not re-paid for");
});

Deno.test("20. a DIFFERENT company refuses the checkpoint, on an identical mission", async () => {
  // THE FAILURE THIS EXISTS TO STOP. Both runs carry the same mission and
  // therefore the same `missionHash`: the mission covers company NAMES, and two
  // real companies can share one. Only the binding fingerprint can see the
  // difference.
  const linear = await bindingFor(SHOWN[1]);
  const vercel = await bindingFor(SHOWN[2]);

  const first = await runWith(missionNaming(["Linear"]), [linear]);
  assertEquals(first.run.state.mission_hash.length > 0, true);

  const crossed = await runWith(missionNaming(["Linear"]), [vercel], first.run.state);
  const seeded = crossed.run.capability_outcomes.find(
    (o) => o.capability === "known_company_resolution");
  assertFalse(seeded!.status === "skipped_resumed",
    "a checkpoint for one company must never resume against another");

  // And the two fingerprints genuinely differ while the mission hash does not.
  assertEquals(first.run.state.mission_hash, crossed.run.state.mission_hash);
  assert(first.run.state.binding_fingerprint !== crossed.run.state.binding_fingerprint);
});

Deno.test("21. a checkpoint written before bindings existed still resumes", async () => {
  // Absent on both sides is compatible. Refusing these would strand every run
  // in flight when the binding landed, and every mission that names its own
  // companies forever after.
  const first = await runWith(missionNaming(["Linear"]), []);
  assertEquals(first.run.state.binding_fingerprint, null);

  const again = await runWith(missionNaming(["Linear"]), [], first.run.state);
  const seeded = again.run.capability_outcomes.find(
    (o) => o.capability === "known_company_resolution");
  assertEquals(seeded!.status, "skipped_resumed");
});

Deno.test("22. a run that HAD an identity may not resume without one", async () => {
  // One side present and one absent is a mismatch in both directions: a fixed
  // identity must not be dropped mid-flight, and a run that had none must not
  // acquire one.
  const bound = await bindingFor(SHOWN[1]);
  const first = await runWith(missionNaming(["Linear"]), [bound]);
  const dropped = await runWith(missionNaming(["Linear"]), [], first.run.state);
  const seeded = dropped.run.capability_outcomes.find(
    (o) => o.capability === "known_company_resolution");
  assertFalse(seeded!.status === "skipped_resumed");
});

Deno.test("23. missionHash never learns about bindings", async () => {
  const bound = await bindingFor(SHOWN[1]);
  const a = await runWith(missionNaming(["Linear"]), []);
  const b = await runWith(missionNaming(["Linear"]), [bound]);
  assertEquals(a.run.state.mission_hash, b.run.state.mission_hash,
    "widening the mission hash would invalidate every persisted checkpoint");
  assertEquals(a.run.state.binding_fingerprint, null);
  assert(b.run.state.binding_fingerprint !== null);
});

// ══ 5. TRANSPORT: THE SIDECAR SURVIVES THE PLAN STEP ═══════════════════════

Deno.test("24. the sidecar is read back off a plan step, and validated", async () => {
  const bound = await bindingFor(SHOWN[1]);
  // The JSON round-trip a plan step actually performs.
  const onStep = JSON.parse(JSON.stringify({
    lead_mission: {}, lead_referent_bindings: [bound],
  }));
  const read = readPersistedBindings(onStep, undefined);
  assertEquals(read.length, 1);
  assertEquals(read[0].entity_key, "domain:linear.app");
  assertEquals(await bindingFingerprint(read), await bindingFingerprint([bound]));
});

Deno.test("25. a HALF-READ binding is dropped, never repaired", async () => {
  const bound = await bindingFor(SHOWN[1]);
  const stripped = JSON.parse(JSON.stringify(bound));
  stripped.identity.canonicalDomain = null;
  stripped.identity.linkedinUrl = null;
  assertEquals(readPersistedBindings({ lead_referent_bindings: [stripped] }), [],
    "a binding with no strong identifier proves nothing the name did not");
  assertEquals(readPersistedBindings({ lead_referent_bindings: [{ nonsense: 1 }] }), []);
  assertEquals(readPersistedBindings(null, null), []);
});

// ══ 6. MONITOR CONSUMES THE EXACT BINDING ══════════════════════════════════

Deno.test("26. 'monitor them' watches the bound company, by its identity", async () => {
  const request = req("monitor", [{ kind: "prior_result", value: "them" }]);
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", [SHOWN[1]], "2026-08-27T10:00:00Z")]);

  const plan = planMonitor(request, bindings);
  assertEquals(plan.refusal, null);
  // THE IDENTITY, NOT THE PRONOUN. Without the binding this row would have been
  // created for a company called "them".
  assertEquals(plan.subject!.identifier, "linear.app");
  assertEquals(plan.subject!.label, "Linear");

  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
  // deno-lint-ignore no-explicit-any
  const out = await executeMonitor(db as any, plan, "w1");
  assertEquals(out.created, true);
  assertEquals(inserted[0].identifier, "linear.app");
});

Deno.test("27. an unresolved 'monitor them' creates no subject at all", async () => {
  // A subject for the wrong company is unattended recurring spend. Two
  // plausible candidates must produce a question, not a row.
  const request = req("monitor", [{ kind: "prior_result", value: "them" }]);
  const r = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(r.bindings, []);
  assert(r.failures.length > 0);
  // pilot-chat returns on the failure, so `planMonitor` is never reached with
  // an unbound pronoun — asserted at the call site in test 15.
});

// ══ 7. THE READ SURFACE PERSISTS WHAT IT DISPLAYED ═════════════════════════

Deno.test("28. a watched-company answer is resolvable on the next turn", async () => {
  // The other surface that shows a company list. `identifier` is a domain or a
  // LinkedIn company URL, and which one it is decided by the same resolver the
  // rest of the pipeline uses rather than by a second classifier.
  const shown = [
    { label: "Linear", identifier: "linear.app" },
    { label: "Vercel", identifier: "https://www.linkedin.com/company/vercel" },
  ];
  const set = buildPresentedReferents(
    shown.map((e) => presentedFromIdentifier(e.label, e.identifier)),
    "watched_companies");
  assertEquals(set.entities[0].entity_key, "domain:linear.app");
  assertEquals(set.entities[1].entity_key, "li_id:vercel");

  const r = await resolveAgainstConversation(
    req("research", [{ kind: "prior_result", value: "the second company" }]),
    [{ id: "m1", created_at: "2026-08-27T10:00:00Z",
       metadata: { [PRESENTED_REFERENTS_KEY]: set } }]);
  assertEquals(r.bindings[0].label, "Vercel");
  assertEquals(r.bindings[0].entity_key, "li_id:vercel");
});

// ══ 8. THE WRITERS ACTUALLY WRITE IT ═══════════════════════════════════════

Deno.test("29. both surfaces that display a company list persist referents", async () => {
  // A resolver with nothing to resolve against is the quietest possible
  // failure: every follow-up clarifies, forever, and nothing looks broken.
  const runAgent = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(runAgent.includes("PRESENTED_REFERENTS_KEY"),
    "the lead-results message must carry the set it displayed");
  assert(runAgent.includes("buildPresentedReferents("));

  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assert(pilot.includes("PRESENTED_REFERENTS_KEY"));
  // The read answer persists exactly what the RENDERER listed.
  // The read answer persists exactly what the RENDERER listed — the same call
  // with the same display limit, so a widened list ("show the full list") is
  // persisted at the width it was shown rather than at the old fixed five.
  assert(pilot.includes("presentedCompanies(result, displayLimitFor(plan))"),
    "persistence must read the renderer's own list, at the renderer's own width");
});

// ══ 9. THE PERSON PATH, ON A COMPANY BINDING ═══════════════════════════════

Deno.test("30. 'who should I contact there?' targets the bound company", async () => {
  // The referent is a COMPANY; the request is about PEOPLE. The binding fixes
  // which company's decision-makers are searched, and changes nothing about how
  // they are found or paid for.
  const request: RequestV1 = {
    ...req("research", []),
    parts: [{
      id: "p1", objective: "research",
      subject: {
        entity: "person",
        references: [{ kind: "prior_result", value: "there" }],
        filters: [],
      },
      output: { shape: "records", count: null },
    }],
  };
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", [SHOWN[1]], "2026-08-27T10:00:00Z")]);
  assertEquals(bindings[0].label, "Linear");

  const route = routeRequest(request, { spendAllowed: true, bindings });
  assertEquals(route.kind, "lead_mission");
  // The company travels as a name; the person request is unchanged.
  assertEquals(route.lead!.proposal.known_companies, ["Linear"]);

  // AND THE EXISTING GATES ARE UNTOUCHED. Spend still needs BOTH the objective
  // and the caller's authority, and confirmation is still required.
  assertEquals(route.requires_confirmation, true);
  assertEquals(routeRequest(request, { spendAllowed: false, bindings }).may_spend, false,
    "a binding may never raise spend authority");
});

Deno.test("31. an UNLABELLED subject still contributes a usable name", async () => {
  // The label is what the mission carries into `known_companies`, and a URL
  // cannot go there — `scanProposalForViolations` refuses every one. Falling
  // back to the raw identifier produced exactly that, so the projection had to
  // drop it and the mission was left with the user's pronoun.
  const e = presentedFromIdentifier(null, "https://www.linkedin.com/company/vercel");
  assertEquals(e.label, "vercel");
  assertFalse(String(e.label).includes("/"));

  const request = req("research", [{ kind: "prior_result", value: "them" }]);
  const set = buildPresentedReferents([e], "watched_companies");
  const r = await resolveAgainstConversation(request,
    [{ id: "m1", created_at: "2026-08-27T10:00:00Z",
       metadata: { [PRESENTED_REFERENTS_KEY]: set } }]);
  assertEquals(r.bindings[0].entity_key, "li_id:vercel");

  const route = routeRequest(request, { spendAllowed: true, bindings: r.bindings });
  assertEquals(route.lead!.proposal.known_companies, ["vercel"]);
  assertFalse(/https?:\/\//.test(JSON.stringify(route.lead!.proposal)));
});

// ══ 10. THE SCOPED READ — ONE COMPANY, STILL ZERO SPEND ════════════════════

/** A `signal_events` / `monitoring_subjects` stub that RECORDS its filters. */
function scopedDb(rows: {
  events?: Array<Record<string, unknown>>;
  watched?: Array<Record<string, unknown>>;
}) {
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    queries.push({ table, filters });
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.order = chain;
    q.limit = () => Promise.resolve({
      data: table === "signal_events" ? (rows.events ?? []) : (rows.watched ?? []),
      error: null,
    });
    q.eq = (k: string, v: unknown) => { filters[`eq:${k}`] = v; return q; };
    q.gte = (k: string, v: unknown) => { filters[`gte:${k}`] = v; return q; };
    q.in = (k: string, v: unknown) => { filters[`in:${k}`] = v; return q; };
    return q;
  };
  return { db: { from: (t: string) => build(t) }, queries };
}

async function bindingForRead(entity: typeof SHOWN[number]) {
  const request = req("read", [{ kind: "prior_result", value: "them" }]);
  request.parts[0].objective = "read";
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", [entity], "2026-08-27T10:00:00Z")]);
  return { request, bindings };
}

Deno.test("32. 'what about the second company?' scopes the read to that company", async () => {
  // THE WHOLE FLOW. Displayed list -> persisted set -> lookup -> resolver ->
  // binding -> read plan. Every boundary crossed with the real module on both
  // sides of it.
  const request = req("read", [{ kind: "prior_result", value: "the second company" }]);
  request.parts[0].objective = "read";
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(bindings[0].label, "Linear");

  const plan = planRead(request, bindings);
  assertEquals(plan.target, "company_detail");
  assertEquals(plan.subject!.entity_key, "domain:linear.app");
  assertEquals(plan.subject!.label, "Linear");
  assertEquals(plan.subject!.domain, "linear.app");
  // THE FULL URL, not the schemeless comparison key — the shape every writer
  // and every consumer downstream actually uses.
  assertEquals(plan.subject!.linkedin_url, "https://www.linkedin.com/company/linear");
});

Deno.test("33. the scoped query filters on THIS company, by strong identifier", async () => {
  const { request, bindings } = await bindingForRead(SHOWN[1]);
  const plan = planRead(request, bindings);
  const { db, queries } = scopedDb({
    events: [{ signal_type: "hiring", subject_key: "linear-app",
      occurred_at: "2026-08-20T00:00:00Z" }],
    watched: [],
  });
  // deno-lint-ignore no-explicit-any
  const result = await executeRead(db as any, plan, "w1");
  assertEquals(result!.target, "company_detail");
  assertEquals(result!.counts.total, 1);

  const events = queries.find((q) => q.table === "signal_events")!;
  assertEquals(events.filters["eq:workspace_id"], "w1");
  // THE KEYS THE WRITERS USE: `canonicalSubjectKey(domain ?? linkedinUrl)`.
  assertEquals(events.filters["in:subject_key"],
    ["linear-app", "https-www-linkedin-com-company-linear"]);

  const watch = queries.find((q) => q.table === "monitoring_subjects")!;
  assertEquals(watch.filters["in:identifier"],
    ["linear.app", "https://www.linkedin.com/company/linear"]);
});

Deno.test("34. the scoped read matches on NO name-derived key", async () => {
  // `run-agent` refuses to write a name-derived subject key, for the stated
  // reason that two companies share a word. A READ that matched on one would
  // show another company's evidence under this company's name — a wrong answer
  // rather than a missing one, and only the missing one is recoverable.
  const { request, bindings } = await bindingForRead(SHOWN[1]);
  const plan = planRead(request, bindings);
  assertFalse(plan.subject!.subject_keys.includes("linear"),
    "a bare name must never be a match key");
  for (const k of plan.subject!.subject_keys) {
    assert(/linear-app|linkedin/.test(k), `unexpected match key: ${k}`);
  }
});

Deno.test("35. the scoped answer NAMES the company it is about", async () => {
  const { request, bindings } = await bindingForRead(SHOWN[1]);
  const plan = planRead(request, bindings);
  const { db } = scopedDb({
    events: [{ signal_type: "hiring", occurred_at: "2026-08-20T00:00:00Z" },
             { signal_type: "funding", occurred_at: "2026-08-18T00:00:00Z" }],
    watched: [],
  });
  // deno-lint-ignore no-explicit-any
  const answer = renderReadAnswer(plan, await executeRead(db as any, plan, "w1"));
  assert(answer.includes("Linear"),
    "a scoped answer that does not name its subject is indistinguishable from a workspace-wide one");
  assert(/2 signals/.test(answer));

  // AND AN EMPTY SCOPED READ SAYS SO WITHOUT INVENTING A SEARCH.
  const { db: empty } = scopedDb({ events: [], watched: [] });
  // deno-lint-ignore no-explicit-any
  const none = renderReadAnswer(plan, await executeRead(empty as any, plan, "w1"));
  assert(none.includes("Linear"));
  assert(/haven't gone looking/.test(none), "an empty read must not imply a search ran");
});

Deno.test("36. NO binding leaves the workspace-wide read exactly as it was", async () => {
  // The compatibility half. Every caller that predates the scope, and every
  // request that names no referent, must reach the identical plan.
  const plain = req("read", [{ kind: "named", value: "signals" }]);
  plain.parts[0].objective = "read";
  plain.parts[0].subject.entity = "signal";

  const before = planRead(plain);
  const after = planRead(plain, []);
  assertEquals(before, after);
  assertEquals(before.target, "signals");
  assertEquals(before.subject, null);

  const companies = req("read", []);
  companies.parts[0].objective = "read";
  assertEquals(planRead(companies).target, "companies");
  assertEquals(planRead(companies).subject, null);
});

Deno.test("37. an AMBIGUOUS referent never produces a scoped read — it clarifies", async () => {
  const request = req("read", [{ kind: "prior_result", value: "them" }]);
  request.parts[0].objective = "read";
  const r = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "ambiguous_referent");
  // With no binding the plan cannot be scoped, so there is no path on which an
  // unresolved pronoun reads one company's data. pilot-chat returns before
  // this point regardless — pinned in test 15.
  assertEquals(planRead(request, r.bindings).subject, null);
});

Deno.test("38. GPT cannot scope a read — only a binding can", async () => {
  // A forged `resolved_key` aimed at another company must not steer the scope.
  const request = req("read", [{ kind: "prior_result", value: "the second company",
    resolved_key: "https://www.linkedin.com/company/attacker" }]);
  request.parts[0].objective = "read";
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  const plan = planRead(request, bindings);
  assertEquals(plan.subject!.entity_key, "domain:linear.app");
  assertFalse(/attacker/.test(JSON.stringify(plan)));

  // And with NO binding, the model's key scopes nothing at all.
  assertEquals(planRead(request, []).subject, null);
});

Deno.test("39. a scoped read is STRUCTURALLY unable to spend", async () => {
  // The guarantee is the absence, not a flag. `readSurface` imports no tool
  // registry, no capability engine, no credit path — so there is nothing on
  // this path to invoke, scoped or not. Asserted on the source because that is
  // where the property lives.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/readSurface.ts", import.meta.url));
  const imports = SRC.split("\n").filter((l) => /^import /.test(l)).join("\n");
  assertFalse(/toolRegistry|capabilityExecution|leadCapabilityEngine|credit|apify|invoke/i
    .test(imports), "the read surface must import nothing that can spend");

  const code = SRC.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(/callProvider|runTool|reserveCredits|invoke\(/.test(code));

  // And the route that carries a read still attaches no mission to spend from.
  const request = req("read", [{ kind: "prior_result", value: "the second company" }]);
  request.parts[0].objective = "read";
  const { bindings } = await resolveAgainstConversation(
    request, [resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z")]);
  const route = routeRequest(request, { spendAllowed: true, bindings });
  assertEquals(route.kind, "read");
  assertEquals(route.may_spend, false, "a read may never spend, bound or not");
  assertEquals(route.lead, undefined, "a read route carries no mission to execute");
});

Deno.test("40. after a scoped read, 'them' means THAT company", async () => {
  // The referent chain. Having just been told about one company, "monitor
  // them" must mean that one — not ask which of the three that preceded it.
  const { request, bindings } = await bindingForRead(SHOWN[1]);
  const plan = planRead(request, bindings);
  const scopedSet = buildPresentedReferents([{
    label: plan.subject!.label, name: plan.subject!.label,
    domain: plan.subject!.domain, linkedin_url: plan.subject!.linkedin_url,
  }], "watched_companies");

  const follow = req("monitor", [{ kind: "prior_result", value: "them" }]);
  const r = await resolveAgainstConversation(follow, [
    // The scoped answer is NEWER than the three-company list it came from.
    { id: "m2", created_at: "2026-08-27T11:00:00Z",
      metadata: { [PRESENTED_REFERENTS_KEY]: scopedSet } },
    resultMessage("m1", SHOWN, "2026-08-27T10:00:00Z"),
  ]);
  assertEquals(r.failures, []);
  assertEquals(r.bindings[0].entity_key, "domain:linear.app");
  assertEquals(planMonitor(follow, r.bindings).subject!.identifier, "linear.app");
});

Deno.test("41. pilot-chat passes the bindings to the read, and records the scope", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assert(SRC.includes("planRead(understood.request, resolvedBindings)"),
    "the read surface must receive the bindings the resolver produced");
  assert(SRC.includes("scoped_to: plan.subject?.entity_key ?? null"),
    "which company a read was scoped to must be recoverable afterwards");
});
