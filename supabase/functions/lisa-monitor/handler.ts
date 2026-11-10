// lisa-monitor — the LISA V2 endpoint. DISABLED BY DEFAULT.
//
// Every request answers 409 `lisa_v2_disabled` unless LISA_V2_ENABLED=true,
// before any credential, row or provider is touched. It must stay off in every
// hosted environment until the security phase revokes the browser write grants
// on the signal tables (docs/plans/lisa-v2/README.md → Deployment readiness).
//
//   weekly      member (read)          the top-5 weekly digest, recomputed against the current Brain
//   signals     member (read)          LISA signals with the downstream contract (verification, lifecycle, relevance)
//   scan_now    editor/admin/owner     on-demand scan of ≤ 3 watches; credits reserved per call;
//                                      a request_id makes a retry idempotent (same run keys → already_done)
//   transition  editor/admin/owner     dismiss / dispute / retract / restore, through lisa_signal_transition
//                                      (session + membership locked, role re-checked in the transaction)
//   tick        service key only       one scheduled sweep for one workspace; ALSO needs
//                                      LISA_V2_SCHEDULE_ENABLED=true. No cron is created anywhere.
//
// Roles come from the same rule as the Company Brain (brainRole.ts). A viewer
// can read; only an editor or above can spend credits or change a lifecycle.

import { canBrain, normalizeWorkspaceRole, type BrainPermission } from "../_shared/brainRole.ts";
import { sessionIdFromBearer } from "../_shared/brainWriter.ts";
import { loadCompanyBrainContext, type LoaderDb, type SharedBrainContext } from "../_shared/companyBrainContextLoader.ts";
import { competitorProposalsFromMonitoring, submitProposals } from "../_shared/lisaBrainProposals.ts";
import { resolveCreditEnforcement, type CreditDb } from "../_shared/creditAuthorization.ts";
import { priceFor } from "../_shared/creditPricing.ts";
import {
  effectiveWatchlist, onDemandRunKey, runWatch, tickWorkspace, watchKey, type MonitoringSubjectRow, type WatchRunResult,
} from "../_shared/lisa/orchestrator.ts";
import { rpcSignalStore } from "../_shared/lisa/persistence.ts";
import { firecrawlSource, ledgerBudget } from "../_shared/lisa/providers.ts";
import { toAgentSignal, weeklyDigest, WEEKLY_WINDOW_DAYS, type StoredSignalRow } from "../_shared/lisa/weekly.ts";
import type { SearchSource } from "../_shared/lisa/types.ts";

export const MAX_ON_DEMAND_WATCHES = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

export interface LisaDeps {
  env(key: string): string | undefined;
  admin: AdminClient;
  /** Resolves a bearer token to a user id (auth.getUser), or null. */
  userIdFor(token: string): Promise<string | null>;
  /** The collection provider; Firecrawl in production, recorded fixtures in tests. */
  source?: SearchSource;
  now?: () => Date;
}

export type LisaRequest =
  | { action: "weekly" | "signals"; workspace_id: string }
  | { action: "scan_now"; workspace_id: string; request_id: string; subject_key?: string }
  | { action: "transition"; workspace_id: string; signal_event_id: string; transition: "dismiss" | "dispute" | "retract" | "restore"; reason?: string }
  | { action: "tick"; workspace_id: string };

export function parseLisaRequest(b: unknown): { ok: true; req: LisaRequest } | { ok: false; error: string } {
  const o = (b ?? {}) as Record<string, unknown>;
  const ws = typeof o.workspace_id === "string" && UUID.test(o.workspace_id) ? o.workspace_id : null;
  if (!ws) return { ok: false, error: "workspace_id must be a uuid" };
  switch (o.action) {
    case "weekly": case "signals": case "tick":
      return { ok: true, req: { action: o.action, workspace_id: ws } };
    case "scan_now": {
      const rid = typeof o.request_id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(o.request_id) ? o.request_id : null;
      if (!rid) return { ok: false, error: "request_id (8–80 chars, [A-Za-z0-9_-]) is required so a retry cannot double-spend" };
      const sk = typeof o.subject_key === "string" ? o.subject_key.slice(0, 200) : undefined;
      return { ok: true, req: { action: "scan_now", workspace_id: ws, request_id: rid, ...(sk ? { subject_key: sk } : {}) } };
    }
    case "transition": {
      const id = typeof o.signal_event_id === "string" && UUID.test(o.signal_event_id) ? o.signal_event_id : null;
      const t = o.transition;
      if (!id) return { ok: false, error: "signal_event_id must be a uuid" };
      if (t !== "dismiss" && t !== "dispute" && t !== "retract" && t !== "restore") return { ok: false, error: "invalid transition" };
      const reason = typeof o.reason === "string" ? o.reason.slice(0, 500) : undefined;
      return { ok: true, req: { action: "transition", workspace_id: ws, signal_event_id: id, transition: t, ...(reason ? { reason } : {}) } };
    }
  }
  return { ok: false, error: "unknown action" };
}

export function permissionFor(action: LisaRequest["action"]): BrainPermission {
  return action === "weekly" || action === "signals" ? "read" : "edit";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function loadBrain(admin: AdminClient, ws: string, now: Date): Promise<SharedBrainContext | null> {
  try {
    const r = await loadCompanyBrainContext(admin as unknown as LoaderDb, ws, { skipMembershipCheck: true, now });
    return r.ok ? r.context : null;
  } catch { return null; }
}

async function monitoringRows(admin: AdminClient, ws: string): Promise<MonitoringSubjectRow[]> {
  const { data } = await admin.from("monitoring_subjects")
    .select("subject_kind, identifier, label, signals, enabled, cadence_minutes")
    .eq("workspace_id", ws).eq("enabled", true).limit(50);
  return (data ?? []) as MonitoringSubjectRow[];
}

async function storedLisaRows(admin: AdminClient, ws: string, now: Date): Promise<{ rows: StoredSignalRow[]; evidence: Map<string, Array<{ url: string; domain: string }>> }> {
  const since = new Date(now.getTime() - WEEKLY_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await admin.from("signal_events")
    .select("id, workspace_id, signal_type, lifecycle_status, verification_status, confidence, occurred_at, observed_at, source_url, subject_type, subject_key, normalized_value")
    .eq("workspace_id", ws).eq("actor_key", "lisa_v2").gte("observed_at", since)
    .order("observed_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as StoredSignalRow[];
  const evidence = new Map<string, Array<{ url: string; domain: string }>>();
  if (rows.length) {
    const { data: ev } = await admin.from("signal_event_evidence")
      .select("signal_event_id, source_url, normalized_value")
      .eq("workspace_id", ws).in("signal_event_id", rows.map((r) => r.id)).limit(1000);
    for (const e of (ev ?? []) as Array<{ signal_event_id: string; source_url: string | null; normalized_value: { domain?: string } | null }>) {
      if (!e.source_url) continue;
      const list = evidence.get(e.signal_event_id) ?? [];
      list.push({ url: e.source_url, domain: e.normalized_value?.domain ?? "" });
      evidence.set(e.signal_event_id, list);
    }
  }
  return { rows, evidence };
}

async function remainingMonitoringCredits(admin: AdminClient, ws: string): Promise<number> {
  const { data: b } = await admin.from("monitoring_budgets").select("period_ceiling, period_days").eq("workspace_id", ws).maybeSingle();
  // No budget row → the table default (200 credits / 7 days), the same as the legacy scheduler.
  const ceiling = Number((b as { period_ceiling?: number } | null)?.period_ceiling ?? 200);
  const days = Number((b as { period_days?: number } | null)?.period_days ?? 7);
  const { data: spent, error } = await admin.rpc("monitoring_spend_in_period", { p_workspace: ws, p_period_days: days });
  if (error) return 0; // cannot answer "may we spend?" → refuse
  return Math.max(0, ceiling - Number(spent ?? 0));
}

function summarize(r: WatchRunResult) {
  return { watch: r.watch, run_key: r.run_key, claim: r.claim, finish: r.finish, status: r.pass?.status ?? null,
    counts: r.pass?.counts ?? null, errors: r.pass?.errors ?? [] };
}

export async function handleLisa(req: Request, deps: LisaDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // THE GATE. Nothing below runs while LISA V2 is off.
  if (deps.env("LISA_V2_ENABLED") !== "true") return json({ error: "lisa_v2_disabled" }, 409);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice(7).trim();

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  const parsed = parseLisaRequest(body);
  if (!parsed.ok) return json({ error: "invalid_request", reason: parsed.error }, 400);
  const r = parsed.req;
  const now = deps.now?.() ?? new Date();
  const admin = deps.admin;
  const source = deps.source ?? firecrawlSource(deps.env("FIRECRAWL_API_KEY"));
  const price = priceFor("signal_search");

  // ── tick: an operator / future scheduler with the service key. Not a user path. ──
  if (r.action === "tick") {
    const service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!service || token !== service) return json({ error: "forbidden", reason: "service_key_required" }, 403);
    if (deps.env("LISA_V2_SCHEDULE_ENABLED") !== "true") return json({ error: "lisa_v2_schedule_disabled" }, 409);
    const brain = await loadBrain(admin, r.workspace_id, now);
    let remaining = await remainingMonitoringCredits(admin, r.workspace_id);
    const out = await tickWorkspace({
      db: admin, workspace_id: r.workspace_id, brain, rows: await monitoringRows(admin, r.workspace_id), source,
      store: rpcSignalStore(admin), now,
      budgetFor: (runKey) => {
        const b = ledgerBudget({ db: admin as unknown as CreditDb, workspace_id: r.workspace_id, run_key: runKey,
          mode: resolveCreditEnforcement((k) => deps.env(k)), scheduled: true, remainingPeriodCredits: remaining, price });
        return { authorize: async (q) => { const a = await b.authorize(q); if (a.ok) remaining -= price; return a; }, settle: b.settle };
      },
    });
    return json({ ok: true, results: out.results.map(summarize), skipped: out.skipped });
  }

  // ── user paths: membership and role first ──
  const userId = await deps.userIdFor(token);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const { data: member } = await admin.from("workspace_members").select("role")
    .eq("workspace_id", r.workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden", reason: "not_member" }, 403);
  const role = normalizeWorkspaceRole((member as { role?: unknown }).role);
  const required = permissionFor(r.action);
  if (!canBrain(role, required)) return json({ error: "lisa_role_forbidden", role, required }, 403);

  try {
    if (r.action === "weekly" || r.action === "signals") {
      const brain = await loadBrain(admin, r.workspace_id, now);
      const { rows, evidence } = await storedLisaRows(admin, r.workspace_id, now);
      if (r.action === "weekly") return json({ ok: true, digest: weeklyDigest(r.workspace_id, rows, brain, now, (id) => evidence.get(id) ?? []) });
      return json({ ok: true, brain_fingerprint: brain?.fingerprint ?? null,
        signals: rows.map((x) => toAgentSignal(x, brain, now, evidence.get(x.id) ?? [])).filter(Boolean) });
    }

    if (r.action === "transition") {
      const sessionId = sessionIdFromBearer(authHeader);
      if (!sessionId) return json({ error: "Unauthorized", reason: "session_invalid" }, 401);
      const { data, error } = await admin.rpc("lisa_signal_transition", {
        p_workspace_id: r.workspace_id, p_actor_id: userId, p_session_id: sessionId,
        p_signal_event_id: r.signal_event_id, p_action: r.transition, p_reason: r.reason ?? null,
      });
      if (error) return json({ error: "internal_error" }, 500);
      const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; lifecycle_status?: string } | null;
      const outcome = String(row?.outcome ?? "unknown");
      const status = outcome === "ok" ? 200 : outcome === "not_found" ? 404 : outcome === "invalid_transition" ? 409
        : outcome === "session_invalid" ? 401 : 403;
      return json({ ok: outcome === "ok", outcome, lifecycle_status: row?.lifecycle_status ?? null }, status);
    }

    if (r.action !== "scan_now") return json({ error: "invalid_request" }, 400);
    const brain = await loadBrain(admin, r.workspace_id, now);
    const rows = await monitoringRows(admin, r.workspace_id);
    const { watches, skipped } = effectiveWatchlist(brain, rows);
    const chosen = (r.subject_key ? watches.filter((w) => watchKey(w) === r.subject_key) : watches).slice(0, MAX_ON_DEMAND_WATCHES);
    if (!chosen.length) return json({ ok: false, error: "nothing_to_watch", skipped }, 409);
    const results: WatchRunResult[] = [];
    for (const w of chosen) {
      const run_key = onDemandRunKey(w, r.request_id);
      const res = await runWatch({
        db: admin, workspace_id: r.workspace_id, watch: w, brain, source, store: rpcSignalStore(admin), now, trigger: "on_demand", run_key,
        budget: ledgerBudget({ db: admin as unknown as CreditDb, workspace_id: r.workspace_id, run_key,
          mode: resolveCreditEnforcement((k) => deps.env(k)), scheduled: false, remainingPeriodCredits: null, price }),
      });
      results.push(res);
      if (res.pass?.status === "budget_exhausted") break;
    }
    // LISA → Company Brain: competitors watched but not in the Brain become PENDING proposals (existing mechanism).
    let proposals: Array<{ fact_key: string; outcome: string }> = [];
    if (brain) {
      const props = competitorProposalsFromMonitoring(
        rows.map((x) => ({ kind: x.subject_kind, identifier: x.identifier, label: x.label })), brain.competitors, () => null, now);
      if (props.length) proposals = await submitProposals(admin as unknown as Parameters<typeof submitProposals>[0], r.workspace_id, "lisa", props);
    }
    return json({ ok: true, results: results.map(summarize), skipped, proposals });
  } catch (e) {
    console.error("[lisa-monitor]", e instanceof Error ? e.message : String(e));
    return json({ error: "internal_error" }, 500);
  }
}
