// P4 — FEEDING COLLECTED WEB EVIDENCE BACK INTO QUALIFICATION.
//
// P2 buys pages and files them. Nothing read them. This is the read.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// It does not run discovery, identity resolution, enrichment or hiring
// verification. Those verdicts were reached by providers this pass never
// consults, and re-running them to re-read a cached page would spend money to
// learn nothing. It does not buy a page: it reads `company_web_evidence`, and a
// company with no cached rows is simply not re-evaluated.
//
// So the only cost of this module is ONE model call per candidate that has both
// an unresolved requirement and evidence it has never been shown.
//
// ── WHY IT IS SAFE TO RE-DECIDE ────────────────────────────────────────────
//
// Requirements the first pass verified travel forward with their original
// citations (`mergeReevaluation`). A second pass cannot un-verify UK presence
// by forgetting to mention it. It can only settle what was open, or contradict
// something — and a contradiction is new information that should win.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildMissionReevaluationInput,
  mergeReevaluation,
  parseMissionEvaluationStrict,
  type MissionEvaluation,
  type MissionEvaluationInput,
} from "./missionEvaluation.ts";
import { readFreshPages } from "./webEvidenceStore.ts";
import { fingerprint, type EvidenceRegistry } from "./leadEvidenceRegistry.ts";

/**
 * WHAT THIS SECOND LOOK WAS. Durable, so the next slice knows it happened.
 *
 * ── THE WASTE THIS ENDS ────────────────────────────────────────────────────
 *
 * Lineage ab06540f made THIRTY-SEVEN re-evaluation calls for FIVE companies.
 * Metaview, Hebbia, Kody, Pump.co and DiligenceVault were each re-asked seven
 * or eight times, on the same pages, and every answer after the first was
 * identical to it — `resolved: []`, the same `still_open`, the same counts.
 *
 * The guard that should have stopped it compares the fetched pages against the
 * web_page items in `c.evidence_registry`. That registry is built by the
 * engine's `registryFor` for the FIRST pass, which runs before any page has
 * been bought and therefore passes no pages at all. So the set it compares
 * against is empty on every real candidate and the guard has never once fired
 * in production. Its unit test passes because the test hands in a registry
 * with pages in it — the one input production never produces.
 *
 * An in-memory guard could not have fixed it anyway. Each slice is a fresh
 * invocation restored from a checkpoint, so "have I already asked this?" has
 * to be a question the checkpoint can answer. `completed_operations` is the
 * engine's own durable per-company ledger of work already paid for, it is
 * already carried through the resume record, and it is validated as a plain
 * string list — so a new key survives a resume without a contract change.
 *
 * The key covers the PAGES, because they are the whole of what a second look
 * has that the first did not. A page arriving changes the key and the company
 * is asked again; nothing arriving means asking again buys a model call and no
 * information.
 */
export function reevaluationOperationKey(
  pages: ReadonlyArray<{ source_url: string }>,
): string {
  const urls = [...new Set(pages.map((p) => p.source_url))].sort();
  return `web_evidence_reevaluation:${fingerprint(urls)}`;
}

export type ReevalSkipReason =
  | "not_insufficient"
  | "no_open_requirement"
  | "no_cached_evidence"
  | "no_new_evidence"
  /**
   * The call was made and threw. NOT the same as "nothing new to ask".
   *
   * It shared `no_new_evidence` until that counter became the dedupe signal,
   * and a model outage then read as a run that had nothing left to look at.
   * A throw records no operation key either, so the next slice retries it.
   */
  | "reevaluation_failed"
  | "no_domain"
  | "budget_exhausted";

export interface ReevalOutcome {
  company_key: string;
  company_name: string | null;
  skipped: ReevalSkipReason | null;
  before: MissionEvaluation["decision"] | null;
  after: MissionEvaluation["decision"] | null;
  /** Requirements that moved from open to cited. */
  resolved: string[];
  /** Still unresolved after the second look. Expected to be common. */
  still_open: string[];
  /** Requirements carried forward untouched from the first pass. */
  carried: string[];
  /**
   * The merged verdict, for the caller to apply.
   *
   * RETURNED, not written onto the candidate. The first version mutated
   * `c.mission_evaluation` — but `run-agent` maps the engine's companies into
   * fresh object literals before calling this, so the mutation landed on a
   * throwaway and the verdict was computed and discarded. The live canary
   * logged Metaview as `qualified` while the checkpoint still held
   * `insufficient_evidence`.
   *
   * A module that decides must hand its decision back, not reach into whatever
   * object it happened to be given.
   */
  merged: MissionEvaluation | null;
  /**
   * The key the CALLER must record on the company when this ran.
   *
   * Handed back rather than written, for the same reason `merged` is: this
   * module decides and the caller owns persistence. Null on every skip.
   */
  operation_key: string | null;
  pages_used: number;
  /** Citations the verifier refused. A fabrication counter. */
  dropped_citations: number;
}

export interface ReevalReport {
  considered: number;
  reevaluated: number;
  outcomes: ReevalOutcome[];
  skip_counts: Record<string, number>;
  model_calls: number;
}

/** The minimum this needs from a company. Structural, to avoid importing the engine. */
export interface ReevalCandidate {
  key: string;
  company_name: string | null;
  domain: string | null;
  mission_evaluation: MissionEvaluation | null;
  /** The registry the engine already built for this company. */
  evidence_registry: EvidenceRegistry | null;
  /** The evaluator payload the first pass used, reused verbatim. */
  evaluation_input: MissionEvaluationInput | null;
  /**
   * The engine's durable ledger of work already done for this company.
   *
   * Carried through the checkpoint, so a slice that resumes knows which page
   * sets have already been asked about. See `reevaluationOperationKey`.
   */
  completed_operations?: readonly string[];
}

export interface ReevalDeps {
  db: SupabaseClient;
  workspace_id: string;
  /** One model call. Returns raw JSON or null. */
  reevaluate: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Rebuild the registry with the cached pages folded in. */
  rebuildRegistry: (
    companyKey: string,
    pages: ReadonlyArray<{
      source_url: string;
      page_intent: string;
      source_text: string;
      fetched_at: string | null;
    }>,
  ) => EvidenceRegistry;
  log?: (event: string, meta: Record<string, unknown>) => void;
  now?: number;
  /** Model calls allowed this slice. */
  max_companies?: number;
}

const EMPTY: ReevalReport = {
  considered: 0, reevaluated: 0, outcomes: [], skip_counts: {}, model_calls: 0,
};

/**
 * Re-evaluate candidates whose open requirements now have web evidence.
 *
 * NEVER THROWS. This runs inside a mission that was working before it was
 * called; a failure here leaves every prior verdict exactly as it was.
 */
export async function reevaluateWithWebEvidence(
  candidates: readonly ReevalCandidate[],
  deps: ReevalDeps,
): Promise<ReevalReport> {
  const log = deps.log ?? (() => {});
  const maxCompanies = deps.max_companies ?? 5;
  const report: ReevalReport = {
    ...EMPTY, outcomes: [], skip_counts: {}, model_calls: 0,
  };
  const skip = (c: ReevalCandidate, reason: ReevalSkipReason) => {
    report.skip_counts[reason] = (report.skip_counts[reason] ?? 0) + 1;
    report.outcomes.push({
      company_key: c.key, company_name: c.company_name, skipped: reason,
      before: c.mission_evaluation?.decision ?? null, after: null,
      resolved: [], still_open: [], carried: [], merged: null,
      operation_key: null, pages_used: 0,
      dropped_citations: 0,
    });
  };

  for (const c of candidates) {
    report.considered++;
    const prior = c.mission_evaluation;

    // Only an unresolved verdict is worth a second look. A qualified company
    // needs nothing; a rejected one was answered.
    if (!prior || prior.decision !== "insufficient_evidence") {
      skip(c, "not_insufficient");
      continue;
    }
    if (prior.unknown_fields.length === 0) { skip(c, "no_open_requirement"); continue; }
    if (!c.domain) { skip(c, "no_domain"); continue; }
    if (!c.evaluation_input) { skip(c, "no_cached_evidence"); continue; }
    if (report.model_calls >= maxCompanies) { skip(c, "budget_exhausted"); continue; }

    // ── THE CACHE IS THE ONLY SOURCE. NO FETCH HAPPENS HERE. ──────────────
    let cached;
    try {
      cached = await readFreshPages(deps.db, {
        workspace_id: deps.workspace_id, domain: c.domain, now: deps.now,
      });
    } catch (e) {
      log("reeval-cache-failed", { company: c.company_name, error: String(e) });
      skip(c, "no_cached_evidence");
      continue;
    }

    // A `not_found` row records that we asked and the page is absent. It stops a
    // fetch; it is not something the evaluator can read.
    const pages = [...cached.values()]
      .filter((p) => p.status === "ok" && p.source_text.trim().length > 0)
      .map((p) => ({
        source_url: p.source_url,
        page_intent: p.page_intent,
        source_text: p.source_text,
        fetched_at: p.fetched_at,
      }));

    if (pages.length === 0) { skip(c, "no_cached_evidence"); continue; }

    // Nothing the first pass has not already seen. Re-asking the same question
    // of the same evidence buys a model call and no information.
    const known = new Set(
      (c.evidence_registry?.items ?? [])
        .filter((it) => it.evidence_type === "web_page")
        .map((it) => it.source_url ?? ""),
    );
    if (pages.every((p) => known.has(p.source_url))) {
      skip(c, "no_new_evidence");
      continue;
    }

    // ── AND THE SAME QUESTION IS NOT RE-ASKED ACROSS SLICES ───────────────
    //
    // The check above is in-memory and per-invocation. This one is the durable
    // half: it is what stopped ab06540f asking five companies the same question
    // thirty-seven times. See `reevaluationOperationKey`.
    const operationKey = reevaluationOperationKey(pages);
    if (c.completed_operations?.includes(operationKey)) {
      skip(c, "no_new_evidence");
      continue;
    }

    const registry = deps.rebuildRegistry(c.key, pages);
    const payload = buildMissionReevaluationInput({
      base: { ...c.evaluation_input },
      prior,
      // The registry the model is SHOWN must be the one it is asked about.
      registry,
    });

    let raw: unknown = null;
    try {
      report.model_calls++;
      raw = await deps.reevaluate(payload as unknown as Record<string, unknown>);
    } catch (e) {
      log("reeval-model-failed", { company: c.company_name, error: String(e) });
      skip(c, "reevaluation_failed");
      continue;
    }

    // The SAME strict parser as the first pass, against the SAME registry the
    // model was shown — so a citation to an evidence_id that is not there is
    // dropped here exactly as it would have been on the first pass.
    const parsed = parseMissionEvaluationStrict(raw, registry);
    // ── WHICH EVIDENCE IS ACTUALLY NEW ──────────────────────────────────
    //
    // The first pass's registry is the reference. A requirement it left open
    // cannot close on an item it already had — that is a re-reading, not new
    // evidence. With no prior registry there is nothing to compare against, so
    // nothing is held back on this ground.
    const priorIds = c.evidence_registry
      ? new Set(c.evidence_registry.items.map((it) => it.evidence_id))
      : null;
    const pageIntentFor = (id: string): string | null => {
      const it = registry.items.find((x) => x.evidence_id === id);
      const pi = (it?.metadata ?? {})["page_intent"];
      return typeof pi === "string" ? pi : null;
    };
    const merged = mergeReevaluation(
      prior, parsed.evaluation, pageIntentFor,
      priorIds ? (id: string) => !priorIds.has(id) : undefined,
    );

    const resolved = prior.unknown_fields.filter((u) =>
      !merged.unknown_fields.includes(u)
    );
    const carried = prior.matched_requirements
      .map((m) => m.requirement)
      .filter((r) => merged.matched_requirements.some((m) => m.requirement === r));

    report.reevaluated++;
    report.outcomes.push({
      company_key: c.key,
      company_name: c.company_name,
      skipped: null,
      before: prior.decision,
      after: merged.decision,
      resolved,
      still_open: merged.unknown_fields,
      carried,
      merged,
      operation_key: operationKey,
      pages_used: pages.length,
      dropped_citations: parsed.raw_shape.dropped_citations.length,
    });

    log("reeval-decided", {
      company: c.company_name,
      before: prior.decision, after: merged.decision,
      resolved, still_open: merged.unknown_fields,
      carried: carried.length, pages: pages.length,
      dropped_citations: parsed.raw_shape.dropped_citations.length,
    });

    // The caller owns persistence AND application: this module decides, and
    // hands the decision back on the outcome above.
  }

  return report;
}
