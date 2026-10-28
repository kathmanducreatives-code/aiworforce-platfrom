// Mission interpretation contract v2 (AGENTORY_MISSION_CONTRACT=v2): per-signal
// timeframes attributed by the model and validated by code, the dynamic
// capability context, and proof that v1 — the default, and what the A7 TEST
// runs — is untouched. Pure: no network, no model.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionCompilerPayload, compileLeadMission,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  activeMissionContract, MISSION_CONTRACT_ENV, validateSignalWindows, windowDaysOfPhrase,
} from "../../../supabase/functions/_shared/missionInterpretationContract.ts";
import {
  GPT_MISSION_SCHEMA, GPT_MISSION_SCHEMA_V2, gptMissionSchemaFor, MISSION_PROPOSAL_FIELDS,
} from "../../../supabase/functions/_shared/gptMissionSchema.ts";
import { capabilityAvailability, capabilityContextForPrompt } from "../../../supabase/functions/_shared/capabilityContext.ts";
import { PUBLIC_CAPABILITY_CATALOGUE, PUBLIC_CAPABILITY_IDS } from "../../../supabase/functions/_shared/leadCapabilityCatalogue.ts";
import { executabilityStateOf } from "../../../supabase/functions/_shared/capabilityExecutability.ts";
import {
  evaluate, INTERPRETATION_CORPUS, proposalFor,
} from "../../../scripts/model-routing-eval/interpretationCorpus.ts";

const ctx = { originalUserQuery: "Find companies hiring Account Executives whose funding closed within the last six months." };

// ── v1 IS THE DEFAULT AND IS UNCHANGED ─────────────────────────────────────

Deno.test("contract: v1 unless AGENTORY_MISSION_CONTRACT=v2", () => {
  const r = (v?: string) => (k: string) => (k === MISSION_CONTRACT_ENV ? v : undefined);
  for (const v of [undefined, "", "V3", "2", "true"]) assertEquals(activeMissionContract(r(v)), "v1", String(v));
  assertEquals(activeMissionContract(r("v2")), "v2");
  assertEquals(activeMissionContract(r(" V2 ")), "v2");
});

Deno.test("v1 payload and schema: no v2 field, request in its original place, schema fields unchanged", () => {
  const p = buildMissionCompilerPayload({ ...ctx, contract: "v1" });
  assertFalse("contract_version" in p);
  assertFalse("signal_windows" in (p.response_shape as Record<string, unknown>));
  assertEquals(Object.keys(p).indexOf("user_query"), 3, "v1 key order is untouched");
  assertEquals(JSON.stringify(buildMissionCompilerPayload({ ...ctx, contract: "v1" })), JSON.stringify(buildMissionCompilerPayload(ctx)),
    "with the flag unset the default payload IS v1");
  assertEquals(gptMissionSchemaFor("v1"), GPT_MISSION_SCHEMA);
  assertFalse(MISSION_PROPOSAL_FIELDS.includes("signal_windows"));
});

Deno.test("v1 proposal compiles with no v2 artefact: no trace, no signal_windows key on the recorded proposal", () => {
  const c = INTERPRETATION_CORPUS[1];
  const r = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, c.windows, "v1"), requestedCount: 1 });
  assertFalse("interpretation_trace" in r);
  assertFalse("signal_windows" in (r.gpt_proposal as unknown as Record<string, unknown>));
  assertFalse(r.validator_changes.some((x) => /contract|signal_window/.test(x)));
});

// ── v2 PAYLOAD AND SCHEMA ──────────────────────────────────────────────────

Deno.test("v2 payload: request last (cacheable fixed prefix), signal_windows in the shape, capability availability stated", () => {
  const p = buildMissionCompilerPayload({ ...ctx, contract: "v2" });
  const keys = Object.keys(p);
  assertEquals(keys[keys.length - 1], "user_query");
  assertEquals(p.contract_version, "v2");
  assert(String(p.instruction).includes("signal_windows"));
  assert("signal_windows" in (p.response_shape as Record<string, unknown>));
  const cat = p.capability_catalogue as Array<{ availability: string }>;
  assertEquals(cat.length, PUBLIC_CAPABILITY_IDS.length);
  assert(cat.every((c) => typeof c.availability === "string"));
  // The fixed prefix is identical for two different requests.
  const other = buildMissionCompilerPayload({ originalUserQuery: "Find fintechs in Berlin.", contract: "v2" });
  const prefix = (x: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k !== "user_query")));
  assertEquals(prefix(p), prefix(other));
});

Deno.test("v2 schema: strict, signal_windows required, events from the signal vocabulary", () => {
  const s = GPT_MISSION_SCHEMA_V2.schema as { required: string[]; properties: Record<string, { items?: { properties: { event: { enum: string[] } } } }> };
  assert(s.required.includes("signal_windows"));
  assertEquals(s.required.length, MISSION_PROPOSAL_FIELDS.length + 1);
  assert(s.properties.signal_windows.items!.properties.event.enum.includes("funding"));
  assertEquals(gptMissionSchemaFor("v2"), GPT_MISSION_SCHEMA_V2);
});

// ── CODE DOES THE DATE ARITHMETIC AND CHECKS THE WORDS ─────────────────────

Deno.test("windowDaysOfPhrase: counted by code from the user's words", () => {
  const cases: Array<[string, number | null]> = [
    ["within the last six months", 180], ["within 30 days", 30], ["in the last 2 weeks", 14],
    ["within a year", 365], ["less than 30 days ago", 30], ["in the last 90 days", 90],
    ["recently", null], ["this quarter", null],
  ];
  for (const [p, d] of cases) assertEquals(windowDaysOfPhrase(p), d, p);
});

Deno.test("validateSignalWindows: refuses invented quotes, company age and unknown events; corrects miscounted days; records everything", () => {
  const q = "Find startups founded in the last 2 years whose funding closed within the last six months, hiring AEs.";
  const v = validateSignalWindows(q, [
    { event: "funding", days: 30, phrase: "within the last six months" },
    { event: "hiring", days: 30, phrase: "within the last 30 days" },
    { event: "funding", days: 730, phrase: "in the last 2 years" },
    { event: "valuation", days: 10, phrase: "within the last six months" },
  ]);
  assertEquals(v.byEvent, { funding: 180 });
  assertEquals(v.trace.map((t) => t.status), ["applied_days_from_phrase", "refused", "refused", "refused"]);
  assert(v.changes.includes("signal_window_refused:hiring:phrase_not_in_request"));
  assert(v.changes.includes("signal_window_refused:funding:company_age_not_a_signal_window"));
  assert(v.changes.includes("signal_window_refused:valuation:unknown_event"));
});

Deno.test("validateSignalWindows: an uncountable phrase that IS the user's keeps the model's days, marked as such", () => {
  const v = validateSignalWindows("Find companies funded this quarter.", [{ event: "funding", days: 90, phrase: "this quarter" }]);
  assertEquals(v.byEvent, { funding: 90 });
  assertEquals(v.trace[0].status, "applied_unparsed_phrase");
});

// ── THE CORPUS: v2 CARRIES EVERY CORRECT READING TO THE RUNTIME ────────────

/** Known, recorded, not a v2 window defect: "roles posted" is read as a social post (finding MC-9). */
const KNOWN_V2_FAILURES = new Set(["T8-less-than-ago"]);

for (const c of INTERPRETATION_CORPUS) {
  Deno.test(`corpus v2 ${c.id}: ${c.probes}`, () => {
    const o = evaluate(compileLeadMission, c.id, c.request, proposalFor(c, c.windows, "v2"), c.expect, "v2");
    if (KNOWN_V2_FAILURES.has(c.id)) {
      assertFalse(o.ok, `${c.id} now passes — remove it from KNOWN_V2_FAILURES`);
      return;
    }
    assert(o.ok, JSON.stringify({ runtime: o.runtime, missing: o.missing_events, wrong: o.wrong }));
    // Traceable: every stated window has a trace row.
    const r = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, c.windows, "v2"), requestedCount: 5 });
    assertEquals(r.interpretation_trace?.signal_windows.length, c.windows.length);
  });
  for (const e of c.model_errors ?? []) {
    Deno.test(`corpus model error ${e.id} (${e.detectable ? "code catches it" : "code cannot see it"})`, () => {
      const o = evaluate(compileLeadMission, e.id, c.request, proposalFor(c, e.windows, "v2"), e.expect ?? c.expect, "v2");
      if (e.detectable) {
        assert(o.ok, `the compiler must still produce the correct runtime: ${JSON.stringify(o.runtime)}`);
        assert(o.changes.some((x) => e.expect_change!.test(x)), `and record it: ${JSON.stringify(o.changes)}`);
      } else {
        // Stated honestly: this is a MODEL error the compiler passes through.
        // Only a better model (or the reader-disagreement escalation, not yet
        // wired) can catch it — the live Luna/Sol comparison measures it.
        assertFalse(o.ok);
      }
    });
  }
}

Deno.test("the review's example, end to end under v2: hiring required with no window, funding required within 180 days", () => {
  const c = INTERPRETATION_CORPUS[0];
  const r = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, c.windows, "v2"), requestedCount: 5 });
  const sig = (e: string) => r.final_mission.required_signals.find((s) => (s.event ?? s.type) === e);
  assert(sig("hiring") && sig("funding"), "both signals required");
  assertEquals(sig("hiring")!.timeframe_days ?? null, null);
  assertEquals(sig("funding")!.timeframe_days, 180);
  const hard = r.final_mission.criteria!.filter((x) => x.kind === "hard").map((x) => x.dimension);
  assert(hard.includes("hiring") && hard.includes("funding"), JSON.stringify(hard));
  assert(r.validator_changes.includes("hiring_window_reader_disagrees_with_contract:reader=180:contract=none"),
    "the v1 reader's misreading is recorded, not applied");
});

// ── CAPABILITY CONTEXT: FROM THE CODE-OWNED TABLES, NO SECRETS ─────────────

Deno.test("capability availability is derived from the executability table, not restated", () => {
  for (const id of PUBLIC_CAPABILITY_IDS) {
    const spec = PUBLIC_CAPABILITY_CATALOGUE[id];
    const a = capabilityAvailability(id);
    if (spec.kind === "offer") assertEquals(a, "offer_requires_user_approval", id);
    else if (spec.internal.length && spec.internal.every((c) => executabilityStateOf(c) !== "executable")) assertEquals(a, "not_available", id);
  }
  assertEquals(capabilityAvailability("technology_evidence"), "not_available");
  assertEquals(capabilityAvailability("company_post_evidence"), "not_available");
  assertEquals(capabilityAvailability("expansion_evidence"), "verification_only");
  assertEquals(capabilityAvailability("general_company_discovery"), "available");
});

Deno.test("capability context names no provider, Actor, price, credential or workspace", () => {
  const text = JSON.stringify(capabilityContextForPrompt()).toLowerCase();
  for (const bad of ["apify", "harvestapi", "apollo", "leadocean", "openai", "api_key", "secret", "workspace_id", "$", "per 1m", "microusd"]) {
    assertFalse(text.includes(bad), bad);
  }
  // "amount in USD" describes a funding event's data field, never a price.
  assertFalse(/\d+(?:\.\d+)?\s*usd/.test(text), "no priced amount");
});
