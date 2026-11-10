// The industry exclusions that actually govern a radar/LISA pass.
//
// `CompanyBrainContext.disqualifiers.industries` is the MERGED list and stays
// as it is for compatibility. When the Brain states no disqualifiers of its
// own, that list holds the generic DEFAULT_DISQUALIFIERS — which include
// "manufacturing" and "logistics". A workspace whose ICP TARGETS manufacturers
// therefore had its own market excluded from radar scoring and query planning.
//
// This resolves it with the same precedence rule the ATLAS mission contract
// already uses (industryPrecedence.resolveIndustryExclusions): an exclusion the
// workspace STATED always holds; a generic default is dropped where the
// workspace's own target industries name the same category.
//
// PURE.
import type { CompanyBrainContext } from "./companyBrainCompiler.ts";
import { resolveIndustryExclusions, type SuppressedExclusion } from "./industryPrecedence.ts";

export function effectiveIndustryExclusions(brain: Pick<CompanyBrainContext, "icp" | "disqualifiers">): { industries: string[]; suppressed: SuppressedExclusion[] } {
  const d = brain.disqualifiers as CompanyBrainContext["disqualifiers"] & { industries_explicit?: string[]; industries_generic?: string[] };
  // A context compiled before the split existed: keep the merged list unchanged.
  if (!Array.isArray(d.industries_explicit) || !Array.isArray(d.industries_generic)) {
    return { industries: [...d.industries], suppressed: [] };
  }
  const r = resolveIndustryExclusions({
    workspace_target_industries: [...brain.icp.industries, ...(brain.icp.categories ?? [])],
    workspace_explicit_exclusions: d.industries_explicit,
    generic_exclusions: d.industries_generic,
  });
  return { industries: r.exclusions, suppressed: r.suppressed };
}
