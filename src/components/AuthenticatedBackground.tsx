const AuthenticatedBackground = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-[#020202]">
      {/* 1. Breathing Nebula Glows */}
      <div
        className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full blur-[180px] opacity-20 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, transparent 70%)',
          animation: 'nebula-breathe 8s ease-in-out infinite',
        }}
      />
      <div
        className="absolute bottom-[-5%] right-[-5%] w-[800px] h-[800px] rounded-full blur-[180px] opacity-15 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.3) 0%, transparent 70%)',
          animation: 'nebula-breathe 8s ease-in-out infinite 3s',
        }}
      />
      <div
        className="absolute top-[35%] left-[-5%] w-[600px] h-[600px] rounded-full blur-[160px] opacity-10 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, transparent 70%)',
          animation: 'nebula-breathe 8s ease-in-out infinite 6s',
        }}
      />

      {/* 2. Drifting Grid — large panels with glassy feel */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(16, 185, 129, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 185, 129, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: '140px 140px',
          animation: 'grid-drift 60s linear infinite',
        }}
      />
      {/* Grid cell inner glow — gives each panel a glassy sheen */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 100px 100px at 70px 70px, rgba(16, 185, 129, 0.03) 0%, transparent 70%)
          `,
          backgroundSize: '140px 140px',
          animation: 'grid-drift 60s linear infinite',
        }}
      />
      {/* Intersection dots */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%]"
        style={{
          backgroundImage: `radial-gradient(circle 2px at 0px 0px, rgba(16, 185, 129, 0.2) 0%, transparent 100%)`,
          backgroundSize: '140px 140px',
          animation: 'grid-drift 60s linear infinite',
        }}
      />

      {/* 3. Starfield */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 12px 12px, rgba(255, 255, 255, 0.35) 1px, transparent 1px)`,
          backgroundSize: '160px 160px',
          backgroundPosition: '0 0',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 80px 40px, rgba(16, 185, 129, 0.25) 1px, transparent 1px)`,
          backgroundSize: '200px 200px',
          backgroundPosition: '32px 32px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 50px 110px, rgba(255, 255, 255, 0.2) 0.5px, transparent 0.5px)`,
          backgroundSize: '120px 130px',
          backgroundPosition: '10px 20px',
          animation: 'star-twinkle 3s ease-in-out infinite',
        }}
      />
    </div>
  );
};

export default AuthenticatedBackground;
