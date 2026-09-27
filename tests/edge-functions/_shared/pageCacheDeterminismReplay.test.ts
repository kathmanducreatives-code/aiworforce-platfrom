// THE SAME CACHED PAGES REACH THE GROUNDER WHATEVER THE FIRECRAWL MAP RETURNS.
//
// The Fuse AI business-model regression flipped between production runs of the
// same mission on the same cached pages, because Firecrawl's /map varies:
//
//   152e59d6 / e8a70920   map sample included /pricing  → /pricing read  → plausible
//   5617a303 / 0553512c   map did NOT surface /pricing, selected /company;
//                         the /about 404 "answered" /company → NO page read → never re-grounded
//   636d6f03 / d6cd2ef2   /pricing held from cache, /company fetched → accepted → SATISFIED
//
// Page identity is now the canonical URL (store and runner) and fresh usable
// pages are held whatever the map selects. This replays the whole chain offline
// for every map shape production produced, with the grounder's answer FIXED to
// the one production gave on d6cd2ef2, so the only thing that can differ between
// runs is which pages the grounder is shown:
//
//   map → cache (canonical URL) → held /pricing → web_page evidence → grounder
//       → quote diagnostics → business-model verdict → canonical eligibility
//
// ComfyUI runs through the same chain: its outcome (no business-model claim,
// pending) must be just as independent of the map.
//
// Real modules throughout: readFreshPages, runEvidenceCollection (with the real
// spec-governed map and page fetchers), selectCompanyPages, regroundPendingClaims,
// buildEvidenceRegistry, verifyGroundedResult, applyRegroundedVerification,
// missionCandidatesFrom, evaluateEligibility. Scripted: Firecrawl, the table,
// the model's answer. ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readFreshPages } from "../../../supabase/functions/_shared/webEvidenceStore.ts";
import { runEvidenceCollection } from "../../../supabase/functions/_shared/webEvidenceRunner.ts";
import { selectCompanyPages } from "../../../supabase/functions/_shared/webEvidenceSelection.ts";
import {
  BUSINESS_MODEL_MAX_PAGES, BUSINESS_MODEL_PAGE_INTENTS, claimPageBudget, claimPageDebts, claimPagePlan,
} from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import {
  specGovernedMapper, specGovernedPageFetcher, webEvidenceCreditRate,
} from "../../../supabase/functions/_shared/webEvidenceSpec.ts";
import { newSpendLedger, resolveCeilings } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { newMissionTrace } from "../../../supabase/functions/_shared/missionTrace.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { regroundPendingClaims, type RegroundPage } from "../../../supabase/functions/_shared/webEvidenceRegrounding.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { parseGroundedResult, verifyGroundedResult } from "../../../supabase/functions/_shared/groundedClaims.ts";
import {
  applyRegroundedVerification, missionCandidatesFrom, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { entityHintFromCompany, type EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { compileRequestMission } from "../../../supabase/functions/_shared/requestToMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import type { VerificationTarget } from "../../../supabase/functions/_shared/claimVerifier.ts";

globalThis.fetch = () => { throw new Error("the replay must not reach the network"); };

const WS = "00000000-0000-4000-a000-000000000001";
const NOW = new Date("2026-09-27T06:09:00.000Z");
const RATE = webEvidenceCreditRate(() => undefined, { usd_capped: false }); // production: no account rate

// ── THE TABLE AS PRODUCTION HELD IT ──────────────────────────────────────────

type Row = { source_url: string; page_intent: string; source_text: string; fetched_at: string; status: string; domain: string };

/** fuseai.com/pricing — lines as stored (2026-09-16), including every quote d6cd2ef2 grounded on. */
const FUSE_PRICING = [
  "PRICING", "# Time is money. Let AI handle the busy work.",
  "Try Fuse for free to experience AI-powered sales.",
  "Solo", "$60", "per month", "Sign Up For Free", "Solo workspace with 1 seat",
  "Team", "$200\n\nper month", "Designed for small teams looking to accelerate outbound.",
  "Shared team workspace with 5 seats", "CRM, MCP, API, and Slack Integrations",
  "Enterprise", "Built for teams running outbound as a repeatable system", "Shared team workspace with 5+ seats",
  "Seats", "1/seat", "50/seat", "2,500/mo per account",
  "Used by sales & marketing professionals from 1,000+ startups and enterprises worldwide",
].join("\n\n");

const FUSE_ROWS: Row[] = [
  { domain: "fuseai.com", source_url: "https://fuseai.com/pricing", page_intent: "pricing", source_text: FUSE_PRICING, fetched_at: "2026-09-16T09:42:15.839Z", status: "ok" },
  { domain: "fuseai.com", source_url: "https://fuseai.com/product", page_intent: "product", source_text: "", fetched_at: "2026-09-16T09:42:06.889Z", status: "not_found" },
  { domain: "fuseai.com", source_url: "https://fuseai.com/", page_intent: "homepage", source_text: "Fuse is sales superintelligence for modern revenue teams.", fetched_at: "2026-09-15T10:53:01.565Z", status: "ok" },
  { domain: "fuseai.com", source_url: "https://fuseai.com/about", page_intent: "about", source_text: "", fetched_at: "2026-09-14T07:17:49.928Z", status: "not_found" },
];

const COMFY_ROWS: Row[] = [
  { domain: "comfy.org", source_url: "https://comfy.org/pricing", page_intent: "pricing", fetched_at: "2026-09-26T15:31:13.263Z", status: "ok",
    source_text: "Access cloud-powered ComfyUI workflows with straightforward, usage-based pricing.\n\nStart Comfy Cloud for free\n\nSUBSCRIBE TO CREATOR\n\nTEAM\n\nBuilt for teams collaborating on workflows together." },
  { domain: "comfy.org", source_url: "https://comfy.org/platform", page_intent: "product", fetched_at: "2026-09-26T15:31:07.393Z", status: "ok",
    source_text: "Deploy your ComfyUI workflow as a production API\n\nIt scales effortlessly with your team or project's needs" },
];

/** A table that answers `readFreshPages`' query and records the runner's writes, like the real one. */
function table(seed: Row[]) {
  const rows = [...seed];
  const db = {
    from: () => {
      let domain = "";
      const q = {
        select: () => q,
        eq: (col: string, v: string) => { if (col === "domain") domain = v; return q; },
        order: () => q,
        limit: () => Promise.resolve({
          data: rows.filter((r) => r.domain === domain).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at)),
          error: null,
        }),
        upsert: (written: Array<Record<string, string>>) => {
          for (const w of written) {
            rows.push({ domain: w.domain, source_url: w.source_url, page_intent: w.page_intent, source_text: w.source_text ?? "",
              fetched_at: w.fetched_at ?? NOW.toISOString(), status: w.status });
          }
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, rows };
}

// ── THE MAPS PRODUCTION RETURNED ─────────────────────────────────────────────

const url = (d: string) => (p: string) => `https://${d}${p}`;
const FUSE_MAPS: Record<string, string[]> = {
  "e8a70920 (map had /pricing)": ["/founders", "/", "/prospect", "/engage", "/signals", "/marketing", "/rev-ops", "/sales", "/alternatives", "/blog", "/pricing", "/machine-version"].map(url("fuseai.com")),
  "0553512c (no /pricing; /company)": ["/sitemap.xml", "/founders", "/", "/prospect", "/engage", "/signals", "/marketing", "/rev-ops", "/sales", "/blog", "/machine-version", "/company"].map(url("fuseai.com")),
  "map answered nothing": [],
};
const COMFY_MAPS: Record<string, string[]> = {
  "f2af841d (customers story, no /pricing)": ["/platform/router", "/installation/desktop/macos", "/agent", "/models", "/customers/svedka-silverside"].map(url("comfy.org")),
  "map answered nothing": [],
};

const COMPANY_PAGE = { ok: true, status: "ok" as const, status_code: 200, markdown: "# Fuse\n\nWe build the AI sales platform for revenue teams." };
const CUSTOMER_STORY = { ok: true, status: "ok" as const, status_code: 200, markdown: "# Svedka x Comfy\n\nHow a creative team shipped a campaign with ComfyUI." };

// ── ONE COMPANY THROUGH THE WHOLE CHAIN ──────────────────────────────────────

interface Subject {
  key: string; name: string; domain: string; rows: Row[]; query: string;
  /** The company's LinkedIn description, as company details returned it. */
  description?: string;
  answer: (reg: ReturnType<typeof registryOf>) => Record<string, unknown>;
  page: typeof COMPANY_PAGE;
}

function registryOf(s: Subject, pages: readonly RegroundPage[]) {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: s.key, source_capability: "known_company_resolution", source_query: s.query,
      company: {
        company_name: s.name, linkedin_company_url: s.key, canonical_domain: s.domain, website: `https://${s.domain}`,
        geography: "San Francisco, CA, United States", provider_industry: "Software Development",
        description: s.description ?? null,
        field_trust: {}, missing_fields: [], raw_ref: { actor_key: "apify_linkedin_company_details", source_id: s.name },
      } as never,
      enriched: null, identity_state: "resolved", linkedin_company_url: s.key, commercial_jobs: [], strongest_signal: null,
    }),
    web_pages: pages,
  } as never);
}

function engineCompany(s: Subject): EngineCompany {
  const company = {
    company_name: s.name, linkedin_company_url: s.key, canonical_domain: s.domain, website: `https://${s.domain}`,
    geography: "San Francisco, CA, United States", external_source_id: `li:${s.name}`, employee_count: null,
    field_trust: {}, missing_fields: [], raw_ref: { actor_key: "apify_linkedin_company_details", source_id: s.name },
  };
  const proven = (dimension: EvidenceItem["dimension"], value: unknown): EvidenceItem => ({
    evidence_id: `ev_${dimension}`, company_key: s.key, dimension, value, status: "proven",
    source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc", url: s.key, excerpt: null },
    method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high", derived_from: [], mission_id: "t", origin: "lead_mission",
  });
  return {
    key: s.key, company, hiring_jobs: [], yc_open_jobs: [], hiring_assessment: null, first_in_function: null,
    enriched: null, identity: null, found_by: [], verdict: null, brain: null, shortlisted: true,
    prequalified: null, prequal_key: null, shortlist_exclusion: null, triage: null,
    investigation_state: "investigated", investigation_rank: 1, enrichment_outcome: "success",
    completed_operations: [], mission_evaluation: null, identity_conflicts: [], grounded: null, evidence_registry: null,
    observations: [{
      version: "candidate-observation-v1", observation_id: "obs", capability: "company_enrichment",
      actor_key: "apify_linkedin_company_details", provider: "apify", route_id: null, plan_version: null,
      provider_call_id: null, source_record_id: null, source_url: s.key, observed_at: NOW.toISOString(),
      entity_hint: entityHintFromCompany(company as never),
      evidence: [proven("identity", { linkedin_company_url: s.key, domain: s.domain, name: s.name }), proven("geography", "San Francisco, CA, United States")],
    }],
  } as never;
}

function criteria(s: Subject) {
  const req = {
    version: "request-v1", objective: "research", confidence: 0.9, ambiguity: [],
    parts: [{ id: "p1", objective: "research",
      subject: { entity: "company", references: [{ kind: "named", value: s.name, cardinality: "one" }],
        filters: [{ field: "geography", op: "eq", value: "United States" }, { field: "business_model", op: "eq", value: "B2B SaaS" }] },
      requirements: [], output: { shape: "records", count: 1 } }],
  } as never;
  const route = routeRequest(req, { spendAllowed: true });
  const m = compileRequestMission(req, (route as unknown as { lead: never }).lead, { originalUserQuery: s.query });
  if (!m.ok) throw new Error(JSON.stringify(m));
  return deriveMissionCriteria(m.result.final_mission);
}

async function chain(s: Subject, map: string[]) {
  const t = table(s.rows);
  const fetched: string[] = [];
  const state = { spend_ledger: newSpendLedger(resolveCeilings(null, false)), mission_trace: newMissionTrace(), retrieval_plans: [{ plan_id: "rp", version: 1, mission_hash: "mh" }] };
  const scope = { workspace_id: WS, lineage_id: "0553512c-8e0b-4641-9a18-f91deb68d0ef" };
  const target: VerificationTarget = {
    company_key: s.key, name: s.name, domain: s.domain, linkedin_url: s.key,
    criterion: { criterion_id: "industry:b2b_saas", dimension: "industry", value: "b2b saas" },
    graph: buildCompanyEvidenceGraph(s.key, [], { now: NOW }),
  };
  const debts = claimPageDebts([target]);

  // 1. MAP → CACHE → PAGES (run-agent's business-model `collect`, cache keyed by canonical URL)
  const run = await runEvidenceCollection({
    workspace_id: WS, debts, budget: claimPageBudget(1, BUSINESS_MODEL_PAGE_INTENTS, BUSINESS_MODEL_MAX_PAGES),
    deps: {
      plan: () => Promise.resolve(claimPagePlan(debts, BUSINESS_MODEL_PAGE_INTENTS)),
      extract: null, db: t.db, now: () => NOW.toISOString(),
      readCache: async (domain) => new Map([...(await readFreshPages(t.db, { workspace_id: WS, domain, now: NOW.getTime() }))]
        .map(([k, r]) => [k, { source_url: r.source_url, source_text: r.source_text, fetched_at: r.fetched_at, status: r.status, page_intent: r.page_intent }])),
      fetchPage: specGovernedPageFetcher({ state: state as never, scope, usd_per_credit: RATE.usd_per_credit,
        send: (spec) => { fetched.push(String(spec.serialized_input.url)); return Promise.resolve(s.page); } }),
      mapSite: specGovernedMapper({ state: state as never, scope, usd_per_credit: RATE.usd_per_credit, max_urls: 120, send: () => Promise.resolve(map) }),
    },
  });
  const collected = run.companies[0];

  // 2. RE-GROUNDING on the stored pages (run-agent's `reground` deps), 3. the verifier, 4. the claim
  const c = engineCompany(s);
  let groundedPages: string[] = [];
  const report = await regroundPendingClaims({
    requiresCommercialSignal: false, limit: 1,
    candidates: [{ company_key: s.key, business_model_pending: collected.pages_ok > 0, grounded_source_urls: [] }],
    deps: {
      pagesFor: async () => {
        const fresh = await readFreshPages(t.db, { workspace_id: WS, domain: s.domain, now: NOW.getTime() });
        const usable = [...fresh.values()].filter((pg) => pg.status === "ok" && pg.source_text);
        return selectCompanyPages(usable).pages.map((pg) => ({ source_url: pg.source_url, page_intent: pg.page_intent, source_text: pg.source_text, fetched_at: pg.fetched_at ?? null }));
      },
      rebuildRegistry: (_k, pages) => { groundedPages = pages.map((p) => p.source_url).sort(); return registryOf(s, pages); },
      ground: ({ registry }) => Promise.resolve(verifyGroundedResult({ registry: registry as never, result: parseGroundedResult(s.answer(registry as never)) })),
      apply: (_k, v) => applyRegroundedVerification(c, v, "t", NOW.toISOString()),
    },
  });

  // 5. CANONICAL ELIGIBILITY
  const e = evaluateEligibility(criteria(s), missionCandidatesFrom({ companies: [c] }, { missionId: "t" })[0].graph);
  const bm = (c.observations ?? []).flatMap((o) => o.evidence).find((x) => x.dimension === "business_model");
  return {
    fetched, collected, groundedPages, outcome: report.outcomes[0], registry: c.grounded, bm,
    eligibility: e.eligibility, industry: e.checks.filter((x) => x.dimension === "industry" && x.kind === "hard").map((x) => x.result),
  };
}

// ── THE SUBJECTS, WITH THE MODEL'S ANSWER FIXED ──────────────────────────────

const pageId = (reg: { items: Array<{ evidence_id: string; source_url: string | null }> }, u: string) =>
  reg.items.find((i) => i.source_url === u)!.evidence_id;
const descriptionId = (reg: { items: Array<{ evidence_id: string; evidence_type: string }> }) =>
  reg.items.find((i) => i.evidence_type === "company_description")!.evidence_id;
const claim = (claim_type: string, id: string, excerpts: string[]) =>
  ({ claim: "the company's own words", claim_type, evidence_ids: [id], evidence_excerpts: excerpts.map((excerpt) => ({ evidence_id: id, excerpt })) });

const FUSE: Subject = {
  key: "https://www.linkedin.com/company/fuseaicom", name: "Fuse AI", domain: "fuseai.com", rows: FUSE_ROWS, page: COMPANY_PAGE,
  description: "Fuse is the sales superintelligence platform for modern revenue teams.",
  query: "Check 1 company: Fuse AI (https://www.linkedin.com/company/fuseaicom). It must be based in the US and must be B2B SaaS.",
  // d6cd2ef2's validated business-model and product-type claims, quote for quote
  // (the product claim quoted the LinkedIn description — it states the buyer).
  answer: (reg) => ({
    business_model: { value: "ai_saas", confidence: 0.9, claims: [claim("business_model", pageId(reg, "https://fuseai.com/pricing"), [
      "Try Fuse for free to experience AI-powered sales.", "$200\n\nper month", "50/seat",
      "Used by sales & marketing professionals from 1,000+ startups and enterprises worldwide",
    ])] },
    company_fit: "pass", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
    supporting_claims: [claim("product_type", descriptionId(reg), ["Fuse is the sales superintelligence platform for modern revenue teams."])],
    conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [], confidence: 0.9, reason: "",
  }),
};

const COMFY: Subject = {
  key: "https://www.linkedin.com/company/comfyui", name: "ComfyUI", domain: "comfy.org", rows: COMFY_ROWS, page: CUSTOMER_STORY,
  query: "Check 1 company: ComfyUI (https://www.linkedin.com/company/comfyui). It must be based in the US and must be B2B SaaS.",
  // f2af841d: no business-model claim — a product claim only.
  answer: (reg) => ({
    business_model: { value: "unknown", confidence: 0.5, claims: [] },
    company_fit: "review", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
    supporting_claims: [claim("product_type", pageId(reg, "https://comfy.org/pricing"), [
      "Access cloud-powered ComfyUI workflows with straightforward, usage-based pricing.", "Built for teams collaborating on workflows together.",
    ])],
    conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [], confidence: 0.6, reason: "",
  }),
};

// ── FUSE: EVERY MAP, ONE OUTCOME ─────────────────────────────────────────────

for (const [name, map] of Object.entries(FUSE_MAPS)) {
  Deno.test(`FUSE, map ${name}: /pricing reaches the grounder → accepted → proven b2b ai saas → ELIGIBLE`, async () => {
    const r = await chain(FUSE, map);
    // map → cache: the pricing page is read (held or hit), never lost
    assert(r.collected.pages_ok > 0, JSON.stringify(r.collected));
    assert(r.groundedPages.includes("https://fuseai.com/pricing"), r.groundedPages.join(", "));
    // web_page evidence → grounder
    assertEquals([r.outcome.skipped, r.outcome.decision, r.outcome.status], [null, "accepted", "proven"]);
    assertEquals(r.registry!.rejected_claims, []);
    // quote diagnostics: every quote, on the pricing page's web_page id
    const q = (r.bm!.assessment as { business_model_quotes: Array<{ claim_type: string; excerpt: string; evidence_id: string }> }).business_model_quotes;
    assertEquals(q.map((x) => [x.claim_type, x.excerpt]), [
      ["business_model", "Try Fuse for free to experience AI-powered sales."], ["business_model", "$200\n\nper month"],
      ["business_model", "50/seat"], ["business_model", "Used by sales & marketing professionals from 1,000+ startups and enterprises worldwide"],
      ["product_type", "Fuse is the sales superintelligence platform for modern revenue teams."],
    ], "production d6cd2ef2's quotes, exactly");
    assert(q.slice(0, 4).every((x) => x.evidence_id.startsWith("web_page:company_website:")), "the business-model quotes are the pricing page's");
    // business-model verdict → canonical eligibility
    assertEquals([r.bm!.value, r.bm!.status], ["b2b ai saas", "proven"]);
    assertEquals([r.industry, r.eligibility], [["pass", "pass"], "eligible"]);
  });
}

Deno.test("FUSE: the grounder is shown the same /pricing whatever the map — the outcome is a function of the cache, not of the map", async () => {
  const outcomes = [];
  for (const map of Object.values(FUSE_MAPS)) {
    const r = await chain(FUSE, map);
    outcomes.push([r.groundedPages.includes("https://fuseai.com/pricing"), r.outcome.decision, r.bm?.status, r.eligibility]);
  }
  assertEquals(new Set(outcomes.map((o) => JSON.stringify(o))).size, 1, JSON.stringify(outcomes));
});

Deno.test("FUSE, rerun 0553512c's map: /company is fetched (not answered by the /about 404) and /pricing is held", async () => {
  const r = await chain(FUSE, FUSE_MAPS["0553512c (no /pricing; /company)"]);
  assertEquals(r.fetched, ["https://fuseai.com/company"]);
  assertEquals([r.collected.pages_fetched, r.collected.pages_reused, r.collected.pages_known_missing], [1, 1, 0]);
});

// ── COMFYUI: THE SAME DETERMINISM, A DIFFERENT (HONEST) ANSWER ───────────────

for (const [name, map] of Object.entries(COMFY_MAPS)) {
  Deno.test(`COMFYUI, map ${name}: /pricing and /platform reach the grounder → no business-model claim → PENDING`, async () => {
    const r = await chain(COMFY, map);
    assert(r.groundedPages.includes("https://comfy.org/pricing") && r.groundedPages.includes("https://comfy.org/platform"), r.groundedPages.join(", "));
    assertEquals([r.outcome.decision, r.outcome.status, r.bm], [null, null, undefined], "the grounder named no business model");
    assertEquals(r.eligibility, "pending");
  });
}
