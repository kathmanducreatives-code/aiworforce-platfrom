// LeadOcean validation test V (approved 2026-10-31): at most 2 records, $0.
//
//   deno run --allow-read --allow-write --allow-env --allow-net=api.leadocean.io \
//     scripts/leadocean-validation-v.ts --approve leadocean=2 --key-injected --out <file> [--dry-run]
//
//   V1  GET  /v1/companies/enrich?domain=langchain.com      1 record (found or not)
//   V2  POST /v1/search {domain:[baseten.co], limit 1, ranked, slim false}   ≤ 1 record
//
// The guard admits EXACTLY these two paid requests, byte for byte, each at most
// once, plus the free GET /v1/account before and after for reconciliation.
// Anything else — another path, another body, a repeat, a retry — is refused
// before it leaves. No reveal, no enrichment of a person, no export.
// The key is a cloud Network Secret the proxy adds; this process sends a
// placeholder and never sees it. Output: redacted raw rows (no contact values,
// pictures or key hash) and the key paths each record carries, compared with
// FIELDS / FIELD_BASIS.

import { assertLiveTestsEnabled } from "./_liveTestGate.ts";
import { FIELDS, FIELD_BASIS, redactLeadOceanRow } from "../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";

export const APPROVED_V = Object.freeze({ test: "V", provider: "leadocean", maxRecords: 2, usd: 0 });
const BASE = "https://api.leadocean.io";

export const V_REQUESTS = Object.freeze([
  { id: "V1", method: "GET", path: "/v1/companies/enrich", query: "domain=langchain.com", body: null, maxRecords: 1 },
  { id: "V2", method: "POST", path: "/v1/search", query: "", body: JSON.stringify({ domain: ["baseten.co"], limit: 1, order: "ranked", slim: false }), maxRecords: 1 },
] as const);

export class VRefusal extends Error {}
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

/** The V wire guard: only the two approved paid requests, once each; free account reads allowed. */
export function vGuard(inner: Fetch) {
  const sent = new Set<string>();
  let records = 0;
  const log: { id: string; method: string; path: string; status: number | null; credits: number | null; ms: number }[] = [];
  const fetch: Fetch = async (url, init) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new VRefusal(`refused: host ${u.host}`);
    let id = "account";
    if (!(init.method === "GET" && u.pathname === "/v1/account" && !u.search)) {
      const r = V_REQUESTS.find((x) => x.method === init.method && x.path === u.pathname && x.query === u.search.replace(/^\?/, "") && (x.body ?? undefined) === init.body);
      if (!r) throw new VRefusal(`refused before sending: ${init.method} ${u.pathname}${u.search} is not an approved V request`);
      if (sent.has(r.id)) throw new VRefusal(`refused before sending: ${r.id} was already sent (no retries)`);
      if (records + r.maxRecords > APPROVED_V.maxRecords) throw new VRefusal("refused before sending: record ceiling");
      sent.add(r.id);
      records += r.maxRecords;
      id = r.id;
    }
    const t0 = performance.now();
    const res = await inner(url, init);
    const entry = { id, method: init.method, path: u.pathname, status: res.status, credits: null as number | null, ms: Math.round(performance.now() - t0) };
    try { const j = await res.clone().json() as { meta?: { credits?: unknown } }; entry.credits = typeof j?.meta?.credits === "number" ? j.meta.credits : null; } catch { /* non-JSON */ }
    log.push(entry);
    return res;
  };
  return { fetch, log, committed: () => records };
}

/** Every key path a record carries ("a.b.0.c"), with its JSON type. Values are not returned. */
export function keyPaths(v: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    out[prefix || "$"] = `array(${v.length})`;
    if (v.length) Object.assign(out, keyPaths(v[0], `${prefix}.0`));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) Object.assign(out, keyPaths(x, prefix ? `${prefix}.${k}` : k));
  } else out[prefix] = v === null ? "null" : typeof v;
  return out;
}

/** For every FIELDS entry: which of its paths the record actually has. */
export function fieldCoverage(row: unknown, paths: Record<string, string>) {
  return Object.fromEntries(Object.entries(FIELDS).map(([name, ps]) => {
    const hit = (ps as readonly string[]).find((p) => paths[p] !== undefined && paths[p] !== "null");
    return [name, hit ? { path: hit, basis: FIELD_BASIS[hit] ?? "unlabelled", type: paths[hit] } : null];
  }));
}

if (import.meta.main) {
  const arg = (n: string) => { const i = Deno.args.indexOf(n); return i >= 0 ? Deno.args[i + 1] : undefined; };
  const dry = Deno.args.includes("--dry-run");
  if (arg("--approve") !== `${APPROVED_V.provider}=${APPROVED_V.maxRecords}`) throw new Error(`--approve must be exactly ${APPROVED_V.provider}=${APPROVED_V.maxRecords}`);
  if (!dry && !Deno.args.includes("--key-injected")) throw new Error("the LeadOcean key must be a proxy-injected Network Secret (--key-injected)");
  const worst = V_REQUESTS.reduce((n, r) => n + r.maxRecords, 0);
  if (worst > APPROVED_V.maxRecords) throw new Error(`worst case ${worst} > approved ${APPROVED_V.maxRecords}`);
  if (dry) { console.log(JSON.stringify({ dryRun: true, worstCaseRecords: worst, approved: APPROVED_V.maxRecords, requests: V_REQUESTS }, null, 1)); Deno.exit(0); }
  assertLiveTestsEnabled();

  const g = vGuard((url, init) => fetch(url, init));
  const headers = { "x-api-key": "injected-by-proxy", accept: "application/json", "content-type": "application/json" };
  const used = async () => ((await (await g.fetch(`${BASE}/v1/account`, { method: "GET", headers })).json()) as { data?: { records?: { used?: number } } })?.data?.records?.used ?? null;
  const before = await used();
  const results: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  for (const r of V_REQUESTS) {
    if (stopped) { results.push({ id: r.id, skipped: `stopped: ${stopped}` }); continue; }
    let res: Response;
    try {
      res = await g.fetch(`${BASE}${r.path}${r.query ? `?${r.query}` : ""}`, { method: r.method, headers, ...(r.body ? { body: r.body } : {}) });
    } catch (e) { stopped = `transit failure on ${r.id} (${(e as Error).name}); not retried`; results.push({ id: r.id, error: stopped }); continue; }
    const json = await res.json().catch(() => null) as { data?: unknown; meta?: Record<string, unknown>; success?: boolean } | null;
    if (res.status !== 200) { stopped = `${r.id} HTTP ${res.status}`; results.push({ id: r.id, status: res.status, error: (json as { error?: unknown })?.error ?? null }); continue; }
    const rows = Array.isArray(json?.data) ? json!.data as unknown[] : json?.data ? [json.data] : [];
    const redacted = rows.map(redactLeadOceanRow);
    const meta = Object.fromEntries(Object.entries(json?.meta ?? {}).filter(([k]) => k !== "key_hash"));
    results.push({ id: r.id, status: res.status, rows: rows.length, meta, raw: redacted,
      paths: redacted.map((x) => keyPaths(x)), coverage: redacted.map((x) => fieldCoverage(x, keyPaths(x))) });
  }
  const credits = g.log.filter((l) => l.id !== "account").reduce((n, l) => n + (l.credits ?? 0), 0);
  // The account counter lags the per-response credits by seconds: re-read (free) before calling it a mismatch.
  let after = await used();
  for (let k = 0; k < 3 && before != null && after != null && after - before < credits; k++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await used();
  }
  const out = { test: APPROVED_V, at: new Date().toISOString(), wire: g.log, committedMaxRecords: g.committed(), stopped,
    reconciliation: { before, after, accountDelta: before != null && after != null ? after - before : null, reportedCredits: credits,
      reconciled: before != null && after != null ? after - before === credits && after - before <= APPROVED_V.maxRecords : null }, results };
  if (arg("--out")) await Deno.writeTextFile(arg("--out")!, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ wire: g.log, stopped, reconciliation: out.reconciliation, rows: results.map((x) => [x.id, x.rows ?? null, x.status ?? null]) }, null, 1));
}
