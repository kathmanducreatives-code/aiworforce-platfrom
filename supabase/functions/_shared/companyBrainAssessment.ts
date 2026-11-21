// COMPANY BRAIN V2 · B2.0 — WHAT THE BRAIN ACTUALLY KNOWS, SECTION BY SECTION.
//
// WHY THIS EXISTS
//   `missing_fields` and readiness answer one narrow question: "can this Brain
//   be ACTIVATED?" (companyBrainCompleteness: 8 activation slots). The live
//   Brain passes it — `missing_fields: []` — while goals, positioning, brand
//   voice, competitors, qualification rules, GTM and evidence are all empty
//   (V2 audit, §0). Every agent reads that half-empty Brain as "complete".
//
//   This module is the truthful view: every section the workforce uses, whether
//   it is REQUIRED business information or OPTIONAL enrichment, and what is
//   missing, incomplete, conflicting or unverified in it.
//
// WHAT IT DOES NOT DO
//   It gates nothing. Activation (companyBrainCompleteness) and per-capability
//   readiness (companyBrainReadiness) are unchanged, so no feature that works
//   today is blocked by a section this module calls incomplete.
//
// One copy for the server and the app (the app imports this file; its imports
// carry `.ts`, which the app's tsconfig allows). Pure — no DB, no network.
import { normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";

export const BRAIN_ASSESSMENT_VERSION = "company-brain-assessment-v1" as const;

type Raw = Record<string, unknown>;

/** The sections of the Brain, in the order a person completes them. */
export type AssessmentSectionKey =
  | "company" | "target_customer" | "buyers" | "goals" | "positioning" | "qualification"
  | "signals" | "competitors" | "brand_voice" | "gtm" | "evidence" | "examples";

/** Which existing editor fixes it (the Brain page's drawer), or the completion editor. */
export type SectionEditor =
  | { kind: "drawer"; section: "company" | "targeting" | "buyers" | "signals" | "disqualifiers" | "messaging" }
  | { kind: "completion" };

export interface AssessmentField {
  /** Profile path as stored, e.g. "goals.gtm", "positioning.promise", "competitors". */
  path: string;
  label: string;
  type: "text" | "list";
  /** Placeholder / helper shown in the editor. */
  hint?: string;
}

export interface SectionSpec {
  key: AssessmentSectionKey;
  title: string;
  /** Who uses it, in one line a person understands. */
  used_by: string;
  tier: "required" | "optional";
  /** Fields that make the section COMPLETE (all present). */
  fields: AssessmentField[];
  /** Fields a section needs at least one of to stop being MISSING; defaults to `fields`. */
  any_of?: string[];
  /** How many of `fields` make it COMPLETE; defaults to all of them. */
  complete_min?: number;
  editor: SectionEditor;
}

/** Profile paths whose `type` is text vs list — single source for editors and patches. */
export const SECTION_SPECS: readonly SectionSpec[] = [
  {
    key: "company", title: "Company profile", used_by: "Every agent — who you are and what you sell", tier: "required",
    fields: [
      { path: "company.name", label: "Company name", type: "text" },
      { path: "company.description", label: "What you do", type: "text" },
      { path: "company.business_model", label: "Business model", type: "text", hint: "e.g. B2B SaaS, agency, marketplace" },
    ],
    editor: { kind: "drawer", section: "company" },
  },
  {
    key: "target_customer", title: "Target customer (ICP)", used_by: "ATLAS lead search, LISA signals, ORION ranking", tier: "required",
    fields: [
      { path: "target_customer.industries", label: "Target industries", type: "list" },
      { path: "target_customer.geography", label: "Geography", type: "list" },
      { path: "target_customer.company_size", label: "Company size", type: "text" },
    ],
    any_of: ["target_customer.industries", "target_customer.business_models"],
    editor: { kind: "drawer", section: "targeting" },
  },
  {
    key: "buyers", title: "Buyer personas", used_by: "ATLAS decision-makers, LYRA messaging", tier: "required",
    fields: [
      { path: "buyer_personas", label: "Buyer personas", type: "list" },
      { path: "pain_points", label: "Pain points you solve", type: "list" },
    ],
    editor: { kind: "drawer", section: "buyers" },
  },
  {
    key: "goals", title: "Business goals", used_by: "ORION priorities and weekly brief ranking", tier: "required",
    fields: [
      { path: "goals.gtm", label: "Go-to-market goal", type: "text", hint: "e.g. 10 qualified meetings a month" },
      { path: "goals.outreach", label: "Outreach goal", type: "text" },
      { path: "goals.content", label: "Content goal", type: "text" },
      { path: "goals.competitor_tracking", label: "Competitor-tracking goal", type: "text" },
      { path: "goals.hiring", label: "Hiring goal", type: "text" },
    ],
    any_of: ["goals.gtm", "goals.outreach", "goals.content", "goals.competitor_tracking", "goals.hiring"],
    // Not every company has a hiring or content goal: two stated goals is a complete answer.
    complete_min: 2,
    editor: { kind: "completion" },
  },
  {
    key: "positioning", title: "Positioning & offer", used_by: "LYRA content and outreach, ORION recommendations", tier: "required",
    fields: [
      { path: "positioning.promise", label: "Core promise", type: "text" },
      { path: "positioning.offer", label: "Offer", type: "text" },
      { path: "positioning.differentiators", label: "Differentiators", type: "list" },
    ],
    any_of: ["positioning.promise", "positioning.offer"],
    editor: { kind: "drawer", section: "messaging" },
  },
  {
    key: "qualification", title: "Qualification rules", used_by: "ATLAS qualification — who to reject or review", tier: "required",
    fields: [
      { path: "target_customer.disqualifiers", label: "Disqualifiers", type: "list" },
      { path: "qualification_rules.reject_if", label: "Reject if", type: "list" },
      { path: "qualification_rules.required_evidence", label: "Required evidence", type: "list" },
    ],
    any_of: ["target_customer.disqualifiers", "qualification_rules.reject_if", "qualification_rules.required_evidence", "qualification_rules.manual_review_if"],
    editor: { kind: "drawer", section: "disqualifiers" },
  },
  {
    key: "signals", title: "Buying signals", used_by: "LISA signal monitoring", tier: "required",
    fields: [
      { path: "triggers", label: "Triggers", type: "list" },
      { path: "jobs_to_watch", label: "Jobs to watch", type: "list" },
    ],
    any_of: ["triggers", "jobs_to_watch"],
    editor: { kind: "drawer", section: "signals" },
  },
  {
    key: "competitors", title: "Competitors", used_by: "ORION competitor matching, LISA, LYRA (never claim to be them)", tier: "optional",
    fields: [{ path: "competitors", label: "Competitors", type: "list" }],
    editor: { kind: "drawer", section: "company" },
  },
  {
    key: "brand_voice", title: "Brand voice", used_by: "LYRA content and drafts", tier: "optional",
    fields: [
      { path: "brand_voice.tone", label: "Tone", type: "text" },
      { path: "brand_voice.style_rules", label: "Style rules", type: "list" },
      { path: "brand_voice.avoid", label: "Words and claims to avoid", type: "list" },
    ],
    any_of: ["brand_voice.tone", "brand_voice.tags", "brand_voice.style_rules", "brand_voice.avoid"],
    editor: { kind: "drawer", section: "messaging" },
  },
  {
    key: "gtm", title: "Go-to-market", used_by: "ORION recommendations and channel choices", tier: "optional",
    fields: [
      { path: "gtm.motion", label: "Sales motion", type: "text", hint: "e.g. founder-led sales, outbound, PLG" },
      { path: "gtm.primary_channel", label: "Primary channel", type: "text" },
      { path: "gtm.biggest_bottleneck", label: "Biggest bottleneck", type: "text" },
      { path: "gtm.thirty_day_goal", label: "30-day goal", type: "text" },
    ],
    any_of: ["gtm.motion", "gtm.primary_channel", "gtm.biggest_bottleneck", "gtm.thirty_day_goal"],
    editor: { kind: "completion" },
  },
  {
    key: "evidence", title: "Evidence & sources", used_by: "Every agent — what the Brain's claims rest on", tier: "optional",
    fields: [
      { path: "evidence.source_pages", label: "Source pages", type: "list", hint: "URLs that back your claims" },
      { path: "evidence.confidence_notes", label: "Notes on what is verified", type: "list" },
    ],
    any_of: ["evidence.source_pages", "evidence.linkedin_sources"],
    editor: { kind: "completion" },
  },
  {
    key: "examples", title: "Fit examples", used_by: "ATLAS ranking — companies like these", tier: "optional",
    fields: [
      { path: "positive_examples", label: "Good-fit examples", type: "list" },
      { path: "negative_examples", label: "Bad-fit examples", type: "list" },
    ],
    any_of: ["positive_examples", "negative_examples"],
    editor: { kind: "drawer", section: "targeting" },
  },
];

/** Fields the completion editor writes (sections whose editor is `completion`). */
export const COMPLETION_EDITOR_FIELDS: readonly AssessmentField[] =
  SECTION_SPECS.filter((s) => s.editor.kind === "completion").flatMap((s) => s.fields);

export type SectionStatus = "complete" | "incomplete" | "missing";

/**
 * A disagreement found in the stored profile, attached to the section it
 * belongs to. Produced by the ICP consistency check (B2.1,
 * companyBrainIcpConsistency.ts) and passed in, so this module stays the
 * neutral view of completeness.
 */
export interface AssessmentConflict {
  id: string;
  section: AssessmentSectionKey;
  message: string;
  paths: string[];
}

export interface SectionIssue {
  kind: "conflicting" | "unverified";
  message: string;
  /** Profile paths involved. */
  paths: string[];
}

export interface SectionAssessment {
  key: AssessmentSectionKey;
  title: string;
  used_by: string;
  tier: "required" | "optional";
  status: SectionStatus;
  filled: string[];
  missing: Array<{ path: string; label: string }>;
  issues: SectionIssue[];
  editor: SectionEditor;
}

export interface BrainAssessment {
  version: typeof BRAIN_ASSESSMENT_VERSION;
  sections: SectionAssessment[];
  required: { complete: number; total: number };
  optional: { complete: number; total: number };
  /** 0..100: required sections carry 75%, optional 25%; incomplete counts half. */
  score: number;
  /** "foundation" = required incomplete; "core" = required complete; "enriched" = everything complete. */
  stage: "foundation" | "core" | "enriched";
  conflicts: number;
  unverified: number;
  /** The first required section that is not complete, then the first optional one. */
  next: AssessmentSectionKey | null;
  /** The Brain is an AI draft no one has activated yet. */
  is_draft: boolean;
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const list = (v: unknown) => Array.isArray(v) && v.some((x) => str(x));

/** Read a stored path. Goals and GTM exist only in the raw profile (not in CompanyBrainV2). */
export function readProfilePath(raw: Raw, path: string): unknown {
  let cur: unknown = raw;
  for (const k of path.split(".")) cur = isObj(cur) ? cur[k] : undefined;
  return cur;
}

/** Is a path filled, reading the NORMALIZED Brain where it models the path, else the raw profile. */
export function isFilled(b: CompanyBrainV2, raw: Raw, path: string): boolean {
  switch (path) {
    case "company.name": return str(b.company.name);
    case "company.description": return str(b.company.description) || str(b.company.website_url);
    case "company.business_model": return str(b.company.business_model);
    case "target_customer.industries": return b.target_customer.industries.length > 0;
    case "target_customer.business_models": return b.target_customer.business_models.length > 0;
    case "target_customer.geography": return b.target_customer.geography.length > 0;
    case "target_customer.company_size": {
      const s = b.target_customer.company_size;
      return s.min != null || s.max != null || str(s.label);
    }
    case "target_customer.disqualifiers": {
      const d = b.target_customer.disqualifiers;
      return [d.industries, d.company_types, d.domains, d.keywords, d.titles].some((x) => x.length > 0);
    }
    case "buyer_personas": return b.buyer_personas.length > 0;
    case "pain_points": return b.pain_points.length > 0;
    case "triggers": return b.triggers.length > 0;
    case "jobs_to_watch": return b.jobs_to_watch.length > 0;
    case "competitors": return b.competitors.length > 0;
    case "positive_examples": return b.positive_examples.length > 0;
    case "negative_examples": return b.negative_examples.length > 0;
    case "positioning.promise": return str(b.positioning.promise);
    case "positioning.offer": return str(b.positioning.offer);
    case "positioning.differentiators": return b.positioning.differentiators.length > 0;
    case "positioning.proof_points": return b.positioning.proof_points.length > 0;
    case "qualification_rules.reject_if": return b.qualification_rules.reject_if.length > 0;
    case "qualification_rules.required_evidence": return b.qualification_rules.required_evidence.length > 0;
    case "qualification_rules.manual_review_if": return b.qualification_rules.manual_review_if.length > 0;
    case "brand_voice.tone": return str(b.brand_voice.tone);
    case "brand_voice.tags": return b.brand_voice.tags.length > 0;
    case "brand_voice.style_rules": return b.brand_voice.style_rules.length > 0;
    case "brand_voice.avoid": return b.brand_voice.avoid.length > 0;
    case "evidence.source_pages": return b.evidence.source_pages.length > 0;
    case "evidence.linkedin_sources": return b.evidence.linkedin_sources.length > 0;
    case "evidence.confidence_notes": return b.evidence.confidence_notes.length > 0;
    default: {
      const v = readProfilePath(raw, path);
      return str(v) || list(v);
    }
  }
}

function sectionIssues(spec: SectionSpec, b: CompanyBrainV2, conflicts: readonly AssessmentConflict[]): SectionIssue[] {
  const issues: SectionIssue[] = [];
  for (const c of conflicts) {
    if (c.section === spec.key) issues.push({ kind: "conflicting", message: c.message, paths: c.paths });
  }
  // UNVERIFIED — only where the stored data says so (the profile has no per-field origin):
  //  · proof points are claims; with no source page or LinkedIn source on record, nothing backs them;
  //  · a Brain that is still an un-activated AI draft has had none of its content confirmed.
  if (spec.key === "positioning" && b.positioning.proof_points.length > 0 &&
      b.evidence.source_pages.length === 0 && b.evidence.linkedin_sources.length === 0) {
    issues.push({ kind: "unverified", message: "Proof points have no source on record. Add the page that backs them.", paths: ["positioning.proof_points", "evidence.source_pages"] });
  }
  if (b.is_draft && spec.tier === "required") {
    issues.push({ kind: "unverified", message: "Drafted by AI and not confirmed yet.", paths: spec.fields.map((f) => f.path) });
  }
  return issues;
}

/** Assess a stored profile. Pure. `conflicts` come from the ICP consistency check (B2.1). */
export function assessCompanyBrain(profile: Raw | null | undefined, opts: { conflicts?: readonly AssessmentConflict[] } = {}): BrainAssessment {
  const raw: Raw = isObj(profile) ? profile : {};
  const b = normalizeCompanyBrain(raw);
  const conflicts = opts.conflicts ?? [];

  const sections: SectionAssessment[] = SECTION_SPECS.map((spec) => {
    const filled = spec.fields.filter((f) => isFilled(b, raw, f.path)).map((f) => f.path);
    const anyOf = spec.any_of ?? spec.fields.map((f) => f.path);
    const started = anyOf.some((p) => isFilled(b, raw, p));
    const needed = spec.complete_min ?? spec.fields.length;
    const status: SectionStatus = !started ? "missing" : filled.length >= needed ? "complete" : "incomplete";
    return {
      key: spec.key, title: spec.title, used_by: spec.used_by, tier: spec.tier, status, filled,
      // A complete section lists nothing as missing, even when optional fields of it are empty.
      missing: status === "complete" ? [] : spec.fields.filter((f) => !filled.includes(f.path)).map((f) => ({ path: f.path, label: f.label })),
      issues: sectionIssues(spec, b, conflicts),
      editor: spec.editor,
    };
  });

  const tierCount = (t: "required" | "optional") => {
    const of = sections.filter((s) => s.tier === t);
    return { complete: of.filter((s) => s.status === "complete").length, total: of.length };
  };
  const required = tierCount("required");
  const optional = tierCount("optional");
  const credit = (t: "required" | "optional") => {
    const of = sections.filter((s) => s.tier === t);
    return of.reduce((n, s) => n + (s.status === "complete" ? 1 : s.status === "incomplete" ? 0.5 : 0), 0) / of.length;
  };
  const score = Math.round(credit("required") * 75 + credit("optional") * 25);
  const stage = required.complete < required.total ? "foundation"
    : optional.complete < optional.total ? "core" : "enriched";
  const next = (sections.find((s) => s.tier === "required" && s.status !== "complete")
    ?? sections.find((s) => s.tier === "optional" && s.status !== "complete"))?.key ?? null;

  return {
    version: BRAIN_ASSESSMENT_VERSION, sections, required, optional, score, stage,
    conflicts: sections.reduce((n, s) => n + s.issues.filter((i) => i.kind === "conflicting").length, 0),
    unverified: sections.reduce((n, s) => n + s.issues.filter((i) => i.kind === "unverified").length, 0),
    next, is_draft: b.is_draft,
  };
}
