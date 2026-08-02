// PACK SEPARATION + SOURCE IDENTITY.
//
// Two guarantees the qualified-lead contract depends on:
//  1. Query packs execute as SEPARATE provider calls — never merged into one
//     `A OR B OR C` query.
//  2. A paid call's idempotency key names the FINAL actor and the pack, so two
//     genuinely different calls are never suppressed as "already paid".

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { prepareStepPackCalls, sourceIdempotencyKey } from "../../../supabase/functions/_shared/sequentialSourceRuntime.ts";
import { newSourceExecutionState } from "../../../supabase/functions/_shared/sourceExecutionState.ts";
import type { OrderedSourceStep } from "../../../supabase/functions/_shared/hiringSourcePlan.ts";

const step = {
  stepId: "s1",
  order: 1,
  capability: "indeed_job_discovery",
  role: "discovery",
  reason: "primary discovery",
  activationCondition: "initial",
  semanticIntent: {
    roleFamily: "revenue_operations",
    approvedTitleAliases: ["Sales Operations", "Revenue Operations"],
    geography: "United States",
    postingWindowDays: 7,
    candidateTarget: 30,
  },
  successCondition: {},
  broadeningLadder: [],
  advanceConditions: [],
  stopConditions: [],
} as unknown as OrderedSourceStep;

const packs = [
  { packId: "exact_titles", titleAliases: ["Sales Operations", "Revenue Operations"] },
  { packId: "seniority_variants", titleAliases: ["Head of Revenue Operations"] },
];

function state() {
  return newSourceExecutionState({
    planHash: "h1",
    steps: [{ stepId: step.stepId, capability: step.capability, order: 1 }],
    requestedCount: 5,
    now: new Date().toISOString(),
  });
}

Deno.test("packs compile into separate calls with their own titles", async () => {
  const res = await prepareStepPackCalls({
    taskId: "t1", step, state: state(), queryPacks: packs,
    totalBatch: 30, providerMaximum: 200,
  });

  assertEquals(res.calls.length, 2);
  assertEquals(res.calls.map((c) => c.queryPackId), ["exact_titles", "seniority_variants"]);

  const [a, b] = res.calls;
  // Never merged: the seniority pack's query contains only its own title.
  assertEquals(String(b.input.query), "Head of Revenue Operations");
  assert(String(a.input.query).includes("Sales Operations"));
  assert(!String(a.input.query).includes("Head of Revenue Operations"));

  // Distinct paid identities.
  assert(a.idempotencyKey !== b.idempotencyKey);
  assert(a.inputHash !== b.inputHash);

  // The batch was split, not duplicated per pack.
  assertEquals(Number(a.input.maxItems) + Number(b.input.maxItems), 30);
});

Deno.test("an unfundable pack is dropped, never merged into another", async () => {
  const many = [
    ...packs,
    { packId: "adjacent_owners", titleAliases: ["Deal Desk"] },
    { packId: "tooling_signals", titleAliases: ["CRM Operations"] },
  ];
  const res = await prepareStepPackCalls({
    taskId: "t1", step, state: state(), queryPacks: many,
    totalBatch: 9, providerMaximum: 200,
  });
  assert(res.calls.length < many.length);
  assert(res.skipped.some((s) => s.status === "unfunded"));
  for (const c of res.calls) {
    assert(!String(c.input.query).includes(" OR CRM Operations"));
  }
});

Deno.test("idempotency key names the final actor and the pack", () => {
  const base = sourceIdempotencyKey("t1", "s1", 1, "abcdef0123456789ff");
  const withActor = sourceIdempotencyKey("t1", "s1", 1, "abcdef0123456789ff", { actorKey: "indeed_x" });
  const otherActor = sourceIdempotencyKey("t1", "s1", 1, "abcdef0123456789ff", { actorKey: "indeed_y" });
  const withPack = sourceIdempotencyKey("t1", "s1", 1, "abcdef0123456789ff", {
    actorKey: "indeed_x", queryPackId: "exact_titles",
  });

  assert(base !== withActor);
  assert(withActor !== otherActor);
  assert(withActor !== withPack);
  assert(withPack.includes("actor=indeed_x"));
  assert(withPack.includes("pack=exact_titles"));
  // Same inputs ⇒ same key.
  assertEquals(withPack, sourceIdempotencyKey("t1", "s1", 1, "abcdef0123456789ff", {
    actorKey: "indeed_x", queryPackId: "exact_titles",
  }));
});
