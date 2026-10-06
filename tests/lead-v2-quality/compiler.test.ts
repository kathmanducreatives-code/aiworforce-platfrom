// LEAD V2 QUALITY REGRESSIONS — WHAT THE CARD MEANS (RC01–RC08).
//
// Each test encodes the EXPECTED behaviour from the 2026-10-06 quality run's
// consolidated report. They are written to FAIL on code that still has the root
// cause, and to pass once it is fixed. See lib/cases.ts for the record format
// and lib/chain.ts for the reconstructed-RequestV1 limitation.
//
// Pure. No network, no model, no provider, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileChain, feasibilityOf, fromMission, funding, hiring, named, ofDim, request, textOf,
} from "./lib/chain.ts";
import { qcase, recordedMission } from "./lib/cases.ts";
import { bandSatisfies } from "../../supabase/functions/_shared/companySize.ts";
import { validateLeadMission } from "../../supabase/functions/_shared/leadMission.ts";
import { isCapabilityId } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { buildCompanyEvidenceGraph } from "../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../supabase/functions/_shared/candidateEligibility.ts";
import { decideAutoContinuation, settleV2Outcome } from "../../supabase/functions/_shared/leadAutoContinuation.ts";
import { companyIsTheDeliverable } from "../../supabase/functions/_shared/leadMission.ts";
import type { MissionCriterion } from "../../supabase/functions/_shared/missionCriteria.ts";
import type { EvidenceItem } from "../../supabase/functions/_shared/evidenceGraph.ts";

// ── shared expectations ─────────────────────────────────────────────────────

/** LinkedIn's declared company-size bands — the only size evidence any source returns. */
const LINKEDIN_BANDS: Array<{ min: number; max: number | null }> = [
  { min: 2, max: 10 }, { min: 11, max: 50 }, { min: 51, max: 200 }, { min: 201, max: 500 },
  { min: 501, max: 1000 }, { min: 1001, max: 5000 }, { min: 5001, max: 10000 }, { min: 10001, max: null },
];
const sizeVerdict = (c: MissionCriterion, band: { min: number; max: number | null }) =>
  bandSatisfies(c.value as { min?: number | null; max?: number | null }, band).verdict;
const hardSize = (c: ReturnType<typeof fromMission>) => c.hard.filter((x) => x.dimension === "company_size");

/** A positive criterion for a dimension: something that rewards or requires the thing the user negated. */
const positive = (c: ReturnType<typeof compileChain>, dim: string) =>
  c.criteria.filter((x) => x.dimension === dim && x.status === "ok" && (x.kind === "hard" || x.kind === "target"));
/** An exclusion the mission carries for a negated dimension. */
const excludes = (c: ReturnType<typeof compileChain>, dim: string, word?: RegExp) =>
  c.criteria.some((x) => (x.dimension === "exclusion" || x.elevated_by === "excluding") &&
    (textOf(x.value).includes(dim) || (word ? word.test(textOf(x.value) + x.label.toLowerCase()) : false)));

function evidence(company: string, dimension: string, value: unknown, actor = "apify_linkedin_company_details"): EvidenceItem {
  const now = new Date().toISOString();
  return {
    evidence_id: `q_${company}_${dimension}`, company_key: company, dimension, value, status: "proven",
    source: { provider: "apify", actor, provider_call_id: `pc_${company}`, url: null, excerpt: null },
    method: "provider_field", observed_at: now, valid_until: null, confidence: "high", derived_from: [],
    mission_id: null, origin: "lead_mission",
  } as unknown as EvidenceItem;
}

// ══ RC03 — SIZE-RANGE SEMANTICS ═════════════════════════════════════════════

Deno.test(qcase({
  id: "H05", rc: "RC03", boundary: "reconstructed", query: "Find companies with more than 100 employees.",
  current: "hard company_size {min:100,max:0} — every LinkedIn band FAILS, incl. 201–500 and 1001–5000",
  expected: "an open-ended range: 201–500, 1001–5000 and 10001+ pass; 11–50 fails",
}), () => {
  const c = compileChain(request("Find companies with more than 100 employees.", {
    filters: [{ field: "employee_count", op: "range", value: { min: 100, max: null } }],
  }));
  const size = hardSize(c);
  assertEquals(size.length, 1, "the size requirement is hard");
  for (const band of [{ min: 201, max: 500 }, { min: 1001, max: 5000 }, { min: 10001, max: null }]) {
    assertEquals(sizeVerdict(size[0], band), "pass", `${band.min}–${band.max ?? "∞"} vs ${JSON.stringify(size[0].value)}`);
  }
  assertEquals(sizeVerdict(size[0], { min: 11, max: 50 }), "fail");
});

Deno.test(qcase({
  id: "H05", rc: "RC03", boundary: "pure", query: "Find companies with more than 100 employees.",
  current: "validateLeadMission turns employee_range {min:100,max:null} into {min:100,max:0} (Number(null) === 0)",
  expected: "validateLeadMission keeps an absent upper bound absent (max null or omitted, never 0)",
}), () => {
  const m = recordedMission("H05") as unknown as { company_profile: { employee_range: unknown } };
  // The run recorded the post-validation {100, 0}; the only input that validates to it is max: null.
  m.company_profile.employee_range = { min: 100, max: null };
  const v = validateLeadMission(m, { originalUserQuery: "Find companies with more than 100 employees.", isCapabilityId, requestedCount: null });
  const er = v.mission.company_profile.employee_range as { min?: number | null; max?: number | null } | undefined;
  assertEquals(er?.min, 100);
  assert(er?.max == null, `max must stay open, got ${JSON.stringify(er)}`);
});

Deno.test(qcase({
  id: "H07", rc: "RC03", boundary: "pure", query: "Find companies around 50 employees.",
  current: "hard company_size {min:0,max:0} (an all-null range validated to zeros) — no company can ever pass",
  expected: "an unbounded range never becomes a {0,0} hard size requirement",
}), () => {
  const m = recordedMission("H07") as unknown as { company_profile: { employee_range: unknown } };
  m.company_profile.employee_range = { min: null, max: null };
  const v = validateLeadMission(m, { originalUserQuery: "Find companies around 50 employees.", isCapabilityId, requestedCount: null });
  const chain = fromMission(v.mission);
  for (const s of hardSize(chain)) {
    const val = s.value as { min?: number | null; max?: number | null };
    assert(!(val.min === 0 && val.max === 0), `degenerate hard size ${JSON.stringify(val)}`);
  }
});

for (const [id, query, range] of [
  ["H06", "Find companies between 20 and 100 employees.", "20–100"],
  ["H08", "Find 5 AI companies with 25–75 employees.", "25–75"],
  ["P01", "Find 100 US AI companies with exactly 17 employees.", "exactly 17"],
  ["P04", "Find 100 recruiting agencies with exactly 42 employees.", "exactly 42"],
] as const) {
  Deno.test(qcase({
    id, rc: "RC03", boundary: "recorded", query,
    current: `hard company_size ${range} that no LinkedIn band can pass — every company stays pending, card shown as feasible`,
    expected: "a hard size requirement is satisfiable by at least one declared band, or it is disclosed as unprovable (not an ok hard claim)",
  }), () => {
    const chain = fromMission(recordedMission(id));
    for (const s of hardSize(chain)) {
      const passing = LINKEDIN_BANDS.filter((b) => sizeVerdict(s, b) === "pass");
      assert(passing.length > 0, `${id}: hard size ${JSON.stringify(s.value)} — no LinkedIn band can ever pass it`);
    }
  });
}

// ══ RC01 — NEGATION ═════════════════════════════════════════════════════════
//
// RequestV1 can carry a negated FILTER (`op: "not"`) but has no polarity on a
// REQUIREMENT, so a negated signal is reconstructed as Chat Brain recorded it —
// positively (the run's cards carry the positive signal). The deterministic
// chain still holds the sentence, and must not compile the opposite of it.

/** Correct: refuse / clarify, or carry the exclusion with no positive criterion for it. */
function assertNegationHonoured(c: ReturnType<typeof compileChain>, dim: string, word?: RegExp) {
  if (!c.ok) return;
  assertEquals(positive(c, dim).map((x) => `${x.kind}:${x.label}`), [], `a positive ${dim} criterion compiles the opposite of the request`);
  assert(excludes(c, dim, word), `the ${dim} exclusion is not carried (dropped silently)`);
}

Deno.test(qcase({
  id: "K03", rc: "RC01", boundary: "reconstructed", query: "Find companies outside the United States.",
  current: "HARD geography = United States (inverted)",
  expected: "no United States geography requirement; the exclusion is carried, or the request is clarified",
}), () => {
  const c = compileChain(request("Find companies outside the United States.", {
    filters: [{ field: "geography", op: "not", value: "United States" }],
  }));
  if (!c.ok) return;
  assertEquals(c.hard.filter((x) => x.dimension === "geography" && /united states/i.test(textOf(x.value))).length, 0, "hard US geography");
  assert(excludes(c, "geography", /united states/), "the US exclusion is not carried");
});

Deno.test(qcase({
  id: "G08", rc: "RC01", boundary: "reconstructed", query: "Find companies serving the US but headquartered outside the US.",
  current: "HARD geography = United States (inverted)",
  expected: "no US headquarters requirement; HQ-outside-US carried as an exclusion, or the request is clarified",
}), () => {
  const c = compileChain(request("Find companies serving the US but headquartered outside the US.", {
    filters: [{ field: "geography", op: "not", value: "United States" }],
  }));
  if (!c.ok) return;
  assertEquals(c.hard.filter((x) => x.dimension === "geography" && /united states|\bus\b/i.test(textOf(x.value))).length, 0, "hard US geography");
});

Deno.test(qcase({
  id: "K05", rc: "RC01", boundary: "reconstructed", query: "Find recently funded AI startups that are not currently hiring sales.",
  current: "HARD hiring (gtm_sales) — job searches bought to find companies that ARE hiring",
  expected: "no positive hiring criterion; 'not hiring sales' carried as an exclusion, or the request is clarified",
}), () => {
  assertNegationHonoured(compileChain(request("Find recently funded AI startups that are not currently hiring sales.", {
    filters: [{ field: "industry", op: "eq", value: "AI" }],
    requirements: [funding("recently funded", null), hiring("not currently hiring sales", ["sales"])],
  })), "hiring");
});

Deno.test(qcase({
  id: "K01", rc: "RC01", boundary: "reconstructed", query: "Find AI companies that are NOT hiring sales.",
  current: "target hiring (gtm_sales) — ranks hiring companies HIGHER",
  expected: "no positive hiring criterion; the exclusion is carried, or the request is clarified",
}), () => {
  assertNegationHonoured(compileChain(request("Find AI companies that are NOT hiring sales.", {
    filters: [{ field: "industry", op: "eq", value: "AI" }], requirements: [hiring("NOT hiring sales", ["sales"])],
  })), "hiring");
});

Deno.test(qcase({
  id: "K02", rc: "RC01", boundary: "reconstructed", query: "Find AI companies that have NOT raised venture funding.",
  current: "target funding — ranks funded companies HIGHER",
  expected: "no positive funding criterion; the exclusion is carried, or the request is clarified",
}), () => {
  assertNegationHonoured(compileChain(request("Find AI companies that have NOT raised venture funding.", {
    filters: [{ field: "industry", op: "eq", value: "AI" }], requirements: [funding("NOT raised venture funding", null)],
  })), "funding");
});

Deno.test(qcase({
  id: "E07", rc: "RC01", boundary: "reconstructed", query: "Find companies that received grants but have not raised venture funding.",
  current: "target funding (any round) — venture-funded companies rank HIGHER",
  expected: "venture funding carried as an exclusion (no positive venture/any-funding criterion), or the request is clarified",
}), () => {
  assertNegationHonoured(compileChain(request("Find companies that received grants but have not raised venture funding.", {
    requirements: [funding("Find companies that received grants but have not raised venture funding.", null)],
  })), "funding", /venture/);
});

Deno.test(qcase({
  id: "F12", rc: "RC01", boundary: "reconstructed", query: "Find companies hiring sales roles but not engineering roles.",
  current: "'not engineering roles' dropped silently — no exclusion anywhere on the card",
  expected: "the engineering-roles exclusion is carried, or the request is clarified",
}), () => {
  const c = compileChain(request("Find companies hiring sales roles but not engineering roles.", {
    requirements: [hiring("hiring sales roles", ["sales roles"])],
  }));
  if (!c.ok) return;
  assert(excludes(c, "hiring", /engineer/), "the engineering exclusion is not carried");
});

// ══ RC02 — OR / ANY-OF ═════════════════════════════════════════════════════

Deno.test(qcase({
  id: "L03", rc: "RC02", boundary: "reconstructed", query: "Find companies in New York or California.",
  // CORRECTED WHILE WRITING THIS TEST: the run report said a California company
  // FAILS "New York". It does not — `geographyContradicts` compares countries
  // only, so no sub-national value contradicts another and the AND does not bite
  // for these two states today. The criteria are still two independent hard
  // claims; this test guards the any-of once sub-national geography is enforced.
  current: "two independent HARD geography claims (New York AND California); masked today because geography only contradicts at country level",
  expected: "a company proven in California passes the geography requirement",
}), () => {
  const c = compileChain(request("Find companies in New York or California.", {
    filters: [{ field: "geography", op: "in", value: ["New York", "California"] }],
  }));
  assert(c.ok);
  const graph = buildCompanyEvidenceGraph("ca", [evidence("ca", "geography", "California")]);
  const e = evaluateEligibility(c.criteria, graph);
  assertEquals(e.hard_checks.geography, "pass", JSON.stringify(e.checks.filter((x) => x.dimension === "geography")));
});

Deno.test(qcase({
  id: "L04", rc: "RC02", boundary: "reconstructed", query: "Find AI or developer-tools companies.",
  current: "two HARD industry claims (AI AND developer-tools) — a proven AI company stays pending on developer-tools",
  expected: "a company proven to be AI satisfies the industry requirement",
}), () => {
  const c = compileChain(request("Find AI or developer-tools companies.", {
    filters: [{ field: "industry", op: "in", value: ["AI", "developer-tools"] }],
  }));
  assert(c.ok);
  const graph = buildCompanyEvidenceGraph("ai", [evidence("ai", "industry", "Artificial Intelligence")]);
  const e = evaluateEligibility(c.criteria, graph);
  assertEquals(e.hard_checks.industry, "pass", JSON.stringify(e.checks.filter((x) => x.dimension === "industry")));
});

Deno.test(qcase({
  id: "E05", rc: "RC02", boundary: "reconstructed", query: "Find 5 AI companies that raised Series A or Series B.",
  current: "hard company_stage = series_a only — Series B dropped",
  expected: "the stage requirement admits both series_a and series_b",
}), () => {
  const c = compileChain(request("Find 5 AI companies that raised Series A or Series B.", {
    count: 5, filters: [{ field: "industry", op: "eq", value: "AI" }, { field: "stage", op: "in", value: ["series_a", "series_b"] }],
  }));
  assert(c.ok);
  const stage = ofDim(c, "company_stage").filter((x) => x.status === "ok");
  assert(stage.some((x) => /series[_ ]?a/.test(textOf(x.value))), "series_a present");
  assert(stage.some((x) => /series[_ ]?b/.test(textOf(x.value))), `series_b dropped: ${stage.map((x) => textOf(x.value)).join(", ")}`);
});

Deno.test(qcase({
  id: "J06", rc: "RC02", boundary: "reconstructed",
  query: "Find 10 US recruiting-tech companies with 11–50 employees that raised Seed or Series A funding and are hiring sales.",
  current: "hard company_stage = seed only — Series A dropped, so Series A companies are excluded",
  expected: "the stage requirement admits both seed and series_a",
}), () => {
  const c = compileChain(request(
    "Find 10 US recruiting-tech companies with 11–50 employees that raised Seed or Series A funding and are hiring sales.", {
      count: 10,
      filters: [{ field: "industry", op: "eq", value: "recruiting-tech" }, { field: "geography", op: "eq", value: "United States" },
        { field: "employee_count", op: "range", value: { min: 11, max: 50 } }, { field: "stage", op: "in", value: ["seed", "series_a"] }],
      requirements: [hiring("hiring sales", ["sales"])],
    }));
  assert(c.ok);
  const stage = ofDim(c, "company_stage").filter((x) => x.status === "ok");
  assert(stage.some((x) => /seed/.test(textOf(x.value))), "seed present");
  assert(stage.some((x) => /series[_ ]?a/.test(textOf(x.value))), `series_a dropped: ${stage.map((x) => textOf(x.value)).join(", ")}`);
});

// ══ RC04 — A STATED HIRING REQUIREMENT IS HARD ══════════════════════════════

const hardHiring = (c: ReturnType<typeof compileChain>) => c.hard.filter((x) => x.dimension === "hiring");

for (const [id, query, spec, current] of [
  ["A09", "Is Anthropic hiring account executives?",
    { objective: "research", references: [named("Anthropic")], requirements: [hiring("hiring account executives", ["account executives"])] },
    "hiring is a TARGET — the job search the question asks for is never run"],
  ["A10", "Does OpenAI have open sales roles?",
    { objective: "research", references: [named("OpenAI")], requirements: [hiring("open sales roles", ["sales"])] },
    "hiring is a TARGET — the question is never answered"],
  ["A08", "Check whether Delta Lake has open sales positions.",
    { objective: "research", references: [named("Delta Lake")], requirements: [hiring("has open sales positions", ["sales positions"])] },
    "hiring is a TARGET"],
  ["F01", "Find 5 companies hiring salespeople.",
    { count: 5, requirements: [hiring("hiring salespeople", ["salespeople"])] },
    "hiring is a TARGET — the card has ZERO hard claims"],
  ["N03", "Find me some AI companies that are actually hiring sales rn.",
    { filters: [{ field: "industry", op: "eq", value: "AI" }], requirements: [hiring("actually hiring sales rn", ["sales"])] },
    "hiring is a TARGET"],
  ["S04", "Find companies hiring sales right now.",
    { requirements: [hiring("hiring sales right now", ["sales"])] },
    "hiring is a TARGET — the card has ZERO hard claims"],
] as const) {
  Deno.test(qcase({
    id, rc: "RC04", boundary: "reconstructed", query, current,
    expected: "hiring is a HARD claim verified per company",
  }), () => {
    const c = compileChain(request(query, spec as never));
    assert(c.ok, `refused: ${JSON.stringify(c.refusal)}`);
    assertEquals(hardHiring(c).length, 1,
      `hiring compiled as ${ofDim(c, "hiring").map((x) => `${x.kind}/${x.status}`).join(", ") || "nothing"}`);
  });
}

// ══ RC05 — FUNDING PRESENCE AND ABSOLUTE DATES ═════════════════════════════

Deno.test(qcase({
  id: "A05", rc: "RC05", boundary: "reconstructed", query: "Has LlamaIndex raised venture funding?",
  current: "REFUSED (UNSUPPORTED, no_requirement_provable: \"Nothing scheduled can establish funding\") — while A06 (\"recently\") compiles a verifiable hard funding claim for the same company",
  expected: "a feasible card with a hard, verifiable funding claim for LlamaIndex",
}), () => {
  const c = compileChain(request("Has LlamaIndex raised venture funding?", {
    objective: "research", references: [named("LlamaIndex")], requirements: [funding("raised venture funding", null)],
  }));
  assert(c.ok && c.mission);
  const f = feasibilityOf(c.mission!);
  assert(f.ok, `refused: ${f.refusals.map((r) => r.code).join(", ")}`);
  assert(c.claimPlan!.hard.some((h) => h.dimension === "funding" && h.status === "verifiable"), "funding is not a verifiable hard claim");
});

Deno.test(qcase({
  id: "S01", rc: "RC05", boundary: "reconstructed", query: "Find companies funded this year.",
  current: "funding is a TARGET (279-day window correct, kind wrong) — nothing rejects a company funded last year",
  expected: "funding is a HARD claim on the year-to-date window",
}), () => {
  const c = compileChain(request("Find companies funded this year.", { requirements: [funding("funded this year", 279)] }));
  assert(c.ok);
  const f = c.hard.filter((x) => x.dimension === "funding");
  assertEquals(f.length, 1, `funding compiled as ${ofDim(c, "funding").map((x) => x.kind).join(", ")}`);
  assertEquals(f[0].time_window?.days, 279);
});

Deno.test(qcase({
  id: "E01", rc: "RC05", boundary: "reconstructed", query: "Find 5 AI startups that have raised venture funding.",
  current: "funding is a TARGET — unfunded companies qualify",
  expected: "funding is a HARD claim",
}), () => {
  const c = compileChain(request("Find 5 AI startups that have raised venture funding.", {
    count: 5, filters: [{ field: "industry", op: "eq", value: "AI" }, { field: "stage", op: "eq", value: "startup" }],
    requirements: [funding("raised venture funding", null)],
  }));
  assert(c.ok);
  assertEquals(c.hard.filter((x) => x.dimension === "funding").length, 1,
    `funding compiled as ${ofDim(c, "funding").map((x) => x.kind).join(", ")}`);
});

// ══ RC06 — ONE WINDOW PER SIGNAL ════════════════════════════════════════════

for (const [id, query, spec] of [
  ["RND39", "Find 10 developer tools companies funded in the last 24 months hiring sales.", {
    count: 10, filters: [{ field: "industry", op: "eq", value: "developer tools" }],
    requirements: [funding("funded in the last 24 months", 730), hiring("hiring sales", ["sales"])],
  }],
  ["J07", "Find 20 US AI infrastructure companies with 11–200 employees that have raised institutional funding in the last two years and currently have at least one revenue-related opening.", {
    count: 20,
    filters: [{ field: "industry", op: "eq", value: "AI infrastructure" }, { field: "geography", op: "eq", value: "United States" },
      { field: "employee_count", op: "range", value: { min: 11, max: 200 } }],
    requirements: [funding("raised institutional funding in the last two years", 730),
      hiring("currently have at least one revenue-related opening", ["revenue-related"])],
  }],
] as const) {
  Deno.test(qcase({
    id, rc: "RC06", boundary: "reconstructed", query,
    current: "hiring carries the FUNDING window (730 days) — a two-year-old posting proves 'currently hiring'",
    expected: "hiring keeps its own window (30 days, 'currently / actively hiring'); funding keeps 730",
  }), () => {
    const c = compileChain(request(query, spec as never));
    assert(c.ok);
    const h = ofDim(c, "hiring").filter((x) => x.status === "ok");
    assert(h.length > 0, "hiring missing");
    for (const x of h) assertEquals(x.time_window?.days, 30, `hiring window ${x.time_window?.days}`);
    assert(ofDim(c, "funding").some((x) => x.time_window?.days === 730), "funding window 730 kept");
  });
}

// ══ RC07 — COMPANY BRAIN PROVENANCE ═════════════════════════════════════════

for (const [id, query, spec] of [
  ["C07", "Find 10 AI infrastructure companies.", { count: 10, filters: [{ field: "industry", op: "eq", value: "AI infrastructure" }] }],
  ["A01", "Check whether LlamaIndex currently has an open sales role.", {
    objective: "research", references: [named("LlamaIndex")], requirements: [hiring("currently has an open sales role", ["sales role"])],
  }],
] as const) {
  Deno.test(qcase({
    id, rc: "RC07", boundary: "reconstructed", query,
    current: "hard_constraints['company_profile.locations'] = united states, reason \"stated explicitly in the user's query\", while field_provenance says company_brain — sent to the evaluator as a hard constraint",
    expected: "a location the user did not state is never recorded as a hard constraint stated by the user",
  }), () => {
    const c = compileChain(request(query, spec as never));
    assert(c.ok && c.mission);
    const m = c.mission!;
    const hc = (m.hard_constraints as Record<string, { reason?: string } | undefined>)["company_profile.locations"];
    const prov = (m.field_provenance as Record<string, string> | undefined)?.["company_profile.locations"];
    assert(!(hc && prov === "company_brain"),
      `Brain location stamped hard: ${JSON.stringify(hc)} (provenance ${prov})`);
  });
}

// ══ RC08 — SUPPLIED-COMPANY REQUESTED COUNT ═════════════════════════════════

Deno.test(qcase({
  id: "A01", rc: "RC08", boundary: "reconstructed", query: "Check whether LlamaIndex currently has an open sales role.",
  current: "requested_count null → effective 5; a YES for LlamaIndex ends search_exhausted '1 of 5'",
  expected: "one supplied company, no stated count → requested 1; one qualified → completed",
}), () => {
  const c = compileChain(request("Check whether LlamaIndex currently has an open sales role.", {
    objective: "research", references: [named("LlamaIndex")], requirements: [hiring("currently has an open sales role", ["sales role"])],
  }));
  assert(c.ok && c.mission);
  assertEquals(c.effectiveCount, 1);
  const requested = c.effectiveCount!;
  const d = decideAutoContinuation({
    qualified: 1, requestedCount: requested, frontierRemaining: 0, continuationsUsed: 0, maxContinuations: 10,
    costUnitsUsed: 5, maxCostUnits: 40, barrenSlices: 0, discoveryRoutesRemain: false, verificationRoutesRemain: 0,
    pendingRuns: 0, providerFailed: false,
  });
  const o = settleV2Outcome({
    continuing: d.continue, stopReason: String(d.reason), legacyStatus: "partial",
    legacyQuota: { eligible_leads: 1, requested_leads: requested }, canonicalQualified: 1, requestedCount: requested,
    companyIsDeliverable: companyIsTheDeliverable(c.mission!),
  });
  assertEquals(o.terminal, "completed");
});

Deno.test(qcase({
  id: "R01", rc: "RC08", boundary: "reconstructed", query: "Find LlamaIndex and Llama Index.",
  current: "two supplied companies (LlamaIndex, Llama Index), requested 2 — one real company, so the quota can never be met",
  expected: "one supplied identity; the requested count cannot exceed the distinct companies supplied",
}), () => {
  const c = compileChain(request("Find LlamaIndex and Llama Index.", {
    objective: "research", references: [named("LlamaIndex"), named("Llama Index")],
  }));
  assert(c.ok && c.mission);
  assertEquals(c.mission!.company_profile.known_companies.length, 1, JSON.stringify(c.mission!.company_profile.known_companies));
  assert(c.effectiveCount! <= 1, `requested ${c.effectiveCount}`);
});
