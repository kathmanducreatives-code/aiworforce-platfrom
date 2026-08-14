// STAGE 2 (GPT MISSION INTELLIGENCE) AND STAGE 3 (SMART SHORTLIST + BUDGET).
//
// TWO DEFECTS, ONE STAGE APART.
//
// ROLE BREADTH. `prequalifyYcCompanies` decided eligibility with `classifyTitle`,
// a substring match over a vocabulary compiled from the Mission sentence. A
// Mission asking for "software engineers" produced the single fragment
// "software engineer", so ML Engineer, Founding Engineer and Member of Technical
// Staff were all classified `technical` and EXCLUDED — before any paid stage and
// before any model saw them. Extending the keyword list is not the fix; reading
// the Mission is.
//
// THE SHORTLIST CEILING. `min(10, max(5, requested * 2))` derived spend from the
// requested lead count. Asking for 5 leads and asking for 50 both authorised ten
// companies of paid evidence, so any request above five was arithmetically
// unsatisfiable. Requested count and evidence budget are separate concepts.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  parseMissionTriageStrict, triageBatches, TRIAGE_BATCH_SIZE,
  type MissionTriageInput,
} from "../../../supabase/functions/_shared/missionTriage.ts";
import {
  buildSmartShortlist, DEFAULT_INVESTIGATION_BUDGET, INVESTIGATION_BUDGET_ENV,
  MAX_INVESTIGATION_BUDGET, resolveInvestigationBudget,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  buildMissionTriageBinding, isMissionTriageEnabled,
} from "../../../supabase/functions/_shared/missionTriageBinding.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// ─────────────────────────────────────────────────────────────── the fixture ──

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 500 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 500,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * THE ROLES THE DICTIONARY THROWS AWAY — measured, not assumed.
 *
 * `buildQualificationContext` expands "software engineers" into a FIXED list:
 *
 *     software engineer · backend engineer · frontend engineer ·
 *     full stack engineer · ai engineer · ml engineer · developer ·
 *     staff engineer
 *
 * So ML Engineer and AI Engineer survive — not because anything understood the
 * Mission, but because someone previously added them to the list. That is the
 * actual defect, and it is worse than a missing entry: the list must grow
 * forever, and every role nobody thought of is silently excluded before a single
 * paid stage runs.
 *
 * These five are what the current list misses. Each one plainly satisfies
 * "hiring software engineers" and each is classified `technical` or `other`,
 * which means INELIGIBLE.
 */
const BREADTH_ROLES = [
  "Founding Engineer", "Member of Technical Staff", "Platform Engineer",
  "Infrastructure Engineer", "Data Scientist",
];

/** Already in the dictionary. Kept to prove the list is the mechanism. */
const DICTIONARY_ROLES = ["ML Engineer", "AI Engineer", "Backend Engineer"];

const rows = (titles: readonly string[]) =>
  titles.map((title, i) => ({
    name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40 + i,
    batch: "W20", industries: ["B2B"], id: `acme${i}`,
    openJobs: [{ title }],
  })) as unknown as Record<string, unknown>[];

// ══════════════════════════════ 1. the parser can never exclude by accident ══

Deno.test("1. an unparseable triage response makes everyone UNCERTAIN, never irrelevant",
  async () => {
    const keys = ["a.com", "b.com", "c.com"];
    for (const bad of [null, undefined, "", "not json", {}, 42, { verdicts: "nope" }]) {
      const p = parseMissionTriageStrict(bad, keys);
      assertEquals(p.parse_status, "invalid_all_uncertain");
      assertEquals(p.verdicts.size, 3);
      for (const k of keys) {
        assertEquals(p.verdicts.get(k)!.relevance, "uncertain",
          `${JSON.stringify(bad)} must never exclude ${k}`);
      }
    }
    await Promise.resolve();
  });

Deno.test("1b. an unreadable relevance value is UNCERTAIN, not irrelevant", () => {
  const p = parseMissionTriageStrict({
    verdicts: [
      { company_key: "a.com", relevance: "REJECT", confidence: 0.9 },
      { company_key: "b.com", relevance: "irrelevant", confidence: 0.9 },
    ],
  }, ["a.com", "b.com"]);
  assertEquals(p.verdicts.get("a.com")!.relevance, "uncertain",
    "a value outside the vocabulary may not remove a company");
  assertEquals(p.verdicts.get("b.com")!.relevance, "irrelevant",
    "an explicit irrelevant IS honoured — that is the only way to exclude");
  assert(p.raw_shape.repaired_fields.includes("relevance:a.com"));
});

Deno.test("1c. a company the model never answered for stays in the run", () => {
  const p = parseMissionTriageStrict({
    verdicts: [{ company_key: "a.com", relevance: "relevant", confidence: 0.8 }],
  }, ["a.com", "b.com", "c.com"]);
  assertEquals(p.verdicts.get("b.com")!.relevance, "uncertain");
  assertEquals(p.verdicts.get("c.com")!.relevance, "uncertain");
  assertEquals(p.raw_shape.missing_keys.sort(), ["b.com", "c.com"]);
});

Deno.test("1d. a verdict for a company outside the batch is dropped", () => {
  const p = parseMissionTriageStrict({
    verdicts: [
      { company_key: "a.com", relevance: "relevant", confidence: 0.8 },
      { company_key: "not-in-batch.com", relevance: "irrelevant", confidence: 1 },
    ],
  }, ["a.com"]);
  assertEquals(p.verdicts.size, 1, "the model cannot reach a company it was not shown");
  assertEquals(p.raw_shape.unknown_keys, ["not-in-batch.com"]);
});

Deno.test("1e. values are clamped rather than trusted", () => {
  const p = parseMissionTriageStrict({
    verdicts: [{
      company_key: "a.com", relevance: "relevant",
      confidence: 9.9, signal_strength: 5000,
    }],
  }, ["a.com"]);
  const v = p.verdicts.get("a.com")!;
  assertEquals(v.confidence, 1);
  assertEquals(v.signal_strength, 100);
});

// ══════════════════════════════════════════ 2. batching keeps triage cheap ══

Deno.test("2. a hundred candidates cost four batches, not a hundred calls", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const batches = triageBatches(items);
  assertEquals(TRIAGE_BATCH_SIZE, 25);
  assertEquals(batches.length, 4);
  assertEquals(batches.flat().length, 100, "and nobody is dropped by batching");
});

Deno.test("2b. the binding is OFF unless the flag AND the allow-list both pass", () => {
  const env = (o: Record<string, string>) => (k: string) => o[k];
  assertEquals(isMissionTriageEnabled("ws-1", env({})).reason, "flag_off");
  assertEquals(
    isMissionTriageEnabled("ws-1", env({ MISSION_TRIAGE: "true" })).reason,
    "no_workspace_allowlist");
  assertEquals(
    isMissionTriageEnabled("ws-1", env({
      MISSION_TRIAGE: "true", MISSION_TRIAGE_WORKSPACES: "ws-2",
    })).reason, "workspace_not_allowed");

  const off = buildMissionTriageBinding({
    workspaceId: "ws-1", read: () => undefined, poolSize: 100,
  });
  assertEquals(off.triageCompanies, null, "no call is made when disabled");
  assertEquals(off.diagnostics.batches_allowed, 0);
});

// ══════════════════════════ 3. the budget is not the requested lead count ══

Deno.test("3. the budget no longer moves when the requested lead count moves", () => {
  const read = () => undefined;
  const at = (requested: number) =>
    resolveInvestigationBudget({ requestedCount: requested, poolSize: 100, read }).budget;

  // THE OLD BEHAVIOUR: min(10, max(5, n*2)) — 5→10 and 50→10, identical, and a
  // request for 50 leads was arithmetically unsatisfiable from ten companies.
  assertEquals(at(1), DEFAULT_INVESTIGATION_BUDGET);
  assertEquals(at(5), DEFAULT_INVESTIGATION_BUDGET);
  // A FLOOR, NOT A MULTIPLIER. Never fewer companies than leads requested.
  assertEquals(at(25), 25, "returning 25 leads from 10 companies is impossible");
  assertEquals(at(500), MAX_INVESTIGATION_BUDGET, "and the hard cap still binds");
});

Deno.test("3b. DEFAULT SPEND IS UNCHANGED — the refactor costs nothing", () => {
  // The old ceiling was 10. This is the assertion that says adopting the budget
  // controller does not, by itself, buy a single extra Actor call.
  assertEquals(DEFAULT_INVESTIGATION_BUDGET, 10);
  const b = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 100, read: () => undefined,
  });
  assertEquals(b.budget, 10);
  assertEquals(b.source, "default");
});

Deno.test("3c. an operator may raise the budget, but never past the hard cap", () => {
  const withEnv = (v: string) => resolveInvestigationBudget({
    requestedCount: 5, poolSize: 500,
    read: (k) => (k === INVESTIGATION_BUDGET_ENV ? v : undefined),
  });
  assertEquals(withEnv("30").budget, 30);
  assertEquals(withEnv("30").source, "environment");
  assertEquals(withEnv("99999").budget, MAX_INVESTIGATION_BUDGET,
    "one typo must not authorise unbounded provider spend");
});

Deno.test("3d. the budget never exceeds the candidates that exist", () => {
  const b = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 3, read: () => undefined,
  });
  assertEquals(b.budget, 3);
  assertEquals(b.source, "pool_bound");
});

// ══════════════════════════════════ 4. the shortlist ranks, and says why ══

Deno.test("4. relevant outranks uncertain, and only IRRELEVANT excludes", () => {
  const budget = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 10, read: () => undefined,
  });
  const d = buildSmartShortlist([
    { company_key: "weak", eligible: true, relevance: "uncertain", confidence: 0.9, signal_strength: 90 },
    { company_key: "strong", eligible: true, relevance: "relevant", confidence: 0.5, signal_strength: 50 },
    { company_key: "out", eligible: true, relevance: "irrelevant", confidence: 0.9, signal_strength: 99 },
  ], budget);

  assertEquals(d.ranking, ["strong", "weak"], "tier beats every other signal");
  assertFalse(d.selected.includes("out"));
  assertEquals(d.excluded.find((e) => e.company_key === "out")?.reason, "triage_irrelevant");
});

Deno.test("4b. GPT can rescue a company the deterministic pass called ineligible", () => {
  // THE ROLE-BREADTH FIX, at the shortlist layer: `eligible:false` is what
  // `classifyTitle` produced for "ML Engineer". A triage verdict overrides it.
  const budget = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 10, read: () => undefined,
  });
  const d = buildSmartShortlist([
    { company_key: "ml-engineer-co", eligible: false, relevance: "relevant", confidence: 0.9, signal_strength: 80 },
    { company_key: "no-triage-ineligible", eligible: false, relevance: null },
  ], budget);

  assert(d.selected.includes("ml-engineer-co"),
    "a company GPT called relevant is investigated even though the keyword gate refused it");
  assertFalse(d.selected.includes("no-triage-ineligible"),
    "and with NO triage the deterministic gate still stands — behaviour unchanged when off");
  assertEquals(
    d.excluded.find((e) => e.company_key === "no-triage-ineligible")?.reason,
    "prequalification_ineligible");
});

Deno.test("4c. running out of budget is recorded as budget, not as a judgement", () => {
  const budget = resolveInvestigationBudget({
    requestedCount: 1, poolSize: 30, read: () => undefined,
  });
  const d = buildSmartShortlist(
    Array.from({ length: 30 }, (_, i) => ({
      company_key: `c${i}`, eligible: true,
      relevance: "relevant" as const, confidence: 0.8, signal_strength: 100 - i,
    })), budget);

  assertEquals(d.selected.length, 10);
  const spill = d.excluded.filter((e) => e.reason === "budget_exhausted");
  assertEquals(spill.length, 20,
    "twenty companies were never judged — they were never reached");
  assertEquals(d.selected[0], "c0", "and the strongest signal is bought first");
});

Deno.test("4d. ordering is deterministic and no longer alphabetical-first", () => {
  const budget = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 10, read: () => undefined,
  });
  const mk = () => buildSmartShortlist([
    { company_key: "zebra", eligible: true, relevance: "relevant", confidence: 0.9, signal_strength: 95 },
    { company_key: "alpha", eligible: true, relevance: "relevant", confidence: 0.9, signal_strength: 10 },
  ], budget).ranking;
  assertEquals(mk(), ["zebra", "alpha"], "signal strength beats the alphabet");
  assertEquals(mk(), mk(), "and the order is stable across runs");
});

// ═══════════════════════════════ 5. through the real engine, end to end ══

const runEngine = async (o: {
  titles: readonly string[];
  triage?: (i: { input: MissionTriageInput; company_keys: string[] }) => Promise<unknown>;
  budgetEnv?: string;
}) => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve(rows(o.titles));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    ...(o.triage ? { triageCompanies: o.triage } : {}),
  } as never, {
    mission: m, plan, brain: BRAIN, maxCandidates: 60,
    readEnv: (k: string) =>
      (k === INVESTIGATION_BUDGET_ENV ? o.budgetEnv : undefined),
  } as never);
  return run;
};

Deno.test("5. THE DEFECT: a role absent from the dictionary is excluded before any spend",
  async () => {
    const run = await runEngine({ titles: BREADTH_ROLES });
    assertEquals(run.companies.filter((c) => c.shortlisted).length, 0,
      "Founding Engineer, Member of Technical Staff, Platform Engineer, " +
      "Infrastructure Engineer and Data Scientist are all dropped");
    for (const c of run.companies) {
      assertEquals(c.shortlist_exclusion, "prequalification_ineligible");
    }
  });

Deno.test("5a. …while roles that happen to BE in the dictionary sail through", async () => {
  // The contrast is the argument: nothing here understood the Mission. One set
  // of engineering roles was added to a list and the other was not.
  const run = await runEngine({ titles: DICTIONARY_ROLES });
  assertEquals(run.companies.filter((c) => c.shortlisted).length,
    DICTIONARY_ROLES.length,
    "eligibility tracks list membership, not meaning");
});

Deno.test("5b. THE FIX: GPT triage restores them and they are investigated", async () => {
  const run = await runEngine({
    titles: BREADTH_ROLES,
    triage: ({ company_keys }) => Promise.resolve({
      verdicts: company_keys.map((k) => ({
        company_key: k, relevance: "relevant", confidence: 0.9,
        signal_strength: 80, reasons: ["engineering hiring satisfies the mission"],
        matched_roles: ["engineer"],
      })),
    }),
  });

  const shortlisted = run.companies.filter((c) => c.shortlisted);
  assertEquals(shortlisted.length, BREADTH_ROLES.length,
    "every breadth role is now worth investigating");
  assertEquals(run.state.triage?.relevant, BREADTH_ROLES.length);
  assertEquals(run.state.triage?.irrelevant, 0);
  for (const c of shortlisted) {
    assertEquals(c.triage?.relevance, "relevant");
    assertEquals(c.shortlist_exclusion, null);
  }
});

Deno.test("5c. an IRRELEVANT verdict is the one thing that excludes", async () => {
  const run = await runEngine({
    titles: BREADTH_ROLES,
    triage: ({ company_keys }) => Promise.resolve({
      verdicts: company_keys.map((k, i) => ({
        company_key: k,
        relevance: i === 0 ? "irrelevant" : "relevant",
        confidence: 0.9, signal_strength: 70, reasons: [], matched_roles: [],
      })),
    }),
  });
  const excluded = run.companies.filter((c) => !c.shortlisted);
  assertEquals(excluded.length, 1);
  assertEquals(excluded[0].shortlist_exclusion, "triage_irrelevant");
  assertEquals(run.state.triage?.irrelevant, 1);
});

Deno.test("5d. a THROWING triage call excludes nobody", async () => {
  const run = await runEngine({
    titles: BREADTH_ROLES,
    triage: () => Promise.reject(new Error("model exploded")),
  });
  // Everyone is uncertain, and uncertain is fully investigable.
  assertEquals(run.state.triage?.uncertain, BREADTH_ROLES.length);
  assertEquals(run.companies.filter((c) => c.shortlisted).length, BREADTH_ROLES.length,
    "a model failure must not cost a single candidate its place");
});

Deno.test("5e. the budget is honoured end to end and recorded with its source", async () => {
  const titles = Array.from({ length: 30 }, () => "ML Engineer");
  const run = await runEngine({
    titles,
    budgetEnv: "12",
    triage: ({ company_keys }) => Promise.resolve({
      verdicts: company_keys.map((k, i) => ({
        company_key: k, relevance: "relevant", confidence: 0.9,
        signal_strength: 100 - i, reasons: [], matched_roles: [],
      })),
    }),
  });

  assertEquals(run.companies.filter((c) => c.shortlisted).length, 12,
    "the operator's budget decides the shortlist, not the requested lead count");
  assertEquals(run.state.shortlist_decision?.budget.budget, 12);
  assertEquals(run.state.shortlist_decision?.budget.source, "environment");
  assertEquals(run.state.shortlist_decision?.budget.requested_count, 5,
    "the requested count is recorded and NOT multiplied into the budget");
  // The rest were never judged.
  assertEquals(
    run.companies.filter((c) => c.shortlist_exclusion === "budget_exhausted").length,
    titles.length - 12);
});
