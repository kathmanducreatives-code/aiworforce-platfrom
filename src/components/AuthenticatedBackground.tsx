import { useEffect, useRef, useState, useCallback } from "react";

/**
 * AuthenticatedBackground — "Glowing Stellar" Deep-Space Environment
 *
 * Architecture:
 *   1. Canvas-based particle star field (~250 stars, 60fps RAF loop)
 *   2. Two atmospheric Pilot Green radial glows (pseudo-element style, CSS animated)
 *   3. Deep Obsidian #030507 base — no grids, no flat patterns
 *
 * Performance:
 *   - Single <canvas> element, drawn via requestAnimationFrame
 *   - Twinkle computed per-frame with sin() — no DOM mutations
 *   - Atmospheric glows are pure CSS (GPU-composited blur + opacity transitions)
 *   - Canvas resizes on window resize via ResizeObserver
 */

/* ─── Types ─── */
interface Star {
  x: number;
  y: number;
  size: number;
  baseAlpha: number;
  color: [number, number, number]; // RGB
  twinkleSpeed: number;            // radians/sec
  twinklePhase: number;            // offset
  doesTwinkle: boolean;            // only ~10% twinkle
}

/* ─── Star Field Generator ─── */
function generateStars(width: number, height: number, count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const isTeal = Math.random() < 0.2; // 20% teal-green stars
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 0.3 + Math.random() * 1.2,          // 0.3px – 1.5px (smaller)
      baseAlpha: 0.1 + Math.random() * 0.3,     // 0.1 – 0.4 (dimmer)
      color: isTeal ? [160, 240, 218] : [255, 255, 255],
      twinkleSpeed: 0.3 + Math.random() * 0.8,  // rad/s
      twinklePhase: Math.random() * Math.PI * 2,
      doesTwinkle: Math.random() < 0.10,        // only 10% twinkle
    });
  }
  return stars;
}

/* ─── Component ─── */
const AuthenticatedBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const rafRef = useRef<number>(0);
  const [isLight, setIsLight] = useState(false);

  // Theme detection
  useEffect(() => {
    const check = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      setIsLight(theme === "light");
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Canvas setup + animation loop
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Size to viewport
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Generate stars on resize (sparse)
    starsRef.current = generateStars(w, h, 60);

    // Animation loop
    let startTime = performance.now();

    const draw = (now: number) => {
      const elapsed = (now - startTime) / 1000; // seconds

      // Clear to deep obsidian
      ctx.fillStyle = "#030507";
      ctx.fillRect(0, 0, w, h);

      // Draw each star
      const stars = starsRef.current;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];

        // Compute alpha: base or twinkling
        let alpha = s.baseAlpha;
        if (s.doesTwinkle) {
          // sin oscillation: 0.3 → 0.9 → 0.3
          const t = Math.sin(elapsed * s.twinkleSpeed + s.twinklePhase);
          alpha = 0.3 + (t * 0.5 + 0.5) * 0.6; // maps sin[-1,1] to [0.3, 0.9]
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.color[0]}, ${s.color[1]}, ${s.color[2]}, ${alpha})`;
        ctx.fill();

        // Add subtle glow halo for larger twinkling stars
        if (s.doesTwinkle && s.size > 1.5) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${s.color[0]}, ${s.color[1]}, ${s.color[2]}, ${alpha * 0.08})`;
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Mount + resize handling
  useEffect(() => {
    const cleanup = initCanvas();

    const handleResize = () => {
      cancelAnimationFrame(rafRef.current);
      initCanvas();
    };

    // Debounced resize
    let resizeTimer: ReturnType<typeof setTimeout>;
    const debouncedResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 200);
    };

    window.addEventListener("resize", debouncedResize);
    return () => {
      cleanup?.();
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", debouncedResize);
      clearTimeout(resizeTimer);
    };
  }, [initCanvas]);

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      style={{ opacity: isLight ? 0.3 : 1 }}
    >
      {/* ═══ Layer 1: Canvas Star Field ═══ */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: "block" }}
      />

      {/* ═══ Layer 2: Atmospheric Pilot Green Glow — Top-Left (behind search/sidebar) ═══ */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "-5%",
          left: "-5%",
          width: "700px",
          height: "600px",
          background:
            "radial-gradient(circle at 50% 50%, rgba(0, 255, 148, 0.04) 0%, rgba(0, 255, 148, 0.02) 40%, transparent 70%)",
          filter: "blur(150px)",
          mixBlendMode: "screen",
          animation: "atmo-pulse 20s ease-in-out infinite",
        }}
      />

      {/* ═══ Layer 3: Atmospheric Pilot Green Glow — Center (behind AI Departments) ═══ */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "30%",
          left: "35%",
          width: "1000px",
          height: "800px",
          background:
            "radial-gradient(circle at 50% 50%, rgba(0, 255, 148, 0.05) 0%, rgba(0, 255, 148, 0.025) 35%, transparent 65%)",
          filter: "blur(150px)",
          mixBlendMode: "screen",
          animation: "atmo-pulse 20s ease-in-out infinite 10s",
        }}
      />

      {/* ═══ Layer 4: Subtle bottom-right warmth ═══ */}
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: "-10%",
          right: "-8%",
          width: "800px",
          height: "700px",
          background:
            "radial-gradient(circle at 50% 50%, rgba(0, 255, 148, 0.03) 0%, transparent 60%)",
          filter: "blur(160px)",
          mixBlendMode: "screen",
          animation: "atmo-pulse 20s ease-in-out infinite 5s",
        }}
      />

      {/* ═══ Animation Keyframes ═══ */}
      <style>{`
        @keyframes atmo-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.88; }
        }
      `}</style>
    </div>
  );
};

export default AuthenticatedBackground;
