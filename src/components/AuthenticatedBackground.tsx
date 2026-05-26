import { useEffect, useState } from "react";

/**
 * Deep Space AI OS — atmospheric background.
 *
 * Restrained: two faint emerald nebulae, one slow grid drift, two starfield
 * layers, one slow twinkle. Total brightness budget is intentionally low —
 * the UI should feel quietly infinite, not "crypto dashboard".
 */
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

  // Light theme: solid, no atmosphere. Atmosphere is a dark-mode language.
  if (isLight) {
    return (
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: '#FAFAFA' }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      style={{ background: '#050505' }}
    >
      {/* Two faint emerald nebulae — slow breathing, low opacity */}
      <div
        className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.30) 0%, transparent 70%)',
          filter: 'blur(220px)',
          opacity: 0.12,
          animation: 'nebula-breathe 12s ease-in-out infinite',
        }}
      />
      <div
        className="absolute bottom-[-10%] right-[-5%] w-[900px] h-[900px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, transparent 70%)',
          filter: 'blur(220px)',
          opacity: 0.08,
          animation: 'nebula-breathe 12s ease-in-out infinite 6s',
        }}
      />

      {/* Single grid layer — very faint, slow drift */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(16, 185, 129, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 185, 129, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: '160px 160px',
          animation: 'grid-drift 90s linear infinite',
        }}
      />

      {/* Starfield — two static layers + one slow twinkle */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 12px 12px, rgba(255, 255, 255, 0.18) 1px, transparent 1px)`,
          backgroundSize: '200px 200px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 80px 40px, rgba(16, 185, 129, 0.12) 1px, transparent 1px)`,
          backgroundSize: '280px 280px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 50px 110px, rgba(255, 255, 255, 0.10) 0.5px, transparent 0.5px)`,
          backgroundSize: '140px 150px',
          animation: 'star-twinkle 6s ease-in-out infinite',
        }}
      />
    </div>
  );
};

export default AuthenticatedBackground;
