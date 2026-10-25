// The Company Brain section edit contract: the editable state of one section,
// and the partial `company_brain.profile` patch that state saves as.
//
// Moved verbatim out of CompanyBrainEditDrawer so the drawer and the page's
// inline editors share ONE builder — an inline chip edit writes exactly the
// patch the drawer would have written for the same change. Each section maps
// to a fixed set of top-level profile keys; the parent shallow-merges the patch
// onto the raw profile, so fields a section does not render are never touched.

import type { CompanyBrainV2 } from './normalizeCompanyBrain';
import type { BrainProfile } from './companyBrainView';
import type { SectionKey } from './companyBrainHealth';

/** A section's editable values, keyed by the field names below. */
export type SectionState = Record<string, unknown>;

export function initialFor(section: SectionKey, b: CompanyBrainV2): SectionState {
  switch (section) {
    case 'company': return {
      name: b.company.name, website_url: b.company.website_url, category: b.company.category,
      description: b.company.description, business_model: b.company.business_model,
      stage: b.company.stage, team_size: b.company.team_size,
      competitors: [...b.competitors],
      tools: [...b.tools],
      founder_name: b.founder.name, founder_role: b.founder.role, founder_background: b.founder.background,
      founder_linkedin_url: b.founder.linkedin_url, founder_credibility: [...b.founder.credibility_signals],
    };
    case 'targeting': return {
      industries: [...b.target_customer.industries],
      business_models: [...b.target_customer.business_models],
      geography: [...b.target_customer.geography],
      must_have: [...b.target_customer.must_have],
      nice_to_have: [...b.target_customer.nice_to_have],
      funding_stage: [...b.target_customer.funding_stage],
      positive_examples: [...b.positive_examples],
      size_min: b.target_customer.company_size.min?.toString() ?? '',
      size_max: b.target_customer.company_size.max?.toString() ?? '',
      size_label: b.target_customer.company_size.label ?? '',
    };
    case 'buyers': return {
      buyer_personas: [...b.buyer_personas],
      pain_points: [...b.pain_points],
    };
    case 'signals': return {
      triggers: [...b.triggers],
      jobs_to_watch: [...b.jobs_to_watch],
    };
    case 'disqualifiers': return {
      disq_industries: [...b.target_customer.disqualifiers.industries],
      disq_company_types: [...b.target_customer.disqualifiers.company_types],
      disq_keywords: [...b.target_customer.disqualifiers.keywords],
      disq_titles: [...b.target_customer.disqualifiers.titles],
      required_evidence: [...b.qualification_rules.required_evidence],
      reject_if: [...b.qualification_rules.reject_if],
      manual_review_if: [...b.qualification_rules.manual_review_if],
      negative_examples: [...b.negative_examples],
    };
    case 'messaging': return {
      promise: b.positioning.promise,
      differentiators: [...b.positioning.differentiators],
      proof_points: [...b.positioning.proof_points],
      offer: b.positioning.offer,
      pricing: b.positioning.pricing,
      use_cases: [...b.positioning.use_cases],
      avoid_positioning: [...b.positioning.avoid_positioning],
      content_angles: [...b.content_angles],
      tone: b.brand_voice.tone,
      tags: [...b.brand_voice.tags],
      style_rules: [...b.brand_voice.style_rules],
      avoid: [...b.brand_voice.avoid],
    };
  }
}

export function buildPatch(section: SectionKey, s: SectionState, b: CompanyBrainV2): BrainProfile {
  switch (section) {
    case 'company': {
      const raw = b.legacy;
      const patch: BrainProfile = {
        company: {
          ...b.company,
          ...pick(s, ['name', 'website_url', 'category', 'description', 'business_model', 'stage', 'team_size']),
        },
      };
      const competitors = s.competitors as string[] | undefined;
      if (competitors && (competitors.length || 'competitors_v2' in raw || Array.isArray(raw.competitors))) {
        patch[competitorsKey(raw)] = competitors;
      }
      const tools = s.tools as string[] | undefined;
      if (tools && (tools.length || 'tools' in raw)) patch.tools = tools;
      const founder = {
        ...b.founder,
        name: s.founder_name ?? b.founder.name,
        role: s.founder_role ?? b.founder.role,
        background: s.founder_background ?? b.founder.background,
        linkedin_url: s.founder_linkedin_url ?? b.founder.linkedin_url,
        credibility_signals: s.founder_credibility ?? b.founder.credibility_signals,
      };
      if ('founder' in raw || Object.values(founder).some((v) => (Array.isArray(v) ? v.length : !!v))) patch.founder = founder;
      return patch;
    }
    case 'targeting': {
      const min = s.size_min === '' ? null : Number(s.size_min);
      const max = s.size_max === '' ? null : Number(s.size_max);
      const hasMin = Number.isFinite(min as number);
      const hasMax = Number.isFinite(max as number);
      // The backend compiler reads the size LABEL before the numbers and, when
      // it is empty, falls back to the seller's own team size. So with both
      // limits set, the label must state the same range or lead search follows
      // the label instead of the limits the drawer says are used.
      const typed = typeof s.size_label === 'string' ? s.size_label.trim() : '';
      const label = hasMin && hasMax && !labelStatesRange(typed, min as number, max as number)
        ? `${min}-${max} employees`
        : typed;
      return {
        target_customer: {
          ...b.target_customer,
          industries: s.industries, business_models: s.business_models, geography: s.geography,
          must_have: s.must_have, nice_to_have: s.nice_to_have, funding_stage: s.funding_stage,
          company_size: {
            min: hasMin ? (min as number) : null,
            max: hasMax ? (max as number) : null,
            label,
          },
        },
        ...((s.positive_examples as string[] | undefined)?.length || 'positive_examples' in b.legacy
          ? { positive_examples: s.positive_examples ?? b.positive_examples }
          : {}),
      };
    }
    case 'buyers':
      return { buyer_personas: s.buyer_personas, pain_points: s.pain_points };
    case 'signals':
      return { triggers: s.triggers, jobs_to_watch: s.jobs_to_watch };
    case 'disqualifiers':
      return {
        target_customer: {
          ...b.target_customer,
          disqualifiers: {
            ...b.target_customer.disqualifiers,
            industries: s.disq_industries, company_types: s.disq_company_types,
            keywords: s.disq_keywords, titles: s.disq_titles,
          },
        },
        qualification_rules: {
          ...b.qualification_rules,
          required_evidence: s.required_evidence,
          reject_if: s.reject_if,
          manual_review_if: s.manual_review_if,
        },
        negative_examples: s.negative_examples,
      };
    case 'messaging':
      return {
        positioning: {
          ...b.positioning,
          promise: s.promise, differentiators: s.differentiators, proof_points: s.proof_points,
          offer: s.offer ?? b.positioning.offer, pricing: s.pricing ?? b.positioning.pricing,
          use_cases: s.use_cases ?? b.positioning.use_cases,
          avoid_positioning: s.avoid_positioning ?? b.positioning.avoid_positioning,
        },
        content_angles: s.content_angles,
        brand_voice: {
          ...b.brand_voice,
          tone: s.tone, tags: s.tags, style_rules: s.style_rules, avoid: s.avoid,
        },
      };
  }
}

const pick = (s: SectionState, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, s[k]]));

/**
 * Where competitors are READ from (both normalizers: `competitors_v2`, then a
 * v2 profile's `competitors` array, then the legacy `competitors.known`). A
 * legacy `{ known, adjacent }` object is kept intact — the backend compiler
 * still reads `adjacent` from it — so those profiles write `competitors_v2`.
 */
function competitorsKey(raw: Record<string, unknown>): 'competitors' | 'competitors_v2' {
  if ('competitors_v2' in raw) return 'competitors_v2';
  const v2 = raw.schema_version === 2;
  return v2 && (raw.competitors === undefined || Array.isArray(raw.competitors)) ? 'competitors' : 'competitors_v2';
}

/** Does `label` read as exactly min–max to the backend's size parser (companyBrainIcp.parseSizeLabel)? */
function labelStatesRange(label: string, min: number, max: number): boolean {
  const m = label.replace(/,/g, '').match(/(\d+)\s*[-–to]+\s*(\d+)/);
  return !!m && Number(m[1]) === min && Number(m[2]) === max;
}

/**
 * The patch for changing some fields of one section, everything else in that
 * section kept as it is — what an inline edit saves.
 */
export function buildFieldPatch(section: SectionKey, changes: SectionState, b: CompanyBrainV2): BrainProfile {
  return buildPatch(section, { ...initialFor(section, b), ...changes }, b);
}

/** Save some fields of one section in place; resolves false if the write failed. */
export type SaveFields = (section: SectionKey, changes: SectionState) => Promise<boolean>;
