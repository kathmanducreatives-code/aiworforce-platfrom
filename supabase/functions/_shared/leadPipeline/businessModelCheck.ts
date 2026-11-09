// PROPORTIONATE BUSINESS-MODEL VERIFICATION for the lead pipeline (MRLE Phase 1).
//
// REUSES THE PRODUCTION DECISION, BUILDS NO SECOND VERIFIER. The company's own pages go into
// the existing evidence registry (leadEvidenceRegistry `web_pages`), the existing grounded
// classifier reads them, `verifyGroundedResult` drops every quote that is not a substring of a
// fetched page, and `groundedBusinessModelItem` (shared with leadCapabilityEngine) turns the
// surviving claim into the ONE evidence item the eligibility engine weighs:
//   accepted → proven (can pass — or, through the controlled vocabulary, fail — a hard rule)
//   review   → plausible (shown, never proof: the requirement stays pending)
//
// PROPORTIONATE, NOT A CRAWL:
//   * only companies already passing every other REQUIRED check and open ONLY on the business
//     model are read — a disproven company never costs a page;
//   * at most 3 first-party pages each (home, about, customers), listed exactly (depth 0):
//     no link following;
//   * one batched page run for all of them, bounded by the step's approved worst case;
//   * as many as the requested count still needs (overfetch ×1.5), never more.
//
// Every effect is injected: `fetchPages` (Apify website crawler in production, a fake in
// tests) and `ground` (the grounded classifier model). Pure apart from them.

import { buildEvidenceRegistry, type EvidenceRegistry } from "../leadEvidenceRegistry.ts";
import { COMPANY_EVIDENCE_VERSION, type CompanyEvidenceRecord } from "../leadCompanyEvidence.ts";
import type { GroundedVerification } from "../groundedClaims.ts";
import { groundedBusinessModelItem } from "../groundedBusinessModel.ts";
import { matchBusinessModel } from "../businessModelMatch.ts";
import type { EvidenceItem } from "../candidateObservation.ts";
import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import { canonicalDomain } from "./identity.ts";

export const WEBSITE_PAGES_ACTOR_KEY = "apify_website_content" as const;
export const BUSINESS_MODEL_PAGES_PER_COMPANY = 3;

export interface WebPage { companyKey: string; url: string; intent: "home" | "about" | "customers"; text: string; fetchedAt: string }
export interface PageFetch { pages: WebPage[]; runId: string | null; spentUsd: number; stopped: string | null }
export type PageFetcher = (targets: readonly { companyKey: string; domain: string }[], opts: { maxUsd: number; idempotencyKey: string }) => Promise<PageFetch>;
export type Grounder = (registry: EvidenceRegistry, company: { name: string | null; domain: string }) => Promise<GroundedVerification | null>;

/** What the Workbench shows about a company's business model. */
export type BusinessModelStatus = "verified_b2b" | "likely_b2b" | "mixed" | "unknown" | "not_b2b";
export interface BusinessModelFinding {
  companyKey: string;
  status: BusinessModelStatus;
  /** The company's own words the decision rests on, and where they were read. */
  quote: string | null; url: string | null; fetchedAt: string | null;
  reason: string;
  item: EvidenceItem | null;
}

/** The exact first-party pages read for one company (no link following). */
export function businessModelPages(domain: string): { url: string; intent: WebPage["intent"] }[] {
  const d = canonicalDomain(domain);
  if (!d) return [];
  return [{ url: `https://${d}/`, intent: "home" }, { url: `https://${d}/about`, intent: "about" }, { url: `https://${d}/customers`, intent: "customers" }];
}

/**
 * The status a business-model evidence item supports for a REQUIRED "B2B" (or other model)
 * requirement. Never stronger than the item: a `review` grounding is at most "likely".
 */
export function businessModelStatus(required: string, item: EvidenceItem | null): BusinessModelStatus {
  if (!item) return "unknown";
  const accepted = (item.assessment as { business_model_decision?: string } | undefined)?.business_model_decision === "accepted";
  const facets = ((item.assessment as { business_model_facets?: string[] } | undefined)?.business_model_facets ?? []).map(String);
  const match = matchBusinessModel(required, item.value);
  const consumerToo = facets.some((f) => /consumer|b2c|d2c/i.test(f)) && facets.some((f) => /business|b2b|enterprise|team/i.test(f));
  // CONTRADICTED IS NEVER "LIKELY": the company's own words name consumers and businesses, or
  // its quote argues against the reading (`self_description_*`, groundedClaims
  // excerptInconsistency) — mixed, accepted or not. Only an UNcontradicted, unconfirmed reading
  // (e.g. low confidence, a quote that does not state the audience) can be likely.
  const reasons = ((item.assessment as { business_model_reasons?: string[] } | undefined)?.business_model_reasons ?? []).map(String);
  if (consumerToo || reasons.some((r) => r.startsWith("self_description_"))) return "mixed";
  if (accepted && match === "pass") return "verified_b2b";
  if (accepted && match === "fail") return "not_b2b";
  if (!accepted && match === "pass") return "likely_b2b";
  return "unknown";
}

/** A minimal evidence record for the registry: identity and the company's own description. */
function evidenceRecord(c: { companyKey: string; name: string | null; domain: string; linkedinUrl: string | null; description: string | null }): CompanyEvidenceRecord {
  return {
    version: COMPANY_EVIDENCE_VERSION, company_key: c.companyKey, company_name: c.name, domain: c.domain, linkedin_company_url: c.linkedinUrl,
    identity_state: "resolved", geography_evidence: null, size_band_evidence: null, size_band_from_company_record: false,
    linkedin_member_count_evidence: null, industry_evidence: [], description: c.description, source_query: null,
    source_capability: "job_discovery", commercial_job_evidence: [], strongest_signal: null, evidence_urls: [], missing_fields: [], conflicting_evidence: [],
  } as CompanyEvidenceRecord;
}

export interface BusinessModelTarget { companyKey: string; name: string | null; domain: string; linkedinUrl: string | null; description: string | null }

export async function checkBusinessModels(
  targets: readonly BusinessModelTarget[], required: string,
  io: { fetchPages: PageFetcher; ground: Grounder },
  opts: { maxUsd: number; idempotencyKey: string; missionId: string | null; now: () => Date },
): Promise<{ findings: BusinessModelFinding[]; spentUsd: number; stopped: string | null; runId: string | null }> {
  if (!targets.length) return { findings: [], spentUsd: 0, stopped: null, runId: null };
  let fetched: PageFetch;
  try {
    fetched = await io.fetchPages(targets.map((t) => ({ companyKey: t.companyKey, domain: t.domain })), { maxUsd: opts.maxUsd, idempotencyKey: opts.idempotencyKey });
  } catch (e) {
    // A failed page run cites nothing: every company stays unknown (pending), nothing is retried.
    return { findings: targets.map((t) => ({ companyKey: t.companyKey, status: "unknown", quote: null, url: null, fetchedAt: null, reason: "the website could not be read", item: null })),
      spentUsd: 0, stopped: `website pages failed (${(e as Error)?.name ?? "error"}); not retried`, runId: null };
  }
  const at = opts.now().toISOString();
  const findings: BusinessModelFinding[] = [];
  for (const t of targets) {
    const pages = fetched.pages.filter((p) => p.companyKey === t.companyKey && p.text.trim());
    if (!pages.length) { findings.push({ companyKey: t.companyKey, status: "unknown", quote: null, url: null, fetchedAt: null, reason: "no readable first-party page", item: null }); continue; }
    const registry = buildEvidenceRegistry({
      evidence: evidenceRecord(t),
      web_pages: pages.map((p) => ({ source_url: p.url, page_intent: p.intent, source_text: p.text.slice(0, 6000), fetched_at: p.fetchedAt })),
      now: opts.now().getTime(),
    });
    let grounded: GroundedVerification | null = null;
    try { grounded = await io.ground(registry, { name: t.name, domain: t.domain }); } catch { grounded = null; }
    const item = grounded ? groundedBusinessModelItem({ key: t.companyKey, grounded, evidence_registry: registry }, opts.missionId, at) : null;
    const status = businessModelStatus(required, item);
    const quote = item?.source.excerpt ?? null;
    const url = item?.source.url ?? null;
    findings.push({
      companyKey: t.companyKey, status, quote, url, fetchedAt: url ? pages.find((p) => p.url === url)?.fetchedAt ?? null : null,
      reason: !grounded ? "the pages were read but not grounded (model unavailable): unknown"
        : !item ? "the company's own pages do not say what it sells or to whom"
        : status === "verified_b2b" ? "the company's own page states it sells to businesses"
        : status === "likely_b2b" ? "the pages suggest business customers, but the statement was not strong enough to verify"
        : status === "mixed" ? "the company's own pages name both business and consumer customers"
        : status === "not_b2b" ? "the company's own pages describe a consumer business"
        : "the pages do not settle the business model",
      item,
    });
  }
  return { findings, spentUsd: fetched.spentUsd, stopped: fetched.stopped, runId: fetched.runId };
}

/**
 * The production page fetcher: ONE Apify Website Content Crawler run for every target,
 * the exact page list (depth 0, no link following), plain HTTP (cheerio), through the
 * pipeline's ledgered invoker (reserve before spend, no retry, single use per key).
 */
export function apifyPageFetcher(invoke: ActorInvoker | null, now: () => Date): PageFetcher {
  return async (targets, opts) => {
    if (!invoke) return { pages: [], runId: null, spentUsd: 0, stopped: "apify_unavailable" };
    const listed = targets.flatMap((t) => businessModelPages(t.domain).map((p) => ({ ...p, companyKey: t.companyKey, host: canonicalDomain(t.domain)! })));
    if (!listed.length) return { pages: [], runId: null, spentUsd: 0, stopped: null };
    const run = await invoke(WEBSITE_PAGES_ACTOR_KEY, {
      startUrls: listed.map((p) => ({ url: p.url })), crawlerType: "cheerio", maxCrawlDepth: 0, maxCrawlPages: listed.length,
      maxResults: listed.length, saveMarkdown: false, saveHtml: false, removeCookieWarnings: true,
    }, { maxItems: Math.min(100, listed.length), idempotencyKey: opts.idempotencyKey });
    const at = now().toISOString();
    const pages: WebPage[] = [];
    for (const raw of run.items) {
      const r = (raw ?? {}) as { url?: string; text?: string; crawl?: { loadedUrl?: string; httpStatusCode?: number } };
      const url = String(r.crawl?.loadedUrl ?? r.url ?? "");
      if ((r.crawl?.httpStatusCode ?? 200) >= 400 || !r.text) continue;
      const host = canonicalDomain(url);
      // THE COMPANY'S OWN SITE ONLY: a page that redirected to another host is not its words.
      const owner = listed.find((p) => p.host === host && (p.url === r.url || url.replace(/\/$/, "").endsWith(new URL(p.url).pathname.replace(/\/$/, ""))))
        ?? listed.find((p) => p.host === host);
      if (!owner) continue;
      pages.push({ companyKey: owner.companyKey, url, intent: owner.intent, text: String(r.text), fetchedAt: at });
    }
    return { pages, runId: run.runId ?? null, spentUsd: run.chargedUsd ?? 0, stopped: null };
  };
}

/**
 * The production grounder: the SAME routed model call and validation the production engine's
 * grounded binding makes (groundedBrainBinding.ts) — payload, classifier prompt, strict parse,
 * every quote re-checked against the pages. A model failure is null (unknown), never a pass.
 */
export function modelGrounder(generate: import("../intelligence/plannerWrapper.ts").GenerateJsonFn, originalUserQuery: string | null = null): Grounder {
  return async (registry) => {
    const { buildGroundedClassifierPayload, GROUNDED_CLASSIFIER_PROMPT, parseGroundedResult, verifyGroundedResult } = await import("../groundedClaims.ts");
    const payload = buildGroundedClassifierPayload({ registry, originalUserQuery, requiresCommercialSignal: false });
    const res = await generate({ systemPrompt: GROUNDED_CLASSIFIER_PROMPT, messages: [{ role: "user", content: JSON.stringify(payload) }] } as never);
    const raw = (res as { ok?: boolean; json?: unknown })?.ok ? (res as { json?: unknown }).json : null;
    if (raw === null || raw === undefined) return null;
    return verifyGroundedResult({ registry, result: parseGroundedResult(raw), requiresCommercialSignal: false });
  };
}
