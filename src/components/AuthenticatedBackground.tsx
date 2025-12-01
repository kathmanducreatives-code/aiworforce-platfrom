const AuthenticatedBackground = () => {
  return (
    <>
      {/* Subtle Floating Gradient Orbs - Lower opacity than landing page */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-float-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/8 rounded-full blur-3xl animate-float-gentle" 
             style={{ animationDelay: '2s' }} />
      </div>

      {/* Ultra-subtle Grid Pattern */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.01]">
        <div className="absolute inset-0" 
             style={{
               backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                                linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
               backgroundSize: '50px 50px'
             }} 
        />
      </div>

      {/* Fewer Floating Particles */}
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="fixed w-1 h-1 bg-primary/20 rounded-full animate-float-particle pointer-events-none"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${15 + Math.random() * 10}s`,
          }}
        />
      ))}
    </>
  );
};

export default AuthenticatedBackground;
