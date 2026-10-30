// Free, read-only access check for Apollo and LeadOcean.
//
//   APOLLO_API_KEY=… LEADOCEAN_API_KEY=… deno run --allow-env --allow-net=api.apollo.io,api.leadocean.io \
//     --allow-read scripts/provider-access-check.ts [--out report.json]
//
// Every request passes one gate (`FREE_OPERATIONS`): an exact method + path
// that the provider's own documentation states consumes nothing. Anything else
// is refused before it is sent. One attempt per operation, no retries. Keys are
// read from the environment, sent only in headers, and never printed: the
// report carries a 12-hex SHA-256 fingerprint. Response bodies are reduced to
// named, non-personal fields (plan, limits, counts, field NAMES); no row value
// is kept, and a person row from the one-row Apollo search is dropped unread.
//
// Why these and not others:
//   Apollo  GET  /api/v1/auth/health  is NOT used: it answers is_logged_in:true
//           for a missing or invalid key (observed 2026-10-30), so it verifies nothing.
//           POST /api/v1/usage_stats/api_usage_stats — no credits (API pricing:
//           only the listed endpoints consume credits); needs a master key.
//           POST /api/v1/mixed_people/api_search, per_page 1 — 0 credits, returns
//           no emails or phones (People API Search).
//   LeadOcean (OpenAPI 1.0.0, read 2026-10-30): GET /v1/account ("Free"),
//           GET /v1/usage (returns no records; usage is counted in records only),
//           GET /v1/companies/count ("Costs nothing and returns no rows"),
//           GET /v1/filters/companies (returns no records).

export type Provider = "apollo" | "leadocean";

export const FREE_OPERATIONS: Readonly<Record<Provider, readonly { method: "GET" | "POST"; path: string; why: string }[]>> = Object.freeze({
  apollo: [
    { method: "POST", path: "/api/v1/usage_stats/api_usage_stats", why: "rate limits and usage; no credits" },
    { method: "POST", path: "/api/v1/mixed_people/api_search", why: "People API Search: 0 credits, no contact values" },
  ],
  leadocean: [
    { method: "GET", path: "/v1/account", why: "identity, plan, records left: Free" },
    { method: "GET", path: "/v1/usage", why: "records used this month: no records returned" },
    { method: "GET", path: "/v1/companies/count", why: "market sizing: costs nothing, returns no rows" },
    { method: "GET", path: "/v1/filters/companies", why: "filter vocabulary: no records returned" },
  ],
});

const BASE: Record<Provider, string> = { apollo: "https://api.apollo.io", leadocean: "https://api.leadocean.io" };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export class RefusedOperation extends Error {}

export interface OpResult {
  provider: Provider;
  op: string;
  status: number | null;
  ms: number;
  ok: boolean;
  summary: Record<string, unknown>;
  error?: string;
}

export async function fingerprint(key: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

/** The only way this script talks to a provider. */
export function freeGate(fetchImpl: FetchLike, provider: Provider, key: string, now: () => number = Date.now) {
  return async (method: "GET" | "POST", path: string, query: Record<string, string | string[]> = {}, body?: unknown): Promise<{ status: number | null; ms: number; json: unknown; error?: string }> => {
    if (!FREE_OPERATIONS[provider].some((o) => o.method === method && o.path === path)) {
      throw new RefusedOperation(`${provider} ${method} ${path} is not a documented free operation`);
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) for (const x of Array.isArray(v) ? v : [v]) qs.append(k, x);
    const url = `${BASE[provider]}${path}${qs.size ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { "x-api-key": key, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const t0 = now();
    try {
      const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      const text = await res.text();
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { /* non-JSON: kept as null */ }
      return { status: res.status, ms: now() - t0, json };
    } catch (e) {
      return { status: null, ms: now() - t0, json: null, error: String((e as Error)?.name ?? "error") };
    }
  };
}

const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const pick = (o: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, get(o, p) ?? null]));
const errorCode = (j: unknown) => String(get(j, "error.code") ?? get(j, "error") ?? "").slice(0, 80) || null;
/** "kathmandu@gmail.com" → "k***@gmail.com" */
const maskEmail = (v: unknown) => typeof v === "string" && v.includes("@") ? `${v[0]}***@${v.split("@")[1]}` : null;

export interface CohortIdentity { slot: string; domain?: string | null; linkedin_url?: string | null }

export async function checkApollo(fetchImpl: FetchLike, key: string, now?: () => number): Promise<OpResult[]> {
  const call = freeGate(fetchImpl, "apollo", key, now);
  const out: OpResult[] = [];
  const u = await call("POST", "/api/v1/usage_stats/api_usage_stats", {}, {});
  // The response is keyed by endpoint; keep only the limit numbers, per endpoint.
  const limits: Record<string, unknown> = {};
  if (u.json && typeof u.json === "object" && u.status === 200) {
    for (const [ep, v] of Object.entries(u.json as Record<string, unknown>).slice(0, 60)) {
      limits[ep] = pick(v, ["day.limit", "day.consumed", "hour.limit", "minute.limit"]);
    }
  }
  out.push({ provider: "apollo", op: "usage_stats", status: u.status, ms: u.ms, ok: u.status === 200,
    summary: u.status === 200 ? { endpoints: Object.keys(limits).length, limits } : { error: errorCode(u.json), note: u.status === 403 ? "not a master key: usage stats and People API Search need one" : null },
    ...(u.error ? { error: u.error } : {}) });
  const p = await call("POST", "/api/v1/mixed_people/api_search", {}, { page: 1, per_page: 1, person_titles: ["VP Sales"], person_locations: ["United States"], include_similar_titles: false });
  const people = get(p.json, "people");
  const first = Array.isArray(people) && people[0] && typeof people[0] === "object" ? people[0] as Record<string, unknown> : null;
  out.push({ provider: "apollo", op: "people_api_search(per_page=1)", status: p.status, ms: p.ms, ok: p.status === 200,
    summary: p.status === 200
      ? { total_entries: get(p.json, "total_entries") ?? get(p.json, "pagination.total_entries") ?? null, rows: Array.isArray(people) ? people.length : 0,
        // Field NAMES only, to confirm the adapter's paths; every value is dropped here.
        row_fields: first ? Object.keys(first).sort() : [], organization_fields: first && first.organization && typeof first.organization === "object" ? Object.keys(first.organization).sort() : [] }
      : { error: errorCode(p.json) },
    ...(p.error ? { error: p.error } : {}) });
  return out;
}

export async function checkLeadOcean(fetchImpl: FetchLike, key: string, cohort: CohortIdentity[], mission: Record<string, string | string[]>, now?: () => number): Promise<OpResult[]> {
  const call = freeGate(fetchImpl, "leadocean", key, now);
  const out: OpResult[] = [];
  const a = await call("GET", "/v1/account");
  out.push({ provider: "leadocean", op: "account", status: a.status, ms: a.ms, ok: a.status === 200,
    summary: a.status === 200 ? {
      account_id: get(a.json, "data.account.id"), email: maskEmail(get(a.json, "data.account.email")),
      ...pick(get(a.json, "data"), ["account.plan", "account.suspended", "account.fairUse", "key.prefix", "key.scopes", "key.maxDepth",
        "records.ceiling", "records.used", "records.remaining", "records.period", "records.resetsAt", "records.overLimit", "records.whenOver",
        "subscription.status", "subscription.planSlug", "rate.rps", "rate.rpm", "search.maxDepth", "search.companyMaxDepth"]),
    } : { error: errorCode(a.json) }, ...(a.error ? { error: a.error } : {}) });
  const u = await call("GET", "/v1/usage");
  out.push({ provider: "leadocean", op: "usage", status: u.status, ms: u.ms, ok: u.status === 200,
    summary: u.status === 200 ? pick(get(u.json, "data"), ["month", "period", "resetsAt", "used", "plan"]) : { error: errorCode(u.json) }, ...(u.error ? { error: u.error } : {}) });
  const f = await call("GET", "/v1/filters/companies");
  out.push({ provider: "leadocean", op: "filters/companies", status: f.status, ms: f.ms, ok: f.status === 200,
    summary: f.status === 200 ? { filters: Object.keys((get(f.json, "data") as Record<string, unknown>) ?? {}).sort().slice(0, 80) } : { error: errorCode(f.json) } });
  // Exact identity coverage of each known company: a count by domain or LinkedIn URL. Free; no row is returned.
  for (const c of cohort) {
    const q: Record<string, string> | null = c.domain ? { domain: c.domain } : c.linkedin_url ? { linkedin: c.linkedin_url } : null;
    if (!q) continue;
    const r = await call("GET", "/v1/companies/count", q);
    out.push({ provider: "leadocean", op: `companies/count(${c.slot})`, status: r.status, ms: r.ms, ok: r.status === 200,
      summary: r.status === 200 ? { by: Object.keys(q)[0], total: get(r.json, "meta.total") ?? get(r.json, "data.total") ?? null, withheld: get(r.json, "meta.totalWithheld") ?? null } : { error: errorCode(r.json) } });
  }
  const m = await call("GET", "/v1/companies/count", mission);
  out.push({ provider: "leadocean", op: "companies/count(discovery mission)", status: m.status, ms: m.ms, ok: m.status === 200,
    summary: m.status === 200 ? { total: get(m.json, "meta.total") ?? get(m.json, "data.total") ?? null, withheld: get(m.json, "meta.totalWithheld") ?? null, unsupported: get(m.json, "meta.unsupportedFilters") ?? null } : { error: errorCode(m.json) } });
  return out;
}

if (import.meta.main) {
  const outIdx = Deno.args.indexOf("--out");
  const cohortFile = JSON.parse(await Deno.readTextFile(new URL("../benchmarks/provider-discovery/cohort.json", import.meta.url))) as { known_companies: (CohortIdentity & { status: string })[] };
  const cohort = cohortFile.known_companies.filter((c) => c.status === "selected");
  const mission = { hqCountry: "United States", minEmployees: "51", maxEmployees: "200", keywords: ["saas"] };
  const report: Record<string, unknown> = { version: "provider-access-check-v1", at: new Date().toISOString(), operations: FREE_OPERATIONS };
  const realFetch: FetchLike = (url, init) => fetch(url, init);
  for (const [p, env] of [["apollo", "APOLLO_API_KEY"], ["leadocean", "LEADOCEAN_API_KEY"]] as const) {
    const key = Deno.env.get(env)?.trim();
    if (!key) { report[p] = { configured: false, note: `${env} is not set; nothing was sent` }; continue; }
    const results = p === "apollo" ? await checkApollo(realFetch, key) : await checkLeadOcean(realFetch, key, cohort, mission);
    report[p] = { configured: true, key_fingerprint: await fingerprint(key), results };
  }
  const text = JSON.stringify(report, null, 2);
  if (outIdx >= 0 && Deno.args[outIdx + 1]) await Deno.writeTextFile(Deno.args[outIdx + 1], text);
  console.log(text);
}
