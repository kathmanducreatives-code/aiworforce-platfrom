// The pipeline's Apify invoker: a synchronous actor run, bounded three ways.
//
//   allowlist   only the actors this pipeline priced (canonical.ts, signals.ts);
//               anything else is refused before a request is made
//   USD cap     maxTotalChargeUsd = the run's worst case (Apify stops a
//               pay-per-event actor at the cap) and maxItems
//   no retry    one request; a timeout or 5xx is thrown to the caller, which
//               counts the worst case and stops that step (it may have billed)
//
// The token goes in the Authorization header, never in a URL (URLs are logged).
// Apify has no idempotency key: the caller's ledger key is the guard, and this
// invoker refuses a key it has already run in the same process.

import type { ActorInvoker, ActorRun } from "../discoveryProviders/adapters/apify.ts";
import type { FetchLike } from "../discoveryProviders/http.ts";
import { COMPANY_RECORD_ACTOR } from "./canonical.ts";
import { SIGNAL_ACTORS, worstCaseUsd } from "./signals.ts";
import { COMPANY_EMPLOYEES_ACTOR } from "./founderCheck.ts";

export const PIPELINE_ACTORS: Readonly<Record<string, { actorId: string; perItemUsd: number; perStartUsd: number; emptyUsd: number }>> = Object.freeze({
  [COMPANY_RECORD_ACTOR.key]: { actorId: COMPANY_RECORD_ACTOR.actorId, perItemUsd: COMPANY_RECORD_ACTOR.perItemUsd, perStartUsd: COMPANY_RECORD_ACTOR.perStartUsd, emptyUsd: 0 },
  [SIGNAL_ACTORS.profilePosts.key]: SIGNAL_ACTORS.profilePosts,
  [SIGNAL_ACTORS.companyPosts.key]: SIGNAL_ACTORS.companyPosts,
  [SIGNAL_ACTORS.jobs.key]: SIGNAL_ACTORS.jobs,
  [COMPANY_EMPLOYEES_ACTOR.key]: COMPANY_EMPLOYEES_ACTOR,
  // Discovery actors (discoveryEngine/sources/apify.ts); prices from hiringActorCatalog.ts, BRONZE.
  apify_linkedin_post_search: { actorId: "harvestapi/linkedin-post-search", perStartUsd: 0.00005, perItemUsd: 0.002, emptyUsd: 0.001 },
  // $0.10 per search page (≤25 short profiles) is the floor: perStart carries it.
  apify_people_search: { actorId: "harvestapi/linkedin-profile-search", perStartUsd: 0.1, perItemUsd: 0.004, emptyUsd: 0 },
});

export class ApifyRefusal extends Error { override name = "ApifyRefusal"; }

export function pipelineApifyInvoker(deps: { token: string; fetch: FetchLike; timeoutMs?: number; baseUrl?: string }): ActorInvoker & { runs: { actorKey: string; status: number | null; items: number; capUsd: number }[] } {
  const done = new Set<string>();
  const runs: { actorKey: string; status: number | null; items: number; capUsd: number }[] = [];
  const base = deps.baseUrl ?? "https://api.apify.com";
  const invoke = async (actorKey: string, input: Record<string, unknown>, opts: { maxItems: number; idempotencyKey: string }): Promise<ActorRun> => {
    const a = PIPELINE_ACTORS[actorKey];
    if (!a) throw new ApifyRefusal(`actor ${actorKey} is not on the pipeline allowlist`);
    if (done.has(opts.idempotencyKey)) throw new ApifyRefusal(`run ${opts.idempotencyKey} was already started (no repeats)`);
    if (!Number.isInteger(opts.maxItems) || opts.maxItems < 1 || opts.maxItems > 200) throw new ApifyRefusal("maxItems must be 1–100");
    done.add(opts.idempotencyKey);
    const capUsd = worstCaseUsd({ key: actorKey, ...a }, opts.maxItems);
    const q = new URLSearchParams({ maxItems: String(opts.maxItems), maxTotalChargeUsd: capUsd.toFixed(5), timeout: String(Math.ceil((deps.timeoutMs ?? 120_000) / 1000)) });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), (deps.timeoutMs ?? 120_000) + 5_000);
    let status: number | null = null;
    try {
      const res = await deps.fetch(`${base}/v2/acts/${a.actorId.replace("/", "~")}/run-sync-get-dataset-items?${q}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.token}` }, body: JSON.stringify(input), signal: ctl.signal,
      });
      status = res.status;
      if (!res.ok) throw new Error(`apify ${res.status}`);
      const items = await res.json();
      const list = Array.isArray(items) ? items.slice(0, opts.maxItems) : [];
      runs.push({ actorKey, status, items: list.length, capUsd });
      // run-sync does not report the charge: the caller records the estimate (worst case for this many items).
      return { items: list, runId: res.headers.get("x-apify-run-id") ?? undefined };
    } catch (e) {
      runs.push({ actorKey, status, items: 0, capUsd });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  return Object.assign(invoke, { runs });
}

/** Ledger units for Apify: 1 unit = $0.00001 (the ledger counts integers). */
export const APIFY_UNIT_USD = 0.00001;
export const usdToUnits = (usd: number) => Math.ceil(usd / APIFY_UNIT_USD - 1e-6);

/**
 * Durable accounting for Apify runs: each run reserves its worst case in the
 * usage ledger under its idempotency key before it starts. A settled key
 * replays the stored items (a re-run never buys twice); a failed run is marked
 * uncertain (it may have billed) and is never retried; `maxUsd` caps the
 * mission's Apify total across runs and sessions.
 */
export function ledgeredInvoker(invoke: ActorInvoker, ledger: import("../discoveryProviders/budget.ts").UsageLedger, scope: { workspaceId: string; missionId: string; maxUsd: number }): ActorInvoker {
  return async (actorKey, input, opts) => {
    const a = PIPELINE_ACTORS[actorKey];
    if (!a) throw new ApifyRefusal(`actor ${actorKey} is not on the pipeline allowlist`);
    const units = usdToUnits(worstCaseUsd({ key: actorKey, ...a }, opts.maxItems));
    const cap = usdToUnits(scope.maxUsd);
    const r = await ledger.reserve({ workspaceId: scope.workspaceId, missionId: scope.missionId, provider: "apify", key: opts.idempotencyKey, credits: units, providerCap: cap, missionCap: Infinity });
    if (!r.ok) throw new ApifyRefusal(`ledger refused ${actorKey}: ${r.reason}`);
    if (r.replay) return { ...(r.result as ActorRun), chargedUsd: 0 };
    try {
      const run = await invoke(actorKey, input, opts);
      const spent = run.chargedUsd ?? worstCaseUsd({ key: actorKey, ...a }, Math.max(1, run.items.length));
      await ledger.settle(opts.idempotencyKey, Math.min(units, usdToUnits(spent)), { items: run.items, runId: run.runId ?? null });
      return run;
    } catch (e) {
      if (!(e instanceof ApifyRefusal)) await ledger.markUncertain(opts.idempotencyKey); else await ledger.release(opts.idempotencyKey);
      throw e;
    }
  };
}
