// EVIDENCE RUNNER (P2) — plan, fetch, extract, persist. Dependency-injected.
//
// The only module that spends. Everything it needs to reach the outside world
// arrives as a function, so the whole path is exercisable offline: the tests
// drive it with a fake fetcher and a fake model and assert on what it would
// have bought.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// It does not re-evaluate a company, touch the frontier, write a checkpoint,
// or change any qualification outcome. Those are P4 and P5. P2 collects
// evidence and stores it; nothing downstream reads it yet. That ordering is
// what makes this phase safe to run against a live mission: the worst case is
// pages bought and filed, never a decision changed by half-built machinery.
//
// ── THE BUDGET IS A CEILING, NOT A TARGET ──────────────────────────────────
//
// Three independent caps — companies per slice, pages per company, pages per
// run — because a single cap fails differently at each scale. A company with
// six plausible intents must not consume the run's whole allowance, and a pool
// of forty blocked candidates must not multiply into a hundred fetches.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EvidenceRequestV1, WebEvidencePage } from "./evidenceRequest.ts";
import type { EvidenceDebt } from "./webEvidenceDebt.ts";
import {
  buildEvidencePlannerInput,
  DEFAULT_PLANNER_BUDGET,
  parseEvidencePlanStrict,
  type PlannerBudget,
} from "./webEvidencePlanner.ts";
import {
  buildExtractionInput,
  parseExtractionStrict,
} from "./webEvidenceExtraction.ts";
import { looksLikeMissingPage, resolvePages, sameSite } from "./pageIntentResolver.ts";
import { toStoredRows, writeWebEvidence } from "./webEvidenceStore.ts";

export interface EvidenceRunBudget extends PlannerBudget {
  max_companies: number;
  /** Across the whole slice, all companies together. */
  max_pages_total: number;
}

export const DEFAULT_RUN_BUDGET: Readonly<EvidenceRunBudget> = Object.freeze({
  ...DEFAULT_PLANNER_BUDGET,
  max_companies: 5,
  max_pages_total: 30,
});

/** One page fetch. Implemented over the paid tool path by the caller. */
export type PageFetcher = (i: {
  url: string;
  request_id: string;
  company_key: string;
}) => Promise<{
  ok: boolean;
  /** Page text, when there is any. */
  markdown: string;
  /** The URL actually served, after redirects, when the provider reports one. */
  final_url?: string | null;
  status: "ok" | "empty" | "blocked" | "not_found" | "timeout";
  /** The provider's own HTTP status, when it reports one. Decides over the
   * content heuristic: a real 404 needs no guessing. */
  status_code?: number | null;
  provider_run_id?: string | null;
}>;

/**
 * Fresh pages already held for a site, keyed by page intent.
 *
 * THE CACHE READ THAT STOPS THE LOOP AT THE FETCH LAYER. The debt gate stops
 * the same company being re-raised; this stops the same PAGE being re-bought
 * when a different requirement, or a different mission, asks for it.
 */
export type CacheReader = (domain: string) => Promise<Map<string, {
  source_url: string;
  source_text: string;
  fetched_at: string;
  /** ok | empty | blocked | not_found | timeout. Only `ok` may be cited. */
  status: string;
}>>;

export interface EvidenceRunnerDeps {
  plan: (payload: Record<string, unknown>) => Promise<unknown>;
  extract: (payload: Record<string, unknown>) => Promise<unknown>;
  fetchPage: PageFetcher;
  /** Optional. Omitted, every page is bought — the pre-fix behaviour. */
  readCache?: CacheReader | null;
  db?: SupabaseClient | null;
  now?: () => string;
  log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface CompanyEvidenceOutcome {
  company_key: string;
  company_name: string | null;
  domain: string;
  requirement_id: string;
  pages_fetched: number;
  /** Served from cache. Free: no fetch, no credit, no ledger row. */
  pages_reused: number;
  /** Known absent from a previous attempt. Not bought, not evidence. */
  pages_known_missing: number;
  pages_ok: number;
  claims_kept: number;
  claims_rejected: number;
  /** The reason nothing was collected, when nothing was. */
  outcome:
    | "collected"
    | "no_pages_planned"
    | "site_unavailable"
    | "no_useful_pages"
    | "budget_exhausted";
}

export interface EvidenceRunReport {
  planned: number;
  companies: CompanyEvidenceOutcome[];
  pages_fetched: number;
  pages_reused: number;
  pages_known_missing: number;
  claims_kept: number;
  claims_rejected: number;
  rows_written: number;
  store_error: string | null;
  /** Planner entries that were refused, by reason. */
  plan_rejections: Record<string, number>;
  /** Extraction claims that were refused, by reason. */
  claim_rejections: Record<string, number>;
}

const EMPTY_REPORT: EvidenceRunReport = {
  planned: 0,
  companies: [],
  pages_fetched: 0,
  pages_reused: 0,
  pages_known_missing: 0,
  claims_kept: 0,
  claims_rejected: 0,
  rows_written: 0,
  store_error: null,
  plan_rejections: {},
  claim_rejections: {},
};

/**
 * Collect web evidence for a set of debts.
 *
 * NEVER THROWS. Every failure resolves to a reported outcome, because this runs
 * inside a mission that was working before it was called and must still be
 * working after.
 */
export async function runEvidenceCollection(i: {
  workspace_id: string;
  debts: readonly EvidenceDebt[];
  deps: EvidenceRunnerDeps;
  budget?: EvidenceRunBudget;
}): Promise<EvidenceRunReport> {
  const budget = i.budget ?? DEFAULT_RUN_BUDGET;
  const now = i.deps.now ?? (() => new Date().toISOString());
  const log = i.deps.log ?? (() => {});
  const debts = i.debts.slice(0, budget.max_companies);
  if (debts.length === 0) return { ...EMPTY_REPORT };

  const report: EvidenceRunReport = {
    ...EMPTY_REPORT,
    companies: [],
    plan_rejections: {},
    claim_rejections: {},
  };

  // ── ONE PLANNER CALL FOR THE WHOLE SLICE ──────────────────────────────────
  //
  // Batched deliberately: the planner reads a requirement and a list of
  // companies, and asking it once per company would multiply the cheapest part
  // of the loop by the size of the pool for no better answer.
  let requests: EvidenceRequestV1[] = [];
  try {
    const raw = await i.deps.plan(
      buildEvidencePlannerInput(debts) as unknown as Record<string, unknown>,
    );
    const parsed = parseEvidencePlanStrict(raw, debts, budget);
    requests = parsed.requests;
    for (const r of parsed.rejected) {
      report.plan_rejections[r.reason] = (report.plan_rejections[r.reason] ?? 0) + 1;
    }
  } catch (e) {
    log("evidence-plan-failed", { error: String(e) });
    return report;
  }
  report.planned = requests.length;

  // Companies the planner declined to plan for are reported, not researched.
  const plannedKeys = new Set(requests.map((r) => r.company_key));
  for (const d of debts) {
    if (plannedKeys.has(d.company_key)) continue;
    report.companies.push({
      company_key: d.company_key,
      company_name: d.company_name,
      domain: d.domain,
      requirement_id: d.requirement_id,
      pages_fetched: 0,
      pages_reused: 0,
      pages_known_missing: 0,
      pages_ok: 0,
      claims_kept: 0,
      claims_rejected: 0,
      outcome: "no_pages_planned",
    });
  }

  let pagesSpent = 0;

  for (const req of requests) {
    const debt = debts.find((d) => d.company_key === req.company_key)!;
    const outcome: CompanyEvidenceOutcome = {
      company_key: req.company_key,
      company_name: debt.company_name,
      domain: req.domain,
      requirement_id: req.requirement_id,
      pages_fetched: 0,
      pages_reused: 0,
      pages_known_missing: 0,
      pages_ok: 0,
      claims_kept: 0,
      claims_rejected: 0,
      outcome: "no_useful_pages",
    };

    if (pagesSpent >= budget.max_pages_total) {
      outcome.outcome = "budget_exhausted";
      report.companies.push(outcome);
      continue;
    }

    const allowance = Math.min(
      req.max_pages,
      budget.max_pages,
      budget.max_pages_total - pagesSpent,
    );
    const targets = resolvePages(req.domain, req.page_intents, allowance);
    if (targets.length === 0) {
      outcome.outcome = "no_pages_planned";
      report.companies.push(outcome);
      continue;
    }

    const pages: WebEvidencePage[] = [];

    // ── WHAT WE ALREADY HAVE, BEFORE WE BUY ANYTHING ──────────────────────
    let cached = new Map<string, {
      source_url: string; source_text: string; fetched_at: string; status: string;
    }>();
    if (i.deps.readCache) {
      try {
        cached = await i.deps.readCache(req.domain);
      } catch (e) {
        // A cache that cannot be read degrades to buying, never to failing.
        log("evidence-cache-read-failed", { domain: req.domain, error: String(e) });
      }
    }

    for (const t of targets) {
      const hit = cached.get(t.intent);
      if (hit) {
        // ── A KNOWN-ABSENT PAGE IS AN ANSWER, AND IT IS FREE ───────────────
        //
        // "We asked and it is not there" is as good a reason not to spend as a
        // successful fetch. Filtering these out of the cache is what made run
        // d3a79c32 buy diligencevault.com 16 times for 4 URLs.
        //
        // It is NOT evidence: no text, never shown to the extractor, and it
        // cannot make a company look investigated when nothing was learned.
        if (hit.status !== "ok" || !hit.source_text.trim()) {
          outcome.pages_known_missing++;
          report.pages_known_missing++;
          pages.push({
            url: hit.source_url,
            intent: t.intent,
            markdown: "",
            fetched_at: hit.fetched_at,
            // Narrowed against the vocabulary rather than cast: a status the
            // table somehow holds outside it becomes `empty`, which is the
            // conservative reading — we asked, we got nothing usable.
            status: (["empty", "blocked", "not_found", "timeout"] as const)
                .includes(hit.status as "empty" | "blocked" | "not_found" | "timeout")
              ? hit.status as "empty" | "blocked" | "not_found" | "timeout"
              : "empty",
          });
          log("evidence-cache-known-missing", {
            company: debt.company_name, url: hit.source_url,
            intent: t.intent, status: hit.status,
          });
          continue;
        }
        // FREE. No fetch, no credit, no ledger row. Counted separately from
        // `pages_fetched` so the telemetry cannot make reuse look like spend.
        outcome.pages_reused++;
        report.pages_reused++;
        pages.push({
          url: hit.source_url,
          intent: t.intent,
          markdown: hit.source_text,
          fetched_at: hit.fetched_at,
          status: "ok",
        });
        outcome.pages_ok++;
        log("evidence-cache-hit", {
          company: debt.company_name, url: hit.source_url, intent: t.intent,
        });
        continue;
      }

      let res;
      try {
        res = await i.deps.fetchPage({
          url: t.url,
          request_id: req.request_id,
          company_key: req.company_key,
        });
      } catch (e) {
        log("evidence-fetch-threw", { url: t.url, error: String(e) });
        res = { ok: false, markdown: "", status: "timeout" as const };
      }
      pagesSpent++;
      outcome.pages_fetched++;
      report.pages_fetched++;

      // ── THE REDIRECT GUARD ────────────────────────────────────────────
      //
      // A page that redirected off the company's own registrable domain is
      // not that company's page, whatever it says. Recorded as `blocked` so
      // the attempt is visible, and its text is discarded rather than read.
      const served = res.final_url ?? t.url;
      const offSite = !sameSite(req.domain, served);

      // ── A 200 THAT SAYS "NOT FOUND" IS NOT A PAGE ──────────────────────
      //
      // Sites answer 200 with a not-found body; run 40295080 stored three of
      // them as `ok`. Harmless while every slice re-fetched — durable false
      // evidence now that the cache is read.
      const missing = !offSite && res.ok &&
        looksLikeMissingPage(res.markdown, res.status_code);
      const status = offSite ? "blocked" : missing ? "not_found" : res.status;
      const usable = status === "ok" && !offSite && res.markdown.trim().length > 0;

      const fetched: WebEvidencePage = {
        url: t.url,
        intent: t.intent,
        markdown: usable ? res.markdown : "",
        fetched_at: now(),
        status,
      };
      pages.push(fetched);
      if (usable) outcome.pages_ok++;

      // ── PERSIST BEFORE THE NEXT FETCH, NOT AT THE END ──────────────────
      //
      // The write was batched once per company, after every page. A slice that
      // hit its deadline in between bought pages and lost them, and the next
      // slice bought them again because the cache had nothing to say.
      //
      // Lineage b1348724, `pump.co/about`, verbatim:
      //
      //     16:58:00  call started    -> never finalized, no row
      //     18:35:09  call succeeded  -> no row
      //     18:47:13  call succeeded  -> row written 18:47:16
      //
      // Three purchases of one page; 24 calls for 17 URLs across that run.
      //
      // This is the same interruption that leaves `status: started` rows in the
      // ledger — which I diagnosed as observability-only because they hold no
      // credits and block no sweeper. True, and incomplete: the same death also
      // loses the PAGE, and a lost page is a guaranteed re-buy.
      //
      // One page, one write, before anything else can be interrupted.
      if (i.deps.db) {
        const w = await writeWebEvidence(
          i.deps.db,
          toStoredRows({
            workspace_id: i.workspace_id,
            company_key: req.company_key,
            domain: req.domain,
            requirement_id: req.requirement_id,
            provider_run_id: res.provider_run_id ?? null,
            // Including the pages that are not there: "we asked and it is
            // absent" is what stops the next slice asking again.
            pages: [fetched],
          }),
        );
        report.rows_written += w.written;
        if (w.error) report.store_error = w.error;
      }

      log("evidence-fetch", {
        company: debt.company_name, url: t.url, intent: t.intent,
        status, off_site: offSite, missing_page: missing,
        chars: res.markdown.length,
      });

      if (pagesSpent >= budget.max_pages_total) break;
    }

    // Nothing readable came back. `site_unavailable` and `no_useful_pages` are
    // both ANSWERS — they resolve to insufficient_evidence downstream, never to
    // a failed requirement.
    if (outcome.pages_ok === 0) {
      outcome.outcome = pages.every((p) =>
          p.status === "timeout" || p.status === "not_found" || p.status === "blocked"
        )
        ? "site_unavailable"
        : "no_useful_pages";
    } else {
      try {
        const raw = await i.deps.extract(
          buildExtractionInput({
            question: req.research_question,
            company_name: debt.company_name,
            pages,
          }) as unknown as Record<string, unknown>,
        );
        const parsed = parseExtractionStrict(raw, {
          company_key: req.company_key,
          requirement_id: req.requirement_id,
          pages,
        });
        outcome.claims_kept = parsed.claims.length;
        outcome.claims_rejected = parsed.rejected.length;
        report.claims_kept += parsed.claims.length;
        report.claims_rejected += parsed.rejected.length;
        for (const r of parsed.rejected) {
          report.claim_rejections[r.reason] =
            (report.claim_rejections[r.reason] ?? 0) + 1;
        }
        outcome.outcome = parsed.claims.length > 0 ? "collected" : "no_useful_pages";
        log("evidence-claims", {
          company: debt.company_name,
          kept: parsed.claims.length,
          rejected: parsed.rejected.length,
          reasons: parsed.rejected.map((r) => r.reason),
        });
      } catch (e) {
        log("evidence-extract-failed", {
          company: debt.company_name, error: String(e),
        });
        outcome.outcome = "no_useful_pages";
      }
    }

    // Nothing to persist here: every page was written the moment it was
    // fetched, above. Batching to the end of the company is precisely where a
    // deadline lands, and what turned interrupted slices into repeat purchases.

    report.companies.push(outcome);
  }

  return report;
}
