// Shared visual tokens for the premium Lead Library command surface.
// Kept as Tailwind class strings so components stay theme-token aware.

export const glassSurface =
  "relative bg-[rgba(10,14,12,0.55)] backdrop-blur-xl border border-white/[0.06] " +
  "shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]";

export const glassSurfaceRaised =
  "relative bg-[rgba(14,20,18,0.72)] backdrop-blur-2xl border border-white/[0.08] " +
  "shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]";

export const glassActive =
  "border-primary/40 shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_20px_60px_-25px_rgba(16,185,129,0.35)] " +
  "bg-[linear-gradient(180deg,rgba(16,185,129,0.10),rgba(16,185,129,0.02))]";

// Top-left inner light edge that gives glass panels a subtle bevel.
export const edgeHighlight =
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] " +
  "before:bg-[linear-gradient(140deg,rgba(255,255,255,0.06),transparent_35%)] before:opacity-70";

export const emeraldGlow =
  "shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_18px_60px_-20px_rgba(16,185,129,0.55)]";
