// sourceQuality: turn raw actor output into honest accept/reject/dedupe counts
// and a definitive process narrative. The adaptive loop (sourcingRetry) already
// validates + dedupes + caps; this module SURFACES those numbers (raw vs
// accepted vs persisted vs requested) and explains rejects, so the UI never
// shows "30 results" when accepted is 0 and "complete" when accepted is 0.

import { evaluateWorkflowStatus } from "./adaptiveWorkflow.ts";
import { keyForItem, type SourcedItem, type SourcingCriteria, type StrictConstraints, type AttemptRecord } from "./sourcingRetry.ts";

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
    if (c.role && title) {
      const roleRe = new RegExp(c.role.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (!roleRe.test(title) && !ROLE_WORDS.test(title)) { rejected.push({ item: it, reason: "wrong role" }); bump("wrong role"); continue; }
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
