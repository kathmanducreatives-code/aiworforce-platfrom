// ASYNCHRONOUS APIFY RUNS WITH REAL RECEIPTS (V5 phase C).
//
// One transport, four documented calls (Apify API v2):
//
//   start    POST /v2/acts/{actor}/runs?build=&maxItems=&maxTotalChargeUsd=&timeout=[&memory=]&waitForFinish=0
//   poll     GET  /v2/actor-runs/{runId}?waitForFinish≤60      (documented long-poll, 0–60 s)
//   items    GET  /v2/datasets/{datasetId}/items?clean=true&limit=
//   abort    POST /v2/actor-runs/{runId}/abort
//
// and the ledger discipline that makes a purchase happen at most once:
//
//   reserve the worst case under the step's key (mission:planHash:step)    ledger
//   start, then RECORD THE RUN ID on that reservation BEFORE polling       ledger.recordRun
//   poll within this request's deadline; a run still going is RunPending (202 running);
//   the next request with the same signed plan finds the reservation in flight, reads the
//   recorded run and ADOPTS it (polls it) — it never starts another
//   settle from the run's own receipt: provider_reported, and `settled` once a read at least
//   APIFY_SETTLE_MS after the run finished repeats the same figure (V2's rule, reused)
//
// Reused from V2 (not re-implemented): `apifyReceiptFromRun` (providerReceipts.ts) reads
// usageTotalUsd and chargedEventCounts × the run's own event prices; `receiptUsd`
// (budgetPolicy.ts) takes the larger of the two, never their sum; `apifyRunSettled`,
// `APIFY_MAX_WAIT_S`, `APIFY_SETTLE_MS` (smokeAdmissionRefusal.ts) are the documented
// long-poll bound and the "costs are stable ~10 s after finish" rule.
//
// Never retried: `restartOnError` is not sent (Apify's default is false), a FAILED run is final
// for its step, and a start whose answer was lost is UNKNOWN — it may have bought — so its
// reservation is marked uncertain (the worst case stays counted) and is never started again.
// The token travels in the Authorization header, never in a URL.

import type { ActorInvoker, ActorRun } from "../discoveryProviders/adapters/apify.ts";
import type { UsageLedger } from "../discoveryProviders/budget.ts";
import type { FetchLike } from "../discoveryProviders/http.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { receiptUsd } from "../budgetPolicy.ts";
import { apifyReceiptFromRun } from "../providerReceipts.ts";
import { APIFY_MAX_WAIT_S, APIFY_SETTLE_MS, apifyRunSettled } from "../smokeAdmissionRefusal.ts";
import { reviewedBuild, unknownInputKeys } from "./actorBuilds.ts";
import { ApifyRefusal, PIPELINE_ACTORS, usdToUnits } from "./apifyInvoker.ts";
import { worstCaseUsd } from "./signals.ts";
import { RunFailed, RunPending } from "./runErrors.ts";

export { failedChargeUsd, rethrowPending, RunFailed, RunPending } from "./runErrors.ts";

// ── Charge states (stored on the ledger row and reported in the outcome) ─────

/**
 *   estimated          the plan's worst case (no run yet)
 *   reserved           the ledger holds the worst case; the run started or is starting
 *   provider_reported  the run's receipt was read once; not yet confirmed final
 *   settled            a receipt read ≥ APIFY_SETTLE_MS after finish repeated the same figure
 *   unknown            the receipt could not be read (or the start's answer was lost): the
 *                      worst case stays counted and the charge is labelled unknown
 */
export type ChargeState = "estimated" | "reserved" | "provider_reported" | "settled" | "unknown";

export interface RunCharge {
  actorKey: string;
  key: string;
  runId: string | null;
  state: ChargeState;
  /** The provider's figure when read; the worst case when unknown; null while reserved. */
  usd: number | null;
  reservedUsd: number;
  build: string | null;
  status: string | null;
}

/** What a started run leaves on its reservation, before the first poll. */
export interface RecordedRun {
  runId: string;
  datasetId: string | null;
  actorId: string;
  build: string;
  buildId: string | null;
  inputHash: string;
  startedAt: string;
}

/** A ledger that can hold the started run on an IN-FLIGHT reservation (and read it back). */
export interface RunLedger extends UsageLedger {
  recordRun(key: string, run: RecordedRun): Promise<void>;
  /** The run recorded on an in-flight reservation; null when none was recorded. */
  recordedRun(key: string): Promise<RecordedRun | null>;
  /** A SETTLED row's figure, re-read from a later receipt (provider_reported → settled). */
  resettle(key: string, actual: number, result: unknown): Promise<void>;
}

const r6 = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

// ── The HTTP transport (documented endpoints only) ───────────────────────────

export interface StartParams { build: string; maxItems: number; maxTotalChargeUsd: number; timeoutS: number; memoryMb?: number }

export type StartResult =
  | { ok: true; runId: string; datasetId: string | null; buildId: string | null; status: string }
  /** Apify answered 4xx: no run was created. */
  | { ok: false; definite: true; status: number; message: string }
  /** No answer (connection lost, timeout, 5xx): a run MAY exist. */
  | { ok: false; definite: false; status: number | null; message: string };

export interface ApifyTransport {
  start(actorId: string, input: Record<string, unknown>, p: StartParams): Promise<StartResult>;
  /** The run document, long-polled up to `waitS` (≤ 60); null when it cannot be read. */
  run(runId: string, waitS: number): Promise<Record<string, unknown> | null>;
  items(datasetId: string, limit: number): Promise<unknown[]>;
  abort(runId: string): Promise<boolean>;
}

export function apifyHttpTransport(deps: { token: string; fetch: FetchLike; baseUrl?: string; requestSlackMs?: number }): ApifyTransport {
  const base = deps.baseUrl ?? "https://api.apify.com";
  const auth = { Authorization: `Bearer ${deps.token}` };
  const slack = deps.requestSlackMs ?? 10_000;
  const call = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }, ms: number) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await deps.fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
  };
  return {
    async start(actorId, input, p) {
      const q = new URLSearchParams({ build: p.build, maxItems: String(p.maxItems), maxTotalChargeUsd: p.maxTotalChargeUsd.toFixed(5),
        timeout: String(p.timeoutS), waitForFinish: "0", ...(p.memoryMb ? { memory: String(p.memoryMb) } : {}) });
      let res: Response;
      try {
        res = await call(`${base}/v2/acts/${actorId.replace("/", "~")}/runs?${q}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(input) }, slack + 20_000);
      } catch (e) {
        return { ok: false, definite: false, status: null, message: `start not answered (${(e as Error)?.name ?? "error"})` };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        const body = await res.text().catch(() => "");
        return { ok: false, definite: true, status: res.status, message: body.slice(0, 300) };
      }
      if (!res.ok) { await res.body?.cancel(); return { ok: false, definite: false, status: res.status, message: `apify ${res.status}` }; }
      const d = ((await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null)?.data;
      if (!d || typeof d.id !== "string") return { ok: false, definite: false, status: res.status, message: "start answered without a run id" };
      return { ok: true, runId: d.id, datasetId: typeof d.defaultDatasetId === "string" ? d.defaultDatasetId : null, buildId: typeof d.buildId === "string" ? d.buildId : null, status: String(d.status ?? "READY") };
    },
    async run(runId, waitS) {
      const w = Math.max(0, Math.min(APIFY_MAX_WAIT_S, Math.floor(waitS)));
      try {
        const res = await call(`${base}/v2/actor-runs/${encodeURIComponent(runId)}?waitForFinish=${w}`, { method: "GET", headers: auth }, w * 1000 + slack);
        if (!res.ok) { await res.body?.cancel(); return null; }
        return (((await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null)?.data) ?? null;
      } catch { return null; }
    },
    async items(datasetId, limit) {
      const res = await call(`${base}/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`, { method: "GET", headers: auth }, slack + 20_000);
      if (!res.ok) { await res.body?.cancel(); throw new Error(`dataset ${res.status}`); }
      const list = await res.json();
      return Array.isArray(list) ? list.slice(0, limit) : [];
    },
    async abort(runId) {
      try {
        const res = await call(`${base}/v2/actor-runs/${encodeURIComponent(runId)}/abort`, { method: "POST", headers: auth }, slack);
        await res.body?.cancel();
        return res.ok;
      } catch { return false; }
    },
  };
}

// ── The ledgered async invoker ───────────────────────────────────────────────

export async function inputHash(input: Record<string, unknown>): Promise<string> {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canon(input))));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AsyncInvokerOptions {
  /** How long this request may wait on one run before answering RunPending. */
  deadlineMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  defaultTimeoutS?: number;
}

/**
 * The ActorInvoker the pipeline uses when async runs are on. Every call is one ledger key:
 * a settled key replays its stored items; an in-flight key with a recorded run is adopted;
 * otherwise the worst case is reserved, the run started, its id recorded, then followed.
 * `charges` lists what each key cost and how sure that figure is.
 */
export function asyncLedgeredInvoker(transport: ApifyTransport, ledger: RunLedger, scope: { workspaceId: string; missionId: string; maxUsd: number }, o: AsyncInvokerOptions = {}): ActorInvoker & { charges: RunCharge[] } {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadlineMs = o.deadlineMs ?? 90_000;
  const charges: RunCharge[] = [];

  const follow = async (actorKey: string, key: string, rec: RecordedRun, maxItems: number, worstUsd: number, units: number, t0: number): Promise<ActorRun> => {
    let doc: Record<string, unknown> | null = null;
    let status = "READY";
    // POLL within this request's own deadline (each read ≤ 60 s, the documented maximum).
    while (!TERMINAL.has(status)) {
      const left = deadlineMs - (now() - t0);
      if (left <= 1_000) break;
      const read = await transport.run(rec.runId, Math.min(APIFY_MAX_WAIT_S, Math.floor((left - 1_000) / 1000)));
      if (read) { doc = read; status = String(read.status ?? status); }
      else await sleep(Math.min(2_000, Math.max(0, left - 1_000)));
    }
    if (!TERMINAL.has(status)) {
      charges.push({ actorKey, key, runId: rec.runId, state: "reserved", usd: null, reservedUsd: worstUsd, build: rec.build, status });
      throw new RunPending(actorKey, rec.runId, status, worstUsd);
    }
    // ITEMS, then the RECEIPT. A figure is final only from a read at least APIFY_SETTLE_MS after
    // the run finished that repeats the previous read (charges post after SUCCEEDED).
    const items = status === "SUCCEEDED" && rec.datasetId ? await transport.items(rec.datasetId, maxItems).catch(() => null) : [];
    let usd = r6(receiptUsd(apifyReceiptFromRun(doc)));
    let state: ChargeState = usd === null ? "unknown" : "provider_reported";
    if (!apifyRunSettled(doc, now())) {
      const finished = typeof doc?.finishedAt === "string" ? Date.parse(doc.finishedAt) : NaN;
      const wait = Number.isFinite(finished) ? Math.max(0, finished + APIFY_SETTLE_MS - now()) : APIFY_SETTLE_MS;
      if (now() - t0 + wait + 5_000 <= deadlineMs) await sleep(wait);
    }
    if (now() - t0 + 5_000 <= deadlineMs) {
      const again = await transport.run(rec.runId, 0);
      const usd2 = r6(receiptUsd(apifyReceiptFromRun(again)));
      if (usd2 !== null) {
        state = usd !== null && Math.abs(usd2 - usd) < 1e-9 && apifyRunSettled(again, now()) ? "settled" : "provider_reported";
        usd = usd2;
      }
    }
    const charged = usd ?? worstUsd;
    // The ledger keeps the provider's figure (never above what was reserved: maxTotalChargeUsd
    // capped the run at that worst case); an unreadable receipt keeps the worst case.
    const chargeUnits = usd === null ? units : Math.min(units, usdToUnits(usd));
    if (items === null) {
      // The run bought its items but the dataset could not be read: never re-bought; counted.
      await ledger.settle(key, chargeUnits, { items: [], runId: rec.runId, charge: { state, usd: charged }, datasetUnread: true });
      charges.push({ actorKey, key, runId: rec.runId, state, usd: charged, reservedUsd: worstUsd, build: rec.build, status });
      throw new RunFailed(actorKey, rec.runId, "DATASET-UNREADABLE", charged, state);
    }
    await ledger.settle(key, chargeUnits, { items, runId: rec.runId, buildId: rec.buildId, charge: { state, usd: charged } });
    charges.push({ actorKey, key, runId: rec.runId, state, usd: charged, reservedUsd: worstUsd, build: rec.build, status });
    if (status !== "SUCCEEDED") throw new RunFailed(actorKey, rec.runId, status, charged, state);
    return { items, runId: rec.runId, chargedUsd: charged };
  };

  const invoke = async (actorKey: string, input: Record<string, unknown>, opts: { maxItems: number; idempotencyKey: string }): Promise<ActorRun> => {
    const t0 = now();
    const a = PIPELINE_ACTORS[actorKey];
    if (!a) throw new ApifyRefusal(`actor ${actorKey} is not on the pipeline allowlist`);
    const build = reviewedBuild(actorKey);
    if (!build || build.actorId !== a.actorId) throw new ApifyRefusal(`actor ${actorKey} has no reviewed build`);
    if (!Number.isInteger(opts.maxItems) || opts.maxItems < 1 || opts.maxItems > 100) throw new ApifyRefusal("maxItems must be 1–100");
    const unknown = unknownInputKeys(actorKey, input);
    if (unknown.length) throw new ApifyRefusal(`input field(s) ${unknown.join(", ")} are not in ${a.actorId} build ${build.build}'s schema`);
    const worstUsd = worstCaseUsd({ key: actorKey, ...a }, opts.maxItems);
    const units = usdToUnits(worstUsd);
    const key = opts.idempotencyKey;

    const r = await ledger.reserve({ workspaceId: scope.workspaceId, missionId: scope.missionId, provider: "apify", key, credits: units, providerCap: usdToUnits(scope.maxUsd), missionCap: Infinity });
    if (r.ok && r.replay) {
      const stored = (r.result ?? {}) as { items?: unknown[]; runId?: string | null; charge?: { state: ChargeState; usd: number } } & Record<string, unknown>;
      let state: ChargeState = stored.charge?.state ?? "provider_reported";
      // A figure not yet confirmed final is read again (a free GET): V2's rule — a read at least
      // APIFY_SETTLE_MS after the run finished that repeats the stored figure settles it; a
      // different figure replaces it (still provider_reported). It is never charged again.
      if ((state === "provider_reported" || state === "unknown") && stored.runId) {
        const again = await transport.run(stored.runId, 0);
        const usd2 = r6(receiptUsd(apifyReceiptFromRun(again)));
        if (usd2 !== null) {
          const prev = state === "provider_reported" ? stored.charge?.usd ?? null : null;
          state = prev !== null && Math.abs(prev - usd2) < 1e-9 && apifyRunSettled(again, now()) ? "settled" : "provider_reported";
          await ledger.resettle(key, Math.min(units, usdToUnits(usd2)), { ...stored, charge: { state, usd: usd2 } }).catch(() => undefined);
        }
      }
      charges.push({ actorKey, key, runId: stored.runId ?? null, state, usd: 0, reservedUsd: 0, build: build.build, status: "REPLAYED" });
      return { items: stored.items ?? [], runId: stored.runId ?? null, chargedUsd: 0 };
    }
    if (!r.ok && r.reason === "in_flight") {
      // ADOPT: the run another request started (or started and lost). Never a second start.
      const rec = await ledger.recordedRun(key);
      if (!rec) throw new RunPending(actorKey, null, "STARTING", worstUsd);
      if (rec.inputHash !== await inputHash(input) || rec.build !== build.build) throw new ApifyRefusal(`the run in flight for ${key} was started with a different input or build`);
      return follow(actorKey, key, rec, opts.maxItems, worstUsd, units, t0);
    }
    if (!r.ok && r.reason === "charge_uncertain") {
      // An earlier start whose answer was lost: still unknown, its worst case already counted.
      charges.push({ actorKey, key, runId: null, state: "unknown", usd: 0, reservedUsd: 0, build: build.build, status: "UNKNOWN-EARLIER-START" });
    }
    if (!r.ok) throw new ApifyRefusal(`ledger refused ${actorKey}: ${r.reason}`);

    const started = await transport.start(a.actorId, input, { build: build.build, maxItems: opts.maxItems, maxTotalChargeUsd: worstUsd,
      timeoutS: a.timeoutS ?? o.defaultTimeoutS ?? 300, ...(a.memoryMb ? { memoryMb: a.memoryMb } : {}) });
    if (!started.ok) {
      if (started.definite) { await ledger.release(key); throw new ApifyRefusal(`apify refused the start (${started.status}): ${started.message}`); }
      // A start whose answer was lost MAY have bought: the worst case stays, never restarted.
      await ledger.markUncertain(key);
      charges.push({ actorKey, key, runId: null, state: "unknown", usd: worstUsd, reservedUsd: worstUsd, build: build.build, status: "START-UNANSWERED" });
      const e = new Error(`${actorKey}: ${started.message}; may have started — counted at its worst case, never restarted`); e.name = "StartUnknown";
      throw e;
    }
    const rec: RecordedRun = { runId: started.runId, datasetId: started.datasetId, actorId: a.actorId, build: build.build, buildId: started.buildId,
      inputHash: await inputHash(input), startedAt: new Date(now()).toISOString() };
    // THE RUN ID IS DURABLE BEFORE THE FIRST POLL. If it cannot be written, this request still
    // follows the run; it may not hand it to a later request (RunPending → uncertain instead).
    let recorded = true;
    try { await ledger.recordRun(key, rec); } catch { recorded = false; }
    try {
      return await follow(actorKey, key, rec, opts.maxItems, worstUsd, units, t0);
    } catch (e) {
      if (e instanceof RunPending && !recorded) {
        await ledger.markUncertain(key);
        const c = charges[charges.length - 1];
        if (c?.key === key) c.state = "unknown";
        const u = new Error(`${actorKey} run ${rec.runId} outlived this request and its id could not be recorded; counted at its worst case`); u.name = "StartUnknown";
        throw u;
      }
      throw e;
    }
  };
  return Object.assign(invoke, { charges });
}

/** Abort a run (a cancelled mission). Its receipt is still read by the next settle. */
export async function abortRun(transport: ApifyTransport, ledger: RunLedger, key: string): Promise<{ aborted: boolean; runId: string | null }> {
  const rec = await ledger.recordedRun(key);
  if (!rec) return { aborted: false, runId: null };
  return { aborted: await transport.abort(rec.runId), runId: rec.runId };
}

/** The outcome's spend basis from the run charges: provider-reported only when every paid run was. */
export function spendBasis(charges: readonly RunCharge[]): { basis: "estimate" | "provider_reported"; states: Partial<Record<ChargeState, number>> } {
  const paid = charges.filter((c) => c.status !== "REPLAYED");
  const states: Partial<Record<ChargeState, number>> = {};
  for (const c of paid) states[c.state] = (states[c.state] ?? 0) + 1;
  const reported = paid.length > 0 && paid.every((c) => c.state === "settled" || c.state === "provider_reported");
  return { basis: reported ? "provider_reported" : "estimate", states };
}

// ── Ledgers that can hold a started run ─────────────────────────────────────

/** In memory (tests, simulator): the run is kept on the reserved entry's `result`. */
export function memoryRunLedger(base: UsageLedger & { entries: Map<string, { key: string; state: string; result?: unknown }> }): RunLedger {
  const find = (key: string) => [...base.entries.values()].find((e) => e.key === key && e.state === "reserved");
  return Object.assign(base, {
    recordRun(key: string, run: RecordedRun) { const e = find(key); if (!e) return Promise.reject(new Error("no in-flight reservation")); e.result = { run }; return Promise.resolve(); },
    recordedRun(key: string) { const e = find(key); return Promise.resolve(((e?.result as { run?: RecordedRun } | undefined)?.run) ?? null); },
    resettle(key: string, actual: number, result: unknown) {
      const e = [...base.entries.values()].find((x) => x.key === key && x.state === "settled") as { actual?: number | null; result?: unknown } | undefined;
      if (e) { e.actual = actual; e.result = result; }
      return Promise.resolve();
    },
  });
}

/**
 * Hosted: the started run is written into the RESERVED row's `result` (jsonb) by the
 * service-role client, so no migration is needed. `provider_usage_finish` only accepts final
 * states, and only a reserved row is touched (`state = 'reserved'`), so a settled or
 * uncertain row is never rewritten. If the write is refused, `recordRun` throws and the
 * invoker falls back to "follow it now, else count it uncertain" (never a second start).
 */
export function supabaseRunLedger(
  admin: SupabaseClient,
  workspaceId: string,
  base: UsageLedger,
): RunLedger {
  return Object.assign(Object.create(base) as UsageLedger, base, {
    async recordRun(key: string, run: RecordedRun) {
      const { data, error } = await admin.from("provider_usage_ledger").update({ result: { run }, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId).eq("idempotency_key", key).eq("state", "reserved").select("id");
      if (error) throw new Error(`run not recorded: ${error.message}`);
      if (!Array.isArray(data) || data.length !== 1) throw new Error("run not recorded: no in-flight reservation");
    },
    async recordedRun(key: string) {
      const { data, error } = await admin.from("provider_usage_ledger").select("result").eq("workspace_id", workspaceId).eq("idempotency_key", key).eq("state", "reserved").maybeSingle();
      if (error) throw new Error(`run not read: ${error.message}`);
      return ((data?.result as { run?: RecordedRun } | null)?.run) ?? null;
    },
    async resettle(key: string, actual: number, result: unknown) {
      // Only a SETTLED row; its figure moves to the provider's later, confirmed receipt.
      const { error } = await admin.from("provider_usage_ledger").update({ credits_actual: actual, result, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId).eq("idempotency_key", key).eq("state", "settled");
      if (error) throw new Error(`receipt not re-settled: ${error.message}`);
    },
  });
}

