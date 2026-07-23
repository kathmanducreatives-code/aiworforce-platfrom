// Lead-quality benchmark CLI.
//
//   deno task qa:lead-quality -- --mode=dry-run
//   deno task qa:lead-quality -- --mode=live    --run-id=<id>
//   deno task qa:lead-quality -- --mode=replay  --run-id=<id>
//
// (An `npm run qa:lead-quality -- --mode=…` wrapper shells to the same command.)
//
// SECRET SAFETY: this module reads environment values ONLY to (a) derive the
// PUBLIC project ref and (b) compute credential-presence booleans. It never logs
// a token/key/URL, and passes secret values only to the transport layer.

import { assertBenchmarkPreflight, resolveEnvironment } from "./env-guard.ts";
import { estimateMaxCost, fitLimitsToBudget } from "./budget.ts";
import { decideLiveRun, markTerminal, newLockRecord, type RunLockRecord } from "./run-lock.ts";
import { evaluateRun } from "./evaluate.ts";
import { runLiveSourcing } from "./live-runner.ts";
import { compareRuns, stableHash, type RunManifest } from "./manifest.ts";
import {
  humanReviewCsv, qualityReportMd, rankedLeadsCsv, rejectedLeadsCsv, summarize, writeText,
} from "./artifacts.ts";
import { safeLog } from "./redact.ts";
import {
  DEFAULT_LIMITS, FIXED_QUERY, TEST_PROJECT_REF, type AgentoryOutput, type ApifyLimits,
  type BenchmarkMode, type RawCandidate,
} from "./types.ts";

const env = (k: string): string | undefined => {
  try { return Deno.env.get(k) ?? undefined; } catch { return undefined; }
};
const present = (...keys: string[]): boolean => keys.some((k) => Boolean(env(k)?.trim()));

function refFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

function resolveProjectRef(): string | null {
  return (
    env("DEPLOY_SUPABASE_PROJECT_REF")?.trim() ||
    env("VITE_SUPABASE_PROJECT_ID")?.trim() ||
    env("SUPABASE_PROJECT_ID")?.trim() ||
    refFromUrl(env("VITE_SUPABASE_URL")) ||
    refFromUrl(env("SUPABASE_URL")) ||
    null
  );
}

function parseArgs(argv: string[]): { mode: BenchmarkMode; runId: string | null } {
  const get = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.split("=").slice(1).join("=");
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = (get("mode") ?? "dry-run") as BenchmarkMode;
  return { mode, runId: get("run-id") ?? null };
}

const ARTIFACT_ROOT = "artifacts/lead-quality-benchmark";
function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").slice(0, 15);
  return `lead-quality-sales-ops-us-${ts}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch { return null; }
}

// ------------------------------------------------------------------ main ----

async function main(): Promise<number> {
  const { mode, runId: argRunId } = parseArgs(Deno.args);
  const projectRef = resolveProjectRef();
  const environment = resolveEnvironment(projectRef);

  const limits = fitLimitsToBudget(DEFAULT_LIMITS).limits;
  const estimate = estimateMaxCost(limits);

  const preflight = assertBenchmarkPreflight({
    mode,
    projectRef,
    hasSupabaseUrl: present("VITE_SUPABASE_URL", "SUPABASE_URL"),
    hasSupabaseAnonKey: present("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    hasApifyToken: present("APIFY_API_TOKEN"),
    hasWorkspaceId: present("BENCHMARK_WORKSPACE_ID"),
    limits,
    estimatedMaxUsd: estimate.estimatedMaxUsd,
  });

  safeLog(`[benchmark] mode=${mode} environment=${environment} ref=${projectRef ?? "(none)"}`);
  safeLog(`[benchmark] bounded limits`, limits);
  safeLog(`[benchmark] estimated max spend USD=${estimate.estimatedMaxUsd.toFixed(2)} (hard cap 5.00, soft 4.50)`);

  if (!preflight.ok) {
    safeLog("[benchmark] PREFLIGHT BLOCKED:");
    for (const b of preflight.blockers) safeLog(`  - ${b}`);
    if (mode === "replay") return 1; // replay only needs non-prod
    return 3;
  }
  safeLog("[benchmark] preflight OK.");

  if (mode === "dry-run") {
    safeLog("[benchmark] dry-run complete — no provider invoked, no rows written.");
    return 0;
  }

  if (mode === "replay") return await runReplay(argRunId);
  if (mode === "live") return await runLive(argRunId, projectRef!, limits, estimate.estimatedMaxUsd);

  safeLog(`[benchmark] unknown mode '${mode}'.`);
  return 2;
}

// --------------------------------------------------------------- replay ----

async function runReplay(runId: string | null): Promise<number> {
  if (!runId) { safeLog("[benchmark] replay requires --run-id."); return 2; }
  const dir = `${ARTIFACT_ROOT}/${runId}`;
  const raws = await readJson<RawCandidate[]>(`${dir}/raw-apify-results.json`);
  if (!raws) { safeLog(`[benchmark] no cached raw results at ${dir}/raw-apify-results.json`); return 2; }
  const agentory = (await readJson<Record<string, AgentoryOutput>>(`${dir}/agentory-results.json`)) ?? {};

  const asOf = new Date().toISOString();
  const evals = evaluateRun(raws, { asOf, agentoryByCandidateId: agentory });
  await writeRunOutputs(dir, runId, "replay", evals, raws, agentory, { costUsd: 0, modelCalls: 0, actorRunIds: [] });

  // Compare against a stored baseline evaluation, if present.
  const baseline = await readJson<ReturnType<typeof evaluateRun>>(`${dir}/benchmark-evaluation.baseline.json`);
  if (baseline) {
    const cmp = compareRuns(baseline, evals);
    await writeText(`${dir}/replay-comparison.json`, JSON.stringify(cmp, null, 2));
    safeLog("[benchmark] replay comparison written", cmp);
  }
  safeLog(`[benchmark] replay complete — 0 Apify calls, ${evals.length} candidates re-evaluated.`);
  return 0;
}

// ----------------------------------------------------------------- live ----

async function runLive(argRunId: string | null, projectRef: string, limits: ApifyLimits, estMax: number): Promise<number> {
  const runId = argRunId ?? newRunId();
  const dir = `${ARTIFACT_ROOT}/${runId}`;

  // Run-once protection.
  const existing = await readJson<RunLockRecord>(`${dir}/run.lock.json`);
  const decision = decideLiveRun(runId, existing);
  if (!decision.allowed) { safeLog(`[benchmark] LIVE refused: ${decision.reason}`); return 4; }

  const startedAt = new Date().toISOString();
  let lock = newLockRecord(runId, startedAt);
  await writeText(`${dir}/run.lock.json`, JSON.stringify(lock, null, 2));

  const workspaceId = env("BENCHMARK_WORKSPACE_ID")!;
  let reportedSpend = 0;

  try {
    const res = await runLiveSourcing({
      projectRef, workspaceId, limits,
      onSpend: (usd) => { reportedSpend = usd; },
      invokeRunAgent: makeTransport(projectRef),
    });
    reportedSpend = res.reportedSpendUsd;

    const asOf = new Date().toISOString();
    const evals = evaluateRun(res.rawCandidates, { asOf, agentoryByCandidateId: res.agentoryByCandidateId });
    await writeRunOutputs(dir, runId, "live", evals, res.rawCandidates, res.agentoryByCandidateId, {
      costUsd: reportedSpend, modelCalls: res.modelCallCount, actorRunIds: res.actorRunIds,
    });
    // The live evaluation IS the baseline for future replay refinements.
    await writeText(`${dir}/benchmark-evaluation.baseline.json`, JSON.stringify(evals, null, 2));

    lock = markTerminal(lock, new Date().toISOString());
    await writeText(`${dir}/run.lock.json`, JSON.stringify(lock, null, 2));
    safeLog(`[benchmark] LIVE complete — spend $${reportedSpend.toFixed(2)}, ${evals.length} candidates.`);
    return 0;
  } catch (e) {
    // Preserve partial state; DO NOT auto-retry.
    lock = markTerminal(lock, new Date().toISOString());
    await writeText(`${dir}/run.lock.json`, JSON.stringify(lock, null, 2));
    safeLog(`[benchmark] LIVE failed (partial artifacts preserved, no auto-retry): ${(e as Error).message}`);
    safeLog(`[benchmark] estimated max was $${estMax.toFixed(2)}; reported spend $${reportedSpend.toFixed(2)}.`);
    return 5;
  }
}

/**
 * The REAL transport to the TEST run-agent function. Unexercised in an
 * uncredentialed environment (the env guard blocks live first). Kept faithful so
 * a credentialed operator can run the single paid benchmark. It authenticates
 * with the service key held ONLY in memory and never logged.
 */
function makeTransport(projectRef: string) {
  return async (inv: { action: string; workspaceId: string; toolInput: Record<string, unknown> }) => {
    const url = `https://${projectRef}.supabase.co/functions/v1/run-agent`;
    const anon = env("VITE_SUPABASE_ANON_KEY") ?? env("SUPABASE_ANON_KEY") ?? "";
    const bearer = env("SUPABASE_SERVICE_ROLE_KEY") ?? anon;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anon, authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ workspace_id: inv.workspaceId, tool_input: { lead_action: inv.action, ...inv.toolInput } }),
    });
    if (!r.ok) throw new Error(`run-agent responded ${r.status}`);
    const j = await r.json();
    // The benchmark expects the run-agent response to expose raw provider items
    // + Agentory outputs. Shape-mapping is intentionally defensive.
    return {
      rawCandidates: (j.raw_candidates ?? []) as RawCandidate[],
      agentoryByCandidateId: (j.agentory_results ?? {}) as Record<string, AgentoryOutput>,
      actorRunIds: (j.actor_run_ids ?? []) as string[],
      reportedSpendUsd: Number(j.apify_spend_usd ?? 0),
      modelCallCount: Number(j.model_call_count ?? 0),
    };
  };
}

// ------------------------------------------------------------- outputs ----

async function writeRunOutputs(
  dir: string, runId: string, mode: string,
  evals: ReturnType<typeof evaluateRun>, raws: RawCandidate[],
  agentory: Record<string, AgentoryOutput>,
  meta: { costUsd: number; modelCalls: number; actorRunIds: string[] },
): Promise<void> {
  const summary = summarize(evals);
  const manifest: RunManifest = {
    runId, query: FIXED_QUERY, gitSha: env("GIT_SHA") ?? null, testSupabaseRef: TEST_PROJECT_REF,
    workspaceId: env("BENCHMARK_WORKSPACE_ID") ?? null, mode: mode as BenchmarkMode,
    actorIds: ["curious_coder/linkedin-jobs-scraper", "harvestapi/linkedin-profile-search"],
    actorRunIds: meta.actorRunIds, providerLimits: fitLimitsToBudget(DEFAULT_LIMITS).limits,
    apifyReportedSpendUsd: meta.costUsd, estimatedMaxUsd: estimateMaxCost(fitLimitsToBudget(DEFAULT_LIMITS).limits).estimatedMaxUsd,
    modelCallCount: meta.modelCalls, modelCallPurposes: ["qualification", "ranking"],
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    artifactHashes: { raw: stableHash(raws), evaluation: stableHash(evals) },
  };
  await writeText(`${dir}/run-manifest.json`, JSON.stringify(manifest, null, 2));
  await writeText(`${dir}/raw-apify-results.json`, JSON.stringify(raws, null, 2));
  await writeText(`${dir}/agentory-results.json`, JSON.stringify(agentory, null, 2));
  await writeText(`${dir}/benchmark-evaluation.json`, JSON.stringify(evals, null, 2));
  await writeText(`${dir}/ranked-leads.csv`, rankedLeadsCsv(evals));
  await writeText(`${dir}/rejected-leads.csv`, rejectedLeadsCsv(evals));
  await writeText(`${dir}/human-review.csv`, humanReviewCsv(evals));
  await writeText(`${dir}/quality-report.md`, qualityReportMd({ runId, query: FIXED_QUERY, mode, summary, evals, costUsd: meta.costUsd, modelCalls: meta.modelCalls }));
}

if (import.meta.main) {
  Deno.exit(await main());
}
