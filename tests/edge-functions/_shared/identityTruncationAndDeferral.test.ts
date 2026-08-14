// PARTIAL EXECUTION IS NOT COMPLETE EXECUTION.
//
// A real TEST run shortlisted 20 companies for paid identity resolution,
// attempted 11, and never touched the other 9 — then recorded
// `company_identity_resolution: {status: "complete", evidence_satisfied: true}`
// because ONE lookup had succeeded. `finish` moved the capability into
// `completed_capabilities`, and the resume guard skips anything listed there,
// so those 9 candidates were not deferred. They were gone.
//
// Three defects made that possible and each is pinned here:
//
//   * `runBounded` returned `{processed, skipped}` and the caller discarded the
//     second half.
//   * A deferred or errored provider call returned an empty array, which
//     `resolveIdentityAgainstLookups` turned into `unresolved` — a TERMINAL
//     state — so "we ran out of time" became "this company does not exist".
//   * `expired()` compared the time left against the slowest call ANY stage had
//     made, so a 51s discovery start made a 9s identity search unaffordable.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runBounded, runCapabilityPlan, toResumeRecord,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { createExecutionDeadline } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import {
  companyIsComplete, newCompanyRecord, nextStageFor, shouldSkipProviderCall,
  type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// ─────────────────────────────────────────────────────────────── the fixture ──

// THE SHORTLIST IS TEN, AND THAT IS THE REAL CEILING.
//
// `shortlistSize` is `min(ceiling, max(5, n*2))` and `DEFAULT_SHORTLIST_CEILING`
// is 10 — the audited 20-target run had Stage 2 enabled, which raises the
// ceiling to `batchLimits.max_evaluated`. These tests deliberately run WITHOUT
// Stage 2, so ten targets is the honest shape here and the truncation invariant
// is identical at either size. The exact 20 / 11 / 9 accounting is pinned
// directly on `runBounded` in test 1, which is where those numbers live.
//
// `requested × 2` is READ here and never changed — it is a spend decision and
// is deliberately out of scope.
const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
  "Return 10 qualified leads.";

/** Targets the identity stage will be given, given the fixture above. */
const TARGETS = 10;

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    // STATED, not inferred from the sentence. `shortlistSize` is
    // `min(ceiling, max(5, n*2))`, so ten requested is the exact 20-target
    // shape the audited run had. Set explicitly so this fixture cannot drift
    // if the deterministic parser's count extraction changes.
    requested_count: 10,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 150 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/** 25 in-range companies, every one of them hiring the Mission's role. */
const ELIGIBLE_25 = Array.from({ length: 25 }, (_, i) => ({
  name: `Acme${String(i).padStart(2, "0")}`,
  website: `https://acme${String(i).padStart(2, "0")}.com`,
  teamSize: 20 + i,
  batch: "W20",
  industries: ["B2B"],
  id: `acme${i}`,
  openJobs: [{ title: "Senior Software Engineer" }],
})) as unknown as Record<string, unknown>[];

const IDENTITY_ACTOR = "apify_linkedin_company_search";
const DISCOVERY_ACTOR = "apify_yc_companies_memo23";

/** A LinkedIn search hit that will pass `acceptLinkedInMatch` for company `i`. */
const hitFor = (i: number) => ({
  name: `Acme${String(i).padStart(2, "0")}`,
  linkedinUrl: `https://www.linkedin.com/company/acme${String(i).padStart(2, "0")}`,
  website: `https://acme${String(i).padStart(2, "0")}.com`,
  description: "B2B SaaS company",
  location: "San Francisco, CA, USA",
  employeeCount: 20 + i,
});

const indexOfSearch = (input: Record<string, unknown>): number => {
  const q = JSON.stringify(input);
  for (let i = 0; i < 25; i++) {
    if (q.includes(`Acme${String(i).padStart(2, "0")}`)) return i;
  }
  return -1;
};

interface RunOpts {
  /** Wall-clock the run is given. */
  budgetMs: number;
  /** ms each identity search consumes. */
  identityMs: number;
  /** ms discovery consumes. */
  discoveryMs: number;
  /** Companies whose identity search throws. */
  failFor?: ReadonlySet<number>;
  resume?: readonly CompanyResumeRecord[];
  state?: unknown;
}

const runOnce = async (o: RunOpts) => {
  let now = 0;
  const deadline = createExecutionDeadline({
    budgetMs: o.budgetMs, now: () => now, assumedCallMs: 12_000,
  });
  const searched: number[] = [];
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === DISCOVERY_ACTOR) {
        now += o.discoveryMs;
        return Promise.resolve(ELIGIBLE_25);
      }
      if (call.actorKey === IDENTITY_ACTOR) {
        const i = indexOfSearch(call.input as Record<string, unknown>);
        searched.push(i);
        now += o.identityMs;
        if (o.failFor?.has(i)) return Promise.reject(new Error("provider exploded"));
        return Promise.resolve(i >= 0 ? [hitFor(i)] : []);
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    deadline,
  }, {
    mission: m, plan, brain: BRAIN, maxCandidates: 60,
    ...(o.resume
      ? {
        resume: {
          workspace_id: "ws-1",
          lineage_root_task_id: "task-root",
          records: o.resume,
        },
      }
      : {}),
    ...(o.state ? { state: o.state as never } : {}),
  } as never);

  const outcome = run.capability_outcomes.find(
    (x) => x.capability === "company_identity_resolution");
  const targets = run.companies.filter((c) => c.shortlisted);
  return { run, deadline, searched, outcome, targets };
};

// ══════════════════════════════════════ 1. runBounded accounts for everything ══

Deno.test("1. runBounded reports 20 targets as 11 processed + 9 skipped", async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const done: number[] = [];
  // Stop the moment 11 have been processed — the shape of the audited run.
  const r = await runBounded(items, 2, (i) => { done.push(i); return Promise.resolve(); },
    () => done.length >= 11);

  assertEquals(r.processed, 11, "eleven were attempted");
  assertEquals(r.skipped, 9, "nine were NOT attempted, and the number says so");
  assertEquals(r.processed + r.skipped, items.length,
    "every target is accounted for — none may simply vanish");
});

Deno.test("1b. runBounded reports a full pass as nothing skipped", async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const r = await runBounded(items, 2, () => Promise.resolve(), () => false);
  assertEquals(r.processed, 20);
  assertEquals(r.skipped, 0);
});

// ═════════════════════════════════ 2. the five identity states stay distinct ══

Deno.test("2. deferred and provider_error are resumable; unresolved and mismatch are not", () => {
  const rec = (identity: CompanyResumeRecord["identity"]): CompanyResumeRecord =>
    ({ ...newCompanyRecord("k", "Acme"), identity });

  // 1 — successfully resolved: identity is done, the company owes enrichment.
  assertEquals(nextStageFor(rec("resolved")), "enrichment");
  // 2 — attempted, nothing matched: TERMINAL. Asking again buys the same silence.
  assertEquals(nextStageFor(rec("unresolved")), null);
  assertEquals(nextStageFor(rec("mismatch")), null);
  // 3 — the provider failed: says NOTHING about the company. Resumable.
  assertEquals(nextStageFor(rec("provider_error")), "identity");
  // 4 — the deadline fired before the call: resumable.
  assertEquals(nextStageFor(rec("deferred")), "identity");
  // 5 — never scheduled yet.
  assertEquals(nextStageFor(rec("not_started")), "identity");

  // A deferred company is NOT complete. That is the whole point.
  assertFalse(companyIsComplete(rec("deferred")));
  assertFalse(companyIsComplete(rec("provider_error")));
  assert(companyIsComplete(rec("unresolved")));
});

Deno.test("2b. the resume guard re-asks for deferred and errored, never for terminal", () => {
  const rec = (identity: CompanyResumeRecord["identity"]): CompanyResumeRecord =>
    ({ ...newCompanyRecord("k", "Acme"), identity });

  assertEquals(shouldSkipProviderCall(rec("deferred"), "op-1").skip, false,
    "a deferred candidate MUST be attempted on resume");
  assertEquals(shouldSkipProviderCall(rec("provider_error"), "op-1").skip, false,
    "a provider failure is not a reason to give up on the company");
  assertEquals(shouldSkipProviderCall(rec("unresolved"), "op-1"),
    { skip: true, reason: "identity_terminal" });
  assertEquals(shouldSkipProviderCall(rec("mismatch"), "op-1"),
    { skip: true, reason: "identity_terminal" });

  // Already bought is still already bought, whatever the stage says.
  const paid = { ...rec("deferred"), completed_operations: ["op-1"] };
  assertEquals(shouldSkipProviderCall(paid, "op-1"),
    { skip: true, reason: "already_completed" });
});

// ═══════════════════════════════ 3. the deadline is scoped, not contaminated ══

Deno.test("3. a slow discovery call does not poison the identity estimate", () => {
  let now = 0;
  const d = createExecutionDeadline({
    budgetMs: 125_000, now: () => now, assumedCallMs: 12_000,
  });

  // THE OBSERVED RUN: a 51s memo23 discovery start.
  now += 51_000;
  d.observeCall(51_000, DISCOVERY_ACTOR);

  // 74s left. The identity searches take ~9s each.
  assertEquals(d.remainingMs(), 74_000);

  // THE BUG: unscoped, the 51s maximum says a 9s call cannot be afforded until
  // there is 51s of headroom. That is what stranded nine candidates.
  assertEquals(d.slowestCallMs, 51_000);

  // THE FIX: the identity provider carries its own estimate. With no history it
  // assumes the conservative 12s baseline — never discovery's worst case.
  assertEquals(d.estimateFor(IDENTITY_ACTOR), 12_000);
  assertFalse(d.expired(IDENTITY_ACTOR),
    "74s left is ample for a 9s identity call");

  // And it keeps being affordable well past the point the global figure blocked.
  now += 45_000;                       // 29s left
  d.observeCall(9_000, IDENTITY_ACTOR);
  assertFalse(d.expired(IDENTITY_ACTOR), "29s left still fits a 9s call");
  assert(d.expired(), "the UNSCOPED answer is still the conservative one");
});

Deno.test("3b. identity resolution still stops when it is genuinely unsafe", () => {
  let now = 0;
  const d = createExecutionDeadline({
    budgetMs: 125_000, now: () => now, assumedCallMs: 12_000,
  });
  now += 115_000;                      // 10s left
  assert(d.expired(IDENTITY_ACTOR),
    "10s left cannot safely start a call estimated at 12s");

  // A genuinely slow identity provider raises ITS OWN estimate and stops sooner.
  let now2 = 0;
  const d2 = createExecutionDeadline({
    budgetMs: 125_000, now: () => now2, assumedCallMs: 12_000,
  });
  d2.observeCall(40_000, IDENTITY_ACTOR);
  now2 += 90_000;                      // 35s left
  assertEquals(d2.estimateFor(IDENTITY_ACTOR), 40_000);
  assert(d2.expired(IDENTITY_ACTOR),
    "35s left cannot start a call this provider has taken 40s to make");
});

Deno.test("3c. a per-operation estimate can never fall below the safe baseline", () => {
  const d = createExecutionDeadline({ budgetMs: 125_000, assumedCallMs: 12_000 });
  // One unusually fast call must not talk the deadline into a smaller reserve.
  d.observeCall(400, IDENTITY_ACTOR);
  assertEquals(d.estimateFor(IDENTITY_ACTOR), 12_000,
    "the floor is the assumed cost, so the estimate only ever moves up");
});

Deno.test("3d. an unscoped observation still raises the global figure", () => {
  const d = createExecutionDeadline({ budgetMs: 125_000, assumedCallMs: 12_000 });
  d.observeCall(51_000, DISCOVERY_ACTOR);
  assertEquals(d.slowestCallMs, 51_000,
    "the terminal guard and finalizer keep the conservative run-level answer");
});

// ══════════════════════════════════ 4. the engine: complete means complete ══

// ══════════════════════════════════ 4. the engine: complete means complete ══

Deno.test("4. every target reaches a terminal state ⇒ the capability IS complete",
  async () => {
    const { outcome, targets, run, searched } = await runOnce({
      budgetMs: 400_000, identityMs: 9_000, discoveryMs: 5_000,
    });

    assertEquals(targets.length, TARGETS);
    assertEquals(searched.length, TARGETS, "every target was attempted");
    assertEquals(outcome?.status, "complete");
    assertEquals(outcome?.evidence_satisfied, true);
    assert(run.state.completed_capabilities.includes("company_identity_resolution"),
      "a genuinely finished stage is recorded as finished");
    assertFalse(run.state.pending_capabilities.includes("company_identity_resolution"));

    const records = targets.map(toResumeRecord);
    assertEquals(records.filter((r) => r.identity === "deferred").length, 0);
    assertEquals(records.filter((r) => r.identity === "resolved").length, TARGETS);
  });

Deno.test("5. some attempted and some not ⇒ NOT complete, and the rest are named",
  async () => {
    // The budget runs out partway through the stage — the audited shape.
    const { outcome, targets, run, searched } = await runOnce({
      budgetMs: 70_000, identityMs: 9_000, discoveryMs: 5_000,
    });

    assertEquals(targets.length, TARGETS);
    assert(searched.length > 0, "the stage did real work");
    assert(searched.length < TARGETS, "and the deadline stopped it partway");

    // ── THE INVARIANT ────────────────────────────────────────────────────
    assertEquals(outcome?.status, "incomplete",
      "partial execution may NEVER be recorded as complete");
    assertEquals(outcome?.evidence_satisfied, false);
    assertFalse(run.state.completed_capabilities.includes("company_identity_resolution"),
      "the resume guard skips completed capabilities — this one must not be listed");
    assert(run.state.pending_capabilities.includes("company_identity_resolution"),
      "it stays pending, so a continuation runs it again");

    // ── EVERY CANDIDATE HAS AN EXPLICIT STATE ────────────────────────────
    const records = targets.map(toResumeRecord);
    const deferred = records.filter((r) => r.identity === "deferred");
    const resolved = records.filter((r) => r.identity === "resolved");
    assert(deferred.length > 0, "the ones never attempted are recorded as deferred");
    assert(resolved.length > 0, "the ones that succeeded are recorded as resolved");
    assertEquals(deferred.length + resolved.length, TARGETS,
      "no candidate is missing and none is silently 'unresolved'");
    assertEquals(records.filter((r) => r.identity === "unresolved").length, 0,
      "running out of time is NOT 'this company does not exist on LinkedIn'");

    // ── AND THEY ARE ALL RESUMABLE ───────────────────────────────────────
    for (const r of deferred) {
      assertEquals(nextStageFor(r), "identity", `${r.company_key} must be resumable`);
      assertEquals(shouldSkipProviderCall(r, "fresh-op").skip, false);
    }
    for (const c of targets.filter((x) => x.identity === null)) {
      assertEquals(c.record.stage, "identity_pending");
      assert(c.record.missing_evidence.includes("identity_resolution_deferred"),
        "the reason is recorded on the company, not only in the aggregate");
    }
  });

Deno.test("6. a provider error is not a completion, not a rejection, and not 'not found'",
  async () => {
    const { outcome, targets, run } = await runOnce({
      budgetMs: 400_000, identityMs: 9_000, discoveryMs: 5_000,
      failFor: new Set([3, 7]),
    });

    assertEquals(outcome?.status, "incomplete",
      "a stage with unanswered candidates is not complete");
    assertFalse(run.state.completed_capabilities.includes("company_identity_resolution"));

    const records = targets.map(toResumeRecord);
    const errored = records.filter((r) => r.identity === "provider_error");
    assertEquals(errored.length, 2, "both failures are recorded AS failures");
    assertEquals(records.filter((r) => r.identity === "unresolved").length, 0,
      "a failed call is never evidence that the company has no LinkedIn page");
    for (const r of errored) {
      assertEquals(nextStageFor(r), "identity", "a failed call is retried, not believed");
      assertEquals(shouldSkipProviderCall(r, "fresh-op").skip, false);
    }
    // The rest still succeeded — one provider failure does not sink the stage.
    assertEquals(records.filter((r) => r.identity === "resolved").length, TARGETS - 2);
    // AND IT IS NOT A REJECTION.
    for (const c of targets.filter((x) => x.identity === null)) {
      assertEquals(c.verdict, null, "a provider failure never rejects a company");
    }
  });

Deno.test("7. no resolved candidates at all + deferred candidates ⇒ NOT complete",
  async () => {
    // The budget is gone before the identity stage can buy anything.
    const { outcome, targets, run, searched } = await runOnce({
      budgetMs: 60_000, identityMs: 9_000, discoveryMs: 45_000,
    });

    assertEquals(searched.length, 0, "the reserve stopped every call before it started");
    assertEquals(outcome?.status, "incomplete");
    assertEquals(outcome?.evidence_satisfied, false);
    assertFalse(run.state.completed_capabilities.includes("company_identity_resolution"));

    const records = targets.map(toResumeRecord);
    assertEquals(records.filter((r) => r.identity === "resolved").length, 0);
    assertEquals(records.filter((r) => r.identity === "deferred").length, TARGETS,
      "all of them are still owed, and all of them say so");
  });

// ═══════════════════════════════════════════ 8. resume finishes what was left ══

Deno.test("8. RUN 2 resumes the deferred candidates and does not re-buy the resolved ones",
  async () => {
    // ── RUN 1: truncated ──────────────────────────────────────────────────
    const first = await runOnce({
      budgetMs: 70_000, identityMs: 9_000, discoveryMs: 5_000,
    });
    assertEquals(first.outcome?.status, "incomplete");

    // THIS IS THE DURABLE STATE — what `buildCheckpoint` writes into
    // `tasks.result` and what survives the isolate being torn down.
    const records = first.targets.map(toResumeRecord);
    const deferredKeys = records.filter((r) => r.identity === "deferred")
      .map((r) => r.company_key);
    const resolvedKeys = records.filter((r) => r.identity === "resolved")
      .map((r) => r.company_key);
    assert(deferredKeys.length > 0 && resolvedKeys.length > 0);

    // ── RUN 2: a continuation carrying that ledger ────────────────────────
    const second = await runOnce({
      budgetMs: 400_000, identityMs: 9_000, discoveryMs: 5_000,
      resume: records,
    });

    // The stage RAN again — run 1 never marked it complete, so nothing skipped it.
    assertEquals(second.outcome?.status, "complete",
      "once every candidate is terminal, and only then, the stage completes");
    assert(second.run.state.completed_capabilities
      .includes("company_identity_resolution"));

    // EVERY deferred candidate now has a real answer.
    const after = second.targets.map(toResumeRecord);
    assertEquals(after.filter((r) => r.identity === "deferred").length, 0,
      "nothing is still deferred");
    for (const key of deferredKeys) {
      const r = after.find((x) => x.company_key === key);
      assert(r, `${key} must still exist in run 2`);
      assertEquals(r!.identity, "resolved", "the deferred candidate was picked up");
      assertEquals(nextStageFor(r!), "enrichment", "and it no longer owes identity");
    }

    // AND THE ALREADY-PAID-FOR ONES WERE NOT BOUGHT AGAIN.
    assertEquals(second.searched.length, deferredKeys.length,
      `run 2 must buy exactly the ${deferredKeys.length} outstanding searches — ` +
      `the ${resolvedKeys.length} already resolved are restored, not re-paid for`);
    for (const key of resolvedKeys) {
      assertFalse(second.searched.some((i) => `acme${String(i).padStart(2, "0")}.com` === key),
        `${key} was already resolved and must not be searched again`);
    }
  });

// ════════════════════════════ 9. resume rebuilds the candidate set it skipped ══

Deno.test("9. discovery complete + partial identity ⇒ resume restores and finishes",
  async () => {
    // THE EXACT SCENARIO THE ARCHITECTURE RESET NAMES:
    //
    //   Discovery complete → identity processes some of N → the rest deferred
    //   → execution ends → resume → restore candidate set → process the rest.
    //
    // This used to be impossible. `companies` is populated ONLY by discovery,
    // and a continuation whose state marks discovery complete skips that step —
    // correctly, since re-running it re-pays for the Actor. The working set was
    // then EMPTY, every downstream stage looped over nothing, and the deferred
    // candidates the truncation fix keeps alive could never be picked up. The
    // capability stayed honestly `incomplete` forever and no resume could
    // advance it.
    const first = await runOnce({
      budgetMs: 70_000, identityMs: 9_000, discoveryMs: 5_000,
    });
    assertEquals(first.outcome?.status, "incomplete");
    assert(first.run.state.completed_capabilities.includes("startup_company_discovery"),
      "discovery DID complete — that is the precondition, not an accident");

    const records = first.run.resume_records;
    const deferredKeys = records.filter((r) => r.identity === "deferred")
      .map((r) => r.company_key);
    assert(deferredKeys.length > 0, "there is outstanding work to resume");

    // ── RUN 2: the continuation, carrying BOTH the state and the ledger ────
    const second = await runOnce({
      budgetMs: 400_000, identityMs: 9_000, discoveryMs: 5_000,
      resume: records,
      state: first.run.state,
    });

    // DISCOVERY WAS SKIPPED — no second Actor start.
    const rerunDiscovery = second.run.capability_outcomes.find(
      (x) => x.capability === "startup_company_discovery");
    assertEquals(rerunDiscovery?.status, "skipped_resumed",
      "the paid discovery step must not run twice");

    // AND THE CANDIDATES CAME BACK ANYWAY.
    assertEquals(second.run.companies.length, first.run.companies.length,
      "the whole working set is reconstructed from the checkpoint");
    assertEquals(second.targets.length, TARGETS,
      "including which of them were shortlisted for paid resolution");

    // THE OUTSTANDING WORK WAS FINISHED, AND ONLY THE OUTSTANDING WORK.
    assertEquals(second.searched.length, deferredKeys.length,
      `run 2 must buy exactly the ${deferredKeys.length} deferred searches`);
    assertEquals(second.outcome?.status, "complete",
      "and only now, with every candidate terminal, does the stage complete");
    assert(second.run.state.completed_capabilities
      .includes("company_identity_resolution"));

    const after = second.run.resume_records;
    assertEquals(after.filter((r) => r.identity === "deferred").length, 0,
      "no candidate is still deferred");
    for (const key of deferredKeys) {
      const r = after.find((x) => x.company_key === key);
      assert(r, `${key} survived the process boundary`);
      assertEquals(r!.identity, "resolved");
    }
  });

Deno.test("9b. the restored set keeps triage verdicts — excluded comes back excluded",
  async () => {
    const first = await runOnce({
      budgetMs: 70_000, identityMs: 9_000, discoveryMs: 5_000,
    });
    const notShortlisted = first.run.companies.filter((c) => !c.shortlisted);
    assert(notShortlisted.length > 0, "the fixture really does exclude some companies");

    const second = await runOnce({
      budgetMs: 400_000, identityMs: 9_000, discoveryMs: 5_000,
      resume: first.run.resume_records,
      state: first.run.state,
    });

    assertEquals(second.run.companies.filter((c) => !c.shortlisted).length,
      notShortlisted.length,
      "an excluded company must come back excluded, not come back unknown");
    for (const c of notShortlisted) {
      const back = second.run.companies.find((x) => x.key === c.key);
      assert(back, `${c.key} must survive the restore`);
      assertEquals(back!.prequalified?.eligible, c.prequalified?.eligible,
        "its triage verdict is restored, not recomputed from nothing");
    }
    // NO CANDIDATE SILENTLY DISAPPEARS.
    assertEquals(
      new Set(second.run.companies.map((c) => c.key)).size,
      new Set(first.run.companies.map((c) => c.key)).size);
  });

Deno.test("9c. a checkpoint with no snapshots degrades safely, it does not throw",
  async () => {
    // BACKWARD COMPATIBILITY. A checkpoint written before the snapshot field
    // existed must still resume — restoring nothing, exactly as it did before —
    // rather than failing to parse or reconstructing a half-built company.
    const first = await runOnce({
      budgetMs: 70_000, identityMs: 9_000, discoveryMs: 5_000,
    });
    const legacy = first.run.resume_records.map((r) => {
      const { snapshot: _drop, ...rest } = r;
      return rest as typeof r;
    });

    const second = await runOnce({
      budgetMs: 400_000, identityMs: 9_000, discoveryMs: 5_000,
      resume: legacy,
      state: first.run.state,
    });

    assertEquals(second.run.companies.length, 0, "nothing could be restored");
    assertEquals(second.searched.length, 0, "and nothing was bought for nothing");
    // AND IT STILL DOES NOT LIE.
    assertFalse(second.run.state.completed_capabilities
      .includes("company_identity_resolution"),
      "an empty working set must never be mistaken for finished work");
  });
