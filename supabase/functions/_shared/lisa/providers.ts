// LISA V2 — PROVIDER ADAPTERS and the metered budget.
//
// ONE provider is wired for collection: Firecrawl /v2/search, the same endpoint
// and response shape Radar uses (results at data.web). Apify actors are NOT
// called by LISA V2: their IDs are recorded in providerInventory (see
// docs/plans/lisa-v2/PROVIDERS.md) exactly as the codebase names them, and
// adding one is a new SearchSource, not a change to the pipeline.
//
// Every call is reserved BEFORE it is sent (authorizeProviderCall, capability
// `signal_search`, ledger kind `monitoring_call` for scheduled scans) and
// settled on what actually happened. Scheduled scans additionally respect the
// workspace's monitoring_budgets period ceiling. A refusal stops the pass; it
// is never replaced by a fabricated result.

import {
  authorizeProviderCall, settleProviderCall, type CreditDb, type CreditEnforcementMode,
} from "../creditAuthorization.ts";
import type { CallBudget } from "./pipeline.ts";
import type { SearchHit, SearchResult, SearchSource } from "./types.ts";

/** Firecrawl /v2/search. `fetchImpl` is injectable so tests never reach the network. */
export function firecrawlSource(apiKey: string | undefined, fetchImpl: typeof fetch = fetch): SearchSource {
  return {
    provider: "firecrawl",
    async search(query, { limit, signal }): Promise<SearchResult> {
      if (!apiKey) return { hits: [], error: "not_configured", credits: 0 };
      try {
        const res = await fetchImpl("https://api.firecrawl.dev/v2/search", {
          method: "POST", signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit }),
        });
        if (!res.ok) return { hits: [], error: `http_${res.status}`, credits: res.status === 429 ? 0 : 1 };
        const data = await res.json().catch(() => null);
        const raw = (Array.isArray(data?.data?.web) && data.data.web) || (Array.isArray(data?.web) && data.web) || null;
        if (!raw) return { hits: [], error: "invalid_response", credits: 1 };
        const hits: SearchHit[] = raw.map((h: Record<string, unknown>) => ({
          url: typeof h.url === "string" ? h.url : null,
          title: typeof h.title === "string" ? h.title : null,
          description: typeof h.description === "string" ? h.description : null,
          markdown: typeof h.markdown === "string" ? h.markdown : null,
          published_at: typeof h.publishedDate === "string" ? h.publishedDate : typeof h.date === "string" ? h.date : null,
        }));
        const used = Number(data?.creditsUsed);
        return { hits, error: null, credits: Number.isFinite(used) && used > 0 ? used : 1 };
      } catch (e) {
        if (signal?.aborted) return { hits: [], error: "timeout", credits: 0 };
        return { hits: [], error: `transport_error`, credits: 0 };
      }
    },
  };
}

/** Recorded responses, keyed by query (exact) or by a function. For tests and `dev:lisa`. */
export function fixtureSource(respond: (query: string) => SearchResult | "hang" | "throw", provider = "fixture"): SearchSource {
  return {
    provider,
    search(query, { signal }) {
      const r = respond(query);
      if (r === "throw") return Promise.reject(new Error("fixture provider threw"));
      if (r === "hang") {
        return new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ hits: [], error: "timeout", credits: 0 })));
      }
      return Promise.resolve(structuredClone(r));
    },
  };
}

/** An in-memory budget for tests: allows `n` calls, then refuses. */
export function countingBudget(n: number): CallBudget & { authorized: number; settled: Array<{ credits: number; ok: boolean }> } {
  const b = {
    authorized: 0,
    settled: [] as Array<{ credits: number; ok: boolean }>,
    authorize(_q: string) {
      if (b.authorized >= n) return Promise.resolve({ ok: false as const, reason: "budget_exhausted" });
      b.authorized++;
      return Promise.resolve({ ok: true as const, token: `t${b.authorized}` });
    },
    settle(_t: string, credits: number, ok: boolean) { b.settled.push({ credits, ok }); return Promise.resolve(); },
  };
  return b;
}

/**
 * The production budget: the credit ledger, plus — for scheduled scans — the
 * monitoring period ceiling. `remainingPeriodCredits` is read ONCE per tick by
 * the caller (monitoring_spend_in_period vs monitoring_budgets.period_ceiling)
 * and decremented locally so one tick can never overshoot it.
 */
export function ledgerBudget(i: {
  db: CreditDb; workspace_id: string; run_key: string; mode: CreditEnforcementMode;
  scheduled: boolean; remainingPeriodCredits: number | null; price: number;
}): CallBudget {
  let remaining = i.remainingPeriodCredits;
  let seq = 0;
  return {
    async authorize(query) {
      if (remaining !== null && remaining < i.price) return { ok: false, reason: "monitoring_period_ceiling" };
      const key = `lisa:${i.run_key}:${seq++}:${query.slice(0, 80)}`;
      const auth = await authorizeProviderCall({
        db: i.db, workspace_id: i.workspace_id, logical_call_key: key, task_id: null, capability: "signal_search",
        mode: i.mode, amount: i.price, persistence_authority: i.scheduled ? "monitoring_engine" : null,
      });
      if (!auth.allowed) return { ok: false, reason: auth.reason };
      if (remaining !== null) remaining -= i.price;
      return { ok: true, token: auth.transaction_id ?? "" };
    },
    async settle(token, credits, ok) {
      await settleProviderCall({ db: i.db, transaction_id: token || null, started: credits > 0, amount: i.price });
    },
  };
}
