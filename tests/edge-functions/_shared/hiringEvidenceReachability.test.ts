// A MISSION MAY NOT REQUIRE A SIGNAL NOTHING IN ITS PLAN CAN PROVE.
//
// From the real compiled mission behind conversation bcbabb10, query:
//   "Find companies matching my ICP that are actively hiring sales roles."
//
// The plan it produced was:
//   general_company_discovery -> company_identity_resolution ->
//   company_enrichment -> company_brain_qualification -> persistence
//
// with no hiring stage. That was not a UI summary problem — `hiring_verification`
// was genuinely absent, and appeared in `prohibited_capabilities` only because
// pilot-chat sets that field to `plan.prohibited`, the complement of what was
// scheduled.
//
// Two independent defects produced it, and this file pins both.
//
//   A. The graph relied on FREE embedded hiring evidence, because the model
//      asked for `embedded_hiring_evidence` (which maps to no internal stage —
//      it is the free branch inside `hiring_verification`). Of the providers
//      actually scheduled, only the YC actor produces `isHiring`/`openJobs[]`,
//      and it is `cohort_scope: "y_combinator"` while this mission's own entry
//      reason is "outside startup cohorts". Non-YC companies would arrive with
//      no hiring evidence at all, and nothing was scheduled to fill the gap.
//
//   B. The role qualifier was severed from the signal. The model wrote
//      `preferred_signals: ["sales roles", "actively hiring"]` — one
//      requirement in two fragments — and the compiler maps each fragment
//      independently, so "sales roles" became an unrecognised verbatim type
//      and "actively hiring" became a hiring signal with NO role_terms.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { evidenceCoversPopulation } from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";
import { readSignalPhrase } from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import { readSignalPhrases } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { validateLeadMission } from "../../../supabase/functions/_shared/leadMission.ts";

const REAL = JSON.parse(
  Deno.readTextFileSync(new URL("./fixtures/missionHiringSalesRoles.json", import.meta.url)),
);

const caps = (m: unknown) =>
  buildCapabilityGraph(m as never).steps.map((s) => s.capability);

// ── A. the requirement must be reachable ───────────────────────────────────

Deno.test("the real hiring mission schedules a stage that can prove hiring", () => {
  assert(
    caps(REAL).includes("hiring_verification"),
    "the mission requires hiring evidence and no scheduled discovery provider " +
      "supplies it for this population, so verification must be scheduled; " +
      `got: ${caps(REAL).join(" -> ")}`,
  );
});

Deno.test("the YC actor does not cover a non-startup-cohort mission", () => {
  const yc = ["apify_yc_companies_memo23"];
  assert(
    evidenceCoversPopulation(yc, "hiring", "company", "y_combinator"),
    "it does cover a mission scoped to YC",
  );
  assert(
    !evidenceCoversPopulation(yc, "hiring", "company", null),
    "it must NOT count as coverage for an unrestricted population",
  );
});

Deno.test("providers that prove nothing never count as embedded coverage", () => {
  const barren = ["apify_yc_companies_solidcode", "apify_linkedin_company_search",
    "apify_linkedin_company_details"];
  assertEquals(evidenceCoversPopulation(barren, "hiring", "company", null), false);
});

// ── the two behaviours this fix must NOT break ─────────────────────────────

Deno.test("a mission with no hiring signal still buys no hiring verification", () => {
  // The partner-fit regression: "hiring" appearing nowhere must stay unscheduled.
  const noHiring = { ...REAL, required_signals: [] };
  assertEquals(caps(noHiring).includes("hiring_verification"), false);
});

Deno.test("a startup-cohort mission still takes hiring evidence for free", () => {
  // Entry becomes startup_company_discovery, whose YC provider genuinely
  // carries openJobs[] for exactly the companies it discovers.
  const ycMission = {
    ...REAL,
    company_profile: { ...REAL.company_profile, stages: ["yc"] },
    required_capabilities: [
      "startup_company_discovery", "company_identity_resolution",
      "company_enrichment", "company_brain_qualification", "persistence",
    ],
  };
  const plan = buildCapabilityGraph(ycMission as never);
  assertEquals(plan.entry_capability, "startup_company_discovery");
  assertEquals(
    plan.steps.map((s) => s.capability).includes("hiring_verification"), false,
    "embedded YC evidence covers this population; a paid search would be waste",
  );
});

// ── B. the role qualifier must survive compilation ─────────────────────────

Deno.test("the reader can read the whole requirement", () => {
  // Not a claim about the compiler — a statement of what the reader already
  // does correctly, which is why fragmenting the phrase is the defect.
  const whole = readSignalPhrase("actively hiring sales roles");
  assertEquals(whole?.type, "hiring");
  assertEquals(whole?.qualifier?.role_terms, ["sales roles"]);
  assertEquals(readSignalPhrase("sales roles"), null);
});

Deno.test("the model's two fragments rejoin into one qualified hiring signal", () => {
  // The exact `preferred_signals` the model produced for this query.
  const sigs = readSignalPhrases(["sales roles", "actively hiring"]);
  assertEquals(sigs.length, 1, "one requirement, not two");
  assertEquals(sigs[0].type, "hiring");
  assertEquals(
    (sigs[0].qualifier as Record<string, unknown>).role_terms, ["sales roles"],
    "the run must verify SALES hiring, not hiring in general",
  );
  assertEquals(
    sigs.some((x) => x.type === "sales roles"), false,
    "'sales roles' is not a signal type; it is a qualifier of the hiring signal",
  );
});

Deno.test("genuinely distinct signals are still kept apart", () => {
  // The merge must not collapse independent requirements into one.
  const sigs = readSignalPhrases(["recently funded", "actively hiring"]);
  assertEquals(sigs.length, 2);
  assertEquals(new Set(sigs.map((x) => x.type)), new Set(["funding", "hiring"]));
});

Deno.test("a fragment with no readable signal to host it stays unrecognised", () => {
  // The documented rule: never rounded to the nearest event, never dropped.
  // With nothing to qualify, the verbatim fallback still reports it so
  // coverage can say the requirement was not understood.
  const sigs = readSignalPhrases(["blockchain vibes"]);
  assertEquals(sigs.length, 1);
  assertEquals(sigs[0].phrase, "blockchain vibes");
  assert(sigs[0].type !== "hiring");
});

Deno.test("merging never changes the event type of the host signal", () => {
  // The one thing a qualifier may not do is turn one requirement into another.
  for (const frag of ["sales roles", "enterprise", "blockchain vibes"]) {
    const sigs = readSignalPhrases([frag, "recently funded"]);
    for (const sig of sigs) {
      assert(
        sig.type === "funding" || sig.phrase === frag,
        `fragment ${frag} must not invent an event; got ${JSON.stringify(sig)}`,
      );
    }
  }
});

// ── C. the structured reading must survive validation ──────────────────────
//
// `MissionSignal` declares `event`, `subject` and `qualifier` and documents
// them as what "stop[s] ... an enterprise-seller role being mistaken for any
// open role at all". `validateLeadMission`'s mapper rebuilt each signal from
// `type`, `role_families` and `timeframe_days` only, so the structured reading
// the compiler had just produced was discarded on the way into the mission.

Deno.test("validation preserves the qualifier the compiler read", () => {
  const compiled = readSignalPhrases(["sales roles", "actively hiring"]);
  const validated = validateLeadMission(
    { required_signals: compiled },
    { originalUserQuery: "actively hiring sales roles", isCapabilityId: () => true },
  ).mission;
  const hiring = validated.required_signals.find((s) => s.type === "hiring");
  assert(hiring, "the hiring signal survives");
  assertEquals(hiring!.qualifier?.role_terms, ["sales roles"],
    "the role qualifier must reach the mission, not be dropped by the mapper");
  assertEquals(hiring!.subject, "company");
});

// ── the live regression: same count, wrong qualifier ───────────────────────
//
// Caught on a real card, 2026-08-25. The model wrote
// `preferred_signals: ["active hiring", "sales roles"]` and the merge refused,
// because it compared qualifier COUNT and the reader gives:
//
//     "active hiring"             -> role_terms ["active"]        (1)
//     "active hiring sales roles" -> role_terms ["sales roles"]   (1)
//
// So the mission kept a hiring signal qualified by the junk term "active" AND
// a second `{type:"sales roles"}` matching nothing. Counting was a proxy for
// the real question — does this fragment belong to that signal — which
// `qualifierAbsorbs` now asks directly.

Deno.test("a same-count merge that CORRECTS the qualifier is taken", () => {
  const sigs = readSignalPhrases(["active hiring", "sales roles"]);
  assertEquals(sigs.length, 1, "one requirement, not two");
  assertEquals(sigs[0].type, "hiring");
  assertEquals(
    (sigs[0].qualifier as Record<string, unknown>).role_terms, ["sales roles"],
    "the junk term 'active' must be replaced by the real role",
  );
  assertEquals(sigs.some((x) => x.type === "sales roles"), false);
});

Deno.test("a fragment the combined reading does NOT absorb stays separate", () => {
  // The merge must remain a test of belonging, not a licence to glue any two
  // phrases together.
  const sigs = readSignalPhrases(["recently funded", "active hiring"]);
  assertEquals(sigs.length, 2);
  assertEquals(new Set(sigs.map((x) => x.type)), new Set(["funding", "hiring"]));
});

// ── THE PARALLEL CHANNEL MUST FOLD INTO THE SIGNAL ─────────────────────────
//
// From the authenticated card, 2026-08-26. The user asked for "actively hiring
// sales roles" and the compiled mission carried:
//
//   required_signals      [{ type: "hiring", qualifier: {} }]
//   required_signal_terms ["sales roles"]
//
// The model lost nothing — it put the signal in `preferred_signals` and the
// material constraint in `required_signal_terms`, which is exactly what the
// proposal contract asks of it. The COMPILER read only the first field, so the
// role and the signal never met and the preview could only promise "hiring".
//
// `missionSignalDescriptor`'s own header names this: the role "survived only
// through a parallel channel — `role_families` plus `required_signal_terms` —
// which exists for roles and nothing else." That module exists to end the
// parallel channel; this is the compiler catching up to it.
//
// Solved at the contract level: every declared signal term is offered to each
// readable signal through the SAME `qualifierAbsorbs` rule that rejoins split
// prose. No vocabulary is named anywhere.

Deno.test("a declared signal term folds into the signal it qualifies", () => {
  const sigs = readSignalPhrases(["hiring"], ["sales roles"]);
  assertEquals(sigs.length, 1);
  assertEquals(sigs[0].type, "hiring");
  assertEquals(
    (sigs[0].qualifier as Record<string, unknown>).role_terms, ["sales roles"],
    "the constraint the user stated must reach the signal",
  );
});

Deno.test("paraphrases fold the same way, with no vocabulary in the code", () => {
  for (const [signal, term, expected] of [
    ["hiring", "account executives", "account executives"],
    ["hiring", "customer success managers", "customer success managers"],
    ["actively hiring", "SDRs", "sdrs"],
    ["recruiting", "engineers", "engineers"],
  ] as const) {
    const sigs = readSignalPhrases([signal], [term]);
    const q = (sigs[0]?.qualifier ?? {}) as Record<string, string[]>;
    const got = (q.role_terms ?? []).map((t) => t.toLowerCase());
    assert(
      got.some((t) => t.includes(expected)),
      `"${signal}" + "${term}" lost the constraint; got ${JSON.stringify(sigs)}`,
    );
  }
});

Deno.test("a term no signal absorbs is NOT silently attached", () => {
  // The merge stays a test of belonging. Without the absorption guard the
  // reader still returns the SAME event for the combined phrase — it simply
  // absorbs nothing — so the host signal would be replaced by one whose
  // `phrase` now carries an unrelated constraint. These are the two shapes
  // where that actually happens, found by scanning the reader rather than
  // guessed:
  //
  //   "hiring"         + "10-50 employees"  -> hiring, qualifier {}
  //   "recently funded" + "sales roles"     -> funding, qualifier {}
  //
  // A company-size constraint is not a hiring qualifier and a role is not a
  // funding qualifier; both must be left alone.
  const size = readSignalPhrases(["hiring"], ["10-50 employees"]);
  assertEquals(size[0].phrase, "hiring",
    `an employee range must not be absorbed into the hiring signal: ${JSON.stringify(size)}`);
  assertEquals(size[0].qualifier, {});

  const funding = readSignalPhrases(["recently funded"], ["sales roles"]);
  const f = funding.find((s) => s.type === "funding")!;
  assertEquals(f.phrase, "recently funded",
    `a role term may not rewrite a funding signal: ${JSON.stringify(funding)}`);
  assertEquals(
    ((f.qualifier ?? {}) as Record<string, string[]>).role_terms ?? [], [],
    "a role term may not qualify a funding signal",
  );
});

Deno.test("declared terms never invent a signal that was not requested", () => {
  const sigs = readSignalPhrases([], ["sales roles"]);
  assertEquals(sigs, [], "a qualifier alone is not a requirement");
});

// ── THE CALL SITE, NOT JUST THE FUNCTION ───────────────────────────────────
//
// The tests above exercise `readSignalPhrases` directly, so they pass even when
// the COMPILER stops passing `required_signal_terms` to it — which is exactly
// the bug that shipped. This one runs the real `compileLeadMission` over the
// verbatim model proposal from the authenticated card that produced
// `qualifier: {}`, so the wiring itself is pinned.

Deno.test("LIVE PROPOSAL: the compiler folds the term into the signal", async () => {
  const proposal = JSON.parse(
    Deno.readTextFileSync(new URL("./fixtures/liveHiringSalesProposal.json", import.meta.url)),
  );
  // The model's own split, as recorded on the card.
  assertEquals(proposal.preferred_signals, ["hiring"]);
  assertEquals(proposal.required_signal_terms, ["sales roles"]);

  const { compileLeadMission } = await import(
    "../../../supabase/functions/_shared/leadMissionCompiler.ts"
  );
  const m = compileLeadMission({
    originalUserQuery: "Find 3 companies matching my ICP that are actively hiring sales roles.",
    proposal,
  }).final_mission;

  const hiring = m.required_signals.find((s) => s.type === "hiring");
  assert(hiring, "the hiring signal survives compilation");
  assertEquals(
    hiring!.qualifier?.role_terms, ["sales roles"],
    `the compiler must pass required_signal_terms through; got ${JSON.stringify(hiring)}`,
  );
  // And the parallel channel is still carried, so nothing downstream regresses.
  assertEquals(m.required_signal_terms, ["sales roles"]);
});
