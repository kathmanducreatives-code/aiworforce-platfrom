// Radar signal enrichment + gating — the bridge that makes the tested intelligence
// contracts part of persistence. Runs on the scored `signals` insert rows just
// before they are written: applies hiring role-family + company exclusion, the
// canonical decision, the draft-outreach gate, tag hygiene, and stamps
// scan_run_id. PURE / Deno-testable — run-radar-scan stays a thin handler.

import type { RadarIntelligenceProfile } from "./radarIntelligenceProfile.ts";
import { classifyRoleFamily, classifyCompanyExclusion, buildHiringSignalView } from "./hiringRoleFamily.ts";
import { canonicalDecision, allowedAction, cleanLabel, dedupeTags, type CanonicalDecision } from "./radarDecision.ts";

/** The narrow slice of a `signals` insert row this module touches. */
export interface EnrichableRow {
  signal_type: string;
  signal_label?: string;
  title?: string;
  source_url?: string | null;
  raw: Record<string, unknown>;
}

export interface EnrichResult {
  kept: EnrichableRow[];
  dropped: { title: string; reason: string }[];
  rejection_reasons: Record<string, number>;
  decision_counts: Record<CanonicalDecision, number>;
}

function bump(m: Record<string, number>, k: string) { m[k] = (m[k] ?? 0) + 1; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function isHttpUrl(u: unknown): boolean { return /^https?:\/\/\S+/i.test(str(u).trim()); }

/**
 * Enrich + gate a batch of scored rows for one scan. Unrelated/excluded hiring
 * rows are DROPPED (never persisted as useful signals). Everything kept gets a
 * canonical decision, an allowed action, cleaned tags and the scan_run_id.
 */
export function enrichAndGateRows(
  rows: EnrichableRow[],
  intel: RadarIntelligenceProfile,
  scan_run_id: string,
): EnrichResult {
  const kept: EnrichableRow[] = [];
  const dropped: EnrichResult["dropped"] = [];
  const rejection_reasons: Record<string, number> = {};
  const decision_counts: Record<CanonicalDecision, number> = { contact: 0, watch: 0, needs_review: 0, skip: 0 };

  for (const row of rows) {
    const raw = row.raw ?? {};
    const details = (raw["source_details"] ?? {}) as Record<string, unknown>;
    const company = str(details["company"]) || str(raw["account_name"]) || str(raw["company"]) || null;
    const hasEvidence = isHttpUrl(row.source_url) || isHttpUrl(details["job_url"]);
    const verification = str(raw["verification_status"]);
    const isPersonOnly = !!raw["is_person_only"];

    let hardDisqualifier = Array.isArray(raw["disqualifiers_hit"]) && (raw["disqualifiers_hit"] as unknown[]).length > 0;
    let meaningful = true;

    // ---- hiring: role family + company exclusion ----
    if (row.signal_type === "hiring") {
      const role = str(details["job_title"]) || str(raw["job_title"]);
      const roleClass = classifyRoleFamily(role, intel);
      const exclusion = classifyCompanyExclusion(
        { text: [company, str(details["industries"]), str(details["location"])].filter(Boolean).join(" "), domain: str(details["company_domain"]), employee_count: (details["employee_count"] as number) ?? null },
        intel,
      );
      // Unrelated role or excluded company → drop; never persist as a useful signal.
      if (roleClass.family === "unrelated") { dropped.push({ title: row.title ?? role, reason: roleClass.reason }); bump(rejection_reasons, "unrelated_role"); continue; }
      if (exclusion.excluded) { dropped.push({ title: row.title ?? company ?? role, reason: exclusion.reason ?? "excluded company" }); bump(rejection_reasons, "excluded_company"); continue; }

      const view = buildHiringSignalView({ company, role, profile: intel, roleClass, exclusion });
      raw["role_family"] = roleClass.family;
      raw["headline"] = view.headline;
      raw["why_it_matters"] = view.why_it_matters;
      // Adjacent roles are watch at best; only exact can reach contact.
      if (roleClass.family === "adjacent") meaningful = true;
    }

    // ---- person-only rows are not verified market signals ----
    if (isPersonOnly) {
      raw["excluded_from_verified"] = true;
    }

    // ---- canonical decision ----
    const brainFit = !hardDisqualifier && (Array.isArray(raw["matched_icp"]) ? (raw["matched_icp"] as unknown[]).length > 0 : false)
      || row.signal_type === "hiring" && raw["role_family"] === "exact";
    const recent = !!raw["freshness_score"] && Number(raw["freshness_score"]) >= 6;
    // Adjacent hiring caps at watch: never let it reach contact.
    const capWatch = row.signal_type === "hiring" && raw["role_family"] === "adjacent";

    let decision: CanonicalDecision;
    if (isPersonOnly) { decision = "needs_review"; }
    else {
      const d = canonicalDecision({
        verified_company: !!company, brain_fit: !!brainFit, has_meaningful_signal: meaningful,
        evidence_url: row.source_url, recent, hard_disqualifier: hardDisqualifier,
        why_now: str(raw["why_now"]), decision_maker_present: !!raw["decision_maker_present"],
      }).decision;
      decision = capWatch && d === "contact" ? "watch" : d;
    }
    raw["canonical_decision"] = decision;
    bump(decision_counts, decision);

    // ---- draft-outreach gate ----
    const gate = allowedAction({
      decision, is_person_only: isPersonOnly, has_evidence_url: hasEvidence,
      verified_company: !!company, decision_maker_present: !!raw["decision_maker_present"],
    });
    raw["can_draft_outreach"] = gate.can_draft_outreach;
    raw["recommended_action"] = gate.action;

    // ---- tag hygiene + scan run ----
    if (Array.isArray(raw["tags"])) raw["tags"] = dedupeTags(raw["tags"] as (string | null)[]);
    if (row.signal_label) row.signal_label = cleanLabel(row.signal_label);
    raw["scan_run_id"] = scan_run_id;

    kept.push({ ...row, raw });
  }

  return { kept, dropped, rejection_reasons, decision_counts };
}
