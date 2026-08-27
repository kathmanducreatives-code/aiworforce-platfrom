// RESEARCH AND SOURCE ARE DIFFERENT QUESTIONS, ALL THE WAY DOWN.
//
// ── WHAT WAS COLLAPSED, AND WHAT WAS NOT ───────────────────────────────────
//
// Both objectives bind to the same pilot-chat category, which looked like a
// collapse. It was not: the capability graph already separates them by DATA —
// a non-empty `known_companies` enters at `known_company_resolution` and skips
// discovery entirely. That mechanism predates this migration and is reused
// rather than rebuilt.
//
// What WAS genuinely collapsed is the case the data cannot separate: a
// `research` request that names nobody. It produced an empty `known_companies`,
// fell through to `general_company_discovery`, and bought a full discovery run
// to answer a question about one company. That is now refused.
//
// These tests run the REAL chain — projection, the real compiler, the real
// capability graph — because the separation lives in the graph, not in a flag.
//
// Pure. No network, no model, no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestObjective, type RequestReference,
} from "../../../supabase/functions/_shared/requestV1.ts";
import {
  heldEvidenceFor, renderHeldEvidence,
} from "../../../supabase/functions/_shared/researchEvidenceGate.ts";

/** The SAME evidence requirement in both, so only the population differs. */
const HIRING = {
  event: "hiring" as const, subject: "company" as const,
  qualifier: { role_terms: ["salespeople"] }, phrase: "hiring salespeople",
};

const request = (
  objective: RequestObjective, references: RequestReference[], utterance: string,
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance, objective,
  parts: [{
    id: "p1", objective,
    subject: { entity: "company", references },
    requirements: [HIRING],
    output: { shape: "records", count: null },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

/** Project → compile → graph. The real chain, no shortcuts. */
function plan(r: RequestV1) {
  const proj = projectToLeadMission(r);
  if (proj.refusal) return { proj, mission: null, graph: null };
  const compiled = compileLeadMission({
    originalUserQuery: r.utterance, proposal: proj.proposal as never, requestedCount: null,
  });
  return { proj, mission: compiled.final_mission, graph: buildCapabilityGraph(compiled.final_mission) };
}

const VERCEL = [{ kind: "named" as const, value: "Vercel" }];

// ══ 1. "Check whether Vercel is hiring" ════════════════════════════════════

Deno.test("research fixes Vercel and runs ZERO general discovery", () => {
  const { proj, mission, graph } = plan(
    request("research", VERCEL, "Check whether Vercel is hiring salespeople."));
  assertEquals(proj.refusal, null);
  assert(mission && graph);

  // THE IDENTITY IS FIXED.
  assertEquals(mission!.company_profile.known_companies, ["Vercel"]);

  // AND DISCOVERY IS NOT IN THE PLAN AT ALL — not disabled, absent.
  assertEquals(graph!.entry_capability, "known_company_resolution");
  const steps = graph!.steps.map((s) => s.capability);
  assertEquals(steps.some((c) => /discovery/.test(c)), false,
    `no discovery step may exist: ${steps.join(" → ")}`);
});

Deno.test("research still requires the SAME evidence", () => {
  const { graph } = plan(request("research", VERCEL, "Check whether Vercel is hiring salespeople."));
  const steps = graph!.steps.map((s) => s.capability);
  assert(steps.includes("hiring_verification"),
    "a named company is still proven, not assumed");
});

// ══ 2. "Find companies hiring" ═════════════════════════════════════════════

Deno.test("source names nobody and discovery IS available", () => {
  const { mission, graph } = plan(
    request("source", [], "Find companies hiring salespeople."));
  assertEquals(mission!.company_profile.known_companies ?? [], []);
  assertEquals(graph!.entry_capability, "general_company_discovery");
  assert(graph!.steps.map((s) => s.capability).some((c) => /discovery/.test(c)));
});

Deno.test("same evidence requirement, different population semantics", () => {
  // THE POINT OF THE PAIR. Identical `hiring` requirement; the only difference
  // is whether an entity was named — and that changes the entry capability,
  // not the standard of proof.
  const r = plan(request("research", VERCEL, "Check whether Vercel is hiring salespeople."));
  const s = plan(request("source", [], "Find companies hiring salespeople."));

  const evidenceOf = (g: NonNullable<typeof r.graph>) =>
    g.steps.map((x) => x.capability).filter((c) => !/discovery|known_company_resolution/.test(c));
  assertEquals(evidenceOf(r.graph!), evidenceOf(s.graph!),
    "the evidence chain is the same; only the population differs");
  assert(r.graph!.entry_capability !== s.graph!.entry_capability,
    "and the populations are reached differently");
});

// ══ 3. AN UNRESOLVED RESEARCH TARGET SPENDS NOTHING ════════════════════════

Deno.test("research naming nobody is REFUSED, not turned into discovery", () => {
  // The measured collapse: "Check whether they're hiring" with no resolved
  // reference produced `entry: general_company_discovery` and a discovery step
  // — a full discovery run to answer a question about one company.
  const { proj, graph } = plan(
    request("research", [], "Check whether they're hiring salespeople."));
  assertEquals(proj.refusal, "research_without_identity");
  assertEquals(graph, null, "nothing is planned for a nameless research request");
});

Deno.test("the router clarifies with zero spend, and asks the right question", () => {
  const route = routeRequest(
    request("research", [], "Check whether they're hiring salespeople."),
    { spendAllowed: true, confirmationRequired: true });
  assertEquals(route.kind, "clarify");
  assertEquals(route.may_spend, false);
  assertEquals(route.lead, undefined, "nothing is projected");
  assert(/which company/i.test(route.message ?? ""), route.message ?? "");
  assertEquals(route.reason, "lead_projection_refused:research_without_identity");
});

Deno.test("a referent contributes its NAME; a resolved URL must not enter the proposal", () => {
  // MEASURED, NOT ASSUMED. `scanProposalForViolations` refuses any url anywhere
  // in a proposal — the same scan that blocks actor references and vendor names
  // — so passing a resolved LinkedIn key is a fatal compilation error
  // (`url:known_companies[0]`), not a nicety.
  //
  // Passing the name is also correct pipeline behaviour: resolving a named
  // company to an identity is what `known_company_resolution` exists for, and
  // it is the entry capability for exactly these missions.
  const { proj, mission, graph } = plan(request("research", [{
    kind: "prior_result", value: "Vercel",
    resolved_key: "https://www.linkedin.com/company/vercel",
  }], "Research them."));
  assertEquals(proj.refusal, null, "a referent with a resolved key still compiles");
  assertEquals(mission!.company_profile.known_companies, ["Vercel"]);
  assertEquals(graph!.entry_capability, "known_company_resolution",
    "and the identity is still fixed — discovery is skipped");
  for (const c of mission!.company_profile.known_companies ?? []) {
    assertEquals(/^https?:\/\//.test(c), false, "no url reaches the mission");
  }
});

// ══ 4. FRESH EVIDENCE IS REUSED BEFORE ANYTHING IS BOUGHT ══════════════════

/**
 * A query chain that is awaitable at every link.
 *
 * The first version returned a plain object from each method, so awaiting the
 * end of the chain yielded `undefined` and every evidence test failed for a
 * reason that had nothing to do with the gate.
 */
const evidenceDb = (rows: Array<Record<string, unknown>>) => {
  const make = (): Record<string, unknown> => {
    const p = Promise.resolve({ data: rows });
    const chain = Object.assign(p, {}) as unknown as Record<string, unknown>;
    for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
    return chain;
  };
  return { from: () => make() };
};
const NOW = "2026-08-27T00:00:00.000Z";
const daysAgo = (d: number) =>
  new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

Deno.test("current evidence makes the run unnecessary", async () => {
  const held = await heldEvidenceFor(
    evidenceDb([{ signal_type: "sales_hiring", occurred_at: daysAgo(2),
      expires_at: null, source_url: "https://x", subject_key: "vercel" }]) as never,
    "ws", ["vercel"], ["hiring"], NOW);
  assertEquals(held.sufficient, true);
  assertEquals(held.missing, []);
  assert(renderHeldEvidence("Vercel", held).includes("already have current evidence"));
});

Deno.test("stale evidence does NOT stand in for a fresh answer", async () => {
  // The whole point of `research` is freshness. Reusing an expired record
  // would answer a question about now with a fact about then.
  const held = await heldEvidenceFor(
    evidenceDb([{ signal_type: "sales_hiring", occurred_at: daysAgo(400),
      expires_at: null, source_url: null, subject_key: "vercel" }]) as never,
    "ws", ["vercel"], ["hiring"], NOW);
  assertEquals(held.sufficient, false);
  assertEquals(held.missing, ["hiring"]);
  assertEquals(held.stale, 1, "and the stale record is reported, not hidden");
});

Deno.test("partial coverage still runs, for the part that is missing", async () => {
  const held = await heldEvidenceFor(
    evidenceDb([{ signal_type: "sales_hiring", occurred_at: daysAgo(1),
      expires_at: null, source_url: null, subject_key: "vercel" }]) as never,
    "ws", ["vercel"], ["hiring", "funding"], NOW);
  assertEquals(held.sufficient, false);
  assertEquals(held.missing, ["funding"]);
});

Deno.test("an unreadable table fails TOWARD spending", async () => {
  // Treating a query error as proof we already know would answer a paid
  // question with silence.
  const broken = { from: () => { throw new Error("down"); } };
  const held = await heldEvidenceFor(broken as never, "ws", ["vercel"], ["hiring"], NOW);
  assertEquals(held.sufficient, false);
  assertEquals(held.missing, ["hiring"]);
});

Deno.test("evidence is matched on resolved identity, never on a name", async () => {
  const held = await heldEvidenceFor(
    evidenceDb([]) as never, "ws", [], ["hiring"], NOW);
  assertEquals(held.sufficient, false, "no identity means no held answer");
});

Deno.test("the gate owns no freshness policy of its own", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/researchEvidenceGate.ts", import.meta.url));
  const code = SRC.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assert(code.includes("isSignalFresh"), "staleness comes from signalFreshness");
  assertEquals(/DAYS\(|windowHours\s*[:=]|86_?400/.test(code), false,
    "a second staleness rule would drift from the first");
});

// ══ 5. THE CALL SITE ═══════════════════════════════════════════════════════

Deno.test("pilot-chat checks held evidence only for a NAMED investigation", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = SRC.indexOf("heldEvidenceFor(");
  assert(i > 0, "the gate must be wired");
  const block = SRC.slice(Math.max(0, i - 1200), i + 1200);
  assert(block.includes('brainRoute.reason === "named_entity_investigation"'),
    "a discovery run must not be skipped because one company has evidence");
  assert(block.includes("held.sufficient"), "and only sufficient evidence short-circuits");
  assert(block.includes("return json("), "a served-from-evidence answer stops there");
});
