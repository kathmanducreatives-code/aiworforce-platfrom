// The structured Company Brain as the one truth for every DERIVED copy.
//
// Readers still union copies the structured (v2) Brain is projected into: the
// legacy `profile.icp` block (agent prompts read it through the normalizer's
// fallback; the lead compiler unions it), the radar's `signal_preferences`, and
// a legacy `competitors.known`. These helpers make those copies an exact
// projection at WRITE time — clears included — so every reader answers the same.
//
// Both write paths use them: the Company Brain page's `update`
// (companyBrainUpdate.ts, #147) and onboarding's save_draft / activate
// (companyBrainV2Save.ts). Their own module so neither imports the other.
//
// Pure — no DB, no network.
import { flattenDisqualifiers, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

/**
 * The raw profile with each legacy `icp` field removed wherever its structured
 * counterpart is present, so normalizing it yields the structured truth — an
 * explicit empty list stays empty. A legacy-only profile (no structured field)
 * keeps its legacy values: there, they ARE the truth.
 */
export function structuredAuthoritative(raw: Raw): Raw {
  if (!isObj(raw.icp)) return raw;
  const tc = isObj(raw.target_customer) ? raw.target_customer : {};
  const icp: Raw = { ...raw.icp };
  if (Array.isArray(tc.industries)) delete icp.industries;
  if (Array.isArray(raw.buyer_personas)) delete icp.buyer_roles;
  if (isObj(tc.disqualifiers)) delete icp.disqualifiers;
  if (isObj(tc.company_size)) delete icp.company_size;
  if (Array.isArray(tc.geography)) delete icp.geography;
  if (Array.isArray(raw.pain_points)) delete icp.pain_points;
  return { ...raw, icp };
}

/**
 * Bring every copy the readers union back in line with the structured Brain.
 * Mutates `merged`.
 *
 * · `icp.*` (legacy) becomes an exact mirror — empty lists included, so a clear
 *   clears. Other legacy `icp` keys are kept.
 * · `signal_preferences` (the radar's copy) loses every value the Brain held
 *   before — in its structured OR legacy form — and no longer holds. Values the
 *   radar alone was given are kept. Skipped when this update edits the radar
 *   preferences itself: then the user's list is the truth.
 * · `competitors.known` (legacy object) loses removed competitors the same way.
 */
export function reconcileDerivedCopies(
  merged: Raw,
  before: CompanyBrainV2,
  existingRaw: Raw,
  after: CompanyBrainV2,
  radarEditedDirectly: boolean,
): void {
  merged.icp = mirrorLegacyIcp(merged.icp, after, merged.target_customer);

  const oldIcp = isObj(existingRaw.icp) ? existingRaw.icp : {};
  const removed = (structuredBefore: string[], legacyBefore: string[], now: string[]): Set<string> => {
    const keep = lower(now);
    return new Set([...structuredBefore, ...legacyBefore].map((x) => x.toLowerCase()).filter((x) => !keep.has(x)));
  };
  const tc = (b: CompanyBrainV2) => b.target_customer;
  const drops: Record<string, Set<string>> = {
    industries: removed(tc(before).industries, strings(oldIcp.industries), tc(after).industries),
    hiring_roles: removed(before.buyer_personas, strings(oldIcp.buyer_roles), after.buyer_personas),
    competitors: removed(before.competitors, [], after.competitors),
    pain_points: removed(before.pain_points, strings(oldIcp.pain_points), after.pain_points),
    linkedin_topics: removed(before.content_angles, [], after.content_angles),
    geographies: removed(tc(before).geography, [], tc(after).geography),
    disqualifiers: removed(tc(before).disqualifiers.industries, strings(oldIcp.disqualifiers), tc(after).disqualifiers.industries),
    negative_keywords: removed(tc(before).disqualifiers.keywords, [], tc(after).disqualifiers.keywords),
  };

  if (!radarEditedDirectly && isObj(merged.signal_preferences)) {
    const prefs: Raw = { ...merged.signal_preferences };
    for (const [key, drop] of Object.entries(drops)) {
      if (!drop.size || !Array.isArray(prefs[key])) continue;
      prefs[key] = strings(prefs[key]).filter((v) => !drop.has(v.toLowerCase()));
    }
    merged.signal_preferences = prefs;
  }

  if (isObj(merged.competitors) && Array.isArray(merged.competitors.known) && drops.competitors.size) {
    merged.competitors = {
      ...merged.competitors,
      known: strings(merged.competitors.known).filter((v) => !drops.competitors.has(v.toLowerCase())),
    };
  }
}

/**
 * The legacy `icp` block as an exact projection of the structured Brain. Unlike
 * `mergeLegacyIcpProjection` (onboarding), an empty structured list writes an
 * empty legacy list. The size is the STRUCTURED size only: the normalizer's
 * fallback to the seller's own `company.team_size` is never copied into the
 * legacy block, where it would outlive a fix to that fallback.
 */
export function mirrorLegacyIcp(existingIcp: unknown, v2: CompanyBrainV2, rawTargetCustomer: unknown): Raw {
  const base: Raw = isObj(existingIcp) ? { ...existingIcp } : {};
  const t = v2.target_customer;
  const rawSize = isObj(rawTargetCustomer) && isObj(rawTargetCustomer.company_size) ? rawTargetCustomer.company_size : {};
  const label = typeof rawSize.label === "string" ? rawSize.label.trim() : "";
  const min = typeof rawSize.min === "number" ? rawSize.min : null;
  const max = typeof rawSize.max === "number" ? rawSize.max : null;
  base.industries = [...t.industries];
  base.buyer_roles = [...v2.buyer_personas];
  base.disqualifiers = flattenDisqualifiers(t.disqualifiers);  // the same flattening onboarding writes
  base.company_size = label || (min != null && max != null ? `${min}-${max} employees` : "");
  base.geography = t.geography[0] ?? "";
  base.pain_points = [...v2.pain_points];
  return base;
}
