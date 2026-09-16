// LEAD V2 P2 — SETTLE SPEND FROM THE PROVIDER'S OWN RECEIPT.
//
// The engine records a provisional derived floor when a call returns. The bill
// is what Apify says the run cost, and Apify posts per-result charges after the
// run reports SUCCEEDED — so a reservation settles from `GET /actor-runs/{id}`
// and is only final once a later read repeats the same figure.
//
// The token travels in an Authorization header, never in a URL, and nothing
// here logs it.

import {
  receiptUsd, settlementPass, type ProviderReceipt, type SpendLedger, type SpendReservation,
} from "./budgetPolicy.ts";
import { apifyEventPrices } from "./providerCostModel.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The run's charge as Apify reports it. Null when the run cannot be read. */
export async function fetchApifyRunReceipt(
  runId: string,
  token: string,
  fetchFn: FetchLike = fetch,
): Promise<ProviderReceipt | null> {
  if (!runId || !token) return null;
  const res = await fetchFn(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const body = await res.json().catch(() => null) as { data?: Record<string, unknown> } | null;
  return apifyReceiptFromRun(body?.data ?? null);
}

/** Read a receipt out of an Apify run document. Pure. */
export function apifyReceiptFromRun(run: Record<string, unknown> | null): ProviderReceipt | null {
  if (!run) return null;
  const usage = typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null;
  const prices = apifyEventPrices(run.pricingInfo);
  const counts = run.chargedEventCounts as Record<string, unknown> | null | undefined;
  let charged: number | null = null;
  if (prices && counts && typeof counts === "object") {
    charged = 0;
    for (const [ev, n] of Object.entries(counts)) {
      if (typeof n === "number" && Number.isFinite(n) && prices[ev] !== undefined) charged += n * prices[ev];
    }
  }
  return {
    usageTotalUsd: usage, chargedUsd: charged,
    status: typeof run.status === "string" ? run.status : null,
    finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
  };
}

export interface SettleOutcome {
  reads: number;
  settled: number;
  stable: number;
  unsettled: number;
  /** Executed reservations with no run to read (e.g. failed before start). */
  without_run: number;
}

/**
 * Read receipts until every settleable reservation is stable or the attempts
 * run out. A reservation still unstable stays `settled` (not stable) and the
 * next pass — a continuation or the finalizer — reads it again.
 */
export async function settleUntilStable(
  l: SpendLedger,
  receiptFor: (runId: string) => Promise<ProviderReceipt | null>,
  opts: {
    attempts?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>;
    /** A read this soon after the run finished is never final. */
    minFinishedAgeMs?: number; now?: () => number;
  } = {},
): Promise<SettleOutcome> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const waitMs = Math.max(0, opts.waitMs ?? 8000);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const read = (r: SpendReservation) => r.provider_run_id ? receiptFor(r.provider_run_id) : Promise.resolve(null);
  const open = () => l.reservations.filter((r) =>
    r.provider_run_id && (r.status === "executed" || (r.status === "settled" && r.settlement_stable !== true)));
  let reads = 0;
  for (let i = 0; i < attempts && open().length > 0; i++) {
    if (i > 0) await sleep(waitMs);
    await settlementPass(l, read, {
      resettle: true, minFinishedAgeMs: opts.minFinishedAgeMs ?? 60_000, now: opts.now,
    });
    reads++;
  }
  const withRun = l.reservations.filter((r) => r.provider_run_id);
  return {
    reads,
    settled: withRun.filter((r) => r.status === "settled").length,
    stable: withRun.filter((r) => r.settlement_stable === true).length,
    unsettled: withRun.filter((r) => r.status === "executed").length,
    without_run: l.reservations.filter((r) => r.status === "executed" && !r.provider_run_id).length,
  };
}

export { receiptUsd };
