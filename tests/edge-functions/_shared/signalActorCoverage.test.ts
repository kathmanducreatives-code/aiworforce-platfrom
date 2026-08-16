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
  // The failure this module exists to end. Both signals are recorded, both are
  // resolved, and the funding half names its own sources rather than being left
  // to whichever later stage happened to look.
  const r = coverMissionSignals(missionWith([{ type: "hiring" }, { type: "funding" }]));
  assertEquals(r.signals.length, 2);
  assertEquals(r.signals[1].signal, "funding");
  assertEquals(r.signals[1].status, "covered");
  assert(r.signals[1].actors.includes("memo23/crunchbase-scraper"));
  // And the union is what discovery must run to serve the whole request.
  assert(r.required_actors.length > r.signals[0].actors.length);
});

Deno.test("3. a strategy that ignores a required signal is reported", () => {
  // The check that would have caught it: pure company discovery against a
  // mission that also required funding.
  const r = coverMissionSignals(missionWith([{ type: "hiring" }, { type: "funding" }]));
  const unserved = signalsUnservedByStrategy(r, ["apify_yc_companies_memo23"]);

  assertEquals(unserved.length, 1);
  assertEquals(unserved[0].signal, "funding");

  // And a strategy that DOES include a funding source reports nothing.
  const served = signalsUnservedByStrategy(
    r, ["apify_yc_companies_memo23", "memo23/crunchbase-scraper"]);
  assertEquals(served.length, 0);
});

Deno.test("4. funding AMOUNT is partial, not covered, and says why", () => {
  // Verified from the Crunchbase schema: the amount unlocks only in LOGGED-IN
  // MODE with a session cookie. News may still mention a figure, so a weaker
  // answer exists — and offering it honestly beats refusing the request.
  const r = coverMissionSignals(missionWith([{ type: "funding_amount" }]));
  assertEquals(r.signals[0].status, "partial");
  assertEquals(r.fully_covered, false);
  assert(r.signals[0].actors.length > 0, "the lesser answer still names a source");
  assert(/cookie/i.test(r.signals[0].limitation!));
  assert(/cookie/i.test(r.shortfall_statement));
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
  const r = coverMissionSignals(missionWith([
    { type: "hiring" }, { type: "funding_amount" }, { type: "technology_adoption" },
  ]));
  assertEquals(r.fully_covered, false);
  const s = r.shortfall_statement;
  assert(/funding_amount/.test(s));
  assert(/technology_adoption/.test(s));
  assertEquals(/"hiring"/.test(s), false, "a covered signal must not appear in the shortfall");
});

Deno.test("11. an empty unmet list produces an empty statement", () => {
  assertEquals(buildShortfallStatement([]), "");
});

Deno.test("12. diagnostics carry the reasons and no payload", () => {
  const r = coverMissionSignals(missionWith([{ type: "hiring" }, { type: "funding_amount" }]));
  const d = coverageDiagnostics(r);

  assertEquals(d.fully_covered, false);
  assertEquals((d.signals as unknown[]).length, 2);
  assert(d.shortfall_statement, "the honest ending must survive into the record");
  const withLimit = (d.signals as Array<Record<string, unknown>>)
    .find((x) => x.signal === "funding_amount")!;
  assert(withLimit.limitation, "the reason must be recorded, not just the status");
  const covered = (d.signals as Array<Record<string, unknown>>)
    .find((x) => x.signal === "hiring")!;
  assertEquals("limitation" in covered, false, "a covered signal carries no limitation");
});
