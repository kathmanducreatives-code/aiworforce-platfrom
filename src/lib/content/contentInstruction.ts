// THE BRIEF SCRIBE IS GIVEN — re-exported, never re-implemented.
//
// The builder moved to `supabase/functions/_shared/`, which is this repo's home
// for logic BOTH runtimes run: `signalEventsFeed.ts` already imports
// `clusterSignalEvents` across the same boundary, for the same stated reason —
// "a mirror is a second copy that drifts".
//
// Pilot now creates Content server-side, so the edge runtime needs this brief
// too. Copying it there would have produced two sentences that start identical
// and diverge on the first change, and a regeneration reads the brief back from
// the row — so a drifted copy would mean the second draft quietly answers a
// different question than the first.
//
// This file stays so every existing `@/lib/content/contentInstruction` import
// keeps working.

export {
  buildContentInstruction,
  type InstructionFormat,
  type InstructionSource,
  type InstructionInput,
} from '../../../supabase/functions/_shared/contentInstruction';
