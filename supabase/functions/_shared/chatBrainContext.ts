// THE COMPANY BRAIN, AS CHAT (ORION) READS IT.
//
// Chat used to read `company_brain.profile` directly — the RAW profile — so an
// approved correction, a newer ICP preference, an explicit exclusion or a
// recorded decision never reached a chat answer (audit 2026-11, finding C1),
// while ORION's brief and LYRA's drafts saw them. One shared loader now feeds
// every surface:
//
//   row          { profile, onboarding_completed } — the shape every existing
//                chat call site already reads, with `profile` = the EFFECTIVE
//                profile (approved memory folded in). Unapproved proposals,
//                stale or disputed items never fold in (the loader's rule).
//   memoryBlock  the ORION memory view (goals, exclusions, decisions, cited
//                preferences) for prompts that answer questions.
//   fingerprint  which Brain version this answer used.
//
// AUTHORIZATION: the loader re-checks membership with the authenticated user.
// If memory cannot be read (e.g. the held tables are absent) the raw profile
// row answers, exactly as before — a missing table never costs chat its Brain.
import { loadCompanyBrainContext, type LoaderDb, type SharedBrainContext } from "./companyBrainContextLoader.ts";
import { renderBrainMemoryBlock } from "./companyBrainAgentViews.ts";

export interface ChatBrain {
  row: { profile: Record<string, unknown> | null; onboarding_completed: boolean } | null;
  shared: SharedBrainContext | null;
  memoryBlock: string;
  fingerprint: string | null;
  source: "shared_loader" | "raw_profile" | "none";
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from(table: string): any };

export async function loadChatBrain(db: Db, workspaceId: string, userId: string, now: Date = new Date()): Promise<ChatBrain> {
  try {
    const r = await loadCompanyBrainContext(db as unknown as LoaderDb, workspaceId, { userId, now });
    // A REFUSAL IS FINAL. Falling back to the raw read here would bypass the
    // membership check the loader just made.
    if (!r.ok) return { row: null, shared: null, memoryBlock: "", fingerprint: null, source: "none" };
    if (!r.context.warnings.includes("brain_unavailable")) {
      const c = r.context;
      // "missing" is about the PROFILE, not the row: onboarding state must
      // survive exactly as the raw read reported it (the onboarding gate reads it).
      if (c.status === "missing") {
        const empty = !c.profile || Object.keys(c.profile).length === 0;
        return { row: { profile: empty ? null : c.profile, onboarding_completed: c.onboarding_completed },
          shared: c, memoryBlock: "", fingerprint: c.fingerprint, source: "shared_loader" };
      }
      return {
        row: { profile: c.effective_profile, onboarding_completed: c.onboarding_completed },
        shared: c,
        memoryBlock: c.warnings.includes("memory_unavailable") ? "" : renderBrainMemoryBlock(c, "orion"),
        fingerprint: c.fingerprint,
        source: "shared_loader",
      };
    }
  } catch { /* fall through to the raw read */ }
  try {
    const { data } = await db.from("company_brain").select("profile, onboarding_completed").eq("workspace_id", workspaceId).maybeSingle();
    if (!data) return { row: null, shared: null, memoryBlock: "", fingerprint: null, source: "none" };
    return { row: { profile: (data.profile ?? null) as Record<string, unknown> | null, onboarding_completed: data.onboarding_completed === true },
      shared: null, memoryBlock: "", fingerprint: null, source: "raw_profile" };
  } catch {
    return { row: null, shared: null, memoryBlock: "", fingerprint: null, source: "none" };
  }
}
