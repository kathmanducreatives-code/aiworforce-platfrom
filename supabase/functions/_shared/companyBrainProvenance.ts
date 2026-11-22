// COMPANY BRAIN V2 · B2.2 — PROVENANCE: where each change to the business profile
// came from, decided by the SERVER.
//
// The browser may say what the person did ("I accepted suggestion X", "I chose
// this resolution"). It is a claim, never trusted as-is:
//
//   suggestion   re-derived here from the STORED research runs of this
//                workspace (read by the server, not sent by the browser). Only
//                when the patch is exactly what accepting that suggestion
//                produces does the revision say research (with the run id) or
//                ai_inference (a rule-based suggestion). Edited first → the
//                person's own words: founder, with the suggestion named in the
//                reason. No match → founder, and the claim is dropped.
//   resolution   re-derived from the ICP consistency check of the profile as
//                stored; only an exact match puts the conflict in the reason.
//   founder      the default for every edit a person makes in the app; an
//                optional reason in their own words.
//
// Nothing here invents a source, a verification or a confidence: an unmatched
// claim degrades to "a person typed it", which is what the server can prove.
// company_brain_provenanced_write then checks the research run id against the
// database (completed, same workspace) before the revision records it.
// Pure; no network.
import { acceptSuggestionPatch, buildCompletionSuggestions, type StoredResearchRun } from "./companyBrainCompletion.ts";
import { assessIcpConsistency } from "./companyBrainIcpConsistency.ts";
import type { BrainProvenance } from "./brainWriter.ts";
import { SECTION_SPECS, type AssessmentSectionKey } from "./companyBrainAssessment.ts";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the browser may claim about an update. Anything else is ignored. */
export type ProvenanceClaim =
  | { source: "founder"; reason?: string }
  | { source: "suggestion"; suggestion_id: string; edited?: boolean }
  | { source: "resolution"; conflict_id: string; resolution_id: string };

export function parseProvenanceClaim(v: unknown): ProvenanceClaim | null {
  if (!isObj(v)) return null;
  const str = (x: unknown, max = 200) => (typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null);
  if (v.source === "suggestion") {
    const id = str(v.suggestion_id);
    return id ? { source: "suggestion", suggestion_id: id, edited: v.edited === true } : null;
  }
  if (v.source === "resolution") {
    const c = str(v.conflict_id, 80), r = str(v.resolution_id, 80);
    return c && r ? { source: "resolution", conflict_id: c, resolution_id: r } : null;
  }
  if (v.source === "founder") {
    const reason = typeof v.reason === "string" ? v.reason.replace(/\s+/g, " ").trim().slice(0, 280) : "";
    return reason ? { source: "founder", reason } : { source: "founder" };
  }
  return null;
}

/** Order-independent JSON identity (patches are plain JSON). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export interface ResolvedProvenance extends BrainProvenance {
  /** True when the browser claimed more than the server could prove. */
  downgraded: boolean;
}

/**
 * Decide the provenance of one `update`. `runs` are this workspace's stored,
 * completed research runs as the SERVER read them (with ids).
 */
export function resolveUpdateProvenance(input: {
  profileBefore: Raw;
  patch: unknown;
  claim: ProvenanceClaim | null;
  runs: readonly StoredResearchRun[];
}): ResolvedProvenance {
  const founder = (reason: string | null, downgraded = false): ResolvedProvenance => ({ kind: "founder", ref: null, reason, downgraded });
  const c = input.claim;
  if (!c) return founder(null);
  if (c.source === "founder") return founder(c.reason ?? null);

  if (c.source === "resolution") {
    const conflict = assessIcpConsistency(input.profileBefore).conflicts.find((x) => x.id === c.conflict_id);
    const res = conflict?.resolutions.find((r) => r.id === c.resolution_id);
    if (!conflict || !res || canonicalJson(res.patch) !== canonicalJson(input.patch)) return founder(null, true);
    return founder(`Resolved a conflict: ${conflict.message} Chose "${res.label}".`.slice(0, 500));
  }

  const sug = buildCompletionSuggestions(input.profileBefore, input.runs).find((s) => s.id === c.suggestion_id);
  if (!sug) return founder(null, true);
  const from = sug.source.kind === "website_research" ? sug.source.label.replace(/^Your /, "your ") : `an Agentory suggestion (${sug.source.label.toLowerCase()})`;
  if (c.edited) return founder(`Edited from ${from} for ${sug.label.toLowerCase()}.`);
  if (canonicalJson(acceptSuggestionPatch(input.profileBefore, sug)) !== canonicalJson(input.patch)) return founder(null, true);
  if (sug.source.kind === "website_research") {
    const runId = sug.source.run_id ?? null;
    if (!runId || !UUID.test(runId)) return founder(`Accepted from ${from} for ${sug.label.toLowerCase()}.`, true);
    return { kind: "research", ref: runId, reason: `Accepted from ${from} for ${sug.label.toLowerCase()}.`, downgraded: false };
  }
  return { kind: "ai_inference", ref: null, reason: `Accepted ${from} for ${sug.label.toLowerCase()} without changes.`, downgraded: false };
}

// ── READING PROVENANCE BACK (the Brain page) ────────────────────────────────

export type RevisionSourceKind = BrainProvenance["kind"] | "system" | "backfill" | "unrecorded";

export interface ProvenanceRevision {
  revision: number;
  changed_sections: string[];
  actor_kind: string;
  actor_id: string | null;
  written_at: string;
  source_kind?: RevisionSourceKind | null;
  source_ref?: string | null;
  reason?: string | null;
  redacted_at?: string | null;
}

export interface SectionProvenance {
  kind: RevisionSourceKind;
  revision: number;
  at: string;
  actor_id: string | null;
  reason: string | null;
  research_run_id: string | null;
  memory_id: string | null;
  /** How many recorded changes touched this section (within the revisions read). */
  changes: number;
}

/**
 * The latest revision that changed any of `profileKeys`, per section. A revision
 * read without B2.2 columns (migration absent) is 'unrecorded'; V1's back-fill
 * is 'backfill' — both say honestly that no source was recorded.
 */
export function sectionProvenance(revisions: readonly ProvenanceRevision[], profileKeys: readonly string[]): SectionProvenance | null {
  const touching = [...revisions].filter((r) => (r.changed_sections ?? []).some((s) => profileKeys.includes(s)))
    .sort((a, b) => b.revision - a.revision);
  const r = touching[0];
  if (!r) return null;
  // actor_kind is itself recorded: a revision with no actor was the system, whatever era it is from.
  const kind: RevisionSourceKind = r.actor_kind === "backfill" ? "backfill"
    : r.actor_kind === "system" && (!r.source_kind || r.source_kind === "unrecorded") ? "system"
    : (r.source_kind ?? "unrecorded");
  return {
    kind, revision: r.revision, at: r.written_at, actor_id: r.actor_id, reason: r.reason ?? null,
    research_run_id: kind === "research" ? r.source_ref ?? null : null,
    memory_id: kind === "memory" ? r.source_ref ?? null : null,
    changes: touching.length,
  };
}

/**
 * Onboarding and draft saves (save_draft / activate) carry a change origin the
 * origin-aware save boundary has already validated. Only origins whose author is
 * known map to a source; the rest stay unrecorded rather than guessed.
 */
export function provenanceForOrigin(origin: string): BrainProvenance | null {
  switch (origin) {
    case "manual_edit": return { kind: "founder", reason: null };
    case "onboarding_seller_confirmation": return { kind: "founder", reason: "Confirmed during onboarding." };
    case "approved_refresh_suggestions": return { kind: "founder", reason: "Approved website-refresh suggestions after review." };
    case "automated_refresh": return { kind: "ai_inference", reason: "Automated draft: only empty fields were filled." };
    default: return null;
  }
}

/** Legacy copies and older keys that hold the same knowledge as a section. */
const EXTRA_KEYS: Partial<Record<AssessmentSectionKey, string[]>> = {
  company: ["company_name", "website_url", "short_description"],
  target_customer: ["icp"],
  competitors: ["competitors_v2"],
};

/** The top-level profile keys a section's knowledge lives in (what a revision's changed_sections names). */
export function sectionProfileKeys(section: AssessmentSectionKey): string[] {
  const spec = SECTION_SPECS.find((x) => x.key === section);
  const keys = new Set((spec?.fields ?? []).map((f) => f.path.split(".")[0]));
  for (const k of EXTRA_KEYS[section] ?? []) keys.add(k);
  return [...keys];
}
