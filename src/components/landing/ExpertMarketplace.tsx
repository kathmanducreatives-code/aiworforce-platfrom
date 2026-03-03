import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BadgeCheck, FileText, CheckCircle, ChevronRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const AVATARS = ['AK', 'MS', 'LC', 'DB', 'RW', 'PT', 'SG', 'NV'];

export const ExpertMarketplace = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const avatarCloudRef = useRef<(HTMLDivElement | null)[]>([]);
    const windowRef = useRef<HTMLDivElement>(null);
    const avatarRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const scanRef = useRef<HTMLDivElement>(null);
    const verifiedRef = useRef<HTMLDivElement>(null);
    const statsRef = useRef<HTMLDivElement>(null);
    const recordingRef = useRef<HTMLDivElement>(null);
    const scorecardRef = useRef<HTMLDivElement>(null);
    const ctaRef = useRef<HTMLButtonElement>(null);
    const ctaGlowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top top',
                    end: '+=4000',
                    pin: true,
                    scrub: 2.5,
                    anticipatePin: 1,
                }
            });

            // Power line grows from top to bottom
            tl.fromTo('.em-power-line', { height: '0%' }, { height: '100%', duration: 20, ease: 'none' }, 0);

            // =============================================
            // SLIDE 1: THE CLOUD (0 → 5)
            // =============================================

            // Title flies in
            tl.fromTo('.em-title', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.5, ease: 'expo.out' }, 0);

            // Avatars fly in from edges
            gsap.set(avatarCloudRef.current, { scale: 0, opacity: 0 });
            avatarCloudRef.current.forEach((avatar, i) => {
                const angle = (i / AVATARS.length) * Math.PI * 2;
                const startDist = 500;
                const endDist = 120;
                tl.fromTo(avatar,
                    { x: Math.cos(angle) * startDist, y: Math.sin(angle) * startDist, opacity: 0, scale: 0.3 },
                    { x: Math.cos(angle) * endDist, y: Math.sin(angle) * endDist, opacity: 0.6, scale: 1, duration: 2.5, ease: 'power3.out' },
                    0.3 + i * 0.1
                );
            });

            // =============================================
            // SLIDE 2: WINDOW SLIDES UP + ASSEMBLY (5 → 12)
            // =============================================

            // Glassmorphism window slides up from bottom
            gsap.set(windowRef.current, { y: '100vh', opacity: 0 });
            gsap.set(avatarRef.current, { scale: 0, opacity: 0 });
            gsap.set(cardRef.current, { scaleY: 0, opacity: 0, transformOrigin: 'top center' });
            gsap.set(scanRef.current, { top: 0, opacity: 0 });
            gsap.set(verifiedRef.current, { scale: 0, opacity: 0 });
            gsap.set(statsRef.current, { opacity: 0, y: 20 });

            // Fade out peripheral avatars
            avatarCloudRef.current.forEach((avatar, i) => {
                const angle = (i / AVATARS.length) * Math.PI * 2;
                tl.to(avatar, {
                    x: Math.cos(angle) * 600, y: Math.sin(angle) * 600,
                    opacity: 0, scale: 0.2, duration: 2
                }, 4.5);
            });

            // Fade title
            tl.to('.em-title', { opacity: 0, y: -30, duration: 1 }, 4.5);

            // Window slides up
            tl.to(windowRef.current, { y: 0, opacity: 1, duration: 2.5, ease: 'power3.out' }, 5);

            // JD avatar assembles inside window
            tl.to(avatarRef.current, { scale: 1, opacity: 1, duration: 1.5, ease: 'back.out(1.7)' }, 6);

            // Card unfolds
            tl.to(cardRef.current, { scaleY: 1, opacity: 1, duration: 1.5, ease: 'power3.out' }, 7);

            // Stats
            tl.to(statsRef.current, { opacity: 1, y: 0, duration: 1, ease: 'power2.out' }, 8);

            // Scan line
            tl.to(scanRef.current, { opacity: 1, duration: 0.2 }, 9);
            tl.to(scanRef.current, { top: '100%', duration: 1, ease: 'none' }, 9.2);
            tl.to(scanRef.current, { opacity: 0, duration: 0.2 }, 10.2);

            // Verified badge
            tl.to(verifiedRef.current, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(3)' }, 10);
            tl.to(verifiedRef.current, { boxShadow: '0 0 25px rgba(34,197,94,0.5)', duration: 0.3 }, 10.5);
            tl.to(verifiedRef.current, { boxShadow: '0 0 8px rgba(34,197,94,0.2)', duration: 0.4 }, 10.8);

            // =============================================
            // SLIDE 3: HUB DOCKING (12 → 16)
            // =============================================
            gsap.set(recordingRef.current, { x: 200, opacity: 0 });
            gsap.set(scorecardRef.current, { x: 200, opacity: 0, y: 20 });

            // Recording pill flies in
            tl.to(recordingRef.current, { x: 0, opacity: 1, duration: 1.5, ease: 'power3.out' }, 12);

            // Scorecard slides in
            tl.to(scorecardRef.current, { x: 0, y: 0, opacity: 1, duration: 1.5, ease: 'power3.out' }, 13);

            // =============================================
            // SLIDE 4: CTA GLOW (16 → 20)
            // =============================================
            gsap.set(ctaRef.current, { opacity: 0, y: 30, scale: 0.9 });
            gsap.set(ctaGlowRef.current, { opacity: 0 });

            tl.to(ctaRef.current, { opacity: 1, y: 0, scale: 1, duration: 1.5, ease: 'back.out(1.5)' }, 16);
            tl.to(ctaGlowRef.current, { opacity: 1, duration: 0.5 }, 17);
            tl.to(ctaRef.current, {
                boxShadow: '0 0 60px rgba(34,197,94,0.8), 0 0 120px rgba(34,197,94,0.4)', duration: 1
            }, 17);
            tl.to(ctaRef.current, {
                boxShadow: '0 0 30px rgba(34,197,94,0.5), 0 0 60px rgba(34,197,94,0.2)', duration: 1
            }, 18);
            tl.to(ctaRef.current, {
                boxShadow: '0 0 60px rgba(34,197,94,0.8), 0 0 120px rgba(34,197,94,0.4)', duration: 1
            }, 19);

        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section
            ref={sectionRef}
            className="relative w-full h-screen overflow-hidden font-display"
            style={{ background: '#000000' }}
        >
            {/* Blueprint Grid */}
            <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: `linear-gradient(rgba(34,197,94,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.1) 1px, transparent 1px)`,
                backgroundSize: '100px 100px',
            }} />

            {/* Vertical Power Line */}
            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-emerald-500/10 z-[5] pointer-events-none">
                <div className="em-power-line relative w-full bg-emerald-500" style={{ height: '0%', boxShadow: '0 0 12px rgba(34,197,94,0.8), 0 0 24px rgba(34,197,94,0.4)' }}>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_20px_4px_rgba(34,197,94,0.8)] animate-ping" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)]" />
                </div>
            </div>

            <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex flex-col items-center justify-center">

                {/* Title */}
                <div className="em-title absolute top-20 left-0 w-full text-center z-30">
                    <span className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80 font-semibold block mb-4">◆ Expert Marketplace</span>
                    <span className="text-4xl md:text-5xl font-black text-white tracking-tight block">
                        Find the best expert to <br />
                        <span className="text-emerald-400">interview your candidate.</span>
                    </span>
                </div>

                {/* Avatar Cloud */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none w-full h-full">
                    {AVATARS.map((init, i) => (
                        <div
                            key={init}
                            ref={el => avatarCloudRef.current[i] = el}
                            className="absolute left-1/2 top-1/2 -ml-5 -mt-5 w-10 h-10 rounded-full border border-emerald-500/20 bg-emerald-500/5 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-emerald-400/60"
                        >
                            {init}
                        </div>
                    ))}
                </div>

                {/* GLASSMORPHISM WINDOW (slides up) */}
                <div
                    ref={windowRef}
                    className="relative z-30 w-full max-w-4xl bg-white/[0.03] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-8 shadow-[0_0_80px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,255,255,0.05)]"
                >
                    {/* Glossy edge */}
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent rounded-t-3xl" />

                    <div className="flex items-start gap-8">
                        {/* LEFT: Profile */}
                        <div className="flex flex-col items-center w-[280px] shrink-0">
                            {/* Central Avatar */}
                            <div
                                ref={avatarRef}
                                className="relative z-40 w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-900/60 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-2xl font-mono shadow-[0_0_40px_rgba(34,197,94,0.15)]"
                            >
                                JD
                                <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-emerald-500 rounded-full border-2 border-black flex items-center justify-center">
                                    <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                </div>
                            </div>

                            {/* Profile Card */}
                            <div
                                ref={cardRef}
                                className="relative w-full bg-black/60 border border-white/5 rounded-2xl -mt-3 pt-6 overflow-hidden"
                            >
                                <div ref={scanRef} className="absolute left-0 w-full h-[2px] bg-emerald-400 z-50" style={{ boxShadow: '0 0 15px rgba(34,197,94,0.8)' }} />

                                <div className="flex flex-col items-center px-5 pb-5">
                                    <h3 className="text-xl font-bold text-white mb-1">Jane Doe</h3>
                                    <p className="text-zinc-500 text-sm mb-4">Principal Systems Architect</p>

                                    <div ref={statsRef} className="grid grid-cols-2 gap-3 w-full mb-4">
                                        <div className="bg-emerald-500/10 border border-emerald-500/15 p-3 rounded-xl text-center">
                                            <div className="text-[10px] text-emerald-500/70 uppercase tracking-[0.15em] mb-1 font-semibold">Match</div>
                                            <div className="text-xl font-bold text-emerald-400 tabular-nums">99%</div>
                                        </div>
                                        <div className="bg-white/[0.03] border border-white/5 p-3 rounded-xl text-center">
                                            <div className="text-[10px] text-zinc-600 uppercase tracking-[0.15em] mb-1">Experience</div>
                                            <div className="text-xl font-bold text-white tabular-nums">14y</div>
                                        </div>
                                    </div>

                                    <div ref={verifiedRef} className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full flex items-center gap-2 font-semibold text-xs">
                                        <BadgeCheck className="w-3.5 h-3.5" /> Verified Top 1%
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT: Hub */}
                        <div className="flex-1 flex flex-col gap-4 pt-4">
                            {/* Recording Pill */}
                            <div ref={recordingRef} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-2.5 rounded-full flex items-center gap-3 font-semibold text-sm backdrop-blur-md self-start">
                                <FileText className="w-4 h-4" />
                                Recording Saved & Analyzed
                                <CheckCircle className="w-4 h-4 text-emerald-500" />
                            </div>

                            {/* Scorecard */}
                            <div ref={scorecardRef} className="bg-black/60 border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
                                <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
                                    <h4 className="font-bold text-base text-white">Technical Scorecard</h4>
                                    <span className="text-xs font-mono bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">Validated</span>
                                </div>

                                <div className="space-y-3 mb-5">
                                    {[
                                        { name: 'System Design', score: 98 },
                                        { name: 'Concurrency (Python)', score: 94 },
                                        { name: 'Problem Solving', score: 96 },
                                    ].map(s => (
                                        <div key={s.name}>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="text-zinc-400">{s.name}</span>
                                                <span className="text-emerald-400 font-bold tabular-nums">{s.score}/100</span>
                                            </div>
                                            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                                <div className="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-full" style={{ width: `${s.score}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* CTA */}
                                <div className="relative">
                                    <div ref={ctaGlowRef} className="absolute -inset-3 bg-emerald-500/20 rounded-2xl blur-xl pointer-events-none" />
                                    <button ref={ctaRef} className="relative w-full bg-emerald-500 text-black font-bold text-base px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-95">
                                        Request Expert <ChevronRight className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
