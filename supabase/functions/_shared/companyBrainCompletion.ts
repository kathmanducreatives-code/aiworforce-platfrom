// COMPANY BRAIN V2 · B2.0 — GUIDED COMPLETION: SUGGESTIONS AND THE PATCHES THAT SAVE THEM.
//
// SUGGESTIONS cost nothing and invent nothing:
//   · "website research" — the onboarding research already stored in
//     `company_brain_research_runs` (no new Firecrawl/Apify call is made);
//   · "inferred from your Brain" — the deterministic, pure suggesters onboarding
//     already uses (companyBrainResearch/draftQuality.ts). No model call.
//   Goals and GTM have no honest source, so they get no suggestion.
//
// RULES (B2.0 acceptance):
//   · a suggestion is offered ONLY for a field that is EMPTY — anything a person
//     entered is never challenged or replaced by research;
//   · nothing persists until the person accepts it (the app sends the patch
//     built here through the authorized `update`, origin `manual_edit`);
//   · every suggestion names its source and, for research, the pages it rests on.
//
// The same `buildCompletionPatch` saves the completion editor's own fields, so a
// typed value and an accepted suggestion take exactly one path. Pure.
import { normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";
import { isFilled, readProfilePath, SECTION_SPECS, type AssessmentSectionKey } from "./companyBrainAssessment.ts";
import {
  suggestBuyerPersonas, suggestDisqualifiers, suggestQualificationRules, suggestTargetCustomer,
  suggestTriggers, suggestVoiceAndAngles, type PersonaContext,
} from "./companyBrainResearch/draftQuality.ts";

export const BRAIN_COMPLETION_VERSION = "company-brain-completion-v1" as const;

type Raw = Record<string, unknown>;
export type CompletionValue = string | string[];

export interface CompletionSuggestion {
  /** Stable for one profile + research state: `${path}:${source}`. */
  id: string;
  section: AssessmentSectionKey;
  path: string;
  label: string;
  value: CompletionValue;
  confidence: "low" | "medium" | "high";
  source: {
    kind: "website_research" | "brain_inference";
    /** What a person reads: "Your website research (16 Aug 2026)". */
    label: string;
    urls: string[];
    observed_at: string | null;
    /** B2.2: the stored research run this came from (website research only), when the run was read with its id. */
    run_id?: string;
    /** Why to double-check it, when there is a reason. */
    caution?: string;
  };
}

/** A stored research run, as `company_brain_research_runs` holds it. */
export interface StoredResearchRun {
  /** The run's id (B2.2 provenance links an accepted suggestion to it). */
  id?: string;
  source_type: string;
  status: string;
  output: unknown;
  created_at: string;
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(s).filter(Boolean) : [];
const uniq = (xs: string[]) => { const seen = new Set<string>(); return xs.filter((x) => { const k = x.toLowerCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; }); };
const sectionOf = (path: string): AssessmentSectionKey => {
  for (const spec of SECTION_SPECS) if (spec.fields.some((f) => f.path === path)) return spec.key;
  return path.startsWith("qualification_rules") ? "qualification" : "company";
};
const labelOf = (path: string) => SECTION_SPECS.flatMap((x) => x.fields).find((f) => f.path === path)?.label ?? path;

// ── PATCHES ────────────────────────────────────────────────────────────────

/**
 * Build an `update` patch that sets each changed path, preserving the rest of
 * its object. Only top-level keys the update path accepts are produced
 * (companyBrainUpdate UPDATABLE_KEYS). Lists are written as the full new list.
 */
export function buildCompletionPatch(profile: Raw | null | undefined, changes: Record<string, CompletionValue>): Raw {
  const raw: Raw = isObj(profile) ? profile : {};
  const b = normalizeCompanyBrain(raw);
  const patch: Raw = {};
  const objectFor = (top: string): Raw => {
    if (isObj(patch[top])) return patch[top] as Raw;
    const current = top === "target_customer" ? structuredClone(b.target_customer) as unknown as Raw
      : top === "positioning" ? { ...b.positioning } as unknown as Raw
      : top === "brand_voice" ? { ...b.brand_voice } as unknown as Raw
      : top === "qualification_rules" ? { ...b.qualification_rules } as unknown as Raw
      : top === "company" ? { ...b.company } as unknown as Raw
      // goals / gtm / evidence: only the changed fields. The server merges the
      // block shallowly, so unchanged fields (and any older keys) stay as stored.
      : {};
    patch[top] = current;
    return current;
  };
  for (const [path, value] of Object.entries(changes)) {
    const clean = Array.isArray(value) ? uniq(value.map(s).filter(Boolean)) : s(value);
    const parts = path.split(".");
    if (parts.length === 1) {
      const top = parts[0] === "competitors" ? competitorsKey(raw) : parts[0];
      patch[top] = clean;
      continue;
    }
    if (path === "target_customer.company_size") {
      const label = s(value);
      const m = label.replace(/,/g, "").match(/(\d+)\s*[-–to]+\s*(\d+)/);
      const tc = objectFor("target_customer");
      tc.company_size = m ? { min: Number(m[1]), max: Number(m[2]), label } : { min: null, max: null, label };
      continue;
    }
    if (path === "target_customer.disqualifiers") {
      // The flat list the assessment shows is the industry bucket; finer buckets keep their values.
      const tc = objectFor("target_customer");
      tc.disqualifiers = { ...(tc.disqualifiers as Raw), industries: clean };
      continue;
    }
    let obj = objectFor(parts[0]);
    for (const k of parts.slice(1, -1)) {
      obj[k] = isObj(obj[k]) ? { ...(obj[k] as Raw) } : {};
      obj = obj[k] as Raw;
    }
    obj[parts[parts.length - 1]] = clean;
  }
  return patch;
}

/** The patch that accepts one suggestion (optionally as the person edited it). List values are added to what is there. */
export function acceptSuggestionPatch(profile: Raw | null | undefined, sug: CompletionSuggestion, edited?: CompletionValue): Raw {
  const raw: Raw = isObj(profile) ? profile : {};
  const value = edited ?? sug.value;
  if (Array.isArray(value)) {
    const existing = arr(readNormalizedList(raw, sug.path));
    return buildCompletionPatch(raw, { [sug.path]: [...existing, ...value] });
  }
  return buildCompletionPatch(raw, { [sug.path]: value });
}

function readNormalizedList(raw: Raw, path: string): unknown {
  const b = normalizeCompanyBrain(raw) as unknown as Raw;
  if (path === "target_customer.disqualifiers") return (b.target_customer as Raw & { disqualifiers: Raw }).disqualifiers.industries;
  const fromNormalized = readProfilePath(b, path);
  return fromNormalized ?? readProfilePath(raw, path);
}

/** Same rule as the Brain page's editor (src/lib/companyBrainPatch.ts competitorsKey). */
function competitorsKey(raw: Raw): "competitors" | "competitors_v2" {
  if ("competitors_v2" in raw) return "competitors_v2";
  return raw.schema_version === 2 && (raw.competitors === undefined || Array.isArray(raw.competitors)) ? "competitors" : "competitors_v2";
}

// ── SUGGESTIONS ────────────────────────────────────────────────────────────

/** The latest completed run of one kind. */
function latest(runs: readonly StoredResearchRun[], type: string): StoredResearchRun | null {
  return [...runs].filter((r) => r.source_type === type && r.status === "completed" && isObj(r.output))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const ctxFromBrain = (b: CompanyBrainV2): PersonaContext => ({
  product_category: b.company.category ?? "", one_line_summary: b.company.description ?? "",
  primary_users: b.buyer_personas, key_features: b.positioning.use_cases, user_description: b.company.description ?? "",
});

/** Every suggestion for the EMPTY fields of this profile. Pure; no network. */
export function buildCompletionSuggestions(profile: Raw | null | undefined, research: readonly StoredResearchRun[] = []): CompletionSuggestion[] {
  const raw: Raw = isObj(profile) ? profile : {};
  const b = normalizeCompanyBrain(raw);
  const out: CompletionSuggestion[] = [];
  const empty = (path: string) => !isFilled(b, raw, path);
  const add = (path: string, value: CompletionValue, confidence: CompletionSuggestion["confidence"], source: CompletionSuggestion["source"]) => {
    if (!empty(path)) return;
    if (Array.isArray(value) ? value.length === 0 : !value) return;
    if (out.some((o) => o.path === path)) return; // research first; one suggestion per field
    out.push({ id: `${path}:${source.kind}`, section: sectionOf(path), path, label: labelOf(path), value, confidence, source });
  };

  // 1. Stored website research (already paid for at onboarding; read only).
  const web = latest(research, "company_website");
  if (web) {
    const o = web.output as Raw;
    const u = isObj(o.understanding) ? o.understanding as Raw : {};
    const urls = uniq([...arr(o.source_pages), ...((Array.isArray(o.evidence) ? o.evidence : []) as Raw[]).map((e) => s(isObj(e) ? e.url : ""))]).slice(0, 8);
    const ambiguous = o.ambiguous === true || u.ambiguous === true;
    const source = {
      kind: "website_research" as const, label: `Your website research (${day(web.created_at)})`, urls, observed_at: web.created_at,
      ...(typeof web.id === "string" && web.id ? { run_id: web.id } : {}),
      ...(ambiguous ? { caution: "The research found mixed signals on the site. Check before accepting." } : {}),
    };
    const conf = ambiguous ? "low" : "medium";
    add("company.description", s(o.description) || s(u.one_line_summary), conf, source);
    add("company.business_model", s(o.business_model) || s(u.business_model), conf, source);
    const promise = s(u.main_promise) || arr(o.positioning_claims)[0] || "";
    add("positioning.promise", promise, conf, source);
    add("positioning.differentiators", arr(o.positioning_claims).filter((c) => c !== promise).slice(0, 4), conf, source);
    add("positioning.proof_points", arr(o.proof_points).length ? arr(o.proof_points).slice(0, 4) : arr(u.proof_points).slice(0, 4), conf, source);
    const integrations = new Set([...arr(o.integrations), ...arr(u.integrations)].map((x) => x.toLowerCase()));
    add("competitors", arr(u.competitors_or_tools_mentioned).filter((c) => !integrations.has(c.toLowerCase())).slice(0, 6), "low",
      { ...source, caution: "Named on your website. Confirm each is a competitor, not a tool you work with." });
    add("evidence.source_pages", urls, "high", source);
  }

  // 2. Inferred from what the Brain already says (deterministic; onboarding's suggesters).
  const ctx = ctxFromBrain(b);
  const hasContext = !!(ctx.product_category || ctx.one_line_summary);
  if (hasContext) {
    const inferred = { kind: "brain_inference" as const, label: "Inferred from your company description", urls: [], observed_at: null,
      caution: "A starting point based on what you sell. Edit it to match your real buyers." };
    add("buyer_personas", suggestBuyerPersonas(ctx, "medium").map((p) => p.title).slice(0, 4), "medium", inferred);
    const voice = suggestVoiceAndAngles(ctx);
    add("pain_points", voice.pain_points.slice(0, 4), "medium", inferred);
    add("brand_voice.tone", voice.brand_voice.tone, "low", inferred);
    add("brand_voice.avoid", voice.brand_voice.avoid.slice(0, 5), "low", inferred);
    const triggers = suggestTriggers(ctx);
    add("triggers", triggers.triggers.slice(0, 4), "medium", inferred);
    add("jobs_to_watch", triggers.jobs_to_watch.slice(0, 4), "medium", inferred);
    const tc = suggestTargetCustomer(ctx);
    add("target_customer.industries", tc.industries.slice(0, 4), "low", inferred);
    const d = suggestDisqualifiers({
      product_category: ctx.product_category, business_model: b.company.business_model ?? "",
      target_industries: b.target_customer.industries, primary_users: ctx.primary_users, user_description: ctx.user_description,
    });
    add("target_customer.disqualifiers", d.industries.slice(0, 5), "low", inferred);
  }
  const rules = suggestQualificationRules({ hasIndustries: b.target_customer.industries.length > 0, hasTriggers: b.triggers.length > 0 || b.jobs_to_watch.length > 0 });
  const ruleSource = { kind: "brain_inference" as const, label: "Agentory's standard qualification rules", urls: [], observed_at: null,
    caution: "Generic rules. Tighten them for your market." };
  add("qualification_rules.reject_if", rules.reject_if.slice(0, 4), "medium", ruleSource);
  add("qualification_rules.required_evidence", rules.required_evidence.slice(0, 4), "medium", ruleSource);

  return out;
}
