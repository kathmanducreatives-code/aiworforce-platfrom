// THE AGENTORY ROOM LIGHT. One fixed backdrop behind a working page: a deep
// near-black base, a faint grid that fades out, and soft emerald light.
//
// The Lead Library set the look (CommandBackdrop renders `variant="leads"`,
// unchanged). Signals and Content share the same base and palette and differ
// only in where the light falls — so they read as one product without being
// copies of each other:
//   leads    light from the top right, over the command surface
//   signals  the same room with a radar: faint range rings where the light is
//   content  a quiet spotlight over the centre column, where the writing is

type Variant = "leads" | "signals" | "content";

const BASE = "linear-gradient(180deg,#050706 0%,#020403 100%)";

const LIGHT: Record<Variant, string> = {
  leads:
    "radial-gradient(1200px 600px at 100% -10%,rgba(16,185,129,0.10),transparent 60%)," +
    "radial-gradient(900px 500px at -10% 110%,rgba(6,95,70,0.12),transparent 55%)",
  signals:
    "radial-gradient(1100px 560px at 78% -12%,rgba(16,185,129,0.11),transparent 60%)," +
    "radial-gradient(800px 520px at -8% 105%,rgba(6,95,70,0.12),transparent 55%)",
  content:
    "radial-gradient(1000px 520px at 50% -14%,rgba(16,185,129,0.10),transparent 62%)," +
    "radial-gradient(760px 480px at 105% 108%,rgba(6,95,70,0.11),transparent 55%)",
};

const GRID: Record<Variant, { opacity: string; mask: string }> = {
  leads: { opacity: "opacity-[0.06]", mask: "radial-gradient(1200px 600px at 60% 0%, black, transparent 80%)" },
  signals: { opacity: "opacity-[0.05]", mask: "radial-gradient(1100px 560px at 65% 0%, black, transparent 78%)" },
  // Writing wants less texture: the grid is there, barely.
  content: { opacity: "opacity-[0.035]", mask: "radial-gradient(1000px 480px at 50% 0%, black, transparent 75%)" },
};

const BLOB: Record<Variant, string> = {
  leads: "-top-32 right-[10%] h-[420px] w-[420px] bg-emerald-500/[0.09]",
  signals: "-top-40 right-[22%] h-[440px] w-[440px] bg-emerald-500/[0.08]",
  content: "-top-48 left-1/2 h-[380px] w-[560px] -translate-x-1/2 bg-emerald-500/[0.07]",
};

export function AmbientBackdrop({ variant }: { variant: Variant }) {
  const grid = GRID[variant];
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ backgroundImage: `${LIGHT[variant]},${BASE}` }} />
      <div
        className={`absolute inset-0 ${grid.opacity}`}
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: grid.mask,
          WebkitMaskImage: grid.mask,
        }}
      />
      {variant === "signals" && (
        // Range rings — a radar, not a decoration: very faint, fading out.
        <div
          className="absolute -top-[380px] right-[8%] h-[760px] w-[760px] rounded-full opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-radial-gradient(circle at center, transparent 0 94px, rgba(16,185,129,0.9) 94px 95px)",
            maskImage: "radial-gradient(circle at center, black 20%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(circle at center, black 20%, transparent 70%)",
          }}
        />
      )}
      <div className={`absolute rounded-full blur-3xl ${BLOB[variant]}`} />
    </div>
  );
}
