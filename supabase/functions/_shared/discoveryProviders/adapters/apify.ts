// Apify adapter — web research and signal verification, REUSING the existing
// actor integration.
//
// It makes no Apify HTTP call of its own: every run goes through an injected
// `ActorInvoker`, which in production is the existing guarded invoker over
// `_shared/actorRegistry.ts` (tool_calls, execution ledger, credits). The
// actors are registry keys that already exist: `apify_google_search` (web
// research), `apify_website_content` (what a company's own site says) and
// `apify_ats_verification` (open roles).
//
// What a site says about itself is evidence for industry / exclusions / a
// hiring signal; it is not evidence for headcount or headquarters, which this
// adapter never claims.

import { pickStr, type DiscoveryAdapter, type SearchPage, type UsageInfo } from "../adapter.ts";
import type { PlanStep } from "../routing.ts";
import { ProviderError, type DiscoveryRequirements, type FilterKey, type HardRequirement, type ProviderCompany } from "../types.ts";

export interface ActorRun { items: unknown[]; runId?: string | null }
export type ActorInvoker = (actorKey: string, input: Record<string, unknown>, opts: { maxItems: number; idempotencyKey: string }) => Promise<ActorRun>;

export const APIFY_ACTORS = {
  webResearch: "apify_google_search",
  siteRead: "apify_website_content",
  openRoles: "apify_ats_verification",
} as const;

export function webResearchQuery(req: DiscoveryRequirements): string {
  const words: string[] = [];
  for (const h of req.hard) {
    if (!Array.isArray(h.values)) continue;
    if (h.key === "industry") words.push(h.values.join(" OR "));
    if (h.key === "geography_hq") words.push(h.values.join(" OR "));
  }
  return `${words.join(" ")} company`.trim();
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

/** Directory / social / news hosts are not companies. */
const NOT_A_COMPANY = /(^|\.)(linkedin|facebook|twitter|x|instagram|youtube|wikipedia|crunchbase|yelp|glassdoor|indeed|bloomberg|forbes|reddit|medium)\.(com|org)$/;

export function apifyAdapter(invoke: ActorInvoker, opts: { now?: () => Date; idempotencyPrefix: string }): DiscoveryAdapter & {
  verifyCompanies(companies: ProviderCompany[], requirements: HardRequirement[], keys: FilterKey[]): Promise<SiteEvidence[]>;
} {
  const now = opts.now ?? (() => new Date());
  return {
    provider: "apify",
    async search(step: PlanStep, req: DiscoveryRequirements, cursor: string | null, limit: number): Promise<SearchPage> {
      if (cursor) return { companies: [], people: [], nextCursor: null, creditsCharged: 0, ignoredFilters: [], total: null };
      const run = await invoke(APIFY_ACTORS.webResearch, { queries: webResearchQuery(req), maxPagesPerQuery: 1, resultsPerPage: Math.min(50, limit) },
        { maxItems: Math.min(50, limit), idempotencyKey: `${opts.idempotencyPrefix}:apify:search` });
      const at = now().toISOString();
      const companies: ProviderCompany[] = [];
      for (const item of run.items) {
        for (const r of ((item as { organicResults?: unknown[] }).organicResults ?? [item])) {
          const url = pickStr(r, ["url", "link"]);
          const domain = domainOf(url);
          if (!domain || NOT_A_COMPANY.test(domain)) continue;
          companies.push({
            provider: "apify", recordId: `web:${domain}`, retrievedAt: at,
            name: pickStr(r, ["title"])?.split(/[|\-–]/)[0].trim() ?? domain, domain,
            assertedFilters: [], ignoredFilters: [],
          });
        }
      }
      return { companies: companies.slice(0, limit), people: [], nextCursor: null, creditsCharged: 1, ignoredFilters: [], total: null };
    },
    async verifyKey(): Promise<UsageInfo> {
      // The platform's existing Apify credential is checked by integration-readiness.
      return { plan: null, used: null, limit: null, remaining: null, resetsAt: null, checkedAt: now().toISOString() };
    },
    async verifyCompanies(companies, requirements, keys) {
      const out: SiteEvidence[] = [];
      for (const c of companies) {
        if (!c.domain) continue;
        const wantsSite = keys.some((k) => k === "industry" || k === "excluded_company_types" || k === "known_companies");
        const wantsRoles = requirements.some((h) => h.key === "signal" && keys.includes("signal") && (h.detail === "hiring" || (Array.isArray(h.values) && h.values.includes("hiring"))));
        const at = now().toISOString();
        if (wantsSite) {
          let run: ActorRun;
          try {
            run = await invoke(APIFY_ACTORS.siteRead, { startUrls: [{ url: `https://${c.domain}` }], maxCrawlPages: 1 }, { maxItems: 1, idempotencyKey: `${opts.idempotencyPrefix}:apify:site:${c.domain}` });
          } catch (e) {
            if (e instanceof ProviderError && e.kind === "charge_uncertain") throw e;
            continue;
          }
          const text = run.items.map((i) => pickStr(i, ["text", "markdown", "content"]) ?? "").join("\n").slice(0, 20_000);
          if (text) out.push({ domain: c.domain, kind: "site_text", url: `https://${c.domain}`, text, at, runId: run.runId ?? null });
        }
        if (wantsRoles) {
          try {
            const run = await invoke(APIFY_ACTORS.openRoles, { domain: c.domain }, { maxItems: 25, idempotencyKey: `${opts.idempotencyPrefix}:apify:roles:${c.domain}` });
            out.push({ domain: c.domain, kind: "open_roles", url: null, text: null, count: run.items.length, at, runId: run.runId ?? null });
          } catch (e) {
            if (e instanceof ProviderError && e.kind === "charge_uncertain") throw e;
          }
        }
      }
      return out;
    },
  };
}

/** What an Apify run observed about one company, for `verify.ts`. */
export interface SiteEvidence {
  domain: string;
  kind: "site_text" | "open_roles";
  url: string | null;
  text: string | null;
  count?: number;
  at: string;
  runId: string | null;
}

/**
 * Prove a workspace's own Apify token works: GET /v2/users/me (free), token in
 * the Authorization header, never in the URL.
 */
export async function apifyVerifyToken(fetchImpl: import("../http.ts").FetchLike, token: string, now: () => Date = () => new Date()): Promise<UsageInfo> {
  const { callProvider } = await import("../http.ts");
  const r = await callProvider(fetchImpl, { provider: "apify", url: "https://api.apify.com/v2/users/me", method: "GET", headers: { authorization: `Bearer ${token}` }, paid: false, maxRetries: 1 });
  const d = (r.json as { data?: Record<string, unknown> })?.data ?? {};
  return { plan: pickStr(d, ["plan.id", "plan"]), used: null, limit: null, remaining: null, resetsAt: null, checkedAt: now().toISOString() };
}
