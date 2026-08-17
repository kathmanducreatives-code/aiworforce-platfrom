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
  buildSmartShortlist, DEFAULT_INVESTIGATION_BUDGET, DEFAULT_TRIAGE_CONCURRENCY,
  INVESTIGATION_BUDGET_ENV, isFrontier, MAX_INVESTIGATION_BUDGET,
  MAX_TRIAGE_CONCURRENCY, resolveInvestigationBudget, resolveTriageConcurrency,
  resolveUntriagedPolicy, TRIAGE_CONCURRENCY_ENV, UNTRIAGED_POLICY_ENV,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  buildMissionTriageBinding, isMissionTriageEnabled,
} from "../../../supabase/functions/_shared/missionTriageBinding.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

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
  //
  // THE FLOOR IS GONE TOO. It used to raise the budget to the requested count
  // ("never investigate fewer companies than we were asked to return"), which
  // sounded like arithmetic and was really the product question setting the
  // spend decision through the last remaining door. Asking for 25 leads does
  // not make 25 paid investigations affordable — and if it is not affordable,
  // the honest output is a shortfall, not the spend.
  //
  // `requested_count` is now recorded and never read by the arithmetic.
  for (const n of [1, 5, 25, 500]) {
    assertEquals(at(n), DEFAULT_INVESTIGATION_BUDGET,
      `requested_count=${n} must not move the investigation budget`);
  }
  // It is still CARRIED, so a shortfall can name what was asked for.
  assertEquals(
    resolveInvestigationBudget({ requestedCount: 25, poolSize: 100, read }).requested_count,
    25);
  assert(MAX_INVESTIGATION_BUDGET >= DEFAULT_INVESTIGATION_BUDGET);
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
  // ── AND WITH NO TRIAGE THE KEYWORD GATE NO LONGER EXCLUDES EITHER ────────
  //
  // This used to assert the opposite. "Behaviour unchanged when off" sounded
  // conservative, but Mission Intelligence is off by DEFAULT — so the branch it
  // preserved was the one that actually ran in production, and the brittle
  // vocabulary remained the real gate for every live run. A substring match may
  // not permanently remove a candidate, because nothing downstream can recover
  // one: the pool is the only place a company can be reconsidered from.
  //
  // It still RANKS last (see `NO_TRIAGE_INELIGIBLE_TIER`), so it consumes only
  // budget that no better candidate wanted.
  assert(d.selected.includes("no-triage-ineligible"),
    "with no GPT verdict the deterministic pass ranks, it does not exclude");
  assertEquals(d.ranking, ["ml-engineer-co", "no-triage-ineligible"],
    "and the GPT-relevant company is still investigated first");
  assertEquals(d.excluded.length, 0, "nobody is removed from the pool");
  assertEquals(d.untriaged_policy, "rank");
});

Deno.test("4c. an operator may restore the old spend profile explicitly", () => {
  // THE COST CONTROL, MADE EXPLICIT RATHER THAN IMPLIED. `rank` spends the full
  // budget on a large pool; `eligible_only` spends only what the vocabulary
  // approved. That is a money decision, so it is an operator's to make — and it
  // is recorded on the decision either way.
  const budget = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 10, read: () => undefined,
  });
  const candidates = [
    { company_key: "eligible-co", eligible: true, relevance: null },
    { company_key: "ineligible-co", eligible: false, relevance: null },
  ];
  const legacy = buildSmartShortlist(candidates, budget, { untriaged: "eligible_only" });
  assertEquals(legacy.selected, ["eligible-co"]);
  assertEquals(
    legacy.excluded.find((e) => e.company_key === "ineligible-co")?.reason,
    "prequalification_ineligible");
  assertEquals(legacy.untriaged_policy, "eligible_only");

  // ...and the env var is what selects it.
  assertEquals(resolveUntriagedPolicy(() => undefined), "rank");
  assertEquals(resolveUntriagedPolicy(() => "eligible_only"), "eligible_only");
  assertEquals(resolveUntriagedPolicy(() => "nonsense"), "rank",
    "an unreadable value falls back to the architecture's default");
});

Deno.test("4d. a MISSION-STATED size constraint still removes a candidate", () => {
  // THE ONE NON-GPT EXCLUSION THAT SURVIVES, and the reason it is separate from
  // `eligible`: the Mission set a range and this company is verifiably outside
  // it. That is a falsifiable fact about a constraint the USER expressed, not a
  // judgement about role titles — so paying to investigate it buys a lead that
  // cannot qualify. Triage cannot override it either.
  const budget = resolveInvestigationBudget({
    requestedCount: 5, poolSize: 10, read: () => undefined,
  });
  const d = buildSmartShortlist([
    { company_key: "too-big", eligible: true, hard_exclusion: "employee_size",
      relevance: "relevant", confidence: 1, signal_strength: 99 },
    { company_key: "in-range", eligible: true, relevance: null },
  ], budget);
  assertFalse(d.selected.includes("too-big"),
    "a verified mission-stated disqualifier is not overridable by triage");
  assertEquals(
    d.excluded.find((e) => e.company_key === "too-big")?.reason,
    "mission_constraint:employee_size");
  assert(d.selected.includes("in-range"));
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
  /** Extra env, so the untriaged spend policy is exercised through the engine. */
  env?: Record<string, string>;
}) => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
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
      (k === INVESTIGATION_BUDGET_ENV
        ? o.budgetEnv
        // ONE PASS: this file's subject is triage and the shortlist ranking,
        // not the frontier's yield loop.
        : k === "LEAD_INVESTIGATION_MAX_PASSES"
        ? "1"
        : o.env?.[k]),
  } as never);
  return run;
};

Deno.test("5. THE DEFECT IS FIXED: a role absent from the dictionary is no longer excluded",
  async () => {
    // WHAT THIS TEST USED TO ASSERT, VERBATIM: that all five companies were
    // dropped and every one carried `shortlist_exclusion:
    // "prequalification_ineligible"`. It was written to DOCUMENT the defect
    // while Mission Intelligence was built beside it — but the flag is off by
    // default, so the documented defect was also the shipping behaviour.
    //
    // Founding Engineer, Member of Technical Staff, Platform Engineer,
    // Infrastructure Engineer and Data Scientist all plainly satisfy a Mission
    // asking for software engineers. None appears in the compiled vocabulary.
    // They now enter the investigation pool on the deterministic path too — the
    // vocabulary orders them, it does not delete them.
    const run = await runEngine({ titles: BREADTH_ROLES });
    assertEquals(run.companies.filter((c) => c.shortlisted).length, BREADTH_ROLES.length,
      "every breadth role now reaches investigation, with no GPT verdict at all");
    for (const c of run.companies) {
      assertEquals(c.shortlist_exclusion, null, c.key);
      // The deterministic opinion is still RECORDED — it simply has no veto.
      assertFalse(c.prequalified?.eligible ?? true,
        `${c.key}: the vocabulary still rates it ineligible, and is still wrong`);
    }
  });

Deno.test("5-legacy. …and an operator can still restore the old exclusion", async () => {
  // The same pool under `eligible_only`. Kept as a real, exercised path so the
  // rollback is a configuration change rather than a code revert.
  const run = await runEngine({
    titles: BREADTH_ROLES,
    env: { [UNTRIAGED_POLICY_ENV]: "eligible_only" },
  });
  assertEquals(run.companies.filter((c) => c.shortlisted).length, 0);
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
  // ── THE REST ARE WAITING, NOT EXCLUDED ────────────────────────────────────
  //
  // This used to assert eighteen companies carried `shortlist_exclusion ===
  // "budget_exhausted"`, and that assertion was the bug written down: a queue
  // POSITION was recorded as a REASON, the Workbench read it as a verdict, and
  // no later pass or continuation ever reconsidered them. Ninety companies
  // were closed this way in the run that prompted the frontier work.
  //
  // Being past position twelve is now a cursor, not a judgement.
  const waiting = run.companies.filter((c) => isFrontier(c.investigation_state));
  assertEquals(waiting.length, titles.length - 12,
    "everyone the budget did not reach stays on the frontier");
  assertEquals(
    run.companies.filter((c) => c.shortlist_exclusion === "budget_exhausted").length, 0,
    "and NONE of them is given a reason — the budget is not a verdict");
  // The spend is still bounded, and the state says so in its own field.
  assertEquals(run.state.investigation_selected, 12);
});

// ═════════════ 6. TRIAGE MUST NOT SPEND THE PAID STAGES' WALL CLOCK ══
//
// Task 83843770, a 125s budget, measured from the run's own log timestamps:
//
//   discovery                28.7s
//   GPT triage               33.6s   ← four batches of 25, one after another
//   identity resolution      19.1s   ← 5 of 10 companies; 5 deferred
//   enrichment               10.5s
//   evaluation + brain       11.3s
//
// The free, read-only stage took more wall clock than the paid stage it starves.
// Every batch is an independent model call over a DISJOINT set of companies, so
// the sequencing bought nothing at all.

Deno.test("6. triage batches run concurrently, not one after another", async () => {
  let inFlight = 0;
  let peak = 0;
  const order: string[] = [];

  await runEngine({
    titles: Array.from({ length: 100 }, () => "ML Engineer"),
    triage: async ({ company_keys }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      order.push(`start:${company_keys.length}`);
      // A round trip. Sequenced, four of these are four times the latency.
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return {
        verdicts: company_keys.map((k) => ({
          company_key: k, relevance: "relevant", confidence: 0.9,
          signal_strength: 80, reasons: [], matched_roles: [],
        })),
      };
    },
  });

  assert(peak > 1,
    `four independent batches must overlap; peak concurrency was ${peak}`);
  assertEquals(peak, DEFAULT_TRIAGE_CONCURRENCY,
    "and the lane count is the configured one, not unbounded");
});

Deno.test("6b. concurrency changes the timing and NOTHING else", async () => {
  // The verdicts are keyed by company and the batches are disjoint, so the
  // result must be identical whichever order the lanes happen to finish in.
  const triage = ({ company_keys }: { company_keys: string[] }) =>
    Promise.resolve({
      verdicts: company_keys.map((k, i) => ({
        company_key: k,
        relevance: i % 7 === 0 ? "irrelevant" : "relevant",
        confidence: 0.9, signal_strength: 100 - i, reasons: [], matched_roles: [],
      })),
    });

  const titles = Array.from({ length: 100 }, () => "ML Engineer");
  const serial = await runEngine({
    titles, triage, env: { [TRIAGE_CONCURRENCY_ENV]: "1" },
  });
  const parallel = await runEngine({
    titles, triage, env: { [TRIAGE_CONCURRENCY_ENV]: "4" },
  });

  assertEquals(parallel.state.triage?.relevant, serial.state.triage?.relevant);
  assertEquals(parallel.state.triage?.irrelevant, serial.state.triage?.irrelevant);
  assertEquals(parallel.state.triage?.uncertain, serial.state.triage?.uncertain);
  assertEquals(parallel.state.triage?.batches_made, serial.state.triage?.batches_made);
  // Every company reaches the same verdict either way.
  const verdictOf = (r: typeof serial) =>
    r.companies.map((c) => `${c.key}:${c.triage?.relevance ?? "none"}`).sort();
  assertEquals(verdictOf(parallel), verdictOf(serial),
    "overlapping the calls must not move a single company");
});

Deno.test("6c. a THROWN batch still excludes nobody when lanes overlap", async () => {
  // The concurrency guard's safety argument: if overlapping provokes a rate
  // limit, the call throws and those companies become `uncertain` — fully
  // investigable. Overshooting costs a ranking signal, never a candidate.
  let n = 0;
  const run = await runEngine({
    titles: Array.from({ length: 100 }, () => "ML Engineer"),
    triage: ({ company_keys }) => {
      // Every other batch fails, whichever lane picks it up.
      if (n++ % 2 === 0) return Promise.reject(new Error("429 rate limited"));
      return Promise.resolve({
        verdicts: company_keys.map((k) => ({
          company_key: k, relevance: "relevant", confidence: 0.9,
          signal_strength: 80, reasons: [], matched_roles: [],
        })),
      });
    },
  });

  assertEquals(run.state.triage!.irrelevant, 0, "a failed call excludes nobody");
  assertEquals(
    (run.state.triage!.relevant ?? 0) + (run.state.triage!.uncertain ?? 0), 100,
    "every company still carries a verdict");
  assertEquals(
    run.companies.filter((c) => c.shortlist_exclusion === "triage_irrelevant").length, 0);
});

Deno.test("6d. the batch ALLOWANCE still caps model calls", async () => {
  // Concurrency must not become a way around the budget.
  assertEquals(resolveTriageConcurrency(() => undefined), DEFAULT_TRIAGE_CONCURRENCY);
  assertEquals(resolveTriageConcurrency((k) =>
    k === TRIAGE_CONCURRENCY_ENV ? "999" : undefined), MAX_TRIAGE_CONCURRENCY,
    "and it is capped, however it is configured");
  assertEquals(resolveTriageConcurrency((k) =>
    k === TRIAGE_CONCURRENCY_ENV ? "0" : undefined), DEFAULT_TRIAGE_CONCURRENCY,
    "a nonsense value falls back rather than serialising or exploding");
});
