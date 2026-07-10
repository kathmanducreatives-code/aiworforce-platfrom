// Ambient background layer for the Company Brain onboarding "Brain Lab".
// Pure CSS/SVG — no libs, no motion cost. Fixed to the viewport so it stays
// cinematic through step transitions.

export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      {/* Base near-black */}
      <div className="absolute inset-0 bg-[#050506]" />

      {/* Dot grid */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.18]">
        <defs>
          <pattern id="brainlab-dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="hsl(var(--foreground) / 0.35)" />
          </pattern>
          <radialGradient id="brainlab-mask" cx="50%" cy="0%" r="80%">
            <stop offset="0%" stopColor="white" stopOpacity="0.85" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="brainlab-dot-mask">
            <rect width="100%" height="100%" fill="url(#brainlab-mask)" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#brainlab-dots)" mask="url(#brainlab-dot-mask)" />
      </svg>

      {/* Emerald orbital washes */}
      <div
        className="absolute -top-1/3 left-1/2 h-[900px] w-[900px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.14), transparent 70%)' }}
      />
      <div
        className="absolute right-[-10%] top-[20%] h-[600px] w-[600px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.08), transparent 70%)' }}
      />
      <div
        className="absolute left-[-15%] bottom-[-10%] h-[700px] w-[700px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.06), transparent 70%)' }}
      />

      {/* Top vignette */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
    </div>
  );
}
