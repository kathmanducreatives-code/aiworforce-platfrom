// Offline end to end: ICP → LeadOcean discovery (mocked) → dedupe/history →
// Apify company records (mocked) → shared engine → signals → ranking → phone
// lookups (mocked) → queue + metrics + checkpoint. No network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memoryLedger, type DiscoveryApproval } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { runLeadPipeline, worstCase, type PipelineApprovals, type PipelineInput } from "../../../../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { apifyMock, CONNECTIONS, ICP, leadOceanMock, LIMITS, NOW, phoneMock, WS } from "./fixtures.ts";

const SIGNALS = { collect: { companyPosts: true, jobs: true }, maxPostsPerSubject: 3, maxJobsPerCompany: 5, windowDays: 30, maxUsd: 0.05 };

async function setup(over: Partial<PipelineInput> = {}, approvals: Partial<PipelineApprovals> = {}) {
  const lo = leadOceanMock();
  const ap = apifyMock();
  const ph = phoneMock();
  const store = memoryCheckpointStore();
  const ledger = memoryLedger();
  const existing = new ExclusionIndex([{ leadId: "lead-delta-1", kind: "account", companyDomain: "deltaflow.example", hold: { reason: "do_not_contact" } }], NOW);
  const baseInput: PipelineInput = {
    workspaceId: WS, walkId: "walk-a-1", icp: ICP, connections: CONNECTIONS, limits: LIMITS,
    approvals: { discovery: null, canonicalMaxUsd: null, signals: null, phoneLookups: null },
    leadocean: lo.adapter, leadoceanDeps: lo.deps, apify: ap.invoke, ledger, checkpoints: store, existing, now: NOW, phoneCall: ph.call as never, ...over,
  };
  const dry = await runLeadPipeline({ ...baseInput, dryRun: true });
  const approval: DiscoveryApproval = { kind: "discovery", workspaceId: WS, missionId: "lp:walk-a-1:r0", planHash: dry.plan.planHash,
    maxCredits: { ...dry.plan.estimatedCredits }, approvedBy: "test-owner", approvedAt: NOW().toISOString() };
  const input: PipelineInput = { ...baseInput, approvals: { discovery: approval, canonicalMaxUsd: 0.05, signals: SIGNALS, phoneLookups: { maxLookups: 3, approvedBy: "test-owner", approvedAt: NOW().toISOString() }, ...approvals } };
  return { lo, ap, ph, store, ledger, dry, input };
}

Deno.test("dry run: plans a LeadOcean people search, buys nothing", async () => {
  const { dry, lo, ap, ph } = await setup();
  assertEquals(dry.status, "dry_run");
  assertEquals(dry.plan.steps.map((s) => [s.provider, s.kind]), [["leadocean", "people_search"]]);
  assertEquals(lo.calls.length + ap.calls.length + ph.calls.length, 0);
  const w = worstCase(dry.plan, { discovery: null, canonicalMaxUsd: 0.05, signals: SIGNALS, phoneLookups: { maxLookups: 3, approvedBy: "x", approvedAt: "x" } });
  assertEquals(w.leadoceanRecords, (dry.plan.estimatedCredits.leadocean ?? 0) + 3);
  assertEquals(w.apifyUsd, 0.1);
});

Deno.test("no discovery approval: blocked, nothing bought", async () => {
  const { input, lo } = await setup();
  const r = await runLeadPipeline({ ...input, approvals: { ...input.approvals, discovery: null } });
  assertEquals(r.status, "blocked");
  assertEquals(lo.calls.length, 0);
});

Deno.test("end to end: shared engine decides on canonical evidence; four separate statuses; ranked queue; phones classified", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("no network in offline tests"); };
  try {
    const { input, ap, ph, lo } = await setup();
    const r = await runLeadPipeline(input);
    assertEquals(lo.calls.length, 1);
    const all = [...r.queue, ...r.review, ...r.excluded];
    const by = Object.fromEntries(all.map((l) => [l.company.domain, l]));
    assertEquals(all.length, 5);

    // Qualification is the shared engine's, after the canonical record.
    assertEquals(by["acmesaas.example"].statuses.qualification, "eligible");
    assertEquals(by["betacloud.example"].statuses.qualification, "ineligible", "Canadian HQ disproves US HQ");
    assertEquals(by["gammaops.example"].statuses.qualification, "pending", "no canonical record: HQ stays unknown");
    assertEquals(by["gammaops.example"].canonicalRecord, "not_found");
    assertEquals(by["deltaflow.example"].statuses.qualification, "eligible");
    assertEquals(by["epsilonlabs.example"].statuses.qualification, "eligible");

    // History: existing Lead keeps its id; its hold blocks outreach and the lookup.
    assertEquals(by["deltaflow.example"].statuses.discovery, "existing");
    assertEquals(by["deltaflow.example"].existingLeadIds, ["lead-delta-1"]);
    assertEquals(by["deltaflow.example"].statuses.outreachReadiness, "blocked");
    assertFalse(ph.calls.includes("1004"), "a held person is never looked up");

    // Phones: only eligible, has_phone, unblocked people; provider numbers never verified.
    assertEquals(ph.calls.sort(), ["1001", "1005"]);
    assertEquals(by["acmesaas.example"].statuses.enrichment, "unverified_person_associated");
    assertEquals([by["acmesaas.example"].phone?.value, by["acmesaas.example"].phone?.e164, by["acmesaas.example"].phone?.valueHash], [null, null, null], "report-safe: no number in any form");
    assertEquals(by["acmesaas.example"].phone?.masked, "+1•••••0001");
    assert(!JSON.stringify([r.queue, r.review, r.excluded, r.phones, r.yield]).includes("5125550001"), "no number anywhere in the report-safe run");
    assertEquals(r.contactValues.map((c) => c.e164).sort(), ["+15125550001", "+15125550005"]);
    // HQ and description come from the canonical record the shared engine read.
    assertEquals(by["acmesaas.example"].company.hq, { country: "United States", region: null, city: "Austin", source: "apify_linkedin_company_details" });
    assert(by["acmesaas.example"].rank.factors.find((f) => f.factor === "icp_relevance")!.points > 0, "the record's own description feeds relevance");
    assertEquals(by["acmesaas.example"].phone?.employment.status, "provider_consistent");
    assertEquals(by["epsilonlabs.example"].statuses.enrichment, "company_switchboard");
    assertEquals(by["gammaops.example"].statuses.enrichment, "not_eligible_for_lookup");
    assert(all.every((l) => l.phone?.class !== "verified_person_direct"));

    // Readiness: only a person-associated number on an eligible decision-maker, for human review.
    assertEquals(by["acmesaas.example"].statuses.outreachReadiness, "ready_for_review");
    assertEquals(by["epsilonlabs.example"].statuses.outreachReadiness, "not_ready");

    // Signals: dated relevant hiring scores; an undated post never counts as recent.
    const acme = by["acmesaas.example"];
    assert(acme.signals.some((s) => s.type === "hiring" && s.recency === "recent"));
    assert(acme.signals.filter((s) => s.eventDate === null).every((s) => s.recency === "undated"));
    assert(acme.rank.factors.some((f) => f.factor === "signal:relevantHiring" && f.points > 0));
    assert(acme.rank.factors.filter((f) => f.why.includes("undated")).every((f) => f.points === 0));
    assertFalse(ap.calls.some((c) => c.actor !== "apify_linkedin_company_details" && JSON.stringify(c.input).includes("betacloud")), "signals only for eligible leads");

    // Lanes: eligible in the queue, ranked; pending in review; ineligible excluded.
    assertEquals(r.queue.map((l) => l.company.domain)[0], "acmesaas.example");
    assertEquals(r.review.map((l) => l.company.domain), ["gammaops.example"]);
    assertEquals(r.excluded.map((l) => l.company.domain), ["betacloud.example"]);
    assert(acme.rank.explanation.startsWith("Eligible;"));

    // Spend and metrics.
    assertEquals(r.spend.leadoceanRecords, 5 + 2);
    assert(r.spend.apifyUsd <= 0.1);
    assertEquals(r.funnel.discovered, 5);
    assertEquals(r.funnel.eligible, 2, "Delta is eligible but not new");
    assertEquals(r.funnel.personAssociated, 1);
    assertEquals(r.estimates.length, 4);
    assert(r.estimates.find((e) => e.usable === "verified_direct")!.unknownStages.includes("verifiedDirect"));

    // Checkpoint: the people bought are excluded from the next search.
    assertEquals(r.checkpoint.seenPersonIds.sort(), ["1001", "1002", "1003", "1004", "1005"]);
    assertEquals(r.checkpoint.recordsBought, 5);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("resume: the second run sends excludeIds for every person already bought, under a new mission id", async () => {
  const { input, lo } = await setup();
  await runLeadPipeline(input);
  const dry2 = await runLeadPipeline({ ...input, dryRun: true });
  assertEquals(dry2.status, "dry_run");
  const approval2: DiscoveryApproval = { ...input.approvals.discovery!, missionId: "lp:walk-a-1:r5", planHash: dry2.plan.planHash, maxCredits: { ...dry2.plan.estimatedCredits } };
  await runLeadPipeline({ ...input, approvals: { ...input.approvals, discovery: approval2, phoneLookups: null } });
  const body = lo.calls[1].body as Record<string, unknown>;
  assertEquals(JSON.stringify(body).includes("1001"), true, "excludeIds carries prior person ids");
});

Deno.test("signals fail soft: a failed actor marks its type unavailable, qualification unchanged, worst case counted", async () => {
  const { input } = await setup();
  const ap = apifyMock({ failJobs: true });
  const r = await runLeadPipeline({ ...input, apify: ap.invoke });
  assertEquals(r.status, "partial");
  assert(r.signals!.statuses.some((s) => s.type === "hiring" && s.state === "unavailable"));
  assertEquals([...r.queue, ...r.review, ...r.excluded].find((l) => l.company.domain === "acmesaas.example")!.statuses.qualification, "eligible");
});

Deno.test("Apify not connected: canonical unavailable, HQ stays pending — never qualified on a provider row", async () => {
  const { input } = await setup({ apify: null });
  const r = await runLeadPipeline(input);
  assertEquals(r.queue.length, 0);
  assert([...r.review, ...r.excluded].every((l) => l.statuses.qualification !== "eligible"));
});
