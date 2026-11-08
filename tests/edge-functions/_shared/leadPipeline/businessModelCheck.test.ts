// MRLE Phase 1: REQUIRED B2B is verified from ≤3 first-party pages through the production
// grounded classifier — verified / likely / mixed / unknown / not B2B, never stronger than
// the evidence. Offline: mocked Apify (jobs, company records, website pages) and a fake model
// that quotes only text it finds on the pages; the REAL validation re-checks every quote.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { businessModelPages, modelGrounder } from "../../../../supabase/functions/_shared/leadPipeline/businessModelCheck.ts";
import { handleStrategyRequest, parseStrategyRequest, readPipelineFlags, type StrategyDeps } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { planSigner } from "../../../../supabase/functions/_shared/leadPipeline/planToken.ts";
import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import type { StrategyPlan } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractHash, type MissionContract } from "../../../../supabase/functions/_shared/missionContract/contract.ts";
import { MISSION } from "../../../../scripts/test-project/contract-v4-run.ts";

const WS = "22222222-2222-4222-8222-222222222222";
const NOW = () => new Date("2026-11-07T12:00:00Z");
const ENV: Record<string, string> = { LEAD_PIPELINE_ENABLED: "true", LEAD_PIPELINE_WORKSPACES: WS, PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_APIFY_DISCOVERY_ENABLED: "true" };
const SIGNER = await planSigner("offline-test-secret-0123456789abcdef");

const ANSWER = {
  understanding: {
    roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" },
      { span: "SDR", title: "sales_development_representative", family: null, relation: "excluded" },
      { span: "BDR", title: "business_development_representative", family: null, relation: "excluded" }],
    role_match: "any", places: [{ span: "headquartered in the United States", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    industries: [{ span: "must operate as B2B businesses", industry: "B2B", necessity: "required" }],
    signals: [{ span: "actively hiring Account Executives", kind: "hiring", necessity: "required" }],
    signal_logic: "all", ambiguities: [], unsupported: [],
  },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
};

type Co = { slug: string; name: string; site: string };
const CO: Co[] = [
  { slug: "northwind", name: "Northwind Ledger", site: "northwind.example" },     // states business customers
  { slug: "harbor", name: "Harbor Kids", site: "harborkids.example" },            // a consumer business
  { slug: "quartz", name: "Quartz Data", site: "quartz.example" },                // pages say nothing useful
  { slug: "maple", name: "Maple Goods", site: "maple.example" },                  // both businesses and consumers
];
const PAGES: Record<string, string> = {
  "northwind.example": "Accounting software built for finance teams at mid-market companies. Close your books faster with Northwind Ledger.",
  "harborkids.example": "Harbor Kids sells toys and games to consumers through our online store. Free shipping for families.",
  "quartz.example": "Welcome. Learn more about us.",
  "maple.example": "Maple Goods sells kitchenware to consumers in our online shop and supplies restaurants and other businesses wholesale.",
};
const job = (id: string, c: Co) => ({ id, title: "Account Executive", linkedinUrl: `https://www.linkedin.com/jobs/view/${id}`, jobState: "LISTED", postedDate: "2026-11-02",
  company: { id: `c-${c.slug}`, universalName: c.slug, name: c.name, linkedinUrl: `https://www.linkedin.com/company/${c.slug}`, website: `https://${c.site}`,
    employeeCount: 80, employeeCountRange: { start: 51, end: 200 }, industries: [{ name: "Software Development" }], locations: [{ headquarter: true, parsed: { text: "Austin, Texas, United States" } }] },
  location: { linkedinText: "Austin, TX" }, descriptionText: `${c.name} is hiring.` });
const record = (c: Co) => ({ id: `li-${c.slug}`, name: c.name, linkedinUrl: `https://www.linkedin.com/company/${c.slug}`, website: `https://${c.site}`, description: null,
  employeeCount: 85, employeeCountRange: { start: 51, end: 200 }, locations: [{ headquarter: true, city: "Austin", country: "US", parsed: { text: "Austin, United States", countryFull: "United States" } }], companyType: "Privately Held" });

function apify(o: { failPages?: boolean } = {}) {
  const calls: { actor: string; input: Record<string, unknown>; key: string; maxItems: number }[] = [];
  const invoke: ActorInvoker = (actor, input, opts) => {
    calls.push({ actor, input, key: opts.idempotencyKey, maxItems: opts.maxItems });
    if (actor === "apify_linkedin_job_search") return Promise.resolve({ items: CO.map((c, i) => job(`j${i}`, c)), runId: "run-jobs", chargedUsd: 0.005 });
    if (actor === "apify_linkedin_company_details") return Promise.resolve({ items: CO.map(record), runId: "run-rec", chargedUsd: 0.016 });
    if (actor === "apify_website_content") {
      if (o.failPages) return Promise.reject(new Error("apify 502"));
      const urls = (input.startUrls as { url: string }[]).map((x) => x.url);
      // Only the homepage of each site exists; /about and /customers are 404s.
      const items = urls.map((u) => { const host = new URL(u).host; const home = new URL(u).pathname === "/";
        return home ? { url: u, text: PAGES[host], crawl: { loadedUrl: u, httpStatusCode: 200 } } : { url: u, text: "", crawl: { loadedUrl: u, httpStatusCode: 404 } }; });
      return Promise.resolve({ items, runId: "run-pages", chargedUsd: 0.01 });
    }
    return Promise.resolve({ items: [], runId: "x" });
  };
  return { invoke, calls };
}

// A fake grounded classifier: reads the payload, cites the web page it quotes, never invents text.
const VALUES: Record<string, string> = { "northwind.example": "b2b_software", "harborkids.example": "consumer", "quartz.example": "unknown", "maple.example": "b2b_service" };
const fakeModel = (calls: string[]) => (req: { messages: { content: string }[] }) => {
  const p = JSON.parse(req.messages[0].content);
  const page = (p.evidence as { evidence_id: string; evidence_type: string; source_text: string | null }[]).find((x) => x.evidence_type === "web_page" && x.source_text);
  const host = Object.keys(PAGES).find((h) => page?.source_text === PAGES[h]) ?? "";
  calls.push(host);
  const value = VALUES[host] ?? "unknown";
  const excerpt = page?.source_text?.split(". ")[0] ?? "";
  const claims = value === "unknown" || !page ? [] : [{ claim: `${host} business model`, claim_type: "business_model", evidence_ids: [page.evidence_id], evidence_excerpts: [{ evidence_id: page.evidence_id, excerpt }] }];
  return Promise.resolve({ ok: true, json: {
    business_model: { value, confidence: value === "unknown" ? 0.2 : 0.9, claims }, company_fit: "pass", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" }, supporting_claims: [], conflicting_evidence_ids: [],
    missing_evidence: [], unknown_fields: [], confidence: 0.9, reason: "test" } });
};

function deps(o: { ground?: boolean; failPages?: boolean } = {}) {
  const ap = apify({ failPages: o.failPages });
  const written: PipelineRow[] = [];
  const modelCalls: string[] = [];
  const d: StrategyDeps = {
    userId: "u-owner", flags: readPipelineFlags((k) => ENV[k]), discoveryFlags: readFlags((k) => ENV[k]),
    store: { memberRole: (u: string, w: string) => Promise.resolve(w === WS && u === "u-owner" ? "owner" : null), list: () => Promise.resolve([]), secret: () => Promise.resolve(null) } as never,
    ledger: memoryLedger(), checkpoints: memoryCheckpointStore(), loadExisting: () => Promise.resolve([]),
    leadoceanFor: () => { throw new Error("LeadOcean is never used here"); }, apify: ap.invoke,
    persist: (rows) => { written.push(...rows); return Promise.resolve(); }, now: NOW,
    interpret: async (query) => {
      const { contract } = contractFromProposal(query, ANSWER as never);
      const hash = await contractHash(contract);
      return { mission: await compileContract(contract), contract, brain: { status: "absent", fields: [], applied: [], rejected: [] },
        replay: { proposal: { contract, contractHash: hash }, brain: { status: "absent", fields: [], context: null } } };
    },
    recompile: async (_q, _n, replay) => { const a = replay.proposal as { contract: MissionContract }; return { mission: await compileContract(a.contract), contract: a.contract }; },
    signer: SIGNER,
    ...(o.ground === false ? {} : { groundBusinessModel: modelGrounder(fakeModel(modelCalls) as never, MISSION) }),
  } as StrategyDeps;
  return { d, ap, written, modelCalls };
}
const req = (b: Record<string, unknown>) => parseStrategyRequest({ workspace_id: WS, walk_id: "bm-walk", query: MISSION, requested_count: 5, ...b })!;
type Lead = { company: { name: string }; statuses: { qualification: string }; businessModel?: { status: string; quote: string | null; url: string | null } };

Deno.test("the page list is the company's own three pages, never a crawl", () => {
  assertEquals(businessModelPages("https://www.Northwind.example/about").map((p) => p.url), ["https://northwind.example/", "https://northwind.example/about", "https://northwind.example/customers"]);
});

Deno.test("REQUIRED B2B with the website check: the plan is READY, checks B2B on first-party pages, and stays within the $0.25 cap", async () => {
  const x = deps();
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  assertEquals(planned.status, 200, JSON.stringify(planned.body).slice(0, 400));
  const plan = planned.body.plan as StrategyPlan;
  assertEquals(plan.steps.map((s) => s.capability), ["apify.linkedin_job_search", "apify.linkedin_company_record", "apify.website_business_model"]);
  const bm = plan.requirementRoutes.find((r) => r.dimension === "business_model")!;
  assertEquals([bm.route, bm.checkedBy], ["checked", ["apify.website_business_model"]]);
  assert(plan.estimate.apifyUsd <= 0.25, `${plan.estimate.apifyUsd}`);
  assertEquals(x.ap.calls.length, 0, "planning buys nothing");
});

Deno.test("without the grounding model the website check is unavailable: REQUIRED B2B is blocked with a question, nothing bought", async () => {
  const x = deps({ ground: false });
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  assertEquals(planned.status, 409);
  assert(((planned.body.plan as StrategyPlan).questions ?? []).some((q) => /business model/i.test(q)));
  assertEquals(x.ap.calls.length, 0);
});

Deno.test("verified only from the company's own words: B2B qualifies, consumer is rejected, mixed and silent stay open — with quote and URL", async () => {
  const x = deps();
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  const plan = planned.body.plan as StrategyPlan;
  const ran = await handleStrategyRequest(req({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), x.d);
  assertEquals(ran.status, 200, JSON.stringify(ran.body).slice(0, 400));
  const all = [...(ran.body.queue as Lead[]), ...(ran.body.review as Lead[])];
  const by = Object.fromEntries(all.map((l) => [l.company.name, l]));
  assertEquals(by["Northwind Ledger"].statuses.qualification, "eligible");
  assertEquals(by["Northwind Ledger"].businessModel!.status, "verified_b2b");
  assert(by["Northwind Ledger"].businessModel!.quote!.includes("built for finance teams"));
  assertEquals(by["Northwind Ledger"].businessModel!.url, "https://northwind.example/");
  assertFalse((ran.body.queue as Lead[]).some((l) => l.company.name === "Harbor Kids"), "a consumer business is never qualified");
  assertEquals(by["Quartz Data"]?.statuses.qualification, "pending", "pages that say nothing leave it unverified");
  assertFalse((ran.body.queue as Lead[]).some((l) => l.company.name === "Maple Goods"), "a business that also sells to consumers is not verified B2B-only by a mixed page");
  assertEquals(by["Quartz Data"]?.businessModel?.status, "unknown");
  // One batched page run, ≤3 pages per company, and every company read once.
  const pageRuns = x.ap.calls.filter((c) => c.actor === "apify_website_content");
  assertEquals(pageRuns.length, 1);
  assert((pageRuns[0].input.startUrls as unknown[]).length <= 3 * CO.length);
  assertEquals(pageRuns[0].input.maxCrawlDepth, 0, "no link following");
  // Honest outcome: only qualified companies count toward the 5 requested.
  const outcome = ran.body.outcome as { status: string; qualified: number; shortfall: number; spend: { basis: string; apifyUsd: number } };
  assertEquals([outcome.status, outcome.qualified, outcome.shortfall], ["completed_with_shortfall", 1, 4]);
  assertEquals(outcome.spend.basis, "estimate");
  assert(outcome.spend.apifyUsd <= 0.25);
  // The verdict travels to the Leads row.
  const nw = x.written.find((w) => w.account.name === "Northwind Ledger")!;
  assertEquals((nw.lead_candidate.raw.agentory_pipeline as { business_model: { status: string } }).business_model.status, "verified_b2b");
});

Deno.test("a failed page run verifies nothing and is never retried: every company stays needs_verification", async () => {
  const x = deps({ failPages: true });
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  const plan = planned.body.plan as StrategyPlan;
  const ran = await handleStrategyRequest(req({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), x.d);
  assertEquals((ran.body.queue as Lead[]).length, 0);
  assertEquals(x.ap.calls.filter((c) => c.actor === "apify_website_content").length, 1, "one attempt, no retry");
  assertEquals((ran.body.outcome as { status: string }).status, "needs_verification");
  assertEquals(x.modelCalls.length, 0, "nothing to ground");
});
