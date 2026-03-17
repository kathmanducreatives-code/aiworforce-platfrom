const AuthenticatedBackground = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-[#030303]">
      {/* 1. The Big Glow Nebulas */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-emerald-500/20 rounded-full blur-[160px] opacity-20 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-emerald-600/20 rounded-full blur-[160px] opacity-20 pointer-events-none translate-x-1/4 translate-y-1/4" />

      {/* 2. The Grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(16, 185, 129, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 185, 129, 0.08) 1px, transparent 1px)
          `,
          backgroundSize: '64px 64px',
        }}
      />

      {/* 3. The Stars */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 12px 12px, rgba(255, 255, 255, 0.4) 1px, transparent 1px)`,
          backgroundSize: '128px 128px',
          backgroundPosition: '0 0',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 48px 48px, rgba(16, 185, 129, 0.3) 1px, transparent 1px)`,
          backgroundSize: '192px 192px',
          backgroundPosition: '32px 32px',
        }}
      />
    </div>
  );
};

