// THE ADAPTIVE DECISION MUST CONTROL THE LOOP, NOT DESCRIBE IT.
//
// Two kinds of proof here:
//   * BEHAVIOURAL — the real controller is driven with a zero-round bound and
//     refusing invokers, exactly as run-agent configures it when the decision
//     blocks sourcing, and we assert no provider call happens.
//   * STRUCTURAL — source assertions on run-agent, because "the decision is
//     enforced" is a property of the call site. A pure-function test of
//     nextAdaptiveAction could pass forever while the handler ignored it.
//
// ZERO network, ZERO paid Actor runs.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  collectCompanyFirstContactIdentities, collectLegacyContactIdentities,
  combineContactIdentities, computeCompanyFirstQuotaProgress, identityDigest,
  leadIdentity, nextAdaptiveAction, type PersistedOutcome,
} from "../../supabase/functions/_shared/qualifiedLeadPersistence.ts";
import { runCompanyFirstQuotaController } from "../../supabase/functions/_shared/companyFirstQuotaController.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";

const runAgent = () => Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));

const contact = (lc: string): PersistedOutcome => ({
  identity: `cf:${lc}`, verdict: "CONTACT", quotaEligible: true,
  result: { ok: true, accountId: "acct", contactId: null, leadCandidateId: lc },
});

// ═══ BEHAVIOURAL: A BLOCKED LOOP MAKES NO PROVIDER CALL ════════════════════
Deno.test("1/16. a blocked decision runs zero rounds and zero provider calls", async () => {
  let jobs = 0, people = 0;
  const res = await runCompanyFirstQuotaController(
    compileLeadEntityIntent("Find companies hiring revenue operations managers"),
    {
      invokeJobs: () => { jobs++; return Promise.resolve([]); },
      invokePeople: () => { people++; return Promise.resolve([]); },
      persist: () => Promise.resolve({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
    } as never,
    // EXACTLY how run-agent configures it when sourcingBlocked: zero rounds and
    // NO actionBudget (which would otherwise raise the bound to the hard ceiling).
    { requestedLeadCount: 5, bounds: { maxRounds: 0 }, workspaceId: "w", taskId: "t" } as never,
  );
  assertEquals(jobs, 0, "a blocked loop must not call the jobs provider");
  assertEquals(people, 0, "nor the people provider");
  assertEquals(res.rounds_attempted, 0);
});

Deno.test("4. an unblocked loop does execute a round", async () => {
  let jobs = 0;
  await runCompanyFirstQuotaController(
    compileLeadEntityIntent("Find companies hiring revenue operations managers"),
    {
      invokeJobs: () => { jobs++; return Promise.resolve([]); },
      invokePeople: () => Promise.resolve([]),
      persist: () => Promise.resolve({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
    } as never,
    { requestedLeadCount: 5, bounds: { maxRounds: 1 }, workspaceId: "w", taskId: "t" } as never,
  );
  assert(jobs > 0, "continue_sourcing must actually permit a source call");
});

// ═══ STRUCTURAL: THE HANDLER ENFORCES THE DECISION ═════════════════════════
Deno.test("1/2/3. run-agent gates sourcing on the adaptive decision", async () => {
  const src = await runAgent();
  assert(src.includes("const sourcingBlocked = legacySkipReason !== null"),
    "the decision must produce a control-flow flag");
  assert(src.includes('"stop_quota_satisfied"') && src.includes("quota_satisfied_by_company_first"),
    "a satisfied quota must set a skip reason");
  assert(src.includes('adaptiveDecision === "await_pending_work"'),
    "pending work must be an explicit branch");
  // Both guards: the loop bound AND the refusing invokers.
  assert(src.includes("bounds: { maxRounds: 0 }"), "blocked sourcing must bound the loop to zero rounds");
  assert(src.includes("legacyBlockedCalls++"), "and the invokers must hard-refuse");
  // The plan-aware budget must be dropped when blocked, or the bound is bypassed.
  assert(src.includes("sequentialSources.enabled && !sourcingBlocked"),
    "actionBudget must not raise the bound past maxRounds when blocked");
  // FAIL CLOSED.
  assert(src.includes("unrecognised_adaptive_decision"),
    "an unknown decision must block rather than assume more spending is safe");
});

Deno.test("5. the persisted decision and the executed action are recorded together", async () => {
  const src = await runAgent();
  assert(src.includes("enforcement: {"), "the enforcement record must be persisted");
  for (const f of ["decision:", "legacy_sourcing_ran", "legacy_skip_reason", "blocked_provider_calls"]) {
    assert(src.includes(f), `the enforcement record must carry ${f}`);
  }
  assert(src.includes("will_run_another_source"),
    "the log must state whether another source will actually run");
});

Deno.test("6. run-agent no longer supplies a literal empty legacy identity set", async () => {
  const src = await runAgent();
  assertFalse(src.includes("legacyContactIdentities: []"),
    "an empty literal would silently disable cross-path deduplication");
  assert(src.includes("legacyContactIdentities: priorLegacyContactIdentities"),
    "the resume identity set must be supplied by name");
  assert(src.includes("collectLegacyContactIdentities("),
    "legacy identities must be collected from persisted items");
  assert(src.includes("combineContactIdentities("),
    "and combined with the company-first set");
});

Deno.test("7. run-agent supplies company-first identities from persisted outcomes", async () => {
  const src = await runAgent();
  assert(src.includes("collectCompanyFirstContactIdentities(persistedOutcomes)"),
    "company-first identities must come from PERSISTED outcomes, not the projection");
  assert(src.includes("combined_quota: combinedQuota"),
    "the combined view must be persisted for audit");
});

// ═══ IDENTITY COLLECTION ══════════════════════════════════════════════════
Deno.test("10/11. only persisted, quota-eligible CONTACT enters the identity set", () => {
  const c = collectLegacyContactIdentities([
    { verdict: "CONTACT", quotaEligible: true, leadCandidateId: "lc1", leadKey: "k1" },
    { verdict: "WATCH", quotaEligible: true, leadCandidateId: "lc2" },
    { verdict: "NEEDS_REVIEW", quotaEligible: true, leadCandidateId: "lc3" },
    { verdict: "REJECT", quotaEligible: false, leadCandidateId: "lc4" },
    { verdict: "SKIP", quotaEligible: false, leadCandidateId: "lc5" },
    // CONTACT but not quota-eligible.
    { verdict: "CONTACT", quotaEligible: false, leadCandidateId: "lc6" },
    // CONTACT, eligible, but never persisted — no lead candidate id.
    { verdict: "CONTACT", quotaEligible: true, leadCandidateId: null, person: "A" },
  ]);
  assertEquals(c.identities, ["lc:lc1"]);
  assertEquals(c.unidentifiable, 1, "an unpersisted CONTACT is counted, not silently dropped");
  assertEquals(c.strategy, "canonical_lead_candidate_id");
});

Deno.test("identity strength: never a display name or vanity URL alone", () => {
  // Strongest first.
  assertEquals(leadIdentity({ leadCandidateId: "lc1", leadKey: "k" })?.strategy,
    "canonical_lead_candidate_id");
  assertEquals(leadIdentity({ leadKey: "person|company" })?.strategy, "stable_profile_id");
  assertEquals(leadIdentity({ person: "Ada", accountId: "acct1" })?.strategy,
    "person_and_company_identity");
  // A name alone, a company name alone, or a vanity URL alone identify nothing.
  assertEquals(leadIdentity({ person: "Ada" }), null);
  assertEquals(leadIdentity({ company: "Acme" }), null);
  assertEquals(leadIdentity({ personProfileUrl: "https://linkedin.com/in/ada" }), null);
});

// ═══ COMBINED DEDUPLICATION ═══════════════════════════════════════════════
Deno.test("8/9. the same lead counts once; two distinct leads count twice", () => {
  const legacy = collectLegacyContactIdentities([
    { verdict: "CONTACT", quotaEligible: true, leadCandidateId: "shared" },
    { verdict: "CONTACT", quotaEligible: true, leadCandidateId: "legacy_only" },
  ]);
  const cf = collectCompanyFirstContactIdentities([contact("shared"), contact("cf_only")]);
  const combined = combineContactIdentities(legacy, cf, 5);
  assertEquals(combined.legacy_contact_count_raw, 2);
  assertEquals(combined.company_first_contact_count_raw, 2);
  assertEquals(combined.duplicate_contact_count, 1);
  assertEquals(combined.deduplicated_contact_count, 3, "shared counts once");
  assertEquals(combined.remaining_quota, 2);
  // Diagnostics carry digests, never raw identifiers.
  assertEquals(combined.identity_digests.length, 3);
  for (const d of combined.identity_digests) {
    assertEquals(d.length, 8);
    assertFalse(d.includes("shared") || d.includes("legacy_only"));
  }
  assertEquals(identityDigest("lc:shared"), identityDigest("lc:shared"), "digests are stable");
});

// ═══ THE FIVE SCENARIOS ═══════════════════════════════════════════════════
Deno.test("A. quota already met => stop, no further source", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [contact("1"), contact("2"), contact("3"), contact("4"), contact("5")],
    requestedQuota: 5,
  });
  assertEquals(p.remaining_quota, 0);
  assertEquals(nextAdaptiveAction(p).action, "stop_quota_satisfied");
});

Deno.test("C. 0 CONTACT with 3 contact_pending => wait, not fallback", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], requestedQuota: 5, contactPending: 3, qualifiedCompany: 3 });
  const a = nextAdaptiveAction(p);
  assertEquals(a.action, "await_pending_work");
  assertEquals(a.reason, "contact_enrichment_pending_not_a_source_failure");
});

Deno.test("D. 2 qualified companies with founders pending => wait", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], requestedQuota: 5, qualifiedCompany: 2, founderPending: 2 });
  const a = nextAdaptiveAction(p);
  assertEquals(a.action, "await_pending_work");
  assertEquals(a.reason, "founder_discovery_pending_not_a_source_failure");
});

Deno.test("E. genuinely exhausted: no CONTACT, nothing pending => continue", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], requestedQuota: 5, contactPending: 0, founderPending: 0 });
  assertEquals(nextAdaptiveAction(p).action, "continue_sourcing");
});

Deno.test("F/12/14. resume after quota satisfaction blocks every further source", () => {
  // The prior run's CONTACTs are already persisted and known.
  const p = computeCompanyFirstQuotaProgress({
    persisted: [contact("a"), contact("b")],
    legacyContactIdentities: ["cf:a", "cf:b"],
    requestedQuota: 2, contactPending: 2, founderPending: 1,
  });
  assertEquals(nextAdaptiveAction(p).action, "stop_quota_satisfied",
    "a satisfied quota outranks pending work");
  // And the identity union does not double-count on resume.
  const combined = combineContactIdentities(
    collectLegacyContactIdentities([
      { verdict: "CONTACT", quotaEligible: true, leadCandidateId: "a" },
      { verdict: "CONTACT", quotaEligible: true, leadCandidateId: "b" }]),
    collectCompanyFirstContactIdentities([contact("a"), contact("b")]), 2);
  assertEquals(combined.deduplicated_contact_count, 2);
  assertEquals(combined.remaining_quota, 0);
});

Deno.test("15. diagnostics alone can never satisfy quota", () => {
  // Every one of these looks like success in a diagnostic and is not a lead.
  const p = computeCompanyFirstQuotaProgress({
    persisted: [
      { identity: "d1", verdict: "CONTACT", quotaEligible: true,
        result: { ok: false, accountId: null, contactId: null, leadCandidateId: null } },
    ],
    requestedQuota: 1, qualifiedCompany: 9,
  });
  assertEquals(p.company_first_contact_credit, 0);
  assertEquals(p.remaining_quota, 1);
  assertEquals(collectCompanyFirstContactIdentities([
    { identity: "d1", verdict: "CONTACT", quotaEligible: true,
      result: { ok: false, accountId: null, contactId: null, leadCandidateId: null } },
  ]).identities.length, 0);
});
