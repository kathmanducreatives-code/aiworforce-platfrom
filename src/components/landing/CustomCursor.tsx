import { useEffect, useRef } from 'react';
import gsap from 'gsap';

const CustomCursor = () => {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    const trail = trailRef.current;
    if (!dot || !ring || !trail) return;

    const onMove = (e: MouseEvent) => {
      gsap.set(dot, { x: e.clientX - 4, y: e.clientY - 4 });
      gsap.to(ring, { x: e.clientX - 16, y: e.clientY - 16, duration: 0.15, ease: 'power2.out' });
      gsap.to(trail, { x: e.clientX - 24, y: e.clientY - 24, duration: 0.3, ease: 'power2.out' });
    };

    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (isTouchDevice) return null;

  return (
    <>
      <div
        ref={dotRef}
        className="fixed top-0 left-0 w-2 h-2 rounded-full pointer-events-none z-[9999] bg-primary"
      />
      <div
        ref={ringRef}
        className="fixed top-0 left-0 w-8 h-8 rounded-full pointer-events-none z-[9998] border border-primary/50 backdrop-blur-[2px]"
      />
      <div
        ref={trailRef}
        className="fixed top-0 left-0 w-12 h-12 rounded-full pointer-events-none z-[9997] border border-primary/20 opacity-40"
      />
    </>
  );
};

export default CustomCursor;
