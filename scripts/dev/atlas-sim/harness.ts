// ATLAS SIMULATOR — one scenario through the REAL lead-pipeline service, offline.
//
// Real: interpretation contract (contractFromProposal + compileContract), capability
// routing, the strategy planner, budget estimate, signed approval, Actor input building,
// company normalisation, grounded business-model validation, eligibility, dedupe/merge,
// persistence (the real persistRows over an in-memory store with the real unique keys)
// and the Workbench plan filter.
//
// Mocked (the external boundary only): the interpreter MODEL's answer (the scenario's
// `interpretation`), Apify Actor responses, the grounding MODEL's classification (it may
// only quote page text the scenario provides; the real validator re-checks every quote),
// billing, and the database. No network: `globalThis.fetch` is disabled by the CLI.
//
// Scenarios: tests/fixtures/atlas-sim/*.json. Used by scripts/dev/atlas-sim.ts and by
// tests/edge-functions/_shared/leadPipeline/atlasSimScenarios.test.ts.

import { handleStrategyRequest, parseStrategyRequest, readPipelineFlags, type StrategyDeps } from "../../../supabase/functions/_shared/leadPipeline/service.ts";
import { modelGrounder } from "../../../supabase/functions/_shared/leadPipeline/businessModelCheck.ts";
import { readFlags } from "../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { memoryLedger } from "../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { planSigner } from "../../../supabase/functions/_shared/leadPipeline/planToken.ts";
import { persistRows, type LeadStore } from "../../../supabase/functions/_shared/leadPipeline/persistRows.ts";
import type { ActorInvoker } from "../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import type { PipelineRow } from "../../../supabase/functions/_shared/leadPipeline/projection.ts";
import type { ExistingRecord } from "../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { contractFromProposal } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractHash, type MissionContract } from "../../../supabase/functions/_shared/missionContract/contract.ts";
import { leadPlanOrFilter } from "../../../src/lib/leads/leadPlanFilter.ts";

export const SIM_WS = "22222222-2222-4222-8222-222222222222";
export const OTHER_WS = "33333333-3333-4333-8333-333333333333";
const NOW = () => new Date("2026-11-07T12:00:00Z");

// ── scenario format ──────────────────────────────────────────────────────────

export type ProviderMode = "ok" | "empty" | "timeout" | "http_502" | "invalid_input";
export interface SimCompany {
  slug: string; name: string; site: string;
  /** LinkedIn slug when it differs from `slug` (two LinkedIn pages, one company). */
  linkedinSlug?: string;
  hq?: { text: string; country: string; countryFull: string; city?: string };
  employees?: number;
  job?: { title?: string; postedDate?: string; state?: string } | null;
  inRecords?: boolean;
  /** The company's homepage text; null = the site returns nothing useful. */
  page?: string | null;
  /** The grounding model's reading of the page (it can only quote `page`). */
  model?: "b2b_software" | "b2b_service" | "consumer" | "mixed" | "unknown";
}
export interface Scenario {
  name: string; description: string; covers: string[];
  query: string; requestedCount?: number;
  /** The interpreter model's answer (Mission Contract proposal shape). */
  interpretation: Record<string, unknown>;
  companies: SimCompany[];
  providers?: { jobs?: ProviderMode; records?: ProviderMode; pages?: ProviderMode; duplicateDelivery?: boolean; unknownSpend?: boolean };
  grounding?: boolean;
  approval?: "approve" | "none" | "tampered_hash" | "under_estimate" | "reject";
  allowReviewOnly?: boolean;
  runs?: number;
  workspace?: "member" | "not_member";
  persistence?: { fail?: boolean; planRecordFails?: boolean; existingAccounts?: { name: string; domain: string }[]; existingRecords?: ExistingRecord[] };
  expect?: Record<string, unknown>;
}

// ── mocked boundary ──────────────────────────────────────────────────────────

const hqOf = (c: SimCompany) => c.hq ?? { text: "Austin, United States", country: "US", countryFull: "United States", city: "Austin" };
const li = (c: SimCompany) => c.linkedinSlug ?? c.slug;
/** LinkedIn's size band for a head count (the record carries both, and they must agree). */
function band(n: number) {
  for (const [a, b] of [[1, 10], [11, 50], [51, 200], [201, 500], [501, 1000], [1001, 5000], [5001, 10000]]) if (n >= a && n <= b) return { start: a, end: b };
  return { start: 10001, end: null };
}

function jobItem(i: number, c: SimCompany) {
  const h = hqOf(c);
  return { id: `j${i}`, title: c.job?.title ?? "Account Executive", linkedinUrl: `https://www.linkedin.com/jobs/view/j${i}`, jobState: c.job?.state ?? "LISTED",
    postedDate: c.job?.postedDate ?? "2026-11-02",
    company: { id: `c-${li(c)}`, universalName: li(c), name: c.name, linkedinUrl: `https://www.linkedin.com/company/${li(c)}`, website: `https://${c.site}`,
      employeeCount: c.employees ?? 80, employeeCountRange: band(c.employees ?? 80), industries: [{ name: "Software Development" }],
      locations: [{ headquarter: true, parsed: { text: h.text } }] },
    location: { linkedinText: h.text }, descriptionText: `${c.name} is hiring.` };
}
function recordItem(c: SimCompany) {
  const h = hqOf(c);
  return { id: `li-${li(c)}`, name: c.name, linkedinUrl: `https://www.linkedin.com/company/${li(c)}`, website: `https://${c.site}`, description: null,
    employeeCount: c.employees ?? 85, employeeCountRange: band(c.employees ?? 85),
    locations: [{ headquarter: true, city: h.city ?? null, country: h.country, parsed: { text: h.text, countryFull: h.countryFull } }], companyType: "Privately Held" };
}

export interface ActorCall { actor: string; input: Record<string, unknown>; key: string; maxItems: number; outcome: string; items: number; chargedUsd: number | null }

function simApify(s: Scenario) {
  const calls: ActorCall[] = [];
  const p = s.providers ?? {};
  const modeFor = (actor: string): ProviderMode =>
    (actor === "apify_linkedin_job_search" ? p.jobs : actor === "apify_linkedin_company_details" ? p.records : actor === "apify_website_content" ? p.pages : "ok") ?? "ok";
  const invoke: ActorInvoker = (actor, input, opts) => {
    const mode = modeFor(actor);
    const call: ActorCall = { actor, input: structuredClone(input) as Record<string, unknown>, key: opts.idempotencyKey, maxItems: opts.maxItems, outcome: mode, items: 0, chargedUsd: null };
    calls.push(call);
    if (mode === "timeout") return Promise.reject(new Error(`apify timeout (${actor})`));
    if (mode === "http_502") return Promise.reject(new Error(`apify 502 (${actor})`));
    if (mode === "invalid_input") return Promise.reject(new Error(`apify 400 invalid input (${actor})`));
    let items: unknown[] = [];
    if (mode === "ok") {
      if (actor === "apify_linkedin_job_search") items = s.companies.filter((c) => c.job !== null).map((c, i) => jobItem(i, c));
      else if (actor === "apify_linkedin_company_details") items = s.companies.filter((c) => c.inRecords !== false).map(recordItem);
      else if (actor === "apify_website_content") {
        items = (input.startUrls as { url: string }[]).map(({ url }) => {
          const u = new URL(url); const c = s.companies.find((x) => x.site === u.host);
          const home = u.pathname === "/";
          return home && c?.page ? { url, text: c.page, crawl: { loadedUrl: url, httpStatusCode: 200 } } : { url, text: "", crawl: { loadedUrl: url, httpStatusCode: 404 } };
        });
      }
    }
    if (p.duplicateDelivery) items = [...items, ...items];
    items = items.slice(0, opts.maxItems);            // the Actor honours maxItems
    call.items = items.length;
    const charged = p.unknownSpend ? undefined : Number((items.length * 0.001 + 0.001).toFixed(5));
    call.chargedUsd = charged ?? null;
    return Promise.resolve({ items, runId: `run-${actor}-${calls.length}`, ...(charged === undefined ? {} : { chargedUsd: charged }) });
  };
  return { invoke, calls };
}

/** The grounding model, mocked: classifies the page and quotes ONLY its first sentence. */
function simModel(s: Scenario, log: { host: string; value: string }[]) {
  return (req: { messages: { content: string }[] }) => {
    const p = JSON.parse(req.messages[0].content);
    const page = (p.evidence as { evidence_id: string; evidence_type: string; source_text: string | null }[]).find((x) => x.evidence_type === "web_page" && x.source_text);
    const c = s.companies.find((x) => x.page && page?.source_text === x.page);
    const value = c?.model ?? "unknown";
    log.push({ host: c?.site ?? "(no page)", value });
    const excerpt = page?.source_text?.split(". ")[0] ?? "";
    const claims = value === "unknown" || !page ? [] : [{ claim: `${c?.site} business model`, claim_type: "business_model", evidence_ids: [page.evidence_id], evidence_excerpts: [{ evidence_id: page.evidence_id, excerpt }] }];
    return Promise.resolve({ ok: true, json: {
      business_model: { value, confidence: value === "unknown" ? 0.2 : 0.9, claims }, company_fit: "pass", agentory_use_case: "plausible",
      mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" }, supporting_claims: [], conflicting_evidence_ids: [],
      missing_evidence: [], unknown_fields: [], confidence: 0.9, reason: "simulated" } });
  };
}

/** The real persistRows against an in-memory store with the real unique keys. */
function memoryStore(failWrites: boolean) {
  type Row = Record<string, unknown> & { id: string; workspace_id: string };
  const accounts: Row[] = [], contacts: Row[] = [], leads: Row[] = [];
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const ins = (t: Row[], r: Record<string, unknown>) => {
    if (failWrites) return Promise.reject(new Error("simulated database write failure"));
    const x = { id: id(), ...r } as Row; t.push(x); return Promise.resolve({ id: x.id });
  };
  const store: LeadStore = {
    findAccountByDomain: (ws, d) => Promise.resolve((accounts.find((a) => a.workspace_id === ws && a.domain === d) ?? null) as never),
    findAccountByName: (ws, nm) => Promise.resolve((accounts.find((a) => a.workspace_id === ws && a.name === nm) ?? null) as never),
    insertAccount: (r) => accounts.some((a) => a.workspace_id === r.workspace_id && a.name === r.name) ? Promise.resolve({ conflict: true as const }) : ins(accounts, r),
    updateAccount: (i, p) => { Object.assign(accounts.find((a) => a.id === i)!, p); return Promise.resolve(); },
    findContactByLinkedin: (ws, u) => Promise.resolve((contacts.find((c) => c.workspace_id === ws && c.linkedin_url === u) ?? null) as never),
    insertContact: (r) => ins(contacts, r),
    updateContact: (i, p) => { Object.assign(contacts.find((c) => c.id === i)!, p); return Promise.resolve(); },
    findLeadById: (ws, i) => Promise.resolve((leads.find((l) => l.workspace_id === ws && l.id === i) ?? null) as never),
    findPipelineLeadForAccount: (ws, a, t) => Promise.resolve((leads.find((l) => l.workspace_id === ws && l.account_id === a && l.lead_type === t) ?? null) as never),
    insertLead: (r) => ins(leads, r),
    updateLead: (i, p) => { Object.assign(leads.find((l) => l.id === i)!, p); return Promise.resolve(); },
  };
  return { store, accounts, contacts, leads };
}

// ── run ──────────────────────────────────────────────────────────────────────

export interface SimResult {
  scenario: Scenario;
  correlationId: string;
  plan: { status: number; body: Record<string, unknown> };
  runs: { approval: string; status: number; body: Record<string, unknown> }[];
  actorCalls: ActorCall[];
  groundingCalls: { host: string; value: string }[];
  db: { accounts: Record<string, unknown>[]; contacts: Record<string, unknown>[]; leads: Record<string, unknown>[] };
  planRecords: { planId: string | null; status: string; summary: string }[];
  workbench: { planId: string; leadIds: string[]; filter: string | null }[];
  timingsMs: { plan: number; runs: number[] };
}

export async function runScenario(s: Scenario): Promise<SimResult> {
  const signer = await planSigner("offline-sim-secret-0123456789abcdef");
  const env: Record<string, string> = { LEAD_PIPELINE_ENABLED: "true", LEAD_PIPELINE_WORKSPACES: SIM_WS, PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_APIFY_DISCOVERY_ENABLED: "true" };
  const ap = simApify(s);
  const grounding: { host: string; value: string }[] = [];
  const mem = memoryStore(s.persistence?.fail === true);
  for (const a of s.persistence?.existingAccounts ?? []) {
    mem.accounts.push({ id: `pre-${a.domain}`, workspace_id: SIM_WS, name: a.name, domain: a.domain, raw: {} });
  }
  const planRecords: SimResult["planRecords"] = [];
  let planSeq = 0;
  const d: StrategyDeps = {
    userId: "u-owner", flags: readPipelineFlags((k) => env[k]), discoveryFlags: readFlags((k) => env[k]),
    store: { memberRole: (u: string, w: string) => Promise.resolve(w === SIM_WS && u === "u-owner" ? "owner" : null), list: () => Promise.resolve([]), secret: () => Promise.resolve(null) } as never,
    ledger: memoryLedger(), checkpoints: memoryCheckpointStore(),
    loadExisting: () => Promise.resolve(s.persistence?.existingRecords ?? []),
    leadoceanFor: () => { throw new Error("LeadOcean is not simulated (flag off)"); },
    apify: ap.invoke,
    persist: (rows: PipelineRow[]) => persistRows(mem.store, rows),
    now: NOW,
    interpret: async (query: string) => {
      const { contract } = contractFromProposal(query, s.interpretation as never);
      const hash = await contractHash(contract);
      return { mission: await compileContract(contract), contract, brain: { status: "absent", fields: [], applied: [], rejected: [] },
        replay: { proposal: { contract, contractHash: hash }, brain: { status: "absent", fields: [], context: null } } } as never;
    },
    recompile: async (_q: string, _n: number | null, replay: { proposal: unknown }) => {
      const a = replay.proposal as { contract: MissionContract };
      return { mission: await compileContract(a.contract), contract: a.contract } as never;
    },
    recordRunPlan: (p: { status: string; summary: string }) => {
      if (s.persistence?.planRecordFails) { planRecords.push({ planId: null, status: p.status, summary: p.summary }); return Promise.reject(new Error("simulated plan record failure")); }
      const planId = `aaaaaaaa-0000-4000-8000-${String(++planSeq).padStart(12, "0")}`;
      planRecords.push({ planId, status: p.status, summary: p.summary });
      return Promise.resolve(planId);
    },
    signer, advisor: null,
    ...(s.grounding === false ? {} : { groundBusinessModel: modelGrounder(simModel(s, grounding) as never, s.query) }),
  } as StrategyDeps;

  const ws = s.workspace === "not_member" ? OTHER_WS : SIM_WS;
  const correlationId = `sim-${s.name}`;
  const req = (b: Record<string, unknown>, walk = correlationId) =>
    parseStrategyRequest({ workspace_id: ws, walk_id: walk, query: s.query, requested_count: s.requestedCount ?? 5, ...b })!;

  const t0 = performance.now();
  const plan = await handleStrategyRequest(req({ action: "strategy_plan", ...(s.allowReviewOnly ? { allow_review_only: true } : {}) }), d);
  const tPlan = performance.now() - t0;
  const runs: SimResult["runs"] = [];
  const runTimes: number[] = [];
  const p = plan.body.plan as { planHash?: string; estimate?: { apifyUsd: number } } | undefined;
  const mode = s.approval ?? "approve";
  if (plan.status === 200 && p?.planHash && mode !== "reject") {
    for (let i = 0; i < (s.runs ?? 1); i++) {
      // One approval runs one walk: a repeated run is a NEW plan and a NEW approval, as in the
      // Workbench. The first run uses the plan reported above.
      const walk = i === 0 ? correlationId : `${correlationId}-${i + 1}`;
      let cur = plan;
      if (i > 0) cur = await handleStrategyRequest(req({ action: "strategy_plan", ...(s.allowReviewOnly ? { allow_review_only: true } : {}) }, walk), d);
      const cp = cur.body.plan as { planHash: string; estimate: { apifyUsd: number } };
      const tok = cur.body.approval_token;
      const approval = mode === "none" ? undefined
        : mode === "tampered_hash" ? { plan_hash: cp.planHash.replace(/^./, (c) => (c === "a" ? "b" : "a")), apify_usd: cp.estimate.apifyUsd, token: tok }
        : mode === "under_estimate" ? { plan_hash: cp.planHash, apify_usd: Number((cp.estimate.apifyUsd / 2).toFixed(5)), token: tok }
        : { plan_hash: cp.planHash, apify_usd: cp.estimate.apifyUsd, token: tok };
      const t = performance.now();
      const r = await handleStrategyRequest(req({ action: "strategy_run", ...(approval ? { approval } : {}), ...(s.allowReviewOnly ? { allow_review_only: true } : {}) }, walk), d);
      runTimes.push(performance.now() - t);
      runs.push({ approval: mode, status: r.status, body: r.body });
    }
  }

  const workbench = planRecords.filter((r) => r.planId).map((r) => {
    const filter = leadPlanOrFilter(r.planId!);
    const leadIds = mem.leads.filter((l) => l.workspace_id === SIM_WS && (l.plan_id === r.planId
      || (l.raw as { agentory_pipeline?: { plan_id?: string } })?.agentory_pipeline?.plan_id === r.planId)).map((l) => String(l.id));
    return { planId: r.planId!, leadIds, filter };
  });

  return { scenario: s, correlationId, plan, runs, actorCalls: ap.calls, groundingCalls: grounding,
    db: { accounts: mem.accounts, contacts: mem.contacts, leads: mem.leads }, planRecords, workbench, timingsMs: { plan: tPlan, runs: runTimes } };
}

export async function loadScenarios(dir: URL): Promise<Scenario[]> {
  const out: Scenario[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".json")) out.push(JSON.parse(await Deno.readTextFile(new URL(e.name, dir))));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
