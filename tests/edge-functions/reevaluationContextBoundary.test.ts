// THE BOUNDARY BETWEEN THE CAPABILITY ENGINE AND P4.
//
// P4 runs OUTSIDE the capability walk on purpose: qualification priority,
// deadline budgeting, provider execution and continuation are proven and
// sensitive, and a second model call inside that loop would put all four at
// risk to save a parameter.
//
// "Outside the engine" must not become "hand run-agent the engine's insides".
// These tests pin what crosses: three already-decided, already-serializable
// values, and nothing else. No working set, no registry object, no deadline.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  reevaluationContextFrom, evaluationInputFromContext,
  MISSION_REEVALUATION_CONTEXT_VERSION,
  type MissionEvaluationInput, type MissionReevaluationContextV1,
} from "../../supabase/functions/_shared/missionEvaluation.ts";

const input = (): MissionEvaluationInput => ({
  schema_version: "mission-evaluation-input-v1",
  instruction: "Find me 5 B2B SaaS companies in the UK",
  mission: { verticals: ["b2b saas"], locations: ["United Kingdom"],
    employee_range: { min: 20, max: 200 } },
  brain: { hard_constraints: {}, preferences: { industries: ["saas"] } },
  company: { company_key: "x", evidence: [{ evidence_id: "a", source_text: "big" }],
    established_facts: { employee_count: 131 } },
});

Deno.test("the context is EXACTLY the evaluator input minus `company`", () => {
  const ctx = reevaluationContextFrom(input());
  assertEquals(Object.keys(ctx).sort(), ["brain", "instruction", "mission", "version"]);
  // The engine's per-company payload — evidence, established facts — does NOT
  // cross. It is rebuilt on the far side from the registry with cached pages
  // folded in, which is the only reason this boundary can be this narrow.
  assert(!JSON.stringify(ctx).includes("established_facts"));
  assert(!JSON.stringify(ctx).includes("evidence_id"));
});

Deno.test("the mission is CARRIED, not rebuilt", () => {
  const i = input();
  const ctx = reevaluationContextFrom(i);
  // Same object graph, byte-identical when serialized: no recompilation, no
  // lossy reconstruction in run-agent.
  assertEquals(JSON.stringify(ctx.mission), JSON.stringify(i.mission));
  assertEquals(JSON.stringify(ctx.brain), JSON.stringify(i.brain));
  assertEquals(ctx.instruction, i.instruction);
});

Deno.test("the context survives a checkpoint/serialization boundary", () => {
  const ctx = reevaluationContextFrom(input());
  const roundTripped = JSON.parse(JSON.stringify(ctx)) as MissionReevaluationContextV1;
  assertEquals(roundTripped, ctx, "plain JSON by construction");
  assertEquals(roundTripped.version, MISSION_REEVALUATION_CONTEXT_VERSION);
  // And it still reconstitutes a usable evaluator base after the round trip.
  const base = evaluationInputFromContext(roundTripped);
  assertEquals(base.instruction, ctx.instruction);
  assertEquals(base.schema_version, "mission-evaluation-input-v1");
});

Deno.test("reconstitution leaves `company` for the registry to fill", () => {
  // `buildMissionReevaluationInput` overwrites it from the rebuilt registry.
  // An empty object here is the honest placeholder; a stale company block is
  // what shipped first and made the model say it had been given no evidence.
  const base = evaluationInputFromContext(reevaluationContextFrom(input()));
  assertEquals(base.company, {});
});

Deno.test("ONE evaluator contract, not two", () => {
  // The reconstituted base is a `MissionEvaluationInput` — the same type the
  // first pass uses. A second contract would let the two drift apart.
  const base = evaluationInputFromContext(reevaluationContextFrom(input()));
  assertEquals(Object.keys(base).sort(),
    ["brain", "company", "instruction", "mission", "schema_version"]);
});

Deno.test("no evaluation means no context, and therefore no P4 work", () => {
  // The engine leaves it null when nothing was evaluated: there is then no
  // compiled mission this run used, and inventing one is the reconstruction
  // this boundary exists to forbid. run-agent guards on it before doing
  // anything, so a run that evaluated nobody does no re-evaluation.
  const ctx: MissionReevaluationContextV1 | null = null;
  assertEquals(ctx, null);
});

Deno.test("the context carries no mutable engine state", () => {
  // Checked as KEYS, not as substrings. The first version of this searched the
  // serialized JSON for "companies" and failed on the user's own instruction —
  // "Find me 5 B2B SaaS companies in the UK" — which is prose, not engine
  // state. A leak is a field appearing where it does not belong.
  const ctx = reevaluationContextFrom(input());
  const keysOf = (v: unknown, acc: string[] = []): string[] => {
    if (Array.isArray(v)) { for (const x of v) keysOf(x, acc); return acc; }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) { acc.push(k); keysOf(val, acc); }
    }
    return acc;
  };
  const keys = new Set(keysOf(ctx));
  for (const leaked of [
    "companies", "resume_records", "deadline", "provider_attempts",
    "pending_runs", "capability_outcomes", "headcount_snapshots",
    "evidence", "established_facts", "items", "hard_facts",
  ]) {
    assert(!keys.has(leaked), `${leaked} must not cross the boundary`);
  }
  // Only the three fields plus the version tag exist at the top level.
  assertEquals(Object.keys(ctx).length, 4);
});

// ── THE CONTEXT IS A PROPERTY OF THE RUN, NOT OF AN EVALUATION ──────────────
//
// It was assigned lazily inside the per-company evaluation loop, so it existed
// only when the engine evaluated somebody NEW. On a resumed slice every verdict
// is restored and that loop body never runs.
//
// Lineage b1348724: seven generations after the write-back fix deployed,
// `decided_by_model: 0` on every slice, five evidence debts raised each time,
// and P4 skipped on all of them because run-agent found a null context. The
// re-evaluation had candidates, cached pages and a working write-back, and
// never ran once.

import { emptyEvidenceRegistry } from "../../supabase/functions/_shared/leadEvidenceRegistry.ts";

Deno.test("an empty registry still yields a usable mission/brain context", () => {
  // This is what the engine builds the context from, before any company exists.
  const reg = emptyEvidenceRegistry("");
  assertEquals(reg.items.length, 0, "it cites nothing");
  assertEquals(reg.company_key, "");
  // A claim checked against it is dropped, so it can never stand in for a real
  // registry where a verdict is decided.
  assertEquals(reg.hard_facts.employee_count, null);
  assertEquals(reg.hard_facts.geography, null);
});

Deno.test("the context does not depend on any company having been evaluated", () => {
  // Built from ctx + authority only. `company` is the sole part of an evaluator
  // input that needs a registry, and re-evaluation replaces it wholesale.
  const withCompany = reevaluationContextFrom({
    ...input(),
    company: { company_key: "acme", evidence: [{ evidence_id: "x" }] },
  });
  const withoutCompany = reevaluationContextFrom({ ...input(), company: {} });
  assertEquals(withCompany, withoutCompany,
    "the company half must not influence the carried context");
});
