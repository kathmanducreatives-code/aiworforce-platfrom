// One guarded HTTP call to a provider: timeout, bounded retries, Retry-After,
// and a failure taxonomy the orchestrator can act on.
//
// The retry rule is about money, not just errors: a request is retried only
// when it cannot have been charged — it is free, or the provider answered with
// a status that bills nothing (429, 503). A paid request that timed out or
// failed in transit has an UNKNOWN outcome; it becomes `charge_uncertain` and
// is never retried, so one approval cannot buy the same rows twice.
//
// `fetch` and `sleep` are injected; tests pass mocks and nothing touches the
// network.

import { ProviderError, type ProviderId } from "./types.ts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export interface CallSpec {
  provider: ProviderId;
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  /** Whether the request can cost credits. */
  paid: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  /** The longest Retry-After honoured; a longer one ends the call as rate_limited. */
  maxRetryWaitMs?: number;
}

export interface CallResult {
  status: number;
  json: unknown;
  headers: Headers;
  attempts: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

function retryAfterMs(h: Headers): number | null {
  const v = h.get("retry-after");
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

function messageOf(json: unknown, status: number): string {
  const e = (json as { error?: { message?: unknown } | string; message?: unknown } | null);
  const m = typeof e?.error === "string" ? e.error : (e?.error as { message?: unknown } | undefined)?.message ?? e?.message;
  // Provider text is data: shortened, never echoed with headers or keys.
  return typeof m === "string" ? m.slice(0, 200) : `HTTP ${status}`;
}

export async function callProvider(fetchImpl: FetchLike, spec: CallSpec, sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<CallResult> {
  const maxRetries = spec.maxRetries ?? 2;
  const maxWait = spec.maxRetryWaitMs ?? 30_000;
  let attempt = 0;
  for (;;) {
    attempt++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(spec.url, {
        method: spec.method,
        headers: { "content-type": "application/json", accept: "application/json", ...spec.headers },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (spec.paid) {
        throw new ProviderError(spec.provider, "charge_uncertain", `request did not complete (${(e as Error)?.name ?? "error"}); not retried because it may have been charged`);
      }
      if (attempt > maxRetries) throw new ProviderError(spec.provider, "outage", "provider unreachable");
      await sleep(Math.min(maxWait, 500 * 2 ** (attempt - 1)));
      continue;
    }
    clearTimeout(timer);
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    if (res.ok) return { status: res.status, json, headers: res.headers, attempts: attempt };

    const s = res.status;
    const wait = retryAfterMs(res.headers);
    const msg = messageOf(json, s);
    if (s === 401) throw new ProviderError(spec.provider, "auth_failed", msg, s);
    if (s === 403) throw new ProviderError(spec.provider, "forbidden_scope", msg, s);
    if (s === 402 || res.headers.get("x-quota-state") === "exhausted") throw new ProviderError(spec.provider, "allowance_exhausted", msg, s);
    if (s === 410) throw new ProviderError(spec.provider, "cursor_expired", msg, s);
    if (s === 400 || s === 404 || s === 409 || s === 422) throw new ProviderError(spec.provider, "invalid_request", msg, s);
    if (s === 429 || s === 503) {
      // Neither bills a row: safe to retry within bounds.
      const w = wait ?? 1000 * 2 ** (attempt - 1);
      if (attempt > maxRetries || w > maxWait) {
        throw new ProviderError(spec.provider, s === 429 ? "rate_limited" : "outage", msg, s, wait);
      }
      await sleep(w);
      continue;
    }
    // Other 5xx: unknown whether a paid request was billed.
    if (spec.paid) throw new ProviderError(spec.provider, "charge_uncertain", `${msg}; not retried because it may have been charged`, s);
    if (attempt > maxRetries) throw new ProviderError(spec.provider, "outage", msg, s);
    await sleep(Math.min(maxWait, 500 * 2 ** (attempt - 1)));
  }
}
