// COMPANY BRAIN V2 · B2.1 — ONE ICP, AND WHAT TO DO WHEN THE COPIES DISAGREE.
//
// `target_customer` (+ `buyer_personas`, `pain_points`) is the authoritative ICP.
// Two other copies live in the same profile:
//   · `icp` — the legacy mirror. ATLAS (leadPipeline/brainContext.ts) and
//     pilot-chat read industries / stages / geography from it, so a STALE mirror
//     makes ATLAS plan against an ICP the user no longer holds.
//   · `signal_preferences` — the radar's watch list. Values the radar alone was
//     given are legitimate (companyBrainMirror keeps them); values that
//     CONTRADICT the ICP are not.
//
// This module only DETECTS and PROPOSES. Every resolution is an ordinary update
// patch for the authorized `update` path, whose mirror (companyBrainMirror.ts)
// rewrites the legacy copy in the same write — so applying a resolution can
// never itself leave the copies apart. Pure.
import { flattenDisqualifiers, normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";

export const ICP_CONSISTENCY_VERSION = "company-brain-icp-consistency-v1" as const;

type Raw = Record<string, unknown>;

export type IcpDimension = "industry" | "geography" | "size" | "buyer" | "disqualifier";
export type IcpConflictKind =
  /** The legacy mirror no longer matches target_customer (ATLAS reads the mirror). */
  | "projection_stale"
  /** target_customer contradicts itself (e.g. the same industry targeted and excluded). */
  | "contradiction"
  /** The radar watches something the ICP excludes, or outside the ICP's regions. */
  | "radar_drift";

export interface IcpResolution {
  id: string;
  label: string;
  /** An update patch for the authorized `update` action (UPDATABLE_KEYS only). */
  patch: Raw;
}

export interface IcpConflict {
  id: string;
  /** Assessment section it belongs to. */
  section: "target_customer" | "buyers" | "qualification";
  dimension: IcpDimension;
  kind: IcpConflictKind;
  message: string;
  paths: string[];
  /** What the authoritative ICP says, and what the other copy says. */
  authoritative: string[];
  other: string[];
  resolutions: IcpResolution[];
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
  : typeof v === "string" && v.trim() ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : [];
const key = (s: string) => s.trim().toLowerCase();
const sameSet = (a: string[], b: string[]) => {
  const A = new Set(a.map(key)), B = new Set(b.map(key));
  return A.size === B.size && [...A].every((x) => B.has(x));
};
const minus = (a: string[], b: string[]) => { const B = new Set(b.map(key)); return a.filter((x) => !B.has(key(x))); };
const both = (a: string[], b: string[]) => { const B = new Set(b.map(key)); return a.filter((x) => B.has(key(x))); };

/** Digits in a size label ("11-50", "51–200 employees", "5", "100+"). null when the label has no number. */
export function sizeFromLabel(label: string): { min: number | null; max: number | null } | null {
  const s = label.trim();
  const range = s.match(/(\d[\d,]*)\s*[-–—to]+\s*(\d[\d,]*)/i);
  const n = (x: string) => parseInt(x.replace(/,/g, ""), 10);
  if (range) return { min: n(range[1]), max: n(range[2]) };
  const plus = s.match(/(\d[\d,]*)\s*\+/);
  if (plus) return { min: n(plus[1]), max: null };
  const solo = s.match(/^\D*(\d[\d,]*)\D*$/);
  if (solo) return { min: n(solo[1]), max: n(solo[1]) };
  return null;
}
const sizeText = (min: number | null, max: number | null) =>
  min != null && max != null ? (min === max ? `${min}` : `${min}-${max}`) : min != null ? `${min}+` : max != null ? `up to ${max}` : "";

/** The full structured target_customer, as a patch that rewrites it (and, through the mirror, the legacy copy). */
function tcPatch(b: CompanyBrainV2, over: Partial<CompanyBrainV2["target_customer"]> = {}): Raw {
  const t = b.target_customer;
  return { target_customer: {
    industries: [...t.industries], business_models: [...t.business_models],
    company_size: { ...t.company_size }, funding_stage: [...t.funding_stage], geography: [...t.geography],
    must_have: [...t.must_have], nice_to_have: [...t.nice_to_have],
    disqualifiers: { ...t.disqualifiers, industries: [...t.disqualifiers.industries], titles: [...t.disqualifiers.titles] },
    ...over,
  } };
}

/** Detect every disagreement between the ICP copies of one stored profile. */
export function assessIcpConsistency(profile: Raw | null | undefined): { version: typeof ICP_CONSISTENCY_VERSION; conflicts: IcpConflict[] } {
  const raw: Raw = isObj(profile) ? profile : {};
  const b = normalizeCompanyBrain(raw);
  const t = b.target_customer;
  const rawTc = isObj(raw.target_customer) ? raw.target_customer : null;
  const icp = isObj(raw.icp) ? raw.icp : null;
  const prefs = isObj(raw.signal_preferences) ? raw.signal_preferences : null;
  const out: IcpConflict[] = [];
  const resync = (what: string): IcpResolution => ({
    id: "resync", label: `Update the copy lead search reads to match your ${what}`, patch: tcPatch(b),
  });

  // ── 1. CONTRADICTIONS INSIDE THE AUTHORITATIVE ICP ─────────────────────────
  const targetedAndExcluded = both(t.industries, t.disqualifiers.industries);
  if (targetedAndExcluded.length) {
    out.push({
      id: "industry_targeted_and_excluded", section: "qualification", dimension: "industry", kind: "contradiction",
      message: `${targetedAndExcluded.join(", ")} ${targetedAndExcluded.length === 1 ? "is" : "are"} both a target industry and a disqualifier.`,
      paths: ["target_customer.industries", "target_customer.disqualifiers.industries"],
      authoritative: targetedAndExcluded, other: targetedAndExcluded,
      resolutions: [
        { id: "keep_target", label: "Keep as a target industry", patch: tcPatch(b, { disqualifiers: { ...t.disqualifiers, industries: minus(t.disqualifiers.industries, targetedAndExcluded) } }) },
        { id: "keep_excluded", label: "Keep as a disqualifier", patch: tcPatch(b, { industries: minus(t.industries, targetedAndExcluded) }) },
      ],
    });
  }
  const personaExcluded = both(b.buyer_personas, t.disqualifiers.titles);
  if (personaExcluded.length) {
    out.push({
      id: "persona_title_excluded", section: "buyers", dimension: "buyer", kind: "contradiction",
      message: `${personaExcluded.join(", ")} ${personaExcluded.length === 1 ? "is" : "are"} both a buyer persona and an excluded title.`,
      paths: ["buyer_personas", "target_customer.disqualifiers.titles"],
      authoritative: personaExcluded, other: personaExcluded,
      resolutions: [
        { id: "keep_persona", label: "Keep as a buyer persona", patch: tcPatch(b, { disqualifiers: { ...t.disqualifiers, titles: minus(t.disqualifiers.titles, personaExcluded) } }) },
        { id: "keep_excluded", label: "Keep as an excluded title", patch: { buyer_personas: minus(b.buyer_personas, personaExcluded) } },
      ],
    });
  }
  const rawSize = rawTc && isObj(rawTc.company_size) ? rawTc.company_size : null;
  if (rawSize && typeof rawSize.label === "string" && (typeof rawSize.min === "number" || typeof rawSize.max === "number")) {
    const fromLabel = sizeFromLabel(rawSize.label);
    const min = typeof rawSize.min === "number" ? rawSize.min : null;
    const max = typeof rawSize.max === "number" ? rawSize.max : null;
    if (fromLabel && (fromLabel.min !== min || fromLabel.max !== max)) {
      out.push({
        id: "size_label_vs_bounds", section: "target_customer", dimension: "size", kind: "contradiction",
        message: `Company size says "${rawSize.label}" but the bounds lead search enforces are ${sizeText(min, max) || "empty"}.`,
        paths: ["target_customer.company_size"],
        authoritative: [sizeText(min, max)], other: [rawSize.label],
        resolutions: [
          { id: "use_bounds", label: `Use ${sizeText(min, max)} employees`, patch: tcPatch(b, { company_size: { min, max, label: sizeText(min, max) } }) },
          { id: "use_label", label: `Use ${sizeText(fromLabel.min, fromLabel.max)} employees`, patch: tcPatch(b, { company_size: { min: fromLabel.min, max: fromLabel.max, label: rawSize.label } }) },
        ],
      });
    }
  }

  // ── 2. THE LEGACY MIRROR (what ATLAS and pilot-chat read) ──────────────────
  // Only where the structured field exists: a legacy-only profile has no other truth.
  if (icp && rawTc) {
    if (Array.isArray(rawTc.industries) && !sameSet(strings(icp.industries ?? icp.industry), t.industries)) {
      out.push({
        id: "mirror_industries", section: "target_customer", dimension: "industry", kind: "projection_stale",
        message: "Lead search is reading an older list of target industries.",
        paths: ["target_customer.industries", "icp.industries"],
        authoritative: [...t.industries], other: strings(icp.industries ?? icp.industry), resolutions: [resync("target industries")],
      });
    }
    if (Array.isArray(rawTc.geography)) {
      const mirrored = typeof icp.geography === "string" ? icp.geography.trim() : strings(icp.geography)[0] ?? "";
      if (key(mirrored) !== key(t.geography[0] ?? "")) {
        out.push({
          id: "mirror_geography", section: "target_customer", dimension: "geography", kind: "projection_stale",
          message: "Lead search is reading an older geography.",
          paths: ["target_customer.geography", "icp.geography"],
          authoritative: [...t.geography], other: mirrored ? [mirrored] : [], resolutions: [resync("geography")],
        });
      }
    }
    if (rawSize) {
      const label = typeof rawSize.label === "string" ? rawSize.label.trim() : "";
      const min = typeof rawSize.min === "number" ? rawSize.min : null;
      const max = typeof rawSize.max === "number" ? rawSize.max : null;
      const expected = label || (min != null && max != null ? `${min}-${max} employees` : "");
      const mirrored = typeof icp.company_size === "string" ? icp.company_size.trim() : "";
      if (key(expected) !== key(mirrored)) {
        out.push({
          id: "mirror_size", section: "target_customer", dimension: "size", kind: "projection_stale",
          message: "Lead search is reading an older company size.",
          paths: ["target_customer.company_size", "icp.company_size"],
          authoritative: expected ? [expected] : [], other: mirrored ? [mirrored] : [], resolutions: [resync("company size")],
        });
      }
    }
    if (Array.isArray(raw.buyer_personas) && !sameSet(strings(icp.buyer_roles), b.buyer_personas)) {
      out.push({
        id: "mirror_personas", section: "buyers", dimension: "buyer", kind: "projection_stale",
        message: "Some agents are reading an older list of buyer roles.",
        paths: ["buyer_personas", "icp.buyer_roles"],
        authoritative: [...b.buyer_personas], other: strings(icp.buyer_roles),
        resolutions: [{ id: "resync", label: "Update the older copy to match your buyer personas", patch: { buyer_personas: [...b.buyer_personas] } }],
      });
    }
    if (isObj(rawTc.disqualifiers) && !sameSet(strings(icp.disqualifiers), flattenDisqualifiers(t.disqualifiers))) {
      out.push({
        id: "mirror_disqualifiers", section: "qualification", dimension: "disqualifier", kind: "projection_stale",
        message: "Some agents are reading an older list of disqualifiers.",
        paths: ["target_customer.disqualifiers", "icp.disqualifiers"],
        authoritative: flattenDisqualifiers(t.disqualifiers), other: strings(icp.disqualifiers), resolutions: [resync("disqualifiers")],
      });
    }
  }

  // ── 3. THE RADAR'S COPY ────────────────────────────────────────────────────
  if (prefs) {
    const prefIndustries = strings(prefs.industries);
    const watchedButExcluded = both(prefIndustries, t.disqualifiers.industries);
    if (watchedButExcluded.length) {
      out.push({
        id: "radar_watches_excluded_industry", section: "qualification", dimension: "industry", kind: "radar_drift",
        message: `Signal monitoring watches ${watchedButExcluded.join(", ")}, which your ICP excludes.`,
        paths: ["signal_preferences.industries", "target_customer.disqualifiers.industries"],
        authoritative: watchedButExcluded, other: watchedButExcluded,
        resolutions: [{ id: "stop_watching", label: "Stop watching them", patch: { signal_preferences: { ...prefs, industries: minus(prefIndustries, watchedButExcluded) } } }],
      });
    }
    const prefGeos = strings(prefs.geographies);
    const outside = t.geography.length ? minus(prefGeos, t.geography) : [];
    if (outside.length) {
      out.push({
        id: "radar_outside_geography", section: "target_customer", dimension: "geography", kind: "radar_drift",
        message: `Signal monitoring watches ${outside.join(", ")}, outside your target geography.`,
        paths: ["signal_preferences.geographies", "target_customer.geography"],
        authoritative: [...t.geography], other: outside,
        resolutions: [
          { id: "add_to_icp", label: "Add to your target geography", patch: tcPatch(b, { geography: [...t.geography, ...outside] }) },
          { id: "stop_watching", label: "Stop watching them", patch: { signal_preferences: { ...prefs, geographies: minus(prefGeos, outside) } } },
        ],
      });
    }
  }

  return { version: ICP_CONSISTENCY_VERSION, conflicts: out };
}

/**
 * B2.1 · WRITE GUARD. Would this already-merged update leave the authoritative
 * ICP contradicting itself in a way it did not before? Returns the conflicts
 * the update INTRODUCES (ids not present before). Projection drift is not
 * counted: the update path rewrites the mirror in the same write.
 */
export function introducedIcpContradictions(before: Raw | null | undefined, after: Raw): IcpConflict[] {
  const was = new Set(assessIcpConsistency(before).conflicts.map((c) => c.id));
  return assessIcpConsistency(after).conflicts.filter((c) => BLOCKING.has(c.id) && !was.has(c.id));
}
/**
 * The disagreements a write may not CREATE. Projection drift is excluded (the
 * update path rewrites the mirror in the same write), and so is the radar
 * watching regions outside the ICP — the radar may legitimately watch more
 * (companyBrainMirror keeps radar-only values); it is shown, not refused.
 */
const BLOCKING = new Set(["industry_targeted_and_excluded", "persona_title_excluded", "size_label_vs_bounds", "radar_watches_excluded_industry"]);

/**
 * B2.1 · The part of an AI `analyze` draft (setup-company-brain) that may be
 * written as-is. Once a Brain has a structured ICP, the model's legacy `icp`
 * block and its `competitors` list are unconfirmed opinions: writing them
 * would overwrite the copy ATLAS reads, and the person's confirmed
 * competitors. They stay in the response (the caller still sees the draft),
 * never in the stored profile.
 */
export function writableAnalyzeDraft(current: Raw | null | undefined, draft: Raw): Raw {
  const structured = isObj(current) && isObj(current.target_customer);
  if (!structured) return draft;
  const { icp: _icp, competitors: _competitors, target_customer: _tc, buyer_personas: _bp, ...rest } = draft;
  return rest;
}
