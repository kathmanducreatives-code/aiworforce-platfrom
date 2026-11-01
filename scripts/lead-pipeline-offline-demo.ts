// OFFLINE demo of the lead pipeline on synthetic data (tests/edge-functions/_shared/leadPipeline/fixtures.ts).
//   deno run --no-check --allow-read --allow-env scripts/lead-pipeline-offline-demo.ts
// No network: LeadOcean, Apify and phone lookups are mocks.
import { memoryLedger } from "../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { runLeadPipeline, type PipelineInput } from "../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { apifyMock, CONNECTIONS, ICP, leadOceanMock, LIMITS, NOW, phoneMock, WS } from "../tests/edge-functions/_shared/leadPipeline/fixtures.ts";

export async function runPipelineDemo() {
  const lo = leadOceanMock();
  const base: PipelineInput = {
    workspaceId: WS, walkId: "demo", icp: ICP, connections: CONNECTIONS, limits: LIMITS,
    approvals: { discovery: null, canonicalMaxUsd: 0.05, signals: { collect: { companyPosts: true, jobs: true }, maxPostsPerSubject: 3, maxJobsPerCompany: 5, windowDays: 30, maxUsd: 0.13 }, phoneLookups: { maxLookups: 5, approvedBy: "demo", approvedAt: NOW().toISOString() } },
    leadocean: lo.adapter, leadoceanDeps: lo.deps, apify: apifyMock().invoke, ledger: memoryLedger(), checkpoints: memoryCheckpointStore(),
    existing: new ExclusionIndex([{ leadId: "lead-delta-1", kind: "account", companyDomain: "deltaflow.example", hold: { reason: "do_not_contact" } }], NOW),
    now: NOW, phoneCall: phoneMock().call as never, usdPerLeadOceanRecord: 0,
  };
  const dry = await runLeadPipeline({ ...base, dryRun: true });
  return runLeadPipeline({ ...base, approvals: { ...base.approvals, discovery: { kind: "discovery", workspaceId: WS, missionId: "lp:demo:r0", planHash: dry.plan.planHash, maxCredits: dry.plan.estimatedCredits, approvedBy: "demo", approvedAt: NOW().toISOString() } } });
}

if (import.meta.main) {
  const r = await runPipelineDemo();
  console.log(JSON.stringify({ queue: r.queue.map((l) => [l.company.domain, l.rank.score, l.statuses]), review: r.review.map((l) => l.company.domain), excluded: r.excluded.map((l) => l.company.domain), yield: r.yield }, null, 1));
  console.log(JSON.stringify(r.queue[0], null, 1));
}
