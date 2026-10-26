// THE LIVE-PRINCIPAL EFFECT FENCE (Codex EXEC-EFFECT, #185 follow-up).
//
// The pre-effect guard (legacyExecutionGuard.ts) authorizes a run at entry and
// the task commit boundary (held 20261025130000) authorizes the task row where
// it is written. Neither covers what comes AFTER the task exists: Codex removed
// the principal's membership once the task INSERT had committed, and the
// handler still started a new model request.
//
// This fence closes that gap at the one place every new external operation
// passes: the transport. While a run is bound to a principal (`effectScope`,
// AsyncLocalStorage, the same pattern as smokeAdmission's `missionAdmission`),
// every request that would START something — a model call, a provider
// purchase, any other host, the project's own functions — first re-reads that
// the principal is still a member of the workspace. A principal removed (and
// committed) before the request is refused before anything is sent.
//
// What it does NOT stop, deliberately:
//   * the project's own REST / Auth / Storage (task accounting, settlement,
//     checkpoints, the membership read itself);
//   * reads of an operation already admitted (Apify run status and dataset,
//     Firecrawl crawl status — smokeAdmission's `poll` classification) and an
//     Apify abort: settling or stopping what was already bought is accounting,
//     not a new operation.
// No second ledger, router or ACL: the request classification is
// smokeAdmission's `classifyRequest`, the refusal is its `refusal` (so the
// tools' existing handling applies), and the authority is the same
// `workspace_members` row the guard reads. A refused PROVIDER request is
// reported "purchase may exist" (503), never as a definite non-start: an
// earlier attempt's credit hold is never refunded by this refusal (R1); the
// reaper settles a hold that had no purchase.
//
// Outside a bound run (no scope, or a scope before the guard bound it) the
// fence passes everything through unchanged.
import { AsyncLocalStorage } from "node:async_hooks";
import { classifyRequest, refusal } from "./smokeAdmission.ts";

type Read = PromiseLike<{ data: unknown; error: unknown }>;
/** The reads the fence needs, against the service client (structurally typed). */
export interface EffectPrincipalDb {
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { eq(col: string, v: string): { maybeSingle(): Read } } };
  };
}
/**
 * A client task's immutable pins (held 20261025170000, #174 §9.1), written once
 * when the task was created. Present only for client-scoped work — which every
 * entry still refuses (#179's guard) until the owner enables client Brains.
 */
export interface EffectPins {
  clientId: string;
  grantId: string;
  generation: number;
  permissionRevision: number | string;
  originSessionId: string;
}
export interface EffectPrincipal {
  db: EffectPrincipalDb;
  workspaceId: string;
  userId: string;
  pins?: EffectPins | null;
  /**
   * §9.2 for a pinned task: Brain's rule, task intent, for exactly these pins
   * and the original session — `client_brain_authorization(...)` through
   * Brain's own `_shared/clientBrain.ts` helper, supplied by whoever binds a
   * client run (only once the owner enables client Brains). Returns 'ok' or
   * Brain's refusal. Pins without it fail closed.
   */
  authorizeTask?: (pins: EffectPins) => Promise<string>;
}
export interface EffectScope {
  principal: EffectPrincipal | null;
  /** The request this scope was opened for (`withEffectScope`). */
  entry?: unknown;
}
export const effectScope = new AsyncLocalStorage<EffectScope>();

/**
 * Run `fn` in a fresh scope opened for `entry` (the handler's own request),
 * unless it already runs in that request's scope. A handler calls it first, so
 * every invocation — edge server, in-process worker — gets its own scope, and
 * a principal bound for one request is never seen by another.
 */
export function withEffectScope<T>(entry: unknown, fn: () => Promise<T>): Promise<T> | null {
  if (effectScope.getStore()?.entry === entry) return null;
  return effectScope.run({ principal: null, entry }, fn);
}

/** Bind the current run (after its guard passed) to the principal every later effect must still have. */
export function bindEffectPrincipal(p: EffectPrincipal): void {
  const s = effectScope.getStore();
  if (s) s.principal = p;
}

export type EffectVerdict = "ok" | "principal_not_member" | "effect_authorization_unavailable" | `client_${string}`;

/**
 * May this principal start a new operation RIGHT NOW? A member of the
 * workspace — and, for a pinned client task, still authorized for exactly the
 * pinned grant generation, permission revision and original session (§9.2:
 * Brain's own rule, task intent; any refusal stops the task, it never re-pins).
 * Fails closed.
 */
export async function liveEffectAuthorization(p: EffectPrincipal): Promise<EffectVerdict> {
  try {
    const { data, error } = await p.db.from("workspace_members").select("user_id")
      .eq("workspace_id", p.workspaceId).eq("user_id", p.userId).maybeSingle();
    if (error) return "effect_authorization_unavailable";
    if (!data) return "principal_not_member";
    if (!p.pins) return "ok";
    if (!p.authorizeTask) return "effect_authorization_unavailable";
    const outcome = await p.authorizeTask(p.pins);
    return outcome === "ok" ? "ok" : `client_${typeof outcome === "string" && outcome ? outcome : "refused"}`;
  } catch {
    return "effect_authorization_unavailable";
  }
}

/** Stopping an operation already bought only reduces spend. */
function stopsAdmitted(method: string, url: URL): boolean {
  return url.hostname === "api.apify.com" && method === "POST" && /^\/v2\/actor-runs\/[^/]+\/abort\/?$/.test(url.pathname);
}

export function createEffectFence(base: typeof fetch, ownApi: URL | null,
  log: (m: string, meta?: unknown) => void = (m, meta) => console.warn(m, meta ?? "")): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const principal = effectScope.getStore()?.principal ?? null;
    if (!principal) return base(input, init);
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      return base(input, init);
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const c = classifyRequest({ method, url, body: null }, ownApi);
    if (c.kind === "free" || c.kind === "poll" || stopsAdmitted(method, url)) return base(input, init);
    const verdict = await liveEffectAuthorization(principal);
    if (verdict === "ok") return base(input, init);
    log("[effect-fence] refused", { decision: verdict, workspace: principal.workspaceId, host: url.hostname, path: url.pathname });
    return refusal(verdict, { host: url.hostname, path: url.pathname }, c.kind === "provider");
  }) as typeof fetch;
}

const INSTALLED = Symbol.for("agentory.effectFence.installed");

/**
 * Wrap the process's fetch once (idempotent). Called where a handler that binds
 * principals is loaded; outside a bound run it changes nothing. In the worker
 * it wraps the smoke admission transport, so the live check comes first.
 */
export function installEffectFence(ownApi: string | undefined = Deno.env.get("SUPABASE_URL")): void {
  const g = globalThis as unknown as { fetch: typeof fetch & { [INSTALLED]?: true } };
  if (g.fetch[INSTALLED]) return;
  let api: URL | null = null;
  try { api = ownApi ? new URL(ownApi) : null; } catch { api = null; }
  const base = g.fetch;
  const fenced = createEffectFence(base.bind(globalThis), api) as typeof fetch & { [INSTALLED]?: true };
  // The transport underneath may carry marks other code reads off globalThis.fetch
  // (the smoke admission gate's ADMISSION_GATE_MARK, read-state and approved-actor
  // marks, which size the planner and the reads). The fence carries them unchanged,
  // so wrapping changes nothing for those readers.
  for (const k of Reflect.ownKeys(base)) {
    if (typeof k !== "symbol") continue;
    const d = Object.getOwnPropertyDescriptor(base, k);
    if (d) Object.defineProperty(fenced, k, d);
  }
  fenced[INSTALLED] = true;
  g.fetch = fenced;
}
