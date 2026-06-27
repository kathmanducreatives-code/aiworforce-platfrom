// sourceQuality: turn raw actor output into honest accept/reject/dedupe counts
// and a definitive process narrative. The adaptive loop (sourcingRetry) already
// validates + dedupes + caps; this module SURFACES those numbers (raw vs
// accepted vs persisted vs requested) and explains rejects, so the UI never
// shows "30 results" when accepted is 0 and "complete" when accepted is 0.

import { evaluateWorkflowStatus } from "./adaptiveWorkflow.ts";
import { keyForItem, type SourcedItem, type SourcingCriteria, type StrictConstraints, type AttemptRecord } from "./sourcingRetry.ts";
import { SUPPORT_ROLE_RE, isSupportRoleText } from "./broaden.ts";

export type SourceQualityCounts = {
  raw_result_count: number;
  accepted_count: number;
  rejected_count: number;
  duplicate_count: number;
  persisted_count: number;
  requested_count: number;
  reject_reason_counts: Record<string, number>;
  status: "complete" | "partial" | "failed";
};

const ROLE_WORDS = /\b(gtm|go-to-market|sdr|bdr|sales|growth|account executive|ae|marketing|revops|founder|ceo|cto|engineer|developer|business development)\b/i;

// Founding / C-suite words that, as a row's title, describe a PERSON's current
// role — not an open job posting. In a jobs/hiring source such a row is profile
// data that leaked in, not a hiring signal. (Bare "founder" is intentionally NOT
// here: "Founder Associate" / "Founder's Office" are support roles and are
// rescued by the SUPPORT_ROLE_RE guard below.)
const PROFILE_TITLE_RE = /\b(co-?founder|ceo|cto|coo|cmo|cro|cfo|chief executive)\b/i;

/** jobs / hiring / company-account sources (rows are companies with openings). */
function isJobsLikeSource(c: SourcingCriteria): boolean {
  return /job|hiring|company|account/.test(String(c.source_type ?? ""));
}

export type Classified = {
  accepted: SourcedItem[];
  rejected: Array<{ item: SourcedItem; reason: string }>;
  duplicates: SourcedItem[];
  reject_reason_counts: Record<string, number>;
};

/**
 * Pure classifier mirroring sourcingRetry's accept rules but recording WHY each
 * item was rejected (for Insights). Same outcome as validateSourcingResults +
 * dedupe, with reasons attached.
 */
export function classifyResults(items: SourcedItem[], c: SourcingCriteria, strict: StrictConstraints): Classified {
  const accepted: SourcedItem[] = [];
  const rejected: Array<{ item: SourcedItem; reason: string }> = [];
  const duplicates: SourcedItem[] = [];
  const reasons: Record<string, number> = {};
  const seen = new Set<string>();
  const bump = (r: string) => { reasons[r] = (reasons[r] ?? 0) + 1; };

  for (const it of items ?? []) {
    const name = (it.name ?? it.company ?? "").toString().trim();
    if (!name) { rejected.push({ item: it, reason: "missing name/company" }); bump("missing name/company"); continue; }

    if (strict.location && c.location && it.location) {
      const re = new RegExp(c.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (!re.test(String(it.location))) { rejected.push({ item: it, reason: "wrong location (strict)" }); bump("wrong location (strict)"); continue; }
    }

    const title = (it.title ?? "").toString();
    const supportRequested = isSupportRoleText(c.role) || isSupportRoleText(c.category);
    const titleIsSupport = SUPPORT_ROLE_RE.test(title);

    if (c.role && title) {
      const roleRe = new RegExp(c.role.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const titleMatchesRole = roleRe.test(title);
      if (supportRequested) {
        // Assistant / founder-support search: the row must actually BE a
        // support-role hire (or explicitly match the requested role). A generic
        // founder/CEO/Sales title is NOT an assistant hiring signal — reject it
        // rather than filling the result with weak profile rows.
        if (!titleIsSupport && !titleMatchesRole) {
          rejected.push({ item: it, reason: "not an assistant/founder-support role" });
          bump("not an assistant/founder-support role");
          continue;
        }
      } else if (!titleMatchesRole && !ROLE_WORDS.test(title)) {
        rejected.push({ item: it, reason: "wrong role" }); bump("wrong role"); continue;
      }
    }

    // Defense-in-depth for jobs/hiring sources: a bare founder / co-founder /
    // C-suite title is a person's current role (profile data), not an open job
    // posting. Reject it unless the row also carries a support-role hire (e.g.
    // "Assistant to CEO", "EA to Founder"). Does NOT apply to people-profile
    // sources, where "founder"/"CEO" IS the requested persona.
    if (
      isJobsLikeSource(c) && title && PROFILE_TITLE_RE.test(title) && !titleIsSupport
      && !(c.role && new RegExp(c.role.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(title))
    ) {
      rejected.push({ item: it, reason: "profile title (founder/CEO), not a hiring signal" });
      bump("profile title (founder/CEO), not a hiring signal");
      continue;
    }

    const key = keyForItem(it);
    if (key && seen.has(key)) { duplicates.push(it); bump("duplicate"); continue; }
    if (key) seen.add(key);
    accepted.push(it);
  }

  return { accepted, rejected, duplicates, reject_reason_counts: reasons };
}

/** Top N reject reasons as "reason (n)" strings. */
export function topRejectReasons(counts: Record<string, number>, n = 3): string[] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([r, c]) => `${r} (${c})`);
}

/**
 * Derive the honest counts from the adaptive attempt log + accepted set.
 * raw = sum of per-attempt result_count; persisted == accepted (by contract).
 */
export function summarizeSourceQuality(opts: {
  attempts: Pick<AttemptRecord, "result_count" | "accepted_count">[];
  accepted_count: number;
  requested_count: number;
  duplicate_count?: number;
  reject_reason_counts?: Record<string, number>;
}): SourceQualityCounts {
  const raw = (opts.attempts ?? []).reduce((s, a) => s + (Number(a.result_count) || 0), 0);
  const accepted = Math.max(0, opts.accepted_count || 0);
  const dupes = Math.max(0, opts.duplicate_count ?? 0);
  const rejected = Math.max(0, raw - accepted - dupes);
  const evStatus = evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested: opts.requested_count, produced: accepted }).status;
  const status: "complete" | "partial" | "failed" =
    evStatus === "complete" || evStatus === "partial" ? evStatus : "failed";
  return {
    raw_result_count: raw,
    accepted_count: accepted,
    rejected_count: rejected,
    duplicate_count: dupes,
    persisted_count: accepted, // contract: persisted == accepted
    requested_count: opts.requested_count,
    reject_reason_counts: opts.reject_reason_counts ?? {},
    status,
  };
}

// ---- Outcome explanation + next actions (Workbench UX layer) ----

export type OutcomeReport = {
  status: "complete" | "partial" | "failed";
  outcome_line: string;
  quality_lines: string[];
  // Action ids the UI renders as pills. Order = priority.
  next_actions: string[];
};

/** Acceptance rate as an integer percent (0 when no raw results). */
export function acceptanceRate(counts: { raw_result_count: number; accepted_count: number }): number {
  if (!counts.raw_result_count) return 0;
  return Math.round((counts.accepted_count / counts.raw_result_count) * 100);
}

/**
 * Human "AI employee report" outcome + next-action pills, derived from the
 * honest counts. Complete/partial show forward actions; failed shows recovery
 * actions. `has_contacts` toggles find_contacts vs draft-ready actions.
 */
export function buildOutcomeReport(opts: {
  counts: SourceQualityCounts;
  requested: number;
  has_contacts?: boolean;
}): OutcomeReport {
  const { counts } = opts;
  const requested = opts.requested ?? counts.requested_count;
  const accepted = counts.accepted_count;

  const quality_lines: string[] = [
    `Scout reviewed ${counts.raw_result_count} raw result${counts.raw_result_count === 1 ? "" : "s"}.`,
  ];
  if (accepted > 0) quality_lines.push(`${accepted} ${accepted === 1 ? "was" : "were"} accepted as qualified opportunit${accepted === 1 ? "y" : "ies"}.`);
  if (counts.rejected_count > 0) quality_lines.push(`${counts.rejected_count} ${counts.rejected_count === 1 ? "was" : "were"} rejected.`);
  if (counts.duplicate_count > 0) quality_lines.push(`${counts.duplicate_count} duplicate${counts.duplicate_count === 1 ? "" : "s"} removed.`);
  const reasons = topRejectReasons(counts.reject_reason_counts, 1);
  if (reasons.length) quality_lines.push(`Main reject reason: ${reasons[0].replace(/\s*\(\d+\)$/, "")}.`);
  if (counts.raw_result_count > 0) quality_lines.push(`Acceptance rate: ${acceptanceRate(counts)}%.`);

  if (counts.status === "complete") {
    return {
      status: "complete",
      outcome_line: "Result: Complete — Scout met the requested count.",
      quality_lines,
      next_actions: opts.has_contacts
        ? ["rank", "draft_outreach", "export_csv", "done"]
        : ["find_contacts", "rank", "export_csv", "done"],
    };
  }
  if (counts.status === "partial") {
    return {
      status: "partial",
      outcome_line: `Result: Partial — Scout found ${accepted} of ${requested} requested opportunit${requested === 1 ? "y" : "ies"}.`,
      quality_lines,
      next_actions: ["broaden_search", "use_results", "find_contacts", "export_csv", "done"],
    };
  }
  return {
    status: "failed",
    outcome_line: "Result: No qualified matches — Scout reviewed results, but none matched closely enough.",
    quality_lines,
    next_actions: ["broaden_search", "edit_criteria", "change_source", "view_details", "done"],
  };
}

/** Definitive AI-employee process narrative for chat/activity (Phase 7). */
export function buildProcessNarrative(opts: {
  actor_label: string;
  counts: SourceQualityCounts;
  attempt_labels: string[];
  entity_label: string; // "accounts" | "contacts" | "signals"
  aria_ran: boolean;
}): string[] {
  const { counts } = opts;
  const lines: string[] = [];
  lines.push("Pilot planned the workflow.");
  lines.push("Scout created the actor input.");
  lines.push(`Scout ran ${opts.actor_label}.`);
  lines.push(`Scout reviewed ${counts.raw_result_count} raw result${counts.raw_result_count === 1 ? "" : "s"}.`);
  if (counts.accepted_count > 0) {
    lines.push(`Scout accepted ${counts.accepted_count} qualified ${opts.entity_label}.`);
    if (opts.attempt_labels.length > 1) {
      opts.attempt_labels.forEach((l, i) => lines.push(`Attempt ${i + 1}: ${l}`));
    }
    if (opts.aria_ran) lines.push(`Aria ranked ${counts.accepted_count} accepted ${opts.entity_label}.`);
    lines.push("Pilot opened the Workbench.");
  } else {
    lines.push(`Scout reviewed ${counts.raw_result_count} raw result${counts.raw_result_count === 1 ? "" : "s"}, but none matched closely enough.`);
    lines.push("Aria skipped because there were no accepted leads to rank.");
  }
  return lines;
}
