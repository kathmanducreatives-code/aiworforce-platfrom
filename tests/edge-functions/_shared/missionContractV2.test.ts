// Mission interpretation contract v2 (AGENTORY_MISSION_CONTRACT=v2): per-signal
// timeframes attributed by the model and validated by code, with the
// deterministic reader as an independent check; the capability context; and
// proof that v1 — the default, and what the A7 TEST runs — is untouched.
// Each "DEFECT n" test reproduces a finding of the failed self-review of
// da3c0b08. Pure: no network, no model.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionCompilerPayload, compileLeadMission, MissionCompilationBlockedError,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  activeMissionContract, MAX_CONTRACT_WINDOW_DAYS, MISSION_CONTRACT_ENV, readTimeframePhrase, timeExpressionsIn,
  validateSignalWindows, windowDaysOfPhrase,
} from "../../../supabase/functions/_shared/missionInterpretationContract.ts";
import {
  GPT_MISSION_SCHEMA, GPT_MISSION_SCHEMA_V2, gptMissionSchemaFor, MISSION_PROPOSAL_FIELDS,
} from "../../../supabase/functions/_shared/gptMissionSchema.ts";
import {
  capabilityAvailability, capabilityContextForPrompt, defaultProviderEnabled, stageRunnable,
} from "../../../supabase/functions/_shared/capabilityContext.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
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
  const r = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, c.windows, "v1"), requestedCount: 1, contract: "v1" });
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
  const s = GPT_MISSION_SCHEMA_V2.schema as { required: string[]; properties: Record<string, { items?: { required: string[]; properties: { event: { enum: string[] } } } }> };
  assert(s.required.includes("signal_windows"));
  assertEquals(s.properties.signal_windows.items!.required, ["event", "days", "phrase", "signal"]);
  assertEquals(s.required.length, MISSION_PROPOSAL_FIELDS.length + 1);
  assert(s.properties.signal_windows.items!.properties.event.enum.includes("funding"));
  assertEquals(gptMissionSchemaFor("v2"), GPT_MISSION_SCHEMA_V2);
});

// ── CODE DOES THE DATE ARITHMETIC AND CHECKS THE WORDS ─────────────────────

const NOW = new Date("2026-10-28T12:00:00Z");

Deno.test("readTimeframePhrase: past windows counted by code; future, older-than, negated, undirected and non-times refused", () => {
  const past: Array<[string, number]> = [
    ["within the last six months", 180], ["within 30 days", 30], ["in the last 2 weeks", 14],
    ["within a year", 365], ["less than 30 days ago", 30], ["in the last 90 days", 90],
  ];
  for (const [p, d] of past) assertEquals(readTimeframePhrase(p, NOW), { kind: "past", days: d }, p);
  const refused: Array<[string, string]> = [
    ["over 90 days ago", "older_than"], ["more than 90 days ago", "older_than"],
    ["not in the last 90 days", "negated"], ["within the next 30 days", "future"],
    ["in 6 months", "ambiguous_direction"], ["posting", "no_time_expression"], ["days", "no_time_expression"],
    ["Account Executive", "no_time_expression"], ["within", "no_time_expression"], ["recently", "no_time_expression"],
  ];
  for (const [p, reason] of refused) assertEquals(readTimeframePhrase(p, NOW), { kind: "refused", reason } as never, p);
  // Calendar phrases are counted from the date, never guessed.
  assertEquals(readTimeframePhrase("this quarter", NOW), { kind: "past", days: 28 });
  assertEquals(windowDaysOfPhrase("over 90 days ago"), null, "an inverted reading is never a window");
});

Deno.test("timeExpressionsIn: a rate or a bare unit is not a timeframe", () => {
  assertEquals(timeExpressionsIn("support 7 days a week, posted within 30 days").map((e) => e.text), ["within 30 days"]);
  assertEquals(timeExpressionsIn("Account Executive posting").length, 0);
});

Deno.test("validateSignalWindows: refuses invented quotes, company age and unknown events; corrects miscounted days; records everything", () => {
  const q = "Find startups founded in the last 2 years whose funding closed within the last six months, hiring AEs.";
  const w = (event: string, days: number, phrase: string) => ({ event, days, phrase, signal: null });
  const v = validateSignalWindows(q, [
    w("funding", 30, "within the last six months"),
    w("hiring", 30, "within the last 30 days"),
    w("funding", 730, "in the last 2 years"),
    w("valuation", 10, "within the last six months"),
  ], NOW);
  assertEquals(v.byEvent, { funding: 180 });
  assertEquals(v.decisions.map((t) => t.status), ["accepted_days_from_phrase", "refused", "refused", "refused"]);
  assert(v.changes.includes("signal_window_refused:hiring:phrase_not_in_request"));
  assert(v.changes.includes("signal_window_refused:funding:company_age_not_a_signal_window"));
  assert(v.changes.includes("signal_window_refused:valuation:unknown_event"));
  assertEquals(v.conflicts, [], "a model's invented or misfiled window is refused, not a reason to refuse the mission");
});

Deno.test("validateSignalWindows: a quote that is the user's but not a past window cannot be dropped — it is a conflict", () => {
  for (const [q, phrase, reason] of [
    ["Find companies hiring AEs, posted over 90 days ago.", "over 90 days ago", "older_than"],
    ["Find companies that will be hiring AEs within the next 30 days.", "within the next 30 days", "future"],
    ["Find companies hiring AEs, but not in the last 90 days.", "not in the last 90 days", "negated"],
    ["Find companies hiring AEs that have not raised funding in the last 90 days.", "in the last 90 days", "negated"],
  ]) {
    const v = validateSignalWindows(q, [{ event: "hiring", days: 90, phrase, signal: null }], NOW);
    assertEquals(v.byEvent, {}, q);
    assert(v.conflicts.some((c) => c.startsWith(`signal_window_unrepresentable:hiring:${reason}`)), JSON.stringify(v.conflicts));
  }
});

Deno.test("validateSignalWindows: trivial quotes are refused — the unparsed-phrase path is gone", () => {
  const q = "Find 1 US B2B software company with an open Account Executive posting dated within 30 days.";
  for (const phrase of ["posting", "days", "within", "Account Executive"]) {
    const v = validateSignalWindows(q, [{ event: "hiring", days: 365, phrase, signal: null }], NOW);
    assertEquals(v.byEvent, {}, phrase);
    assertEquals(v.decisions[0].status, "refused");
  }
});

Deno.test("validateSignalWindows: the 730-day limit is enforced and recorded", () => {
  const v = validateSignalWindows("Find companies funded within the last 3 years.",
    [{ event: "funding", days: 1095, phrase: "within the last 3 years", signal: null }], NOW);
  assertEquals(v.byEvent, { funding: MAX_CONTRACT_WINDOW_DAYS });
  assertEquals(v.decisions[0].status, "accepted_capped");
  assert(v.changes.includes("signal_window_capped:funding:1095->730"));
});

Deno.test("validateSignalWindows: two windows for one event are never collapsed to the shorter", () => {
  const q = "Find companies hiring AEs in the last 2 weeks or SDRs in the last 90 days.";
  const named = validateSignalWindows(q, [
    { event: "hiring", days: 14, phrase: "in the last 2 weeks", signal: "hiring AEs" },
    { event: "hiring", days: 90, phrase: "in the last 90 days", signal: "hiring SDRs" },
  ], NOW);
  assertEquals(named.byEvent, {});
  assertEquals(named.perSignal.hiring, [{ signal: "hiring AEs", days: 14 }, { signal: "hiring SDRs", days: 90 }]);
  const unnamed = validateSignalWindows(q, [
    { event: "hiring", days: 14, phrase: "in the last 2 weeks", signal: null },
    { event: "hiring", days: 90, phrase: "in the last 90 days", signal: null },
  ], NOW);
  assertEquals(unnamed.byEvent, {});
  assertEquals(unnamed.conflicts, ["signal_window_ambiguous:hiring:14|90"]);
});

// ── THE COMPILER UNDER v2: NOTHING THE USER STATED IS DROPPED OR WIDENED ───

const v2 = (request: string, signals: string[], windows: ReadonlyArray<object>, extra: Record<string, unknown> = {}) =>
  compileLeadMission({
    originalUserQuery: request, requestedCount: 5, contract: "v2",
    proposal: { ...proposalFor({ signals }, windows as never, "v2"), ...extra },
  });
const blocked = (f: () => unknown): string[] => {
  try { f(); } catch (e) { if (e instanceof MissionCompilationBlockedError) return e.reasons; throw e; }
  throw new Error("expected the compile to be refused");
};
const hardOf = (r: ReturnType<typeof compileLeadMission>) => (r.final_mission.criteria ?? [])
  .filter((c) => c.kind === "hard").map((c) => `${c.dimension}${c.time_window?.days ? `@${c.time_window.days}` : ""}`).sort();
const runtimeOf = (r: ReturnType<typeof compileLeadMission>, event: string) =>
  r.final_mission.required_signals.find((s) => (s.event ?? s.type) === event)?.timeframe_days ?? null;

Deno.test("DEFECT 1: an omitted funding window is not downgraded — same hard funding@90 as v1", () => {
  const q = "Find startups that raised funding in the last 90 days and are hiring SDRs.";
  const signals = ["raised funding in the last 90 days", "hiring SDRs"];
  const omitted = v2(q, signals, []);
  const stated = v2(q, signals, [{ event: "funding", days: 90, phrase: "in the last 90 days" }]);
  const v1 = compileLeadMission({ originalUserQuery: q, requestedCount: 5, contract: "v1", proposal: proposalFor({ signals }, [], "v1") });
  assertEquals(runtimeOf(omitted, "funding"), 90);
  assert(hardOf(omitted).includes("funding@90"), JSON.stringify(hardOf(omitted)));
  assertEquals(hardOf(omitted).filter((h) => h.startsWith("funding")), hardOf(v1).filter((h) => h.startsWith("funding")));
  assertEquals(hardOf(omitted), hardOf(stated));
  assert(omitted.validator_changes.includes("window_from_reader_contract_omitted:funding:90d"));
  assertEquals(omitted.interpretation_trace!.signals.find((s) => s.event === "funding")!.source, "reader_contract_omitted");
});

Deno.test("DEFECT 1: an omitted hiring window is kept (7 days), not dropped", () => {
  const r = v2("Find companies hiring Account Executives in the last 7 days.", ["hiring Account Executives"], []);
  assertEquals(runtimeOf(r, "hiring"), 7);
  assert(r.validator_changes.includes("window_from_reader_contract_omitted:hiring:7d"));
});

Deno.test("DEFECT 1: an omitted window the reader cannot place fails closed (A7 sentence, no signal_windows)", () => {
  const c = INTERPRETATION_CORPUS[1];
  assertEquals(blocked(() => v2(c.request, c.signals, [])), ["interpretation_conflict:timeframe_unaccounted:within 30 days"]);
});

Deno.test("DEFECT 1/2: model and reader disagree on a signal's window → refused, never one silently preferred", () => {
  // The two windows swapped between signals: every quote is the user's and
  // every count is right, so only the independent reader can see it.
  const reasons = blocked(() => v2("Find companies hiring SDRs in the last 2 weeks that were funded within a year.",
    ["hiring SDRs", "funded within a year"],
    [{ event: "hiring", days: 365, phrase: "within a year" }, { event: "funding", days: 14, phrase: "in the last 2 weeks" }]));
  assert(reasons.includes("interpretation_conflict:window_conflict:hiring:contract=365:reader=14"), JSON.stringify(reasons));
});

Deno.test("DEFECT 2: a trivial quote does not account for the timeframe it sits inside — the A7 window still fails closed", () => {
  const c = INTERPRETATION_CORPUS[1];
  for (const phrase of ["days", "within", "posting", "30 days ago"]) {
    const reasons = blocked(() => v2(c.request, c.signals, [{ event: "hiring", days: 365, phrase }]));
    assert(reasons.includes("interpretation_conflict:timeframe_unaccounted:within 30 days"), `${phrase}: ${JSON.stringify(reasons)}`);
  }
});

Deno.test("DEFECT 3: older-than, negated and future timeframes fail closed, quoted or omitted", () => {
  const cases: Array<[string, object[], RegExp]> = [
    ["Find companies hiring Account Executives, posted over 90 days ago.", [{ event: "hiring", days: 90, phrase: "over 90 days ago" }], /older_than/],
    ["Find companies hiring Account Executives, posted over 90 days ago.", [], /timeframe_unaccounted:over 90 days ago/],
    ["Find companies hiring AEs, but not in the last 90 days.", [{ event: "hiring", days: 90, phrase: "not in the last 90 days" }], /negated/],
    ["Find companies hiring AEs that have not raised funding in the last 90 days.", [], /timeframe_negated:in the last 90 days/],
    ["Find companies that will be hiring AEs within the next 30 days.", [{ event: "hiring", days: 30, phrase: "within the next 30 days" }], /future/],
    ["Find companies that will be hiring AEs within the next 30 days.", [], /timeframe_unaccounted:within the next 30 days/],
  ];
  for (const [q, w, re] of cases) {
    const reasons = blocked(() => v2(q, ["hiring AEs"], w));
    assert(reasons.some((x) => re.test(x)), `${q} ${JSON.stringify(w)} → ${JSON.stringify(reasons)}`);
  }
});

Deno.test("DEFECT 4: signal_windows is never processed unless the contract is v2 — recorded, mission unchanged", () => {
  const c = INTERPRETATION_CORPUS[0];
  const withField = { ...proposalFor(c, [], "v1"), signal_windows: [{ event: "hiring", days: 3650, phrase: "Account Executives", signal: null }] };
  const a = compileLeadMission({ originalUserQuery: c.request, proposal: withField, requestedCount: 5, contract: "v1" });
  const b = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, [], "v1"), requestedCount: 5, contract: "v1" });
  assert(a.validator_changes.includes("signal_windows_ignored:contract_v1"));
  assertFalse("interpretation_trace" in a);
  assertEquals(JSON.stringify(a.final_mission.required_signals), JSON.stringify(b.final_mission.required_signals));
  assertEquals(JSON.stringify(a.final_mission.criteria), JSON.stringify(b.final_mission.criteria));
  if (!Deno.env.get(MISSION_CONTRACT_ENV)) {
    // With the flag unset, a caller that names no contract is on v1.
    const d = compileLeadMission({ originalUserQuery: c.request, proposal: withField, requestedCount: 5 });
    assert(d.validator_changes.includes("signal_windows_ignored:contract_v1"));
  }
});

Deno.test("DEFECT 6: a global window that disagrees with signal_windows is refused; an agreeing one is recorded", () => {
  const q = "Find companies hiring Account Executives in the last 2 weeks.";
  const w = [{ event: "hiring", days: 14, phrase: "in the last 2 weeks" }];
  const reasons = blocked(() => v2(q, ["hiring Account Executives"], w, { signal_recency_days: 30 }));
  assert(reasons.some((x) => x.startsWith("interpretation_conflict:global_window_conflict:signal_recency_days=30")), JSON.stringify(reasons));
  const ok = v2(q, ["hiring Account Executives"], w, { signal_recency_days: 14 });
  assertEquals(runtimeOf(ok, "hiring"), 14);
  assert(ok.validator_changes.includes("signal_recency_days_redundant:14"));
});

Deno.test("DEFECT 7 (MC-9): a window whose signal is missing at runtime fails closed instead of tracing 'applied'", () => {
  const c = INTERPRETATION_CORPUS.find((x) => x.id === "T8-less-than-ago")!;
  const reasons = blocked(() => v2(c.request, c.signals, c.windows));
  assertEquals(reasons, ["interpretation_conflict:signal_missing_for_window:hiring"]);
});

Deno.test("DEFECT 8: separate windows for separate role signals are refused, never collapsed to the shorter", () => {
  const c = INTERPRETATION_CORPUS.find((x) => x.id === "T15-per-signal-windows")!;
  const reasons = blocked(() => v2(c.request, c.signals, c.windows));
  assert(reasons.some((x) => x.startsWith("interpretation_conflict:per_signal_windows_not_enforced_at_runtime:hiring")), JSON.stringify(reasons));
});

Deno.test("the trace is built from the FINAL runtime signals, including one the reader added", () => {
  const c = INTERPRETATION_CORPUS.find((x) => x.id === "T17-funding-signal-omitted")!;
  const r = v2(c.request, c.signals, c.windows);
  const t = r.interpretation_trace!;
  assertEquals(t.contract, "v2");
  assertEquals(t.signals.length, r.final_mission.required_signals.length);
  for (const [i, s] of r.final_mission.required_signals.entries()) {
    assertEquals(t.signals[i].event, String(s.event ?? s.type));
    assertEquals(t.signals[i].runtime_days, s.timeframe_days ?? null);
  }
  assertEquals(t.signals.find((s) => s.event === "funding"), { event: "funding", signal_phrase: t.signals.find((s) => s.event === "funding")!.signal_phrase, runtime_days: 90, source: "contract" });
  assertEquals(t.proposed_windows.map((d) => d.status), ["accepted"]);
});

// ── THE CORPUS: v2 CARRIES EVERY CORRECT READING TO THE RUNTIME, OR REFUSES ──

for (const c of INTERPRETATION_CORPUS) {
  Deno.test(`corpus v2 ${c.id}: ${c.probes}`, () => {
    const o = evaluate(compileLeadMission, c.id, c.request, proposalFor(c, c.windows, "v2"), c.expect, "v2", c.expect_refusal);
    assert(o.ok, JSON.stringify({ runtime: o.runtime, refused: o.refused, missing: o.missing_events, wrong: o.wrong }));
    if (!c.expect_refusal) {
      const r = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, c.windows, "v2"), requestedCount: 5, contract: "v2" });
      assertEquals(r.interpretation_trace?.proposed_windows.length, c.windows.length, "every proposed window has a decision");
    }
  });
  for (const e of c.model_errors ?? []) {
    Deno.test(`corpus model error ${e.id} (${e.detectable ? "code catches it" : "code cannot see it"})`, () => {
      const o = evaluate(compileLeadMission, e.id, c.request, proposalFor(c, e.windows, "v2"), e.expect ?? c.expect, "v2", e.expect_refusal);
      if (e.detectable) {
        assert(o.ok, `the compiler must produce the correct runtime or refuse: ${JSON.stringify({ runtime: o.runtime, refused: o.refused })}`);
        if (e.expect_change) assert(o.changes.some((x) => e.expect_change!.test(x)), `and record it: ${JSON.stringify(o.changes)}`);
      } else {
        // Stated honestly: a MODEL error the compiler passes through. Only a
        // better model or a human review catches it.
        assertFalse(o.ok);
      }
    });
  }
}

Deno.test("the review's example, end to end under v2: hiring required with no window, funding required within 180 days", () => {
  const c = INTERPRETATION_CORPUS[0];
  const r = compileLeadMission({ originalUserQuery: c.request, proposal: proposalFor(c, c.windows, "v2"), requestedCount: 5, contract: "v2" });
  const sig = (e: string) => r.final_mission.required_signals.find((s) => (s.event ?? s.type) === e);
  assert(sig("hiring") && sig("funding"), "both signals required");
  assertEquals(sig("hiring")!.timeframe_days ?? null, null);
  assertEquals(sig("funding")!.timeframe_days, 180);
  const hard = r.final_mission.criteria!.filter((x) => x.kind === "hard").map((x) => x.dimension);
  assert(hard.includes("hiring") && hard.includes("funding"), JSON.stringify(hard));
  assert(r.validator_changes.includes("hiring_regex_disagrees_with_contract:regex=180:contract=none"),
    "the R1 regex's misreading is recorded, never applied");
});

// ── CAPABILITY CONTEXT: FROM THE READINESS AND EXECUTABILITY POLICIES ─────

const allConfigured = { providerEnabled: () => true };

Deno.test("DEFECT 5: funding, expansion and product launch are not advertised — their providers are not live", () => {
  for (const id of ["funding_event_discovery", "expansion_evidence", "product_launch_evidence", "technology_evidence", "company_post_evidence"] as const) {
    assertEquals(capabilityAvailability(id, allConfigured), "not_available", id);
  }
});

Deno.test("availability follows the readiness policy and configuration, not the catalogue", () => {
  for (const id of PUBLIC_CAPABILITY_IDS) {
    const spec = PUBLIC_CAPABILITY_CATALOGUE[id];
    const a = capabilityAvailability(id, allConfigured);
    if (spec.kind === "offer") assertEquals(a, "offer_requires_user_approval", id);
    else if (spec.internal.length && spec.internal.every((c) => executabilityStateOf(c) !== "executable")) assertEquals(a, "not_available", id);
    // Nothing is "available" unless every stage it expands to can run here.
    if (a === "available") assert(spec.internal.every((c) => stageRunnable(c, allConfigured)), id);
  }
  assertEquals(capabilityAvailability("general_company_discovery", allConfigured), "available");
  // No provider configured: a provider-backed capability is not advertised.
  assertEquals(capabilityAvailability("general_company_discovery", { providerEnabled: () => false }), "not_available");
  // A policy that marks nothing ready: the same.
  const nothingReady = { ...PRODUCTION_READINESS, decide: () => ({ ...PRODUCTION_READINESS.decide(null, "persistence"), executable: false }) };
  assertEquals(capabilityAvailability("general_company_discovery", { policy: nothingReady as never, providerEnabled: () => true }), "not_available");
});

Deno.test("credential presence decides configuration; the value never appears", () => {
  assertFalse(defaultProviderEnabled(() => undefined)("apify_linkedin_company_search"));
  assert(defaultProviderEnabled((k) => (k === "APIFY_API_TOKEN" ? "tok_x" : undefined))("apify_linkedin_company_search"));
  assertFalse(defaultProviderEnabled(() => "tok_x")("unknown_provider"));
  assertFalse(JSON.stringify(capabilityContextForPrompt(allConfigured)).includes("tok_x"));
});

Deno.test("capability context names no provider, Actor, price, credential or workspace", () => {
  const text = JSON.stringify(capabilityContextForPrompt(allConfigured)).toLowerCase();
  for (const bad of ["apify", "harvestapi", "apollo", "leadocean", "openai", "api_key", "secret", "workspace_id", "$", "per 1m", "microusd"]) {
    assertFalse(text.includes(bad), bad);
  }
  // "amount in USD" describes a funding event's data field, never a price.
  assertFalse(/\d+(?:\.\d+)?\s*usd/.test(text), "no priced amount");
});
