import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ParticleBurst = () => {
    const particles = useMemo(() => Array.from({ length: 100 }).map((_, i) => ({
        id: i,
        angle: Math.random() * Math.PI * 2,
        velocity: 100 + Math.random() * 300,
        size: 3 + Math.random() * 6,
        delay: Math.random() * 0.1
    })), []);

    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
            {particles.map(p => (
                <motion.div
                    key={p.id}
                    className="absolute rounded-full bg-accent-mint shadow-[0_0_15px_rgba(0,255,148,0.8)]"
                    style={{ width: p.size, height: p.size }}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
                    animate={{ 
                        x: Math.cos(p.angle) * p.velocity, 
                        y: Math.sin(p.angle) * p.velocity,
                        opacity: 0,
                        scale: 1 
                    }}
                    transition={{ duration: 1.5 + Math.random(), delay: p.delay, ease: "easeOut" }}
                />
            ))}
        </div>
    )
};

const TimeMath = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [leftCount, setLeftCount] = useState(0);
  const [rightCount, setRightCount] = useState(0);
  const [showX, setShowX] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [showParticles, setShowParticles] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;

    // Sequence
    // 1. Count up left (0 to 305000) over 2s
    let raf1: number;
    const t0 = performance.now();
    const step1 = (now: number) => {
      const p = Math.min((now - t0) / 2000, 1);
      // easeOutExpo
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setLeftCount(Math.round(305000 * eased));
      
      if (p < 1) {
        raf1 = requestAnimationFrame(step1);
      } else {
        // 2. Show Red X
        setTimeout(() => {
            setShowX(true);
            
            // 3. Reveal Right Side
            setTimeout(() => {
                setShowRight(true);
                
                // 4. Count up right side rapidly
                const t2 = performance.now();
                const step2 = (now2: number) => {
                    const p2 = Math.min((now2 - t2) / 1000, 1);
                    const eased2 = p2 === 1 ? 1 : 1 - Math.pow(2, -10 * p2);
                    setRightCount(Math.round(1788 * eased2));
                    if (p2 < 1) requestAnimationFrame(step2);
                    else {
                        // 5. Particles!
                        setShowParticles(true);
                    }
                };
                requestAnimationFrame(step2);
                
            }, 800);
        }, 500);
      }
    };
    raf1 = requestAnimationFrame(step1);

    return () => cancelAnimationFrame(raf1);
  }, [inView]);

  return (
    <section ref={sectionRef} className="relative px-6 py-16 md:py-24 bg-transparent overflow-hidden border-t border-white/5 min-h-[80vh] flex flex-col items-center justify-center">
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ background: "linear-gradient(to bottom, var(--bg-fiesta-dark) 0%, var(--bg-galaxy-void) 100%)" }} />
      
      {/* Soundwave Data Visualization */ }
      <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center opacity-10 blur-[1px]">
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="w-full h-full text-accent-cyan opacity-40 animate-[pulse_4s_ease-in-out_infinite]">
          <path d="M0 100 Q 50 150 100 100 T 200 100 T 300 50 T 400 100 T 500 150 T 600 100 T 700 20 T 800 100 T 900 180 T 1000 100" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M0 100 Q 50 50 100 100 T 200 150 T 300 100 T 400 50 T 500 100 T 600 180 T 700 100 T 800 20 T 900 100 T 1000 100" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" />
        </svg>
      </div>

      <div className="w-full max-w-6xl mx-auto relative z-10">
        
        <div className="text-center mb-32">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-mint font-bold mb-6 block">THE MATH</span>
          <h2 className="font-display font-black text-5xl md:text-7xl text-white tracking-tighter mb-8 leading-[1.0]">
            The cost of doing it the old way.
          </h2>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-center gap-12 md:gap-24 relative">
            
            {/* LEFT COLUMN: The Old Way */}
            <div className="relative flex flex-col items-center">
                <div className="text-[10px] font-mono font-bold text-red-500/50 uppercase tracking-[0.3em] mb-4">Human Team (Annual)</div>
                <div 
                    className={`font-jetbrains font-bold text-6xl md:text-8xl tracking-tight transition-colors duration-500 ${showX ? 'text-white/20' : 'text-red-500'} tabular-nums`}
                    style={{ textShadow: showX ? 'none' : '0 0 20px rgba(239,68,68,0.6)' }}
                >
                    €{leftCount.toLocaleString()}
                </div>
                
                {/* Aggressive Red X */}
                {showX && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <svg className="w-[120%] h-[120%] absolute -inset-[10%] overflow-visible">
                            <motion.line 
                                x1="10%" y1="90%" x2="90%" y2="10%" 
                                stroke="#EF4444" strokeWidth="12" strokeLinecap="round"
                                initial={{ strokeDasharray: 500, strokeDashoffset: 500 }}
                                animate={{ strokeDashoffset: 0 }}
                                transition={{ duration: 0.4, ease: "easeOut" }}
                            />
                            <motion.line 
                                x1="10%" y1="10%" x2="90%" y2="90%" 
                                stroke="#EF4444" strokeWidth="12" strokeLinecap="round"
                                initial={{ strokeDasharray: 500, strokeDashoffset: 500 }}
                                animate={{ strokeDashoffset: 0 }}
                                transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
                            />
                        </svg>
                    </div>
                )}
            </div>

            {/* DIVIDER */}
            <div className="w-full md:w-px h-px md:h-32 bg-white/10" />

            {/* RIGHT COLUMN: The New Way */}
            <div className="relative flex flex-col items-center">
                <div className="text-[10px] font-mono font-bold text-accent-cyan/60 uppercase tracking-[0.3em] mb-4">Pilot AI Workforce</div>
                
                <div 
                  className="font-jetbrains font-bold text-6xl md:text-8xl tracking-tight text-accent-mint tabular-nums"
                  style={{ textShadow: '0 0 30px rgba(0,255,148,0.8), 0 0 60px rgba(0,229,255,0.4)', color: '#D4FFEA' }}
                >
                    {showRight ? `€${rightCount.toLocaleString()}` : <span className="opacity-0">€1,788</span>}
                </div>

                {showParticles && <ParticleBurst />}
            </div>

        </div>

        
        <AnimatePresence>
            {showParticles && (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="mt-32 text-center"
                >
                    <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full fiesta-halo backdrop-blur-md bg-accent-cyan/10 border border-accent-cyan/30">
                        <div className="w-3 h-3 rounded-full bg-accent-cyan animate-pulse shadow-[0_0_10px_#00E5FF]" />
                        <span className="font-jetbrains font-bold text-white tracking-widest uppercase text-sm">Total Savings: €303,212</span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
        
      </div>
    </section>
  );
};

export default TimeMath;
