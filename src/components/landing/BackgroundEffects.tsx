const BackgroundEffects = () => {
  return (
    <>
      {/* Floating Gradient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-float-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-float-gentle" 
             style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-secondary/20 rounded-full blur-3xl animate-float-slow" 
             style={{ animationDelay: '4s' }} />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02]">
        <div className="absolute inset-0" 
             style={{
               backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                                linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
               backgroundSize: '50px 50px'
             }} 
        />
      </div>

      {/* Floating Particles */}
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          className="fixed w-1 h-1 bg-primary/30 rounded-full animate-float-particle pointer-events-none"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${15 + Math.random() * 10}s`,
          }}
        />
      ))}

      {/* Radial Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none animate-pulse-glow" />
    </>
  );
};

export default BackgroundEffects;
