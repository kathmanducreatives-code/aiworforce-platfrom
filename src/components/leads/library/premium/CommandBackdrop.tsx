// Absolute page backdrop for the Lead Library command surface.
// Renders a deep-black gradient, subtle grid, and a single emerald glow.
export function CommandBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Deep base gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_100%_-10%,rgba(16,185,129,0.10),transparent_60%),radial-gradient(900px_500px_at_-10%_110%,rgba(6,95,70,0.12),transparent_55%),linear-gradient(180deg,#050706_0%,#020403_100%)]" />
      {/* Faint grid */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(1200px 600px at 60% 0%, black, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(1200px 600px at 60% 0%, black, transparent 80%)",
        }}
      />
      {/* Soft emerald glow blob */}
      <div className="absolute -top-32 right-[10%] h-[420px] w-[420px] rounded-full bg-emerald-500/[0.09] blur-3xl" />
    </div>
  );
}
