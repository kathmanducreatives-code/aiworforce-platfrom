// THE CONTENT PAGE WEARS THE LEADS LOOK — IT DOES NOT HAVE ITS OWN.
//
// Actions and surfaces come from the shared workspace styles (the Lead Library's
// premium tokens); the accent is the Growth department's emerald, the one Signals
// renders with. What is here is only what the Studio's lists and fields add.

import { getDeptTheme } from "@/lib/departmentTheme";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/layout/workspaceStyles";

export const ACCENT = getDeptTheme("growth");

export const PRIMARY_BUTTON = PRIMARY_ACTION;
export const SECONDARY_BUTTON = SECONDARY_ACTION;

/** A list row / card at rest, and when it is the one selected. */
export const ROW_IDLE = "border-transparent hover:border-white/[0.07] hover:bg-[linear-gradient(90deg,rgba(16,185,129,0.05),transparent_70%)]";
export const ROW_SELECTED =
  "border-emerald-500/25 bg-[linear-gradient(90deg,rgba(16,185,129,0.10),rgba(16,185,129,0.02))] shadow-[inset_2px_0_0_rgba(16,185,129,0.8),0_8px_24px_-16px_rgba(16,185,129,0.5)]";

/** Inputs: glass well, emerald focus ring. */
export const FIELD =
  "border border-white/[0.07] bg-[rgba(10,13,12,0.55)] backdrop-blur-xl transition focus-within:border-emerald-500/35 focus-within:ring-1 focus-within:ring-primary/30";
