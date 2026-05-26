import { useEffect, useState } from "react";

const AuthenticatedBackground = () => {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const check = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      setIsLight(theme === "light");
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-[#030303] transition-colors duration-500">
      {/* 1. Ambient Cinematic Deep Space Glows */}
      <div
        className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[1000px] h-[700px] rounded-full blur-[160px] opacity-[0.12] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, transparent 80%)',
          animation: 'nebula-breathe 12s ease-in-out infinite',
        }}
      />
      <div
        className="absolute bottom-[-10%] right-[-10%] w-[900px] h-[900px] rounded-full blur-[180px] opacity-[0.10] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.3) 0%, transparent 80%)',
          animation: 'nebula-breathe 12s ease-in-out infinite 4s',
        }}
      />
      <div
        className="absolute top-[30%] left-[-10%] w-[700px] h-[700px] rounded-full blur-[150px] opacity-[0.08] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, transparent 80%)',
          animation: 'nebula-breathe 12s ease-in-out infinite 8s',
        }}
      />

      {/* 2. Restrained Tech Blueprint Grid (Drifting, faint and elegant) */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%] opacity-[0.18]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '120px 120px',
          animation: 'grid-drift 80s linear infinite',
        }}
      />
      {/* Grid intersection micro-glows */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%] opacity-[0.08]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80px 80px at 60px 60px, rgba(16, 185, 129, 0.12) 0%, transparent 80%)
          `,
          backgroundSize: '120px 120px',
          animation: 'grid-drift 80s linear infinite',
        }}
      />
      {/* Intersection coordinates/dots */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%] opacity-[0.25]"
        style={{
          backgroundImage: `radial-gradient(circle 1px at 0px 0px, rgba(16, 185, 129, 0.2) 0%, transparent 100%)`,
          backgroundSize: '120px 120px',
          animation: 'grid-drift 80s linear infinite',
        }}
      />

      {/* 3. Deep Space Starfield (Subtle, varied depth) */}
      <div
        className="absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage: `radial-gradient(circle at 12px 12px, rgba(255, 255, 255, 0.2) 0.5px, transparent 0.5px)`,
          backgroundSize: '180px 180px',
          backgroundPosition: '0 0',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.3]"
        style={{
          backgroundImage: `radial-gradient(circle at 90px 45px, rgba(16, 185, 129, 0.15) 0.5px, transparent 0.5px)`,
          backgroundSize: '240px 240px',
          backgroundPosition: '40px 40px',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: `radial-gradient(circle at 60px 130px, rgba(255, 255, 255, 0.18) 0.5px, transparent 0.5px)`,
          backgroundSize: '140px 150px',
          backgroundPosition: '15px 25px',
          animation: 'star-twinkle 4s ease-in-out infinite',
        }}
      />
    </div>
  );
};

export default AuthenticatedBackground;
