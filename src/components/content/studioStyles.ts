// THE CONTENT PAGE WEARS THE LEADS/SIGNALS LOOK — IT DOES NOT HAVE ITS OWN.
//
// Signals renders with the Growth department accent (DepartmentWorkspaceShell,
// getDeptTheme("growth")): emerald tint + emerald border for the one primary
// action, glass for everything else. These are those tokens, composed once so
// the four Content components don't each restate them.

import { getDeptTheme } from "@/lib/departmentTheme";

export const ACCENT = getDeptTheme("growth");

/** The primary CTA: emerald tint, emerald hairline, a restrained glow. */
export const PRIMARY_BUTTON =
  `border ${ACCENT.accentBorder} ${ACCENT.accentBg} ${ACCENT.accentText} font-semibold shadow-[0_0_22px_-10px_rgba(16,185,129,0.6)] hover:bg-emerald-500/15 disabled:border-white/[0.06] disabled:bg-white/[0.02] disabled:text-muted-foreground/45 disabled:shadow-none`;

/** Secondary actions: glass — near-transparent, thin low-contrast border. */
export const SECONDARY_BUTTON =
  "border border-white/[0.08] bg-white/[0.03] text-foreground/85 hover:border-white/15 hover:bg-white/[0.05] disabled:border-white/[0.04] disabled:bg-transparent disabled:text-muted-foreground/40";

/** A list row / card at rest, and when it is the one selected. */
export const ROW_IDLE = "border-transparent hover:border-white/[0.06] hover:bg-emerald-500/[0.03]";
export const ROW_SELECTED = "border-emerald-500/25 bg-emerald-500/[0.06] shadow-[inset_2px_0_0_rgba(16,185,129,0.8)]";

/** Inputs: glass well, emerald focus ring. */
export const FIELD =
  "border border-white/[0.06] bg-white/[0.02] transition focus-within:border-emerald-500/30 focus-within:ring-1 focus-within:ring-emerald-500/20";
