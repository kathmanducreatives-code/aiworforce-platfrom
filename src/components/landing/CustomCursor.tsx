import { useEffect, useRef } from 'react';
import gsap from 'gsap';

const CustomCursor = () => {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) return;

    const glow = glowRef.current;
    if (!glow) return;

    // quickTo is highly optimized for mouse tracking
    const xTo = gsap.quickTo(glow, "x", { duration: 0.15, ease: "power2.out" });
    const yTo = gsap.quickTo(glow, "y", { duration: 0.15, ease: "power2.out" });

    const onMove = (e: MouseEvent) => {
      xTo(e.clientX);
      yTo(e.clientY);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (isTouchDevice) return null;

  return (
    <div
      ref={glowRef}
      className="fixed top-0 left-0 pointer-events-none z-[1] transform -translate-x-1/2 -translate-y-1/2"
      style={{
        width: '800px',
        height: '800px',
        background: 'radial-gradient(circle, rgba(0, 255, 148, 0.08) 0%, rgba(0, 255, 148, 0.03) 25%, transparent 60%)',
        mixBlendMode: 'screen',
      }}
    />
  );
};

export default CustomCursor;
