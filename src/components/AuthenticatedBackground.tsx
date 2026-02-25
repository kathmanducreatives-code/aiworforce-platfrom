const AuthenticatedBackground = () => {
  return (
    <>
      {/* Animated mesh gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-[600px] h-[600px] rounded-full top-[-10%] left-[-5%] bg-primary/[0.04] blur-[120px]"
          style={{ animation: 'mesh-drift 30s ease-in-out infinite' }} />
        <div className="absolute w-[500px] h-[500px] rounded-full bottom-[-10%] right-[-5%] bg-primary/[0.03] blur-[120px]"
          style={{ animation: 'mesh-drift 25s ease-in-out infinite reverse' }} />
      </div>

      {/* Ultra-subtle grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.015]">
        <div className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                                linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: '60px 60px'
          }}
        />
      </div>

      {/* Fewer floating particles */}
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="fixed w-1 h-1 bg-primary/15 rounded-full animate-float-particle pointer-events-none"
          style={{
            left: `${15 + Math.random() * 70}%`,
            top: `${15 + Math.random() * 70}%`,
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${18 + Math.random() * 10}s`,
          }}
        />
      ))}
    </>
  );
};

export default AuthenticatedBackground;
