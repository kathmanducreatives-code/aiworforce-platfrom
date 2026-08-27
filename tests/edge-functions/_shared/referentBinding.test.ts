// WHICH REAL COMPANY "THEM" MEANT — AND HOW THAT SURVIVES A RESUME.
//
// ── THE ARCHITECTURE THESE TESTS DEFEND ────────────────────────────────────
//
// Identity travels BESIDE the mission, never inside it. The mission carries the
// safe semantic label ("Vercel"), which is what `known_company_resolution`
// already expects; the exact identity travels as a binding. Two properties make
// that necessary rather than stylistic:
//
//   `scanProposalForViolations` refuses ANY url in a proposal — the same scan
//   that blocks actor references and vendor names — so a resolved LinkedIn key
//   cannot go in `known_companies` without weakening it.
//
//   `missionHash` is computed from the compiled mission, so mutating the
//   mission afterwards either changes checkpoint identity silently or leaves a
//   hash describing a different question than its contents.
//
// Pure. No network, no model, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveReferents, bindingFingerprint, bindingsMatchCheckpoint,
  REFERENT_BINDING_VERSION, type ReferentSource, type ResolvedReferentBinding,
} from "../../../supabase/functions/_shared/referentBinding.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestObjective, type RequestReference,
} from "../../../supabase/functions/_shared/requestV1.ts";
import {
  newExecutionState, stateMatchesMission,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

const req = (
  objective: RequestObjective, references: RequestReference[], utterance = "u",
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance, objective,
  parts: [{ id: "p1", objective, subject: { entity: "company", references },
    output: { shape: "records", count: null } }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

const VERCEL = { label: "Vercel", name: "Vercel", domain: "vercel.com",
  linkedin_url: "https://www.linkedin.com/company/vercel", location: "US" };
const LINEAR = { label: "Linear", name: "Linear", domain: "linear.app",
  linkedin_url: "https://www.linkedin.com/company/linear", location: "US" };
const src = (entities: typeof VERCEL[]): ReferentSource =>
  ({ message_id: "m1", entities });

// ══ 1. RESOLUTION ══════════════════════════════════════════════════════════

Deno.test("a bare pronoun binds when there is exactly one prior result", () => {
  const r = resolveReferents(req("monitor", [{ kind: "prior_result", value: "them" }]),
    src([VERCEL]));
  assertEquals(r.failures, []);
  assertEquals(r.bindings.length, 1);
  const b = r.bindings[0];
  assertEquals(b.entity_type, "company");
  assertEquals(b.label, "Vercel");
  assertEquals(b.status, "verified_match");
  assertEquals(b.source.message_id, "m1");
  assertEquals(b.source.result_index, 0);
});

Deno.test("an ordinal selects the exact prior result", () => {
  // "the second company" is a position in what the user was SHOWN. Getting it
  // wrong acts on a company they did not point at.
  const r = resolveReferents(
    req("research", [{ kind: "prior_result", value: "the second company" }]),
    src([VERCEL, LINEAR]));
  assertEquals(r.failures, []);
  assertEquals(r.bindings[0].label, "Linear");
  assertEquals(r.bindings[0].source.result_index, 1);
});

Deno.test("the strongest identifier becomes the canonical key", () => {
  // Reuses `resolveCompanyIdentity`, whose ranking is domain > linkedin id >
  // linkedin url > name+location. Re-modelling identity here would create a
  // second answer to "is this the same company".
  const b = resolveReferents(req("monitor", [{ kind: "prior_result", value: "them" }]),
    src([VERCEL])).bindings[0];
  assertEquals(b.entity_key, "domain:vercel.com");
  assertEquals(b.identity.dedupeKeyKind, "domain");
  assertEquals(b.identity.linkedinCompanyId, "vercel");
});

// ══ 2. AMBIGUITY AND FAILURE — NEVER A NEAREST-NAME GUESS ══════════════════

Deno.test("two candidates and a bare pronoun CLARIFY rather than pick", () => {
  const r = resolveReferents(req("monitor", [{ kind: "prior_result", value: "them" }]),
    src([VERCEL, LINEAR]));
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "ambiguous_referent");
  assert(r.failures[0].question.length > 0);
});

Deno.test("an out-of-range ordinal clarifies", () => {
  const r = resolveReferents(
    req("research", [{ kind: "prior_result", value: "the fifth one" }]), src([VERCEL]));
  assertEquals(r.failures[0].reason, "ordinal_out_of_range");
});

Deno.test("no prior results clarifies", () => {
  const r = resolveReferents(req("monitor", [{ kind: "prior_result", value: "them" }]), null);
  assertEquals(r.failures[0].reason, "no_prior_results");
});

Deno.test("a name that matches nothing is NEVER resolved to the nearest", () => {
  // Nearest-name is how a follow-up ends up investigating a company the user
  // never mentioned.
  const r = resolveReferents(
    req("research", [{ kind: "prior_result", value: "Verceld" }]),
    src([VERCEL, LINEAR]));
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "ambiguous_referent");
});

Deno.test("an entity with no strong identifier is not actionable", () => {
  // `name_location` and `none` are the weak kinds. Binding one would claim a
  // certainty we do not have, and the pipeline would have had to resolve the
  // name anyway.
  const r = resolveReferents(req("monitor", [{ kind: "prior_result", value: "them" }]),
    src([{ label: "Acme" } as never]));
  assertEquals(r.bindings, []);
  assertEquals(r.failures[0].reason, "unidentifiable_entity");
});

Deno.test("a forward-looking reference is not a referent", () => {
  // `named` points at the world, not at a prior result. Only backward-pointing
  // references are bound.
  const r = resolveReferents(req("research", [{ kind: "named", value: "Vercel" }]),
    src([LINEAR]));
  assertEquals(r.bindings, []);
  assertEquals(r.failures, []);
});

// ══ 3. GPT CANNOT CREATE OR MODIFY A BINDING ═══════════════════════════════

Deno.test("bindings are built only from prior results, never from the request", () => {
  // The model says a reference EXISTS; it never says what it resolves to. A
  // request carrying a resolved_key must not be able to assert an identity.
  const r = resolveReferents(req("monitor", [{
    kind: "prior_result", value: "them",
    resolved_key: "https://www.linkedin.com/company/attacker",
  }]), src([VERCEL]));
  assertEquals(r.bindings[0].entity_key, "domain:vercel.com",
    "the resolved key came from the prior result, not the request");
  assertEquals(r.bindings[0].identity.linkedinCompanyId, "vercel");
});

Deno.test("the resolver reads no model output", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/referentBinding.ts", import.meta.url));
  const imports = SRC.split("\n").filter((l) => /^import\s/.test(l)).join("\n");
  for (const forbidden of ["chatBrain", "gptProvider", "gptModelRouter"]) {
    assertEquals(imports.includes(forbidden), false, `must not import ${forbidden}`);
  }
});

// ══ 4. INTEGRITY — A CHECKPOINT FOR A MUST NOT RESUME AGAINST B ════════════

const bindingFor = (e: typeof VERCEL): ResolvedReferentBinding =>
  resolveReferents(req("research", [{ kind: "prior_result", value: "them" }]),
    src([e])).bindings[0];

Deno.test("different companies produce different fingerprints", async () => {
  const a = await bindingFingerprint([bindingFor(VERCEL)]);
  const b = await bindingFingerprint([bindingFor(LINEAR)]);
  assert(a && b && a !== b, "identity must change the fingerprint");
});

Deno.test("no bindings is null — every pre-binding checkpoint stays resumable", async () => {
  assertEquals(await bindingFingerprint([]), null);
  assert(bindingsMatchCheckpoint(null, null), "absent on both sides is compatible");
  assert(bindingsMatchCheckpoint(undefined, null), "a legacy state has no field at all");
});

Deno.test("provenance does not change identity", async () => {
  // Where a binding came from is auditing, not identity. Re-resolving the same
  // company from a different message must not read as a different question.
  const one = bindingFor(VERCEL);
  const other: ResolvedReferentBinding = {
    ...one, label: "vercel inc", source: { message_id: "m99", result_index: 7, kind: "saved_set" },
  };
  assertEquals(await bindingFingerprint([one]), await bindingFingerprint([other]));
});

Deno.test("A CHECKPOINT FOR COMPANY A DOES NOT RESUME AGAINST COMPANY B", async () => {
  // THE CENTRAL INTEGRITY CLAIM. Both requests say "them", both compile to the
  // same mission — `missionHash` covers company NAMES and cannot see the
  // difference. The binding fingerprint can.
  const mission = parseLeadMissionDeterministic("Check whether they are hiring");
  const graph = buildCapabilityGraph(mission);
  const hash = "same-mission-hash";

  const aPrint = await bindingFingerprint([bindingFor(VERCEL)]);
  const bPrint = await bindingFingerprint([bindingFor(LINEAR)]);

  const checkpoint = newExecutionState(graph, hash, aPrint);
  assertEquals(checkpoint.binding_fingerprint, aPrint);

  assert(stateMatchesMission(checkpoint, hash, aPrint),
    "the same company resumes its own checkpoint");
  assertEquals(stateMatchesMission(checkpoint, hash, bPrint), false,
    "a different company must NOT resume it, despite an identical mission hash");
  assertEquals(stateMatchesMission(checkpoint, hash, null), false,
    "a run that had a fixed identity must not resume without one");
});

Deno.test("a run WITHOUT bindings is unaffected by any of this", async () => {
  const mission = parseLeadMissionDeterministic("Find 5 SaaS companies hiring SDRs");
  const graph = buildCapabilityGraph(mission);
  const legacy = newExecutionState(graph, "h");
  assertEquals(legacy.binding_fingerprint, null);
  assert(stateMatchesMission(legacy, "h"), "the pre-binding call signature still works");
  assert(stateMatchesMission(legacy, "h", null));
  assertEquals(stateMatchesMission(legacy, "h", await bindingFingerprint([bindingFor(VERCEL)])),
    false, "and a run with none must not acquire an identity mid-flight");
});

Deno.test("the mission hash itself is untouched by bindings", async () => {
  // Changing what `missionHash` covers would invalidate every persisted
  // checkpoint in the system at once. It is deliberately not extended.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadMission.ts", import.meta.url));
  const i = SRC.indexOf("export async function missionHash");
  const block = SRC.slice(i, i + 700);
  assertEquals(/binding/i.test(block), false,
    "missionHash must not learn about bindings");
  assertEquals(REFERENT_BINDING_VERSION, "referent-binding-v1");
});
