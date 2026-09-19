// LEAD V2 — THE BUSINESS-MODEL VERIFIER: FIRST-PARTY PAGES, RE-GROUNDED.
//
// Plugs into the Claim Registry route `firecrawl / web_evidence`. The gap
// router decides WHEN a company needs it (a hard industry / business-model
// check still unknown, the route READY, not yet answered for this company);
// this buys what the claim needs and nothing else:
//
//   the company's own pages — product, pricing, customers, docs, about —
//   from the page cache when held, through the mission ledger when not
//        ↓
//   the canonical re-grounding: the registry rebuilt with those pages, the
//   grounder re-reads them, `businessModelDecision` decides the claim, and
//   the engine writes it under its stable evidence id
//
// WHAT IT NO LONGER ASKS. Which pages to buy used to be a planner model's
// answer to the legacy Brain's open question; which companies to research was
// the legacy Brain's evidence debt. The claim decides both now: the pages are
// the business-model intents, the companies are the canonical gaps.
//
// Every effect is injected (`collect`, `reground`), so the verifier is
// testable without Firecrawl, a model or a database.

import type { ClaimVerifier, VerificationTarget, VerifierFinding } from "./claimVerifier.ts";
import { requirementId, type PageIntent } from "./evidenceRequest.ts";
import type { EvidenceDebt } from "./webEvidenceDebt.ts";
import type { EvidenceRunBudget } from "./webEvidenceRunner.ts";

export const BUSINESS_MODEL_VERIFIER_KEY = "business_model_first_party_pages" as const;
export const BUSINESS_MODEL_ROUTE_ACTOR = "firecrawl" as const;
/** The pages that state what a company sells and to whom, in the order they are asked for. */
export const BUSINESS_MODEL_PAGE_INTENTS: readonly PageIntent[] = Object.freeze(
  ["product", "pricing", "customers", "docs", "about"] as PageIntent[],
);
/** Pages bought per company at most — the route's cost hint is three /scrape pages. */
export const BUSINESS_MODEL_MAX_PAGES = 3;
/** Companies per slice. One grounding call each. */
export const BUSINESS_MODEL_MAX_TARGETS = 5;

export interface PageCollection {
  /** Pages usable as evidence (bought or cached). */
  pages_ok: number;
  /** collected | no_pages_planned | site_unavailable | no_useful_pages | budget_exhausted | no_domain */
  outcome: string;
}

export interface RegroundResult {
  /** proven | plausible | disproven | null (nothing re-read). */
  status: string | null;
  decision: string | null;
  skipped: string | null;
}

export interface BusinessModelVerifierIO {
  /** Buy or reuse the claim's pages for these companies, through the ledger. */
  collect(targets: readonly VerificationTarget[], intents: readonly PageIntent[], maxPages: number):
    Promise<Record<string, PageCollection>>;
  /** Re-ground the canonical business-model claim on the stored pages; the engine writes it. */
  reground(companyKey: string): Promise<RegroundResult>;
}

export function businessModelVerifier(io: BusinessModelVerifierIO): ClaimVerifier {
  return {
    key: BUSINESS_MODEL_VERIFIER_KEY,
    claim: "business_model",
    route_actor: BUSINESS_MODEL_ROUTE_ACTOR,
    max_targets: BUSINESS_MODEL_MAX_TARGETS,
    async verify(targets, deps) {
      const findings: VerifierFinding[] = [];
      // NOT READY IS NO ANSWER. Nothing is bought and nothing is marked, so the
      // gap stays open for the day the route is.
      if (targets.length === 0 || !deps.ready(BUSINESS_MODEL_ROUTE_ACTOR)) return { findings, pending: [] };
      const withDomain = targets.filter((t) => !!t.domain);
      let collected: Record<string, PageCollection> = {};
      try {
        collected = withDomain.length > 0
          ? await io.collect(withDomain, BUSINESS_MODEL_PAGE_INTENTS, BUSINESS_MODEL_MAX_PAGES)
          : {};
      } catch (e) {
        // A collection that failed bought nothing we can cite; the claims stay
        // pending and UNMARKED, so a later slice may try again.
        deps.log("business_model_collect_failed", { error: String(e).slice(0, 200) });
        return { findings, pending: [] };
      }
      for (const t of targets) {
        const c = t.domain ? collected[t.company_key] ?? { pages_ok: 0, outcome: "no_pages_planned" }
          : { pages_ok: 0, outcome: "no_domain" };
        let r: RegroundResult = { status: null, decision: null, skipped: "no_pages" };
        if (c.pages_ok > 0) {
          try {
            r = await io.reground(t.company_key);
          } catch (e) {
            r = { status: null, decision: null, skipped: "ground_failed" };
            deps.log("business_model_reground_failed", { company_key: t.company_key, error: String(e).slice(0, 200) });
          }
        }
        // ANSWERED whatever the verdict: the pages were asked for (bought or
        // known absent), and asking again this mission returns the same pages.
        // The canonical item, when there is one, was written by the engine's
        // own re-grounding writer — not carried here, so it is written once.
        findings.push({
          company_key: t.company_key, item: null, answered: r.skipped !== "ground_failed",
          detail: {
            pages_ok: c.pages_ok, collection: c.outcome, status: r.status, decision: r.decision,
            skipped: r.skipped,
          },
        });
      }
      return { findings, pending: [] };
    },
  };
}

// ── THE PAGE REQUEST, DECIDED BY THE CLAIM ─────────────────────────────────
//
// The page runner (`runEvidenceCollection`) is reused unchanged for what it is
// good at — cache first, redirect guard, not-found detection, one ledger-bound
// page at a time, persisted before the next fetch. What it is TOLD to fetch no
// longer comes from a planner model reading a legacy Brain question: these two
// functions state it from the canonical claim.

/** One request per target: the claim, its question, the company's domain. */
export function claimPageDebts(targets: readonly VerificationTarget[]): EvidenceDebt[] {
  return targets.filter((t) => !!t.domain).map((t) => {
    const wanted = String(t.criterion.value ?? "the required business model");
    const question = `Is ${t.name ?? t.domain} ${wanted}? What does it sell, how is it delivered, and to whom?`;
    return {
      company_key: t.company_key, company_name: t.name, domain: String(t.domain),
      requirement_id: requirementId(`business_model:${wanted}`),
      open_question: question, known_evidence_types: [], match_score: 0,
    };
  });
}

/** The planner reply the runner parses — written by code, never by a model. */
export function claimPagePlan(debts: readonly EvidenceDebt[], intents: readonly PageIntent[]): Record<string, unknown> {
  return {
    plans: debts.map((d) => ({ company_key: d.company_key, research_question: d.open_question, page_intents: [...intents] })),
  };
}

/** Budget for the claim's pages: every intent may be asked, at most `maxPages` bought per company. */
export function claimPageBudget(targets: number, intents: readonly PageIntent[], maxPages: number): EvidenceRunBudget {
  return {
    max_pages: maxPages, max_intents: intents.length, freshness_window_hours: 720,
    max_companies: Math.max(1, targets), max_pages_total: Math.max(1, targets) * maxPages,
  };
}
