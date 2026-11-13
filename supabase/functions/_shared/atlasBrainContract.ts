// ATLAS ⇄ COMPANY BRAIN — the opt-in interface (contract atlas-brain-v1).
//
// ATLAS (the lead track) is owned by another development track. Company Brain
// V1 does NOT change how ATLAS reads the Brain today: `missionContext.ts` keeps
// calling `getCompiledCompanyBrainForWorkspace`, which is untouched.
//
// This module is the door ATLAS opts into when it is ready. It returns:
//   brain    — the SAME CanonicalCompanyBrain shape ATLAS already consumes, built
//              from the EFFECTIVE profile (approved memory folded in: newer ICP
//              preferences, explicit exclusions as disqualifiers, approved
//              competitors);
//   contract — the narrow AtlasBrainContract (industries, size, geography,
//              exclusions, rejected lead/account refs, icp_changed_at).
//
// THE COMPATIBILITY PROMISE (pinned by atlasBrainContract.test.ts): for a
// workspace with no memory, `brain` is deep-equal to what
// getCompiledCompanyBrainForWorkspace returns. Memory can only add exclusions,
// swap in a NEWER ICP choice a person made, or add approved competitors — it
// never relaxes a qualification, budget, dedupe or approval rule, because none
// of those live in the Brain.
//
// Swap-in for the ATLAS track (one call site, missionContext.ts):
//   - const res = await getCompiledCompanyBrainForWorkspace(db, workspaceId, opts);
//   + const res = await getCompiledCompanyBrainWithMemory(db, workspaceId, opts);
// Rejected leads arrive as refs (`contract.rejected_lead_refs`) for ATLAS to skip
// those records; they are not, and must not become, industry or company rules.

import { loadCompanyBrainContext, type LoaderDb, type LoadOptions } from "./companyBrainContextLoader.ts";
import { atlasView, type AtlasBrainContract } from "./companyBrainAgentViews.ts";
import type { CanonicalCompanyBrain } from "./getCompiledCompanyBrainForWorkspace.ts";

export type AtlasBrainResult =
  | { ok: true; brain: CanonicalCompanyBrain; contract: AtlasBrainContract; warnings: string[] }
  | { ok: false; brain: null; contract: null; error: "forbidden" | "not_found" };

export async function getCompiledCompanyBrainWithMemory(
  db: LoaderDb,
  workspaceId: string,
  opts: LoadOptions = {},
): Promise<AtlasBrainResult> {
  const loaded = await loadCompanyBrainContext(db, workspaceId, opts);
  if (!loaded.ok) return { ok: false, brain: null, contract: null, error: loaded.error };
  return {
    ok: true,
    brain: loaded.context.canonical,
    contract: atlasView(loaded.context, opts.now ?? new Date()),
    warnings: loaded.context.warnings,
  };
}
