import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CheckCircle, XCircle } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const oldWayItems = [
    'Post job → wait 3–4 weeks',
    'Agency sends 3 candidates → pay €15,000 upfront',
    'Screen manually → 45 hours per search',
    'Get 30–50 candidates. Maybe.',
    'Bad hire → €60,000 lost. Repeat next quarter.',
];

const newWayItems = [
    'Paste one profile → AI activates instantly',
    'AI scores all candidates instantly',
    'Get ranked shortlist in 15 minutes',
    'Zero agency fees',
    'One dashboard, unlimited hires',
];

export const TransformationSection = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const leftRef = useRef<HTMLDivElement>(null);
    const rightRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<SVGCircleElement>(null);
    const newWayContainerRef = useRef<HTMLDivElement>(null);

    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const section = sectionRef.current;
        if (!section) return;

        // Reset initial states
        gsap.set(rightRef.current, { opacity: 0, x: 80 });
        gsap.set(newWayContainerRef.current?.querySelectorAll('.new-item'), { opacity: 0, x: 20 });
        gsap.set(leftRef.current, { opacity: 1 });

        const ctx = gsap.context(() => {
            // Main Scrub Timeline
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: section,
                    start: 'center center',
                    end: '+=1200',
                    pin: true,
                    scrub: 0.8,
                    fastScrollEnd: true,
                    onUpdate: (self) => {
                        const p = Math.round(self.progress * 100);
                        setProgress(p);

                        if (p < 50) {
                            document.documentElement.style.setProperty('--grid-pulse', `${2 - (p / 50)}s`);
                        } else {
                            document.documentElement.style.setProperty('--grid-pulse', '1s');
                        }
                    }
                }
            });

            // 0 - 50%: Scanning Ring grows
            tl.to(ringRef.current, {
                strokeDashoffset: 0,
                duration: 0.5,
                ease: "none"
            }, 0);

            // 30% - 60%: Old way fades (opacity only, no blur)
            tl.to(leftRef.current, {
                opacity: 0.3,
                duration: 0.3
            }, 0.3);

            // 55% - 85%: New way flies in (opacity only, no blur)
            tl.to(rightRef.current, {
                opacity: 1,
                x: 0,
                duration: 0.3,
                ease: "power2.out"
            }, 0.55);

            // Stagger in the new items
            if (newWayContainerRef.current) {
                const items = newWayContainerRef.current.querySelectorAll('.new-item');
                tl.to(items, {
                    opacity: 1,
                    x: 0,
                    stagger: 0.02,
                    duration: 0.15
                }, 0.65);
            }

        }, section);

        return () => ctx.revert();
    }, []);

    // Ring Math
    const radius = 160;
    const circumference = 2 * Math.PI * radius;
    // Let CSS handle the dash offset via GSAP, but initialize it empty

    return (
        <section ref={sectionRef} className="relative w-full min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden text-white font-display z-10">

            <div className="text-center mb-[60px] w-full max-w-6xl">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] mb-4 text-emerald-500 font-semibold flex items-center justify-center gap-2">
                    THE TRANSFORMATION
                </p>
                <h2 className="font-black text-[clamp(2.5rem,5vw,4.5rem)] leading-[1.0] tracking-[-0.05em] text-white">
                    FROM AGENCY DEPENDENCY<br />TO TOTAL CONTROL
                </h2>
            </div>

            <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-8 items-center relative">

                {/* Left — Old Way */}
                <div ref={leftRef} className="mt-4 lg:mt-8">
                    <div className="bg-black/80 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-2xl relative overflow-hidden h-full flex flex-col">
                        <h3 className="font-display font-bold text-xl text-white/30 mb-6 uppercase tracking-wide">The Old Way</h3>
                        <div className="space-y-4 flex-grow">
                            {oldWayItems.map((item, i) => (
                                <div key={i} className="flex items-start gap-4 opp-item opacity-80">
                                    <XCircle className="w-5 h-5 text-muted-foreground/60 shrink-0 mt-0.5" />
                                    <span className="text-[15px] text-white/40 font-light">{item}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-8 font-mono text-xs text-white/40 border-t border-white/10 pt-4 bg-card/50 -mx-8 -mb-8 px-8 pb-8">
                            COST: €82,000/year + 340 hours
                        </div>
                    </div>
                </div>

                {/* Center — The Interactive Scanner */}
                <div className="flex flex-col items-center justify-start relative z-20 my-10 lg:my-0 lg:mt-4">
                    <div className="relative w-[300px] h-[300px] md:w-[350px] md:h-[350px]">
                        {/* Background Track Circle */}
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 340 340">
                            <circle cx="170" cy="170" r="160" stroke="rgba(255,255,255,0.05)" strokeWidth="4" fill="none" />
                            {/* Progress Circle (Controlled by GSAP) */}
                            <circle
                                ref={ringRef}
                                cx="170" cy="170" r="160"
                                stroke="#22c55e"
                                strokeWidth="6"
                                fill="none"
                                strokeDasharray={circumference}
                                strokeDashoffset={circumference}
                                strokeLinecap="round"
                                style={{
                                    filter: progress === 100 ? 'drop-shadow(0 0 15px rgba(34,197,94,0.6))' : 'none',
                                    transition: 'filter 0.3s ease'
                                }}
                            />
                        </svg>

                        {/* Inner Content Component (Fading) */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <div className="relative w-full h-full flex items-center justify-center">
                                {/* Scanning State */}
                                <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-[1500ms] ease-in-out ${progress < 100 ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
                                    <p className="font-display font-bold text-lg text-emerald-500 mb-2">
                                        {progress < 30 ? 'SCANNING...' : progress < 70 ? 'ANALYZING...' : 'MATCHING...'}
                                    </p>
                                    <p className="font-mono text-5xl text-emerald-500 font-light tabular-nums tracking-tighter shadow-emerald-500/20 drop-shadow-lg [text-shadow:0_0_20px_rgba(34,197,94,0.4)]">
                                        {progress}%
                                    </p>
                                </div>
                                {/* Complete State */}
                                <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-[1500ms] ease-in-out ${progress === 100 ? 'opacity-100 scale-100' : 'opacity-0 scale-105 pointer-events-none'}`}>
                                    <p className="font-display font-bold text-xl text-emerald-500 mb-3 tracking-widest [text-shadow:0_0_15px_rgba(34,197,94,0.5)]">COMPLETE</p>
                                    <CheckCircle className="w-16 h-16 text-emerald-500 [filter:drop-shadow(0_0_10px_rgba(34,197,94,0.6))]" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right — New Way */}
                <div ref={rightRef} className="relative z-30 mt-4 lg:mt-8">
                    <div ref={newWayContainerRef} className="bg-card backdrop-blur-xl rounded-2xl p-8 border border-emerald-500/30 shadow-[0_0_40px_rgba(34,197,94,0.15)] relative overflow-hidden h-full flex flex-col">
                        {/* Glossy top edge */}
                        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent opacity-50" />

                        <h3 className="font-display font-black text-xl text-emerald-500 mb-6 uppercase tracking-wide">The ScreeningPilot Way</h3>
                        <div className="space-y-4 flex-grow">
                            {newWayItems.map((item, i) => (
                                <div key={i} className="flex items-start gap-4 new-item">
                                    <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                    <span className="text-[15px] text-white/90 font-medium drop-shadow-md">{item}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-8 font-mono text-xs border-t border-emerald-500/10 pt-6">
                            <div className="bg-primary rounded-lg p-3 text-white shadow-[0_8px_20px_rgba(16,185,129,0.4)] flex justify-between items-center text-sm font-bold tracking-wide border border-white/20">
                                <span>€149/MONTH</span>
                                <span>·</span>
                                <span>UNLIMITED HIRES</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>
    );
};
