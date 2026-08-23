// WHY THIS FILE EXISTS.
//
// The mission recorded what evidence a request needs; the registry knew which
// Actors produce it; nothing joined them. A mission asking for companies that
// are hiring AND raised funding recently would discover companies, qualify them
// on hiring, and report success — having never asked a funding source anything.
// The requirement sat in the persisted result, visible and silently unserved.
//
// These tests pin the join, and pin the honesty at the end of it: a shortfall
// must say WHICH signal failed and WHY, because "we found 7 of 10" invites the
// user to ask for more candidates while "no source returns a funding amount
// without a session cookie" tells them the only thing that would change it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildShortfallStatement, coverMissionSignals, coverageDiagnostics,
  scenariosForSignal, signalsUnservedByStrategy,
} from "../../../supabase/functions/_shared/signalActorCoverage.ts";
import type { LeadMissionV1, MissionSignal } from "../../../supabase/functions/_shared/leadMission.ts";

const missionWith = (signals: MissionSignal[]): LeadMissionV1 => ({
  version: "lead_mission_v1",
  original_user_query: "test",
  requested_count: 10,
  company_profile: {
    business_models: [], verticals: [], stages: [], locations: [],
  },
  required_signals: signals,
  decision_makers: { roles: [], current_employment_required: true },
  hard_constraints: {}, soft_preferences: {},
  required_capabilities: [], prohibited_capabilities: [],
  field_provenance: {}, confidence: 1,
} as unknown as LeadMissionV1);

Deno.test("1. a hiring signal resolves to actors that can serve it", () => {
  const r = coverMissionSignals(missionWith([{ type: "hiring" }]));
  assertEquals(r.fully_covered, true);
  assertEquals(r.signals[0].status, "covered");
  assert(r.signals[0].actors.length > 0);
  assertEquals(r.shortfall_statement, "");
});

Deno.test("2. THE DEFECT: a funding requirement is no longer silently dropped", () => {
  // The failure this module exists to end. Both signals are recorded and both
  // are resolved, so the funding half can no longer be left to whichever later
  // stage happened to look.
  //
  // WHY `capability_gap` AND NOT `covered`.
  //
  // This assertion used to read `covered`, and that was the same dishonesty one
  // layer down. Crunchbase is described — its schema has been read — but NO
  // capability declares it, so `toRepoKey` returns null and nothing may call
  // it. Reporting that as covered told the run it had served a signal it had no
  // means of asking about; `runnable_actors` was empty at the same moment.
  //
  // `capability_gap` states the true position: the source is known, it is
  // unreachable, and no evidence for this signal was collected.
  // ── PHASE 4: THE GAP CLOSED ───────────────────────────────────────────────
  //
  // This asserted `capability_gap` for as long as every funding source was
  // described-but-uncallable. `apify_funding_rounds_datahyena` is carded,
  // compiled and engine-driven, so the funding half is now genuinely served —
  // which is the outcome the gap status existed to make visible and fixable.
  //
  // These fixture signals carry no structured descriptor, so this also exercises
  // the LEGACY path: a bare `{ type }` still resolves through the scenario
  // matrix, and it must reach the same verdict as a structured one.
  const r = coverMissionSignals(missionWith([{ type: "hiring" }, { type: "funding" }]));
  assertEquals(r.signals.length, 2);
  assertEquals(r.signals[1].signal, "funding");
  assertEquals(r.signals[1].status, "covered");
  assertEquals(r.fully_covered, true);

  assert(r.runnable_actors.includes("apify_funding_rounds_datahyena"),
    "the funding source must be runnable, not merely described");
  // Crunchbase stays KNOWLEDGE: still named as a source, still uncallable.
  assert(r.described_only.includes("memo23/crunchbase-scraper"));
  assert(!r.runnable_actors.includes("memo23/crunchbase-scraper"));
});

Deno.test("3. a strategy that ignores a runnable required signal is reported", () => {
  // `signalsUnservedByStrategy` answers one question: of the signals this run
  // COULD have served, which did the chosen strategy leave out? Only a covered
  // signal can be unserved in that sense — an unreachable one is not a strategy
  // mistake, and reporting it here would tell the caller to add an Actor it is
  // forbidden to call.
  const r = coverMissionSignals(missionWith([{ type: "hiring" }]));
  assertEquals(r.signals[0].status, "covered");

  // A strategy carrying none of hiring's actors leaves it unserved.
  const unserved = signalsUnservedByStrategy(r, ["apify_linkedin_company_details"]);
  assertEquals(unserved.length, 1);
  assertEquals(unserved[0].signal, "hiring");

  // A strategy that DOES include one reports nothing.
  const served = signalsUnservedByStrategy(r, ["apify_linkedin_job_search"]);
  assertEquals(served.length, 0);
});

Deno.test("3b. a capability gap is never reported as a strategy failure", () => {
  // The companion rule, stated separately because it is the one that keeps the
  // engine safe. `leadCapabilityEngine` adds an Actor to the run for every
  // signal `signalsUnservedByStrategy` returns. A gap signal appearing there
  // would push an undeclared Actor at that loop every single round.
  //
  // Funding was the original example and is served now; a leadership post became
  // `requires_unlock` in Phase 5. So the rule is exercised on headcount growth,
  // which no provider can produce at all — growth is a delta over stored
  // readings, and nothing stores them.
  const r = coverMissionSignals(missionWith([
    { type: "headcount_change", event: "headcount_change", subject: "company", qualifier: {} },
  ] as never));
  assertEquals(r.signals[0].status, "capability_gap");

  // No strategy can serve it, so no strategy is blamed for not serving it.
  assertEquals(signalsUnservedByStrategy(r, []).length, 0);
  assertEquals(signalsUnservedByStrategy(r, ["apify_yc_companies_memo23"]).length, 0);

  // It is reported through coverage instead, which is where a gap belongs.
  assertEquals(r.fully_covered, false);
  // Headcount growth reports the DERIVED reason: it is a delta over stored
  // readings, so "no Actor produces this" would send a user hunting a source
  // that cannot exist.
  assert(/COMPUTED, not retrieved/i.test(r.shortfall_statement));
});

Deno.test("4. funding AMOUNT is covered now, and its limitation is stated in the evidence bar", () => {
  // The cookie gate was a fact about Crunchbase, not about funding amounts. The
  // carded source returns `amount_usd` with no session, so this stopped being a
  // partial answer — while the honest caveat survives where it belongs: an
  // announced figure is a report, and it travels with its source article.
  const r = coverMissionSignals(missionWith([{ type: "funding_amount" }]));
  assertEquals(r.signals[0].status, "covered");
  assertEquals(r.fully_covered, true);
  assert(r.runnable_actors.includes("apify_funding_rounds_datahyena"));
  assert(/report, never an audit/i.test(r.signals[0].minimum_evidence));
});

Deno.test("5. a technology-adoption signal is unservable, with the verified reason", () => {
  // BuiltWith's live schema has two fields and no reverse lookup. There is no
  // lesser answer here, so no source is offered.
  const r = coverMissionSignals(missionWith([{ type: "technology_adoption" }]));
  assertEquals(r.signals[0].status, "unservable");
  assertEquals(r.signals[0].actors, []);
  assert(/reverse lookup/i.test(r.signals[0].limitation!));
});

Deno.test("6. an unrecognised signal is reported, never ignored", () => {
  // Silently dropping a signal is the failure this module exists to end, so a
  // signal we do not understand must be as loud as one we cannot serve.
  const r = coverMissionSignals(missionWith([{ type: "vibes" }]));
  assertEquals(r.signals[0].status, "unrecognised");
  assertEquals(r.fully_covered, false);
  assert(/not understood/i.test(r.shortfall_statement));
  assert(/"vibes"/.test(r.shortfall_statement), "the shortfall must name the signal");
});

Deno.test("7. synonyms and formatting variants map to the same scenarios", () => {
  // `MissionSignal.type` is a free-form string and a model-compiled mission
  // produces near-misses. Matching exactly would drop a signal the user asked
  // for, which is the exact failure being fixed.
  for (const v of ["hiring", "Hiring", " hiring ", "hiring_signal", "job posting", "open-roles"]) {
    assert(scenariosForSignal(v).length > 0, `"${v}" must resolve`);
  }
  assertEquals(scenariosForSignal("hiring"), scenariosForSignal("JOB_POSTING"));
  assertEquals(scenariosForSignal("nonsense"), []);
});

Deno.test("8. every signal in the diagram's list resolves", () => {
  // hiring, funding, founder activity, company size, industry, technology,
  // growth event — the architecture's own vocabulary must be servable input.
  for (const s of ["hiring", "funding", "founder_activity", "company_size",
    "industry", "technology", "growth_event"]) {
    assert(scenariosForSignal(s).length > 0, `"${s}" from the architecture must resolve`);
  }
});

Deno.test("9. a mission with no signals is covered by definition", () => {
  // It asked for nothing beyond the company profile, and that is discovery's
  // own job rather than a signal to cover.
  const r = coverMissionSignals(missionWith([]));
  assertEquals(r.fully_covered, true);
  assertEquals(r.signals, []);
  assertEquals(r.required_actors, []);
  assertEquals(r.shortfall_statement, "");
});

Deno.test("10. the shortfall statement names the signal and the reason", () => {
  // Written for a person. "We found 7 of 10" invites the user to ask for more
  // candidates; the reason tells them what would actually change the answer.
  // `funding_amount` is served since Phase 4, so the unmet examples here are a
  // technology signal (no reverse lookup exists) and an unrecognised one.
  const r = coverMissionSignals(missionWith([
    { type: "hiring" }, { type: "technology_adoption" }, { type: "vibes" },
  ]));
  assertEquals(r.fully_covered, false);
  const s = r.shortfall_statement;
  assert(/technology_adoption/.test(s));
  assert(/vibes/.test(s));
  assertEquals(/"hiring"/.test(s), false, "a covered signal must not appear in the shortfall");
});

Deno.test("11. an empty unmet list produces an empty statement", () => {
  assertEquals(buildShortfallStatement([]), "");
});

Deno.test("12. diagnostics carry the reasons and no payload", () => {
  const r = coverMissionSignals(missionWith([
    { type: "hiring" }, { type: "technology_adoption" },
  ]));
  const d = coverageDiagnostics(r);

  assertEquals(d.fully_covered, false);
  assertEquals((d.signals as unknown[]).length, 2);
  assert(d.shortfall_statement, "the honest ending must survive into the record");
  const withLimit = (d.signals as Array<Record<string, unknown>>)
    .find((x) => x.signal === "technology_adoption")!;
  assert(withLimit.limitation, "the reason must be recorded, not just the status");
  const covered = (d.signals as Array<Record<string, unknown>>)
    .find((x) => x.signal === "hiring")!;
  assertEquals("limitation" in covered, false, "a covered signal carries no limitation");
});
