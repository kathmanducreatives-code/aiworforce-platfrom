// THE LEAD LIBRARY'S SURFACES AND ACTIONS, FOR EVERY WORKING PAGE.
//
// Leads is the reference: glass panels at rgba(10,13,12,0.55) with a 6% white
// hairline, a solid emerald primary with a soft glow ("Create list"), quiet
// glass for everything secondary. These compose its premium tokens so Signals
// and Content wear the same materials instead of approximations of them.

import { surfaceBase, surfaceRaised } from "@/components/leads/library/premium/tokens";

/** A glass panel: filter bars, strips, rails-within-the-page. */
export const GLASS_PANEL = `${surfaceBase} shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]`;

/** A raised glass surface: popovers, the one featured card on a view. */
export const GLASS_RAISED = `${surfaceRaised} shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]`;

/** A list card — flat glass that lifts its hairline and takes a trace of emerald on hover. */
export const GLASS_CARD =
  `rounded-xl ${surfaceBase} transition-[border-color,background-color,box-shadow] duration-200 ` +
  "hover:border-white/[0.1] hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.035),rgba(10,13,12,0.55))] hover:shadow-[0_18px_50px_-30px_rgba(16,185,129,0.35)]";

/** The one primary action on a view: solid emerald, lit from above, a restrained glow. */
export const PRIMARY_ACTION =
  "border border-emerald-400/30 bg-primary/90 font-semibold text-primary-foreground " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(16,185,129,0.18),0_8px_24px_-8px_rgba(16,185,129,0.55)] " +
  "hover:bg-primary hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_0_1px_rgba(16,185,129,0.3),0_10px_30px_-8px_rgba(16,185,129,0.7)] " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.04] disabled:text-muted-foreground/50 disabled:shadow-none";

/** Secondary actions: clean glass, neutral text, understated. */
export const SECONDARY_ACTION =
  "border border-white/10 bg-white/[0.02] font-medium text-foreground/85 " +
  "hover:border-white/20 hover:bg-white/[0.05] hover:text-foreground active:scale-[0.98] " +
  "disabled:cursor-not-allowed disabled:border-white/[0.05] disabled:bg-transparent disabled:text-muted-foreground/40";

/** Inputs and selects inside a glass bar (the Leads toolbar's well). */
export const GLASS_INPUT =
  "border border-white/10 bg-black/25 text-foreground placeholder:text-muted-foreground/50 " +
  "transition-colors focus:outline-none focus-visible:border-emerald-500/35 focus-visible:ring-1 focus-visible:ring-primary/30";

/** A small glass chip / filter control, and its "on" state. */
export const GLASS_CHIP =
  "border border-white/10 bg-black/25 text-muted-foreground transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-foreground";
export const CHIP_ACTIVE = "border-primary/30 bg-primary/[0.08] text-primary";

/** Metric strip — the Leads MetricStrip: glass, divided cells, tracked labels. */
export const METRIC_STRIP = "flex items-stretch overflow-hidden rounded-xl bg-[rgba(12,16,15,0.55)] backdrop-blur-xl border border-white/[0.06]";
export const METRIC_LABEL = "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
export const METRIC_VALUE = "text-[20px] font-semibold leading-none tabular-nums text-foreground";
