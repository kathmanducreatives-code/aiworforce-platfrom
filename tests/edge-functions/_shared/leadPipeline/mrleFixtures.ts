// Shared MRLE fixtures: synthetic companies (.example), a mocked Apify (job search, company
// records, website pages) and a fake grounded classifier that quotes ONLY text it finds on the
// fetched pages (the real validation re-checks every quote). Used by businessModelCheck.test.ts
// and by scripts/dev/mrle-simulation.ts (the Workbench's labelled development simulation).

import { modelGrounder } from "../../../../supabase/functions/_shared/leadPipeline/businessModelCheck.ts";
import { parseStrategyRequest, readPipelineFlags, type StrategyDeps } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { planSigner } from "../../../../supabase/functions/_shared/leadPipeline/planToken.ts";
import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractHash, type MissionContract } from "../../../../supabase/functions/_shared/missionContract/contract.ts";
import { MISSION } from "../../../../scripts/test-project/contract-v4-run.ts";

export { MISSION };

export const WS = "22222222-2222-4222-8222-222222222222";
export const NOW = () => new Date("2026-11-07T12:00:00Z");
export const ENV: Record<string, string> = { LEAD_PIPELINE_ENABLED: "true", LEAD_PIPELINE_WORKSPACES: WS, PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_APIFY_DISCOVERY_ENABLED: "true" };
export const SIGNER = await planSigner("offline-test-secret-0123456789abcdef");

export const ANSWER = {
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

export type Co = { slug: string; name: string; site: string };
export const CO: Co[] = [
  { slug: "northwind", name: "Northwind Ledger", site: "northwind.example" },     // states business customers
  { slug: "harbor", name: "Harbor Kids", site: "harborkids.example" },            // a consumer business
  { slug: "quartz", name: "Quartz Data", site: "quartz.example" },                // pages say nothing useful
  { slug: "maple", name: "Maple Goods", site: "maple.example" },                  // both businesses and consumers
];
export const PAGES: Record<string, string> = {
  "northwind.example": "Accounting software built for finance teams at mid-market companies. Close your books faster with Northwind Ledger.",
  "harborkids.example": "Harbor Kids sells toys and games to consumers through our online store. Free shipping for families.",
  "quartz.example": "Welcome. Learn more about us.",
  "maple.example": "Maple Goods sells kitchenware to consumers in our online shop and supplies restaurants and other businesses wholesale.",
};
export const job = (id: string, c: Co) => ({ id, title: "Account Executive", linkedinUrl: `https://www.linkedin.com/jobs/view/${id}`, jobState: "LISTED", postedDate: "2026-11-02",
  company: { id: `c-${c.slug}`, universalName: c.slug, name: c.name, linkedinUrl: `https://www.linkedin.com/company/${c.slug}`, website: `https://${c.site}`,
    employeeCount: 80, employeeCountRange: { start: 51, end: 200 }, industries: [{ name: "Software Development" }], locations: [{ headquarter: true, parsed: { text: "Austin, Texas, United States" } }] },
  location: { linkedinText: "Austin, TX" }, descriptionText: `${c.name} is hiring.` });
export const record = (c: Co) => ({ id: `li-${c.slug}`, name: c.name, linkedinUrl: `https://www.linkedin.com/company/${c.slug}`, website: `https://${c.site}`, description: null,
  employeeCount: 85, employeeCountRange: { start: 51, end: 200 }, locations: [{ headquarter: true, city: "Austin", country: "US", parsed: { text: "Austin, United States", countryFull: "United States" } }], companyType: "Privately Held" });

export function apify(o: { failPages?: boolean } = {}) {
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
export const VALUES: Record<string, string> = { "northwind.example": "b2b_software", "harborkids.example": "consumer", "quartz.example": "unknown", "maple.example": "b2b_service" };
export const fakeModel = (calls: string[]) => (req: { messages: { content: string }[] }) => {
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

export function deps(o: { ground?: boolean; failPages?: boolean } = {}) {
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
export const req = (b: Record<string, unknown>) => parseStrategyRequest({ workspace_id: WS, walk_id: "bm-walk", query: MISSION, requested_count: 5, ...b })!;
export type Lead = { company: { name: string }; statuses: { qualification: string }; businessModel?: { status: string; quote: string | null; url: string | null } };

