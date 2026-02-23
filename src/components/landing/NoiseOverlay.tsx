const NoiseOverlay = () => (
  <>
    <div
      className="pointer-events-none absolute inset-0 z-10 opacity-[0.04]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        backgroundSize: '128px 128px',
      }}
    />
    {/* Subtle depth gradient */}
    <div
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        background: 'linear-gradient(180deg, transparent 0%, hsl(var(--background) / 0.05) 100%)',
      }}
    />
  </>
);

export default NoiseOverlay;
