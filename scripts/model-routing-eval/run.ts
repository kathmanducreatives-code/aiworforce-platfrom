// THE EVAL RUNNER.
//
// ── OFFLINE BY DEFAULT, AND THE DEFAULT IS NOT A CONVENIENCE ────────────────
//
// Two reasons this refuses to call a model unless told twice.
//
// The first is spend. Every case is three model calls across three stages, and
// a candidate sweep multiplies that by the number of models. That is small money
// but it is REAL money, and a harness that spends it on `deno run` with no flag
// is a harness that will spend it by accident.
//
// The second is that offline is where most of the answer is. `checkMissionInvariants`
// and `scoreDiscoveryProposal` both score a model's output with no golden
// answer and no second model, so a candidate that fails them is eliminated for
// free. Paid comparison is for candidates that have already survived.
//
//   deno run --allow-read scripts/model-routing-eval/run.ts
//       Scores the harvested fixtures. No network. This is what CI runs.
//
//   ... run.ts --live --model gpt-5.6-luna --i-authorize-model-spend
//       Compiles every case on the named model and scores the result.
//       Requires OPENAI_API_KEY, the explicit flag, and --allow-net.
//
// ── WHAT A PASS HERE DOES NOT MEAN ──────────────────────────────────────────
//
// Six of the seven cases are SYNTHETIC (see `corpus.ts` — the persisted history
// contains exactly one distinct request, so there was no corpus to harvest).
// Synthetic cases can prove a model broken. They cannot prove one good. A model
// that passes everything here has earned a REPEATED end-to-end comparison, not
// a routing change.

import { EVAL_CASES, type EvalCase } from "./corpus.ts";
import { checkMissionInvariants, type InvariantReport } from "./invariants.ts";
import { compareMissions, summarizeComparison } from "./compare.ts";
import { readPersistedDiscoveryScore, type DiscoveryScore } from "./discoveryScore.ts";

export const EVAL_RUNNER_VERSION = "eval-runner-v1" as const;

export interface AuthorizationInput {
  live: boolean;
  authorized: boolean;
  hasApiKey: boolean;
  model: string | null;
}

export interface AuthorizationResult {
  mayCallModels: boolean;
  blockers: string[];
}

/**
 * Whether this invocation may spend money.
 *
 * PURE, and separated from the CLI so it is testable without an environment.
 * Every blocker is a sentence the operator can act on; an empty list with
 * `live: false` is the ordinary offline path, not an error.
 */
export function authorizeRun(i: AuthorizationInput): AuthorizationResult {
  if (!i.live) return { mayCallModels: false, blockers: [] };
  const blockers: string[] = [];
  if (!i.authorized) {
    blockers.push(
      "--live requires --i-authorize-model-spend; the flag exists so that " +
      "spending is a thing someone typed, not a default",
    );
  }
  if (!i.hasApiKey) blockers.push("OPENAI_API_KEY is not set");
  if (!i.model) blockers.push("--model is required in live mode; this harness never picks one for you");
  return { mayCallModels: blockers.length === 0, blockers };
}

export interface HarvestedRun {
  run_id: string;
  created_at: string;
  user_request: string;
  mission: Record<string, unknown>;
  discovery: Record<string, unknown>;
  outcome: Record<string, number>;
}

export interface OfflineCaseResult {
  case_id: string;
  provenance: EvalCase["provenance"];
  request: string;
  invariants: InvariantReport | null;
  discovery: DiscoveryScore | null;
  note: string;
}

/**
 * Score what is on disk. No model, no network, no database.
 *
 * Harvested cases get the full treatment because they have a real output to
 * score. Synthetic cases have no output until something compiles them, so they
 * are LISTED rather than scored — showing an empty score for them would look
 * like a pass.
 */
export function scoreOffline(runs: readonly HarvestedRun[]): OfflineCaseResult[] {
  const byRequest = new Map(runs.map((r) => [r.user_request.trim(), r]));
  return EVAL_CASES.map((c) => {
    const run = byRequest.get(c.request.trim());
    if (!run) {
      return {
        case_id: c.id,
        provenance: c.provenance,
        request: c.request,
        invariants: null,
        discovery: null,
        note: c.provenance === "synthetic"
          ? "no compiled output on disk — needs --live to score"
          : "HARVESTED case has no matching persisted run; fixture and corpus disagree",
      };
    }
    return {
      case_id: c.id,
      provenance: c.provenance,
      request: c.request,
      invariants: checkMissionInvariants(run.user_request, run.mission),
      discovery: readPersistedDiscoveryScore(run.discovery),
      note: `scored from persisted run ${run.run_id}`,
    };
  });
}

/**
 * The variance the end-to-end measure would have to see through.
 *
 * Computed from the harvested runs rather than asserted, because it is the
 * reason this harness scores model OUTPUT instead of lead counts.
 */
export function outcomeVariance(runs: readonly HarvestedRun[]): {
  runs: number;
  cost_equivalent_missions: boolean;
  residual_differences: string[];
  qualified: number[];
  identity_unresolved: number[];
  verdict: string;
} {
  // COST-EQUIVALENCE, NOT BYTE IDENTITY.
  //
  // Two compilations of one request are never byte-identical — they word
  // `evaluation_instructions` differently every time. Byte identity would
  // therefore report "missions differ" for every pair that ever existed and the
  // variance figure would never be computable. What the claim actually needs is
  // that nothing which CHANGES PAID WORK differs, which is what `compareMissions`
  // was built to decide.
  const pairs = runs.slice(1).map((r) => compareMissions(runs[0].mission, r.mission));
  const equivalent = pairs.every((p) => p.cost_equivalent);
  const residual = [...new Set(pairs.flatMap((p) =>
    p.differences.filter((d) => d.grade !== "inert").map((d) =>
      `${d.path}: ${JSON.stringify(d.baseline)} vs ${JSON.stringify(d.candidate)}`
    )
  ))];

  const q = runs.map((r) => Number(r.outcome.qualified ?? 0));
  const u = runs.map((r) => Number(r.outcome.identity_unresolved ?? 0));
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

  return {
    runs: runs.length,
    cost_equivalent_missions: equivalent,
    residual_differences: residual,
    qualified: q,
    identity_unresolved: u,
    verdict: equivalent
      ? `${runs.length} runs whose missions buy the same thing: qualified spread ` +
        `${spread(q)}, identity_unresolved spread ${spread(u)}. That spread is ` +
        "provider variance, and any A/B on these metrics must clear it before a " +
        "difference between two models means anything."
      : `${runs.length} runs, but the missions are not cost-equivalent ` +
        `(${residual.length} difference(s) that change paid work). The outcome ` +
        "spread below confounds input and provider variance and must not be " +
        "read as a noise floor.",
  };
}

if (import.meta.main) {
  const args = Deno.args;
  const has = (f: string) => args.includes(f);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };

  const auth = authorizeRun({
    live: has("--live"),
    authorized: has("--i-authorize-model-spend"),
    hasApiKey: !!Deno.env.get("OPENAI_API_KEY"),
    model: val("--model"),
  });

  if (has("--live") && !auth.mayCallModels) {
    console.error("REFUSED — live mode not authorized:");
    for (const b of auth.blockers) console.error(`  · ${b}`);
    Deno.exit(2);
  }
  if (auth.mayCallModels) {
    console.error(
      "Live mode is authorized but not implemented: the OpenAI account has no\n" +
      "credits, so no live path in this harness has ever been exercised and\n" +
      "shipping an unexercised paid code path is how a harness lies about a model.\n" +
      "Offline scoring below.",
    );
  }

  const fixture = JSON.parse(
    await Deno.readTextFile(new URL("./fixtures/anchor-runs.json", import.meta.url)),
  ) as { runs: HarvestedRun[] };

  console.log(`\n═══ OFFLINE SCORE  (${EVAL_RUNNER_VERSION})\n`);
  for (const r of scoreOffline(fixture.runs)) {
    const tag = r.provenance.toUpperCase().padEnd(9);
    console.log(`${tag} ${r.case_id}`);
    console.log(`          ${r.note}`);
    if (r.invariants) {
      console.log(
        `          invariants: ${r.invariants.checks_run} run, ` +
        `${r.invariants.violations.length} violated, ` +
        `${r.invariants.passed ? "PASS" : "FAIL"}`,
      );
      for (const v of r.invariants.violations) {
        console.log(`            [${v.severity}/${v.grade}] ${v.check}: ${v.message}`);
      }
    }
    if (r.discovery) {
      console.log(
        `          discovery: ${r.discovery.usable_actors} actor(s), ` +
        `${r.discovery.dropped_filters} dropped filter(s), ` +
        `${r.discovery.clean ? "CLEAN" : "NEEDED REPAIR (a second reasoning-tier call)"}`,
      );
    }
    console.log();
  }

  const v = outcomeVariance(fixture.runs);
  console.log("═══ OUTCOME VARIANCE ON AN UNCHANGED MISSION\n");
  console.log(`  runs                      ${v.runs}`);
  console.log(`  cost-equivalent missions  ${v.cost_equivalent_missions}`);
  for (const d of v.residual_differences) console.log(`    residual: ${d}`);
  console.log(`  qualified                 ${v.qualified.join(", ")}`);
  console.log(`  identity_unresolved       ${v.identity_unresolved.join(", ")}`);
  console.log(`\n  ${v.verdict}\n`);

  if (fixture.runs.length >= 2) {
    const [a, b] = fixture.runs;
    console.log("═══ THE TWO 10/10 MISSIONS, COMPARED BY COST IMPACT\n");
    console.log(`  ${a.run_id} vs ${b.run_id}: ${summarizeComparison(compareMissions(a.mission, b.mission))}\n`);
  }
}
