// Shared visual tokens for the Lead Library workspace. Restrained glass,
// one teal accent, consistent radii/borders.

export const surfaceBase =
  "bg-[rgba(10,13,12,0.55)] backdrop-blur-xl border border-white/[0.06]";
export const surfaceRaised =
  "bg-[rgba(14,18,17,0.72)] backdrop-blur-2xl border border-white/[0.07]";
export const surfaceHover = "hover:bg-white/[0.03]";
export const borderSubtle = "border-white/[0.06]";
export const borderActive = "border-primary/40";

export const accentTeal = "text-primary";
export const statusSuccess = "text-primary";
export const statusWarning = "text-amber-300";
export const statusDanger = "text-rose-300";

// Legacy compat (still consumed by GlassPanel / MetricStrip callers).
export const glassSurface = surfaceBase + " relative shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]";
export const glassSurfaceRaised = surfaceRaised + " relative shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]";
export const glassActive =
  "border-primary/40 bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(16,185,129,0.02))]";
export const edgeHighlight =
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] " +
  "before:bg-[linear-gradient(140deg,rgba(255,255,255,0.05),transparent_40%)] before:opacity-60";
export const emeraldGlow =
  "shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_18px_60px_-20px_rgba(16,185,129,0.55)]";
