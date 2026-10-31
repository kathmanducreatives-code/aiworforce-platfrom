// LeadOcean final capability benchmark — PROPOSED. Dry run unless approved.
//
//   deno run --allow-read --allow-env scripts/leadocean-final-benchmark.ts --report <test-e-report.json>      # dry run
//   deno run --allow-read --allow-write --allow-env --allow-net \
//     scripts/leadocean-final-benchmark.ts --report <file> --execute --approve "<approval string>" --key-injected \
//       [--independent]            # + Apify company records (≤$0.07) and free homepage technology checks
//
// Eight pinned searches, 15 records at most (one record per row returned):
//   P-S2  people   US SaaS founders, 51–200             2
//   P-S4  people   US lead-gen agency founders, 51–200  2
//   P-S6  people   US agency owners with a phone flag   2
//   P-S10 people   US SaaS founders, founded 2024–2026  2
//   P-S12 people   founders / C-suite at langchain.com  1
//   C-S8  company  US SaaS, Seed / Series A             2
//   C-S7  company  US companies funded since 2025       2
//   C-S9  company  US SaaS using HubSpot / Salesforce   2
//
// Guards, all before any paid byte leaves:
//   * the approval string must equal the computed one (records, Apify cap, plan hash)
//   * free preflight: GET /v1/account — ≥ 15 records left, not over limit
//   * durable ledger (append-only JSONL, outside the repo): every request is
//     reserved under planHash:scenario BEFORE it is sent; a key already in the
//     ledger in ANY state is refused — across processes and restarts
//   * no retries: one raw request per scenario; any non-200 settles as failed
//     (a 429 or 5xx is recorded, never re-sent)
//   * people searches exclude every person already bought in Test E (pinned report)
//   * results: redacted rows (no contact values, pictures or key hashes) written
//     0600 outside the repository; no database writes; no outreach
// LeadOcean's own fields are never treated as independent evidence of themselves:
// independence comes only from the Apify company record and the company's own homepage.

import { redactLeadOceanRow } from "../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { classifyDecisionMakerRole } from "../supabase/functions/_shared/decisionMaker/roleFamily.ts";
import { sha256Hex } from "../supabase/functions/_shared/providerInputFingerprint.ts";
import { accountRecords } from "./lead-pipeline-test-e.ts";
import { readCompanyRecords } from "../supabase/functions/_shared/leadPipeline/canonical.ts";
import { pipelineApifyInvoker } from "../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";

const LO = "https://api.leadocean.io";
export const TEST_E_SHA256 = "a5da3efc0deaffc02605d63b34ee0c29ce6388323989901a5479d6cc97564a76";
export const MAX_RECORDS = 15;
export const INDEPENDENT_APIFY_USD = 0.07;

const SAAS = ["Software Development", "Technology; Information and Internet"];
const AGENCY = ["Marketing Services", "Advertising Services", "Marketing and Advertising"];
const US = { hqCountry: ["US"] };

export interface Scenario {
  id: string; scenario: number; kind: "people" | "companies"; limit: number; label: string;
  filters: Record<string, unknown>;
  /** What a returned row must show for the query to count as accurate (checked where the row carries it). */
  expect: { employees?: [number, number]; industry?: string[]; founded?: [number, number]; fundingTypes?: string[]; fundingFromYear?: number; technologies?: string[]; domain?: string; decisionMaker?: boolean; hasPhone?: boolean };
}

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  { id: "P-S2", scenario: 2, kind: "people", limit: 2, label: "US SaaS founders, 51–200",
    filters: { ...US, employeeRange: ["51-200"], industry: SAAS, companyKeywords: ["saas", "b2b"], seniority: ["founder"] },
    expect: { employees: [51, 200], industry: SAAS, decisionMaker: true } },
  { id: "P-S4", scenario: 4, kind: "people", limit: 2, label: "US lead-generation agency founders, 51–200",
    filters: { ...US, employeeRange: ["51-200"], companyKeywords: ["lead generation", "appointment setting", "outbound sales"], seniority: ["owner", "founder"] },
    expect: { employees: [51, 200], decisionMaker: true } },
  { id: "P-S6", scenario: 6, kind: "people", limit: 2, label: "US agency owners/founders with a phone flag, 5–200",
    filters: { ...US, minEmployees: 5, maxEmployees: 200, industry: AGENCY, seniority: ["owner", "founder"], hasPhone: true },
    expect: { employees: [5, 200], industry: AGENCY, decisionMaker: true, hasPhone: true } },
  { id: "P-S10", scenario: 10, kind: "people", limit: 2, label: "US SaaS founders, company founded 2024–2026",
    filters: { ...US, minEmployees: 2, maxEmployees: 200, industry: SAAS, minFounded: 2024, maxFounded: 2026, seniority: ["founder"] },
    expect: { employees: [2, 200], industry: SAAS, founded: [2024, 2026], decisionMaker: true } },
  { id: "P-S12", scenario: 12, kind: "people", limit: 1, label: "Founders / C-suite at a known domain (langchain.com)",
    filters: { domain: ["langchain.com"], seniority: ["owner", "founder", "c_suite"] },
    expect: { domain: "langchain.com", decisionMaker: true } },
  { id: "C-S8", scenario: 8, kind: "companies", limit: 2, label: "US SaaS companies, last round Seed / Series A",
    filters: { ...US, minEmployees: 11, maxEmployees: 200, industry: SAAS, fundingType: ["Seed", "Series A"] },
    expect: { employees: [11, 200], industry: SAAS, fundingTypes: ["Seed", "Series A"] } },
  { id: "C-S7", scenario: 7, kind: "companies", limit: 2, label: "US companies funded since 2025, 11–200",
    filters: { ...US, minEmployees: 11, maxEmployees: 200, minLastFundingYear: 2025 },
    expect: { employees: [11, 200], fundingFromYear: 2025 } },
  { id: "C-S9", scenario: 9, kind: "companies", limit: 2, label: "US SaaS companies using HubSpot or Salesforce",
    filters: { ...US, minEmployees: 11, maxEmployees: 200, industry: SAAS, technologies: ["HubSpot", "Salesforce"] },
    expect: { employees: [11, 200], industry: SAAS, technologies: ["hubspot", "salesforce"] } },
]);

/** The exact requests, given the person ids already bought (people searches exclude them). */
export function buildRequests(seenPersonIds: readonly string[]) {
  const exclude = [...new Set(seenPersonIds)].sort();
  return SCENARIOS.map((s) => ({
    id: s.id, path: s.kind === "people" ? "/v1/search" : "/v1/search/companies", limit: s.limit,
    body: JSON.stringify({ limit: s.limit, order: "ranked", slim: false, ...s.filters, ...(s.kind === "people" && exclude.length ? { excludeIds: exclude } : {}) }),
  }));
}

export function planHashOf(reqs: ReturnType<typeof buildRequests>): string {
  return sha256Hex(JSON.stringify(reqs.map((r) => [r.id, r.path, r.body]))).slice(0, 16);
}

export const approvalFor = (planHash: string, independent: boolean) =>
  `leadocean=${MAX_RECORDS},apify_usd=${independent ? INDEPENDENT_APIFY_USD : 0},plan=${planHash}`;

// ── Durable ledger ──────────────────────────────────────────────────────────

export interface LedgerLine { key: string; state: "reserved" | "settled" | "failed"; records: number | null; status: number | null; at: string }

export async function ledgerRead(path: string): Promise<LedgerLine[]> {
  try { return (await Deno.readTextFile(path)).split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; }
}
export async function ledgerAppend(path: string, line: LedgerLine) {
  await Deno.writeTextFile(path, JSON.stringify(line) + "\n", { append: true, create: true, mode: 0o600 });
}

// ── Evaluation (pure) ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const get = (o: unknown, p: string): unknown => p.split(".").reduce<unknown>((c, k) => (c && typeof c === "object" ? (c as Row)[k] : undefined), o);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export type Check = "pass" | "fail" | "not_in_row";

export interface RowEval {
  scenario: string; kind: "people" | "companies"; recordId: string | null; personGroupId: string | null;
  company: { id: string | null; name: string | null; domain: string | null; linkedin: string | null; hqCountry: string | null; employees: number | null; employeeBand: [number | null, number | null]; industry: string | null; founded: number | null; funding: { type: string | null; year: number | null; date: string | null } | null; technologies: string[] };
  person: { title: string | null; roleFamily: string | null; hasEmail: boolean | null; hasPhone: boolean | null; linkedin: string | null } | null;
  checks: Record<string, Check>;
  missing: string[];
}

function bandOf(e: unknown): [number | null, number | null] {
  return [num(get(e, "number_of_employees_min")), num(get(e, "number_of_employees_max"))];
}
function inRange(n: number | null, band: [number | null, number | null], want: [number, number]): Check {
  if (n != null) return n >= want[0] && n <= want[1] ? "pass" : "fail";
  if (band[0] != null && band[1] != null) return band[0] >= want[0] && band[1] <= want[1] ? "pass" : band[1] < want[0] || band[0] > want[1] ? "fail" : "not_in_row";
  return "not_in_row";
}

export function evaluateRow(s: Scenario, row: Row): RowEval {
  const people = s.kind === "people";
  const c = people ? get(row, "contact_data.contact_current_experiences.0") : get(row, "company_data");
  const employees = num(get(c, "company_employees.number_of_employees"));
  const band = bandOf(get(c, "company_employees"));
  const industry = people ? str(get(c, "company_industry")) : str(get(row, "company_data.company_industries.0.name3"));
  const fundingRaw = people ? null : get(row, "company_data.company_funding");
  const funding = fundingRaw ? { type: str(get(fundingRaw, "last_round_type")), year: num(get(fundingRaw, "last_round_year")), date: str(get(fundingRaw, "last_round_date")) } : null;
  const foundedRaw = people ? null : get(row, "company_data.company_profile.date_founded");
  const founded = typeof foundedRaw === "number" ? foundedRaw : typeof foundedRaw === "string" && /^\d{4}/.test(foundedRaw) ? Number(foundedRaw.slice(0, 4)) : null;
  const techRaw = people ? null : get(row, "company_detected_technologies");
  const technologies = (Array.isArray(get(techRaw, "technologies")) ? get(techRaw, "technologies") as unknown[] : Array.isArray(techRaw) ? techRaw as unknown[] : [])
    .map((t) => (str(get(t, "name")) ?? str(t) ?? "").toLowerCase()).filter(Boolean);
  const title = people ? str(get(c, "job_title")) : null;
  const role = title ? classifyDecisionMakerRole(title) : null;
  const ev: RowEval = {
    scenario: s.id, kind: s.kind,
    recordId: people ? str(get(row, "meta.source_ids.person_id")) : str(get(row, "company_data.company_id")),
    personGroupId: people ? str(get(row, "meta.source_ids.person_group_id")) : null,
    company: {
      id: people ? str(get(row, "meta.source_ids.company_id")) : str(get(row, "company_data.company_id")),
      name: str(get(c, "company_name")), domain: str(get(c, "company_domain"))?.toLowerCase() ?? null,
      linkedin: str(get(c, "company_social_links.linkedin.url")),
      hqCountry: people ? null : str(get(row, "company_data.company_primary_address.country_code")),
      employees, employeeBand: band, industry, founded, funding, technologies,
    },
    person: people ? { title, roleFamily: role?.role_family ?? null, hasEmail: (get(row, "contact_data.has_email") as boolean | undefined) ?? null, hasPhone: (get(row, "contact_data.has_phone") as boolean | undefined) ?? null, linkedin: str(get(row, "profile_data.profile_url")) } : null,
    checks: {}, missing: [],
  };
  const x = s.expect;
  if (x.employees) ev.checks.employees = inRange(employees, band, x.employees);
  if (x.industry) ev.checks.industry = industry ? (x.industry.includes(industry) ? "pass" : "fail") : "not_in_row";
  if (x.founded) ev.checks.founded = founded == null ? "not_in_row" : founded >= x.founded[0] && founded <= x.founded[1] ? "pass" : "fail";
  if (x.fundingTypes) ev.checks.fundingType = funding?.type ? (x.fundingTypes.includes(funding.type) ? "pass" : "fail") : "not_in_row";
  if (x.fundingFromYear) { const y = funding?.year ?? (funding?.date ? Number(funding.date.slice(0, 4)) : null); ev.checks.fundingYear = y == null ? "not_in_row" : y >= x.fundingFromYear ? "pass" : "fail"; }
  if (x.technologies) ev.checks.technologies = technologies.length ? (technologies.some((t) => x.technologies!.some((w) => t.includes(w))) ? "pass" : "fail") : "not_in_row";
  if (x.domain) ev.checks.domain = ev.company.domain ? (ev.company.domain.replace(/^www\./, "") === x.domain ? "pass" : "fail") : "not_in_row";
  if (x.decisionMaker) ev.checks.decisionMaker = title ? (role && role.role_family !== "other" && !role.disqualified_by ? "pass" : "fail") : "not_in_row";
  if (x.hasPhone) ev.checks.hasPhone = ev.person?.hasPhone == null ? "not_in_row" : ev.person.hasPhone ? "pass" : "fail";
  const want = people ? { title, companyDomain: ev.company.domain, companyLinkedin: ev.company.linkedin, employees: employees ?? band[0], industry, personLinkedin: ev.person!.linkedin }
    : { companyDomain: ev.company.domain, companyLinkedin: ev.company.linkedin, employees: employees ?? band[0], industry, hqCountry: ev.company.hqCountry, founded, funding: funding?.type ?? funding?.year ?? null, technologies: technologies.length || null };
  ev.missing = Object.entries(want).filter(([, v]) => v == null || v === "").map(([k]) => k);
  return ev;
}

/** Independent evidence for one company: the Apify LinkedIn company record and the company's own homepage. */
export interface Independent { hqCountry: string | null; sizeBand: [number, number | null] | null; founded: number | null; homepageTech: string[] | null }

export function independentChecks(e: RowEval, ind: Independent | null): Record<string, Check | "unavailable"> {
  if (!ind) return { hq: "unavailable", size: "unavailable", founded: "unavailable", tech: "unavailable" };
  const out: Record<string, Check | "unavailable"> = {};
  out.hq = ind.hqCountry == null ? "unavailable" : /united states|^us$/i.test(ind.hqCountry) ? "pass" : "fail";
  const want = SCENARIOS.find((s) => s.id === e.scenario)?.expect.employees;
  out.size = !ind.sizeBand || !want ? "unavailable" : ind.sizeBand[0] >= want[0] && (ind.sizeBand[1] ?? Infinity) <= want[1] ? "pass" : (ind.sizeBand[1] ?? Infinity) < want[0] || ind.sizeBand[0] > want[1] ? "fail" : "unavailable";
  out.founded = ind.founded == null || e.company.founded == null ? "unavailable" : ind.founded === e.company.founded ? "pass" : "fail";
  out.tech = ind.homepageTech == null ? "unavailable" : e.company.technologies.length === 0 ? "unavailable"
    : e.company.technologies.some((t) => ind.homepageTech!.some((h) => t.includes(h))) ? "pass" : "fail";
  return out;
}

/** Website markers for the technologies the scenarios ask about (public script hosts). */
export const HOMEPAGE_MARKERS: Readonly<Record<string, RegExp>> = Object.freeze({
  hubspot: /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net|hubspot/i,
  salesforce: /force\.com|salesforce|pardot\.com|pi\.pardot|exacttarget/i,
});
export const homepageTech = (html: string) => Object.entries(HOMEPAGE_MARKERS).filter(([, re]) => re.test(html)).map(([k]) => k);

/** "Useful": every checkable filter passes, a decision-maker where one is asked for, and nothing independent contradicts it. */
export function isUseful(e: RowEval, ind: Record<string, Check | "unavailable"> | null): boolean {
  if (Object.values(e.checks).some((c) => c === "fail")) return false;
  if (ind && (ind.hq === "fail" || ind.size === "fail")) return false;
  return true;
}

// ── Execution ───────────────────────────────────────────────────────────────

async function main() {
  const args = Deno.args;
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const reportPath = arg("--report");
  if (!reportPath) throw new Error("refused: --report <preserved Test E report> is required");
  const raw = await Deno.readTextFile(reportPath);
  if (sha256Hex(raw) !== TEST_E_SHA256) throw new Error("refused: Test E report is not the preserved one");
  const rep = JSON.parse(raw) as { queue: { person: { providerPersonId: string | null } | null }[]; review: { person: { providerPersonId: string | null } | null }[]; excluded: unknown[] };
  const seen = [...rep.queue, ...rep.review].map((l) => l.person?.providerPersonId).filter((x): x is string => !!x);
  const reqs = buildRequests(seen);
  const hash = planHashOf(reqs);
  const independent = args.includes("--independent");
  const approval = approvalFor(hash, independent);
  console.log(`LeadOcean final benchmark — plan ${hash} — ${reqs.length} requests, ≤${reqs.reduce((a, r) => a + r.limit, 0)} records${independent ? `, Apify ≤$${INDEPENDENT_APIFY_USD}` : ""}`);
  for (const r of reqs) console.log(`  ${r.id.padEnd(6)} POST ${r.path.padEnd(22)} ≤${r.limit}  ${r.body.length > 220 ? r.body.slice(0, 220) + "…" : r.body}`);
  console.log(`  APPROVAL STRING: ${approval}`);
  if (!args.includes("--execute")) { console.log("DRY RUN — nothing bought."); return; }

  if (arg("--approve") !== approval) throw new Error(`refused: --approve must equal "${approval}"`);
  if (!args.includes("--key-injected")) throw new Error("refused: --key-injected is required");
  const dir = arg("--dir") ?? "/root/agentory-tests/leadocean-final";
  await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  const ledger = `${dir}/ledger.jsonl`;
  const prior = await ledgerRead(ledger);
  const headers = { "content-type": "application/json", "x-api-key": "injected-by-proxy" };
  const before = accountRecords(await (await fetch(`${LO}/v1/account`, { headers })).json());
  if (!before || before.remaining < MAX_RECORDS || before.overLimit) throw new Error("refused: account cannot cover 15 records");
  if (reqs.reduce((a, r) => a + r.limit, 0) > MAX_RECORDS) throw new Error("refused: plan exceeds 15 records");

  const results: { id: string; status: number | null; credits: number | null; rows: Row[]; unsupportedFilters: unknown }[] = [];
  for (const r of reqs) {
    const key = `${hash}:${r.id}`;
    if (prior.some((l) => l.key === key)) { console.log(`  ${r.id}: already in the ledger — not sent`); continue; }
    await ledgerAppend(ledger, { key, state: "reserved", records: r.limit, status: null, at: new Date().toISOString() });
    let status: number | null = null;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60_000);
      const res = await fetch(`${LO}${r.path}`, { method: "POST", headers, body: r.body, signal: ctl.signal }).finally(() => clearTimeout(timer));
      status = res.status;
      const j = await res.json().catch(() => ({})) as { data?: Row[]; meta?: { credits?: number; unsupportedFilters?: unknown } };
      const rows = (Array.isArray(j.data) ? j.data : []).slice(0, r.limit);
      const credits = typeof j.meta?.credits === "number" ? j.meta.credits : res.ok ? rows.length : 0;
      await ledgerAppend(ledger, { key, state: res.ok ? "settled" : "failed", records: credits, status, at: new Date().toISOString() });
      results.push({ id: r.id, status, credits, rows: rows.map((x) => redactLeadOceanRow(x) as Row), unsupportedFilters: j.meta?.unsupportedFilters ?? null });
    } catch (e) {
      // Sent or not, the outcome is unknown: recorded as failed, never re-sent.
      await ledgerAppend(ledger, { key, state: "failed", records: null, status, at: new Date().toISOString() });
      results.push({ id: r.id, status, credits: null, rows: [], unsupportedFilters: `error ${(e as Error)?.name}` });
    }
    await new Promise((res) => setTimeout(res, 400)); // stay under 5 req/s; not a retry
  }
  const after = accountRecords(await (await fetch(`${LO}/v1/account`, { headers })).json());
  await Deno.writeTextFile(`${dir}/rows.json`, JSON.stringify({ planHash: hash, results }, null, 2), { mode: 0o600 });
  const evals = results.flatMap((res) => res.rows.map((row) => evaluateRow(SCENARIOS.find((s) => s.id === res.id)!, row)));

  // Independent evidence (only with --independent, inside its approved cap).
  const indep = new Map<string, Independent>();
  let apify: { spentUsd: number; stopped: string | null; usageBefore: number | null; usageAfter: number | null } | null = null;
  if (independent) {
    const usage = async () => { try { return ((await (await fetch("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: "Bearer injected-by-proxy" } })).json()) as { data: { current: { monthlyUsageUsd: number } } }).data.current.monthlyUsageUsd; } catch { return null; } };
    const u0 = await usage();
    const targets = [...new Map(evals.filter((e) => e.company.linkedin).map((e) => [e.company.linkedin!.toLowerCase(), { companyKey: e.company.linkedin!.toLowerCase(), linkedinUrl: e.company.linkedin! }])).values()];
    const run = await readCompanyRecords(targets, pipelineApifyInvoker({ token: "injected-by-proxy", fetch: (u, i) => fetch(u, i), timeoutMs: 120_000 }), { maxUsd: INDEPENDENT_APIFY_USD, now: new Date(), idPrefix: `lo-final:${hash}` });
    apify = { spentUsd: run.spentUsd, stopped: run.stopped, usageBefore: u0, usageAfter: await usage() };
    for (const e of evals) {
      const f = e.company.linkedin ? run.facts.get(e.company.linkedin.toLowerCase()) : undefined;
      let tech: string[] | null = null;
      if (e.scenario === "C-S9" && e.company.domain) {
        try { const res = await fetch(`https://${e.company.domain}/`, { signal: AbortSignal.timeout(15_000), redirect: "follow" }); tech = res.ok ? homepageTech(await res.text()) : null; } catch { tech = null; }
      }
      indep.set(`${e.scenario}:${e.recordId}`, { hqCountry: f?.hq?.country ?? null, sizeBand: f?.sizeBand ? [f.sizeBand.min, f.sizeBand.max] : null, founded: f?.founded ?? null, homepageTech: tech });
    }
  }
  const scored = evals.map((e) => { const ind = independent ? independentChecks(e, indep.get(`${e.scenario}:${e.recordId}`) ?? null) : null; return { ...e, independent: ind, useful: isUseful(e, ind) }; });
  const charged = results.reduce((a, r) => a + (r.credits ?? 0), 0);
  await Deno.writeTextFile(`${dir}/evaluation.json`, JSON.stringify({ planHash: hash, before, after, charged, apify, results: results.map(({ rows, ...x }) => ({ ...x, rows: rows.length })), evals: scored }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ before: before.remaining, after: after?.remaining ?? null, charged, apify, useful: scored.filter((x) => x.useful).length, statuses: results.map((r) => [r.id, r.status, r.credits]) }));
}

if (import.meta.main) await main();
