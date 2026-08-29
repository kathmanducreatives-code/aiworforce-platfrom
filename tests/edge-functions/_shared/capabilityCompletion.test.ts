// A NODE MAY NOT CLOSE ON NOTHING WHILE ITS INPUTS ARE STILL COMING.
//
// ── THE PRODUCTION STATE THIS PINS ─────────────────────────────────────────
//
// Task 5c461aa3, persisted verbatim on 2026-08-28:
//
//   completed_capabilities : [general_company_discovery, company_enrichment,
//                             persistence]
//   pending_capabilities   : [company_identity_resolution, hiring_verification,
//                             company_brain_qualification]
//   lead_library_persistence: { planned: 0, persisted: 0 }
//
// `persistence` is the last node in the graph and it closed having saved
// nothing, while the three capabilities that produce what it saves were still
// pending. The engine skips a completed capability on every later slice, so
// that lineage could verify hiring, qualify companies, and never write one
// down. The replay in `run5c461aa3Replay.test.ts` proves six companies were
// waiting behind exactly that gate.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  completionIsProvisional, repairPrematureCompletions,
} from "../../../supabase/functions/_shared/capabilityCompletion.ts";

/** The graph this mission compiled to, in execution order. */
const PLAN = [
  "general_company_discovery",
  "company_identity_resolution",
  "company_enrichment",
  "hiring_verification",
  "company_brain_qualification",
  "persistence",
] as const;

/** The exact lists task 5c461aa3 wrote. */
const POISONED = {
  completed_capabilities: [
    "general_company_discovery", "company_enrichment", "persistence",
  ] as string[],
  pending_capabilities: [
    "company_identity_resolution", "hiring_verification", "company_brain_qualification",
  ] as string[],
};

/** Provider attempts as that run recorded them — none for persistence. */
const ATTEMPTS = [
  { capability: "general_company_discovery" },
  { capability: "company_enrichment" },
  { capability: "hiring_verification" },
  { capability: "hiring_verification" },
  { capability: "hiring_verification" },
  { capability: "hiring_verification" },
];

// ══ THE RULE ═══════════════════════════════════════════════════════════════

Deno.test("1. persistence saving nothing, with upstream pending, is provisional", () => {
  assertEquals(completionIsProvisional({
    capability: "persistence", rows: 0,
    planOrder: PLAN, pendingCapabilities: POISONED.pending_capabilities,
  }), true, "this is the exact state that shipped and it must not close");
});

Deno.test("2. persistence that actually saved something closes, whatever is pending", () => {
  // A node that did work has earned its completion. Reopening it would re-run
  // work already done — and for a paid node, re-spend for it.
  assertEquals(completionIsProvisional({
    capability: "persistence", rows: 3,
    planOrder: PLAN, pendingCapabilities: POISONED.pending_capabilities,
  }), false);
});

Deno.test("3. persistence saving nothing with NOTHING pending closes normally", () => {
  // The legitimate empty run: everything upstream finished and there was
  // genuinely nothing to write. Holding it open forever would be its own bug.
  assertEquals(completionIsProvisional({
    capability: "persistence", rows: 0,
    planOrder: PLAN, pendingCapabilities: [],
  }), false);
});

Deno.test("4. the first node is never held open by this rule", () => {
  // Discovery has no predecessors. A zero-row discovery is already refused by
  // the evidence clause; it must not ALSO become permanently un-closable.
  assertEquals(completionIsProvisional({
    capability: "general_company_discovery", rows: 0,
    planOrder: PLAN, pendingCapabilities: ["company_enrichment", "persistence"],
  }), false);
});

Deno.test("5. the rule is generic — it holds for any dependent node", () => {
  // Not a persistence special case. Qualification is equally unable to close on
  // nothing while the hiring evidence it reads is still outstanding.
  assertEquals(completionIsProvisional({
    capability: "company_brain_qualification", rows: 0,
    planOrder: PLAN, pendingCapabilities: ["hiring_verification"],
  }), true);
  // And a node whose only pending peers come AFTER it is unaffected.
  assertEquals(completionIsProvisional({
    capability: "company_identity_resolution", rows: 0,
    planOrder: PLAN, pendingCapabilities: ["persistence"],
  }), false);
});

// ══ THE REPAIR ═════════════════════════════════════════════════════════════

Deno.test("6. the poisoned checkpoint is repaired on restore", () => {
  const r = repairPrematureCompletions(POISONED, PLAN, ATTEMPTS);
  assertEquals(r.reopened.map((x) => x.capability), ["persistence"]);
  assertEquals(r.state.completed_capabilities,
    ["general_company_discovery", "company_enrichment"]);
  assert(r.state.pending_capabilities.includes("persistence"),
    "persistence must be runnable again");
  assert(/still pending/.test(r.reopened[0].reason),
    "and the repair must say why it reopened it");
});

Deno.test("7. persistence is reopened LAST, not wherever it was appended", () => {
  // The engine walks `pending_capabilities` in order. A shuffled list would run
  // persistence before qualification — the same bug in a new arrangement.
  const r = repairPrematureCompletions(POISONED, PLAN, ATTEMPTS);
  assertEquals(r.state.pending_capabilities, [
    "company_identity_resolution", "hiring_verification",
    "company_brain_qualification", "persistence",
  ]);
});

Deno.test("8. the repair NEVER reopens a capability that bought something", () => {
  // `company_enrichment` sits after a pending `company_identity_resolution` in
  // the poisoned state, so an ordering-only repair would reopen it — and
  // enrichment costs money for companies already enriched. A repair that
  // spends is worse than the state it repairs.
  const r = repairPrematureCompletions(POISONED, PLAN, ATTEMPTS);
  assert(r.state.completed_capabilities.includes("company_enrichment"),
    "paid work keeps its completion");
  assertEquals(r.reopened.some((x) => x.capability === "company_enrichment"), false);
});

Deno.test("9. a healthy checkpoint is left exactly alone", () => {
  const healthy = {
    completed_capabilities: ["general_company_discovery", "company_identity_resolution"],
    pending_capabilities: ["company_enrichment", "hiring_verification"],
  };
  const r = repairPrematureCompletions(healthy, PLAN, ATTEMPTS);
  assertEquals(r.reopened, []);
  assertEquals(r.state, healthy);
});

Deno.test("10. repairing twice changes nothing the second time", () => {
  const once = repairPrematureCompletions(POISONED, PLAN, ATTEMPTS);
  const twice = repairPrematureCompletions(once.state, PLAN, ATTEMPTS);
  assertEquals(twice.reopened, []);
  assertEquals(twice.state, once.state);
});

// ══ THE LIFECYCLE, END TO END ══════════════════════════════════════════════

Deno.test("11. resume: repair, then hiring and qualification land, then persistence runs", () => {
  // The sequence the requirement asks for, driven through the real rule rather
  // than described. Each step asserts the state the next one depends on.
  let state = repairPrematureCompletions(POISONED, PLAN, ATTEMPTS).state;
  assert(state.pending_capabilities.includes("persistence"));

  // A capability completing is: rows produced, not provisional, lists updated.
  const complete = (cap: string, rows: number) => {
    const provisional = completionIsProvisional({
      capability: cap, rows, planOrder: PLAN,
      pendingCapabilities: state.pending_capabilities,
    });
    if (provisional) return false;
    state = {
      completed_capabilities: [...state.completed_capabilities, cap],
      pending_capabilities: state.pending_capabilities.filter((c) => c !== cap),
    };
    return true;
  };

  assert(complete("company_identity_resolution", 11), "11 identities resolved");
  assert(complete("hiring_verification", 6), "six companies verified — the replay's count");
  assert(complete("company_brain_qualification", 6), "qualification accepts them");

  // Only now may persistence close, and it closes on real rows.
  assertEquals(state.pending_capabilities, ["persistence"]);
  assert(complete("persistence", 6), "leads are written");
  assertEquals(state.pending_capabilities, []);
  assert(state.completed_capabilities.includes("persistence"));
});

Deno.test("12. persistence cannot be skipped from an old snapshot alone", () => {
  // The requirement stated directly: appearing in a stale
  // `completed_capabilities` with no work behind it must not be enough to skip.
  const repaired = repairPrematureCompletions(POISONED, PLAN, ATTEMPTS).state;
  assertEquals(repaired.completed_capabilities.includes("persistence"), false,
    "the engine skips what is in this list — persistence must not be in it");
});

// ══ THE ENGINE ACTUALLY USES IT ════════════════════════════════════════════
//
// A correct module nothing calls is the failure mode this codebase has hit
// twice — `ChatBrainContext.conversation` was declared, documented, rendered
// into the prompt and passed by nobody. These read the engine's source.

const ENGINE = await Deno.readTextFile(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));

Deno.test("13. `finish` consults the rule before marking anything complete", () => {
  const at = ENGINE.indexOf("const genuinelyComplete");
  assert(at > 0, "the completion decision must exist");
  const before = ENGINE.slice(Math.max(0, at - 1400), at);
  assert(before.includes("completionIsProvisional({"),
    "the rule must be evaluated before the decision");
  assert(ENGINE.slice(at, at + 200).includes("!provisional &&"),
    "and must gate it — not merely be computed and ignored");
});

Deno.test("14. restored state is repaired before the engine walks the plan", () => {
  const repair = ENGINE.indexOf("repairPrematureCompletions(");
  assert(repair > 0, "the repair must be called");
  // It has to run on the ADOPTED state, after the mission-hash check that
  // decides whether the checkpoint is even ours.
  const adopt = ENGINE.indexOf("stateMatchesMission(opts.state");
  assert(adopt > 0 && adopt < repair, "repair a checkpoint only after adopting it");
  // And before the capability loop that skips completed capabilities.
  const skip = ENGINE.indexOf("state.completed_capabilities.includes(cap)");
  assert(skip > repair, "the repair must land before anything is skipped");
  const block = ENGINE.slice(repair - 400, repair + 700);
  assert(block.includes("state.completed_capabilities ="),
    "the repaired lists must be written back onto the live state");
  assert(block.includes("state.pending_capabilities ="));
});

Deno.test("15. persistence counts what the mission asked it to write", () => {
  // It reported `contact_identities.length` for every mission. On a
  // `qualified_companies` mission that is structurally zero, so persistence
  // reported nothing done even with companies waiting to be saved — and the
  // completion rule reads exactly this number.
  const at = ENGINE.indexOf('if (cap === "persistence") {');
  assert(at > 0);
  const block = ENGINE.slice(Math.max(0, at - 900), at + 200);
  assert(block.includes('requested_output === "qualified_companies"'),
    "a company mission must count qualified companies");
  assert(block.includes("state.qualified_company_keys.length"));
  assert(block.includes("finish(cap, \"complete\", persistable"),
    "and the completion must be given that count, not a fixed one");
});
