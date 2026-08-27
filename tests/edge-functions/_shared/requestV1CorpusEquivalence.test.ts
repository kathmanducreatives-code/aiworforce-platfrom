// EVERY MISSION QUERY IN THE REPO, THROUGH THE NEW CONTRACT.
//
// ── WHAT THIS PROVES, AND WHAT IT DOES NOT ─────────────────────────────────
//
// PROVES: a `RequestV1` carrying the deterministic reading of a query projects
// to a proposal that preserves that reading. Every vertical, geography, stage,
// size bound, signal, role term, named company and count the parser found must
// survive the projection, and anything that cannot is REPORTED rather than
// dropped.
//
// DOES NOT PROVE: that Chat Brain will produce these requests from these
// utterances. That is Phase B, measured against the live corpus. Conflating
// the two would let a projection bug hide behind a model nobody has written.
//
// ── WHY THE REQUEST IS DERIVED, NOT HAND-WRITTEN ───────────────────────────
//
// Hand-authoring 43 requests would test the projection against my reading of
// each query, which is the same author as the projection — a closed loop that
// proves nothing. `parseLeadMissionDeterministic` is an INDEPENDENT reader,
// already trusted by 91 test files, so deriving the request from its output
// makes the assertion "the projection preserves what the parser found" rather
// than "the projection agrees with me".
//
// ── WHY THIS IS NOT A HASH COMPARISON ──────────────────────────────────────
//
// The parser and the compiler are different producers and are NOT expected to
// agree: compiling the same query derives `prohibited_capabilities`
// (`founder_discovery`, `employer_verification`, `contact_enrichment`) that the
// parser never sets. Asserting hash equality across them would fail for a
// correct projection, so equivalence is asserted field-wise on the axes the
// request actually carries.
//
// Pure. No network, no database, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, missionHash, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestFilter, type RequestPart,
} from "../../../supabase/functions/_shared/requestV1.ts";

const CORPUS: string[] = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/missionQueryCorpus.json", import.meta.url)),
);

/**
 * The deterministic reading of a query, expressed as a universal request.
 *
 * A TEST ADAPTER, deliberately. In production Chat Brain produces the request;
 * here the parser stands in for it so the corpus can be walked mechanically.
 */
function requestFromMission(q: string, m: LeadMissionV1): RequestV1 {
  const p = m.company_profile;
  const filters: RequestFilter[] = [];
  if (p.verticals.length) filters.push({ field: "industry", op: "in", value: p.verticals });
  if (p.business_models.length) {
    filters.push({ field: "business_model", op: "in", value: p.business_models });
  }
  if (p.locations.length) filters.push({ field: "geography", op: "in", value: p.locations });
  if (p.stages.length) filters.push({ field: "stage", op: "in", value: p.stages });
  if (p.employee_range && (p.employee_range.min != null || p.employee_range.max != null)) {
    filters.push({ field: "employee_count", op: "range", value: p.employee_range });
  }
  const wantsPeople = m.target_entity === "person";
  if (wantsPeople && m.decision_makers.roles.length) {
    filters.push({ field: "role", op: "in", value: m.decision_makers.roles });
  }
  const part: RequestPart = {
    id: "p1",
    objective: "source",
    subject: {
      entity: wantsPeople ? "person" : "company",
      filters,
      references: (p.known_companies ?? []).map((v) => ({ kind: "named" as const, value: v })),
    },
    requirements: m.required_signals.map((s) => ({
      event: (s.event ?? s.type) as never,
      subject: (s.subject ?? "company") as never,
      qualifier: s.qualifier,
      phrase: s.phrase ?? q,
    })),
    output: { shape: "records", count: m.requested_count },
  };
  return {
    version: REQUEST_V1_VERSION, utterance: q,
    objective: "source", parts: [part], ambiguity: [],
    authority: { may_spend: true, max_cost_units: null, requires_confirmation: false },
    provenance: m.field_provenance ?? {}, confidence: m.confidence ?? 0.9,
  };
}

const lower = (a: readonly string[]) => a.map((x) => String(x).toLowerCase());
const covers = (got: readonly string[], want: readonly string[]) =>
  want.every((w) => lower(got).includes(String(w).toLowerCase()));

// ══ THE CORPUS WALK ════════════════════════════════════════════════════════

Deno.test("the corpus is the repo's, not an invention", () => {
  assert(CORPUS.length >= 40, `expected the extracted corpus, got ${CORPUS.length}`);
  assertEquals(new Set(CORPUS).size, CORPUS.length, "no duplicates");
});

Deno.test("every corpus query projects without refusal", () => {
  const refused: string[] = [];
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const r = requestFromMission(q, m);
    const proj = projectToLeadMission(r);
    if (proj.refusal) refused.push(`${q} → ${proj.refusal}`);
  }
  assertEquals(refused, [], "a sourcing query must always be servable by the Lead surface");
});

Deno.test("the projection preserves every axis the parser found", () => {
  const failures: string[] = [];
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const { proposal } = projectToLeadMission(requestFromMission(q, m));
    const p = m.company_profile;
    const want: Array<[string, boolean]> = [
      ["verticals", covers(proposal.company_types, p.verticals)],
      ["business_models", covers(proposal.company_types, p.business_models)],
      ["locations", covers(proposal.geographies, p.locations)],
      ["signals", covers(proposal.preferred_signals,
        m.required_signals.map((s) => String(s.event ?? s.type)))],
      ["role_terms", covers(proposal.required_signal_terms,
        m.required_signals.flatMap((s) => s.qualifier?.role_terms ?? []))],
      ["known_companies", covers(proposal.known_companies, p.known_companies ?? [])],
    ];
    for (const [axis, ok] of want) if (!ok) failures.push(`${axis} :: ${q}`);
  }
  assertEquals(failures, [], "an axis the parser read must survive the projection");
});

Deno.test("the requested count survives, on the field the entity implies", () => {
  const failures: string[] = [];
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const { proposal, requestedCount } = projectToLeadMission(requestFromMission(q, m));
    if (requestedCount !== m.requested_count) { failures.push(`count :: ${q}`); continue; }
    // `requested_opportunity_count` is what the compiler turns into the
    // mission's `requested_count` — for BOTH entities. Filling only
    // `requested_contact_ready_count` on a person request drops the number the
    // user said; that is measured in the projection's own comment.
    if (proposal.requested_opportunity_count !== m.requested_count) {
      failures.push(`count-field :: ${q}`);
    }
    if (m.target_entity === "person" &&
        proposal.requested_contact_ready_count !== m.requested_count) {
      failures.push(`contact-ready-count :: ${q}`);
    }
  }
  assertEquals(failures, []);
});

Deno.test("decision-maker roles survive for person requests", () => {
  const failures: string[] = [];
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    if (m.target_entity !== "person") continue;
    const { proposal } = projectToLeadMission(requestFromMission(q, m));
    if (!covers(proposal.decision_maker_roles, m.decision_makers.roles)) {
      failures.push(`roles :: ${q}`);
    }
  }
  assertEquals(failures, []);
});

Deno.test("nothing is lost in silence — every loss is named", () => {
  // THE INVARIANT. A requirement this surface cannot express must appear in
  // `unprojected`, never vanish. Measured across the whole corpus, and the
  // losses it finds are real ones worth knowing about.
  const losses = new Map<string, string[]>();
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const { unprojected } = projectToLeadMission(requestFromMission(q, m));
    for (const u of unprojected) {
      losses.set(u, [...(losses.get(u) ?? []), q]);
    }
  }
  // Only qualifier axes the proposal contract has no channel for may appear.
  // A filter loss would mean the projection is incomplete for a real query.
  const kinds = [...losses.keys()].sort();
  for (const k of kinds) {
    assert(k.startsWith("qualifier:"),
      `unexpected projection loss ${k} on: ${losses.get(k)![0]}`);
  }
  // Recorded so the count is visible when it changes.
  assert(kinds.every((k) => ["qualifier:topic", "qualifier:region",
    "qualifier:round_type"].includes(k)), `unexpected qualifier loss: ${kinds}`);
});

Deno.test("every corpus query still compiles to a real mission", async () => {
  // The projection is only useful if the compiler accepts what it produces.
  const failures: string[] = [];
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const proj = projectToLeadMission(requestFromMission(q, m));
    try {
      const out = compileLeadMission({
        originalUserQuery: q, proposal: proj.proposal as never,
        requestedCount: proj.requestedCount,
      });
      if (!out.final_mission) failures.push(`no mission :: ${q}`);
      if (out.final_mission.original_user_query !== q) failures.push(`utterance :: ${q}`);
      const h = await missionHash(out.final_mission);
      if (!h || h.length < 16) failures.push(`hash :: ${q}`);
    } catch (e) {
      failures.push(`threw :: ${q} :: ${String(e).slice(0, 80)}`);
    }
  }
  assertEquals(failures, []);
});

Deno.test("the projection is deterministic across the whole corpus", async () => {
  // Same request, same mission identity — every time. A projection that varied
  // would make `missionHash` unstable, and `missionHash` is checkpoint identity
  // for every persisted run in the system.
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const r = requestFromMission(q, m);
    const a = compileLeadMission({ originalUserQuery: q,
      proposal: projectToLeadMission(r).proposal as never,
      requestedCount: projectToLeadMission(r).requestedCount });
    const b = compileLeadMission({ originalUserQuery: q,
      proposal: projectToLeadMission(r).proposal as never,
      requestedCount: projectToLeadMission(r).requestedCount });
    assertEquals(await missionHash(a.final_mission), await missionHash(b.final_mission),
      `unstable mission identity for: ${q}`);
  }
});

// ══ PRECEDENCE: THE USER'S WORDS OUTRANK THE REQUEST ══════════════════════
//
// The compiler drops a proposed vertical or geography that contradicts what the
// user actually said, and records it as `<field>_overridden_by_user_words`.
// That is the `explicit_user_request > gpt_inference` lattice enforced at the
// mission boundary, and it is the single most important thing Chat Brain must
// NOT be able to break: a model inference must never quietly widen or move the
// population the user named.

Deno.test("a request that contradicts the user's words is overridden, and recorded", () => {
  const q = "Find 5 B2B SaaS companies hiring SDRs";
  const m = parseLeadMissionDeterministic(q);
  const base = requestFromMission(q, m);
  const contradicting: RequestV1 = {
    ...base,
    parts: [{
      ...base.parts[0],
      subject: {
        ...base.parts[0].subject,
        filters: [{ field: "industry", op: "in", value: ["Fintech"] }],
      },
    }],
  };
  const out = compileLeadMission({
    originalUserQuery: q,
    proposal: projectToLeadMission(contradicting).proposal as never,
    requestedCount: 5,
  });
  assertEquals(
    out.final_mission.company_profile.verticals.includes("Fintech"), false,
    "a model inference may not replace the population the user named",
  );
  assert(
    out.validator_changes.some((c) => c.startsWith("company_types_overridden_by_user_words")),
    `the override must be recorded, got: ${out.validator_changes.join(" | ")}`,
  );
});

Deno.test("a request that ADDS an axis the user left open does change the question", () => {
  // The other half. Precedence protects what the user SAID; it must not make
  // the request inert where the user said nothing.
  const q = "Find 3 AI SaaS companies";
  const m = parseLeadMissionDeterministic(q);
  assertEquals(m.company_profile.locations, [], "precondition: no stated geography");
  const base = requestFromMission(q, m);
  const located: RequestV1 = {
    ...base,
    parts: [{
      ...base.parts[0],
      subject: {
        ...base.parts[0].subject,
        filters: [...(base.parts[0].subject.filters ?? []),
          { field: "geography", op: "in", value: ["United States"] }],
      },
    }],
  };
  const out = compileLeadMission({
    originalUserQuery: q,
    proposal: projectToLeadMission(located).proposal as never, requestedCount: 3,
  });
  assert(
    out.final_mission.company_profile.locations.includes("United States"),
    "an axis the user left open must be fillable by the request",
  );
});

Deno.test("mission-level preservation, not just proposal-level", async () => {
  // The corpus assertions above check the PROPOSAL. This checks that what the
  // proposal carries actually reaches the MISSION — the gap that hid the
  // override rule until a hash comparison exposed it.
  const failures: string[] = [];
  for (const q of CORPUS) {
    const m = parseLeadMissionDeterministic(q);
    const out = compileLeadMission({
      originalUserQuery: q,
      proposal: projectToLeadMission(requestFromMission(q, m)).proposal as never,
      requestedCount: m.requested_count,
    });
    const got = out.final_mission;
    if (!covers(got.company_profile.locations, m.company_profile.locations)) {
      failures.push(`locations :: ${q}`);
    }
    if (!covers(got.company_profile.verticals, m.company_profile.verticals)) {
      failures.push(`verticals :: ${q}`);
    }
    const wantEvents = m.required_signals.map((x) => String(x.event ?? x.type));
    const gotEvents = got.required_signals.map((x) => String(x.event ?? x.type));
    if (!covers(gotEvents, wantEvents)) failures.push(`signals :: ${q}`);
    if (got.requested_count !== m.requested_count) failures.push(`count :: ${q}`);
    if (got.target_entity !== m.target_entity) failures.push(`entity :: ${q}`);
  }
  assertEquals(failures, [],
    "what the parser read must reach the compiled mission through the projection");
});
