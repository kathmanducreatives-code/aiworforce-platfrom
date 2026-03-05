import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BadgeCheck, FileText, CheckCircle, ChevronRight, Mic, Star } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const AVATARS = [
    { id: 'AK', label: 'AI Engineer' },
    { id: 'MS', label: 'Legal' },
    { id: 'LC', label: 'Finance' },
    { id: 'DB', label: 'Design' },
    { id: 'RW', label: 'DevOps' },
    { id: 'PT', label: 'Data Sci' },
    { id: 'SG', label: 'Product' },
    { id: 'NV', label: 'Security' },
];

const SCORE_BARS = [
    { label: 'System Design', score: 98, color: '#10b981' },
    { label: 'Distributed Systems', score: 94, color: '#10b981' },
    { label: 'Communication', score: 91, color: '#818cf8' },
    { label: 'Problem Solving', score: 96, color: '#10b981' },
];

const IQ = [
    'Walk me through a system you designed at scale.',
    'How do you handle conflicting stakeholder priorities?',
    'Describe your approach to debugging in production.',
    "What's your experience with cross-functional AI deployment?",
];

/* ─────────────────────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────────────────────── */
export const ExpertMarketplace = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const avatarRefs = useRef<(HTMLDivElement | null)[]>([]);
    const cloudRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLDivElement>(null);
    const windowRef = useRef<HTMLDivElement>(null);   // glassmorphic profile card
    const jdAvatarRef = useRef<HTMLDivElement>(null);
    const jdCardRef = useRef<HTMLDivElement>(null);
    const scanLineRef = useRef<HTMLDivElement>(null);
    const verifiedRef = useRef<HTMLDivElement>(null);
    const statsRef = useRef<HTMLDivElement>(null);
    const scorecardRef = useRef<HTMLDivElement>(null);   // slide 2 scorecard panel
    const barRefs = useRef<(HTMLDivElement | null)[]>([]);
    const fitBadgeRef = useRef<HTMLDivElement>(null);
    const hubRef = useRef<HTMLDivElement>(null);   // slide 3 interview hub
    const hubPillRef = useRef<HTMLDivElement>(null);
    const hubQRefs = useRef<(HTMLDivElement | null)[]>([]);
    const ratingsRef = useRef<HTMLDivElement>(null);   // slide 4
    const ctaRef = useRef<HTMLButtonElement>(null);
    const ctaGlowRef = useRef<HTMLDivElement>(null);
    const powerLineRef = useRef<HTMLDivElement>(null);
    const powerDotRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            /* ── baseline hidden states ── */
            gsap.set(titleRef.current, { opacity: 0, y: 50 });
            gsap.set(cloudRef.current, { opacity: 0 });
            gsap.set(windowRef.current, { opacity: 0, y: 80 });
            gsap.set(jdAvatarRef.current, { opacity: 0, scale: 0 });
            gsap.set(jdCardRef.current, { opacity: 0, scaleY: 0, transformOrigin: 'top center' });
            gsap.set(statsRef.current, { opacity: 0, y: 20 });
            gsap.set(scanLineRef.current, { top: 0, opacity: 0 });
            gsap.set(verifiedRef.current, { opacity: 0, scale: 0 });

            gsap.set(scorecardRef.current, { opacity: 0, y: 50 });
            barRefs.current.forEach(b => b && gsap.set(b, { width: '0%' }));
            gsap.set(fitBadgeRef.current, { opacity: 0, scale: 0.8, y: 20 });

            gsap.set(hubRef.current, { opacity: 0, x: 120, y: 50 });
            gsap.set(hubPillRef.current, { opacity: 0, x: 40 });
            hubQRefs.current.forEach(q => q && gsap.set(q, { opacity: 0, x: 30 }));

            gsap.set(ratingsRef.current, { opacity: 0, y: 50 });
            gsap.set(ctaRef.current, { opacity: 0, y: 30, scale: 0.9 });
            gsap.set(ctaGlowRef.current, { opacity: 0 });

            /* ── Avatar initial scatter ── */
            avatarRefs.current.forEach((av, i) => {
                if (!av) return;
                const angle = (i / AVATARS.length) * Math.PI * 2;
                gsap.set(av, {
                    x: Math.cos(angle) * 420,
                    y: Math.sin(angle) * 320,
                    opacity: 0,
                    scale: 0.4,
                });
            });

            /* ── MAIN TIMELINE ── */
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top top',
                    end: '+=4200',
                    pin: true,
                    scrub: 1.5,
                    anticipatePin: 1,
                },
            });

            /* — power line grows full height — */
            tl.fromTo(powerLineRef.current,
                { height: '0%' },
                { height: '100%', duration: 20, ease: 'none' },
                0,
            );

            /* ══════════════════════════════════
               SLIDE 1 — AVATAR CLOUD (0 → 6)
            ═══════════════════════════════════ */

            // Title enters
            tl.to(titleRef.current, { opacity: 1, y: 0, duration: 2, ease: 'expo.out' }, 0);

            // Cloud becomes visible
            tl.to(cloudRef.current, { opacity: 1, duration: 0.5 }, 0);

            // Avatars converge toward center
            avatarRefs.current.forEach((av, i) => {
                if (!av) return;
                const angle = (i / AVATARS.length) * Math.PI * 2;
                const endDist = 130;
                tl.to(av, {
                    x: Math.cos(angle) * endDist,
                    y: Math.sin(angle) * endDist,
                    opacity: 0.7,
                    scale: 1,
                    duration: 2.5,
                    ease: 'power3.out',
                }, 0.2 + i * 0.1);
            });

            /* REVEAL — glassmorphic window slides up (t=5) */
            // Avatars scatter away
            avatarRefs.current.forEach((av, i) => {
                if (!av) return;
                const angle = (i / AVATARS.length) * Math.PI * 2;
                tl.to(av, {
                    x: Math.cos(angle) * 700,
                    y: Math.sin(angle) * 500,
                    opacity: 0,
                    scale: 0.2,
                    duration: 1.5,
                }, 4.5);
            });
            tl.to(titleRef.current, { opacity: 0, y: -30, duration: 1 }, 4.5);

            // Window slides up
            tl.to(windowRef.current, { opacity: 1, y: 0, duration: 2.5, ease: 'power3.out' }, 5);

            // JD avatar assembles
            tl.to(jdAvatarRef.current, { opacity: 1, scale: 1, duration: 1.5, ease: 'back.out(1.7)' }, 6.5);

            // Card unfolds
            tl.to(jdCardRef.current, { opacity: 1, scaleY: 1, duration: 1.5, ease: 'power3.out' }, 7.5);

            // Stats row
            tl.to(statsRef.current, { opacity: 1, y: 0, duration: 1, ease: 'power2.out' }, 8.5);

            // Scan line sweeps
            tl.to(scanLineRef.current, { opacity: 1, duration: 0.3 }, 9.2);
            tl.to(scanLineRef.current, { top: '100%', duration: 1.2, ease: 'none' }, 9.5);
            tl.to(scanLineRef.current, { opacity: 0, duration: 0.2 }, 10.7);

            // Verified pill snaps in
            tl.to(verifiedRef.current, {
                opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(2.5)',
                boxShadow: '0 0 20px rgba(34,197,94,0.5)',
            }, 10.5);

            /* ══════════════════════════════════
               SLIDE 2 — SCORECARD UNFOLD (11 → 16)
            ═══════════════════════════════════ */

            tl.to(scorecardRef.current, { opacity: 1, y: 0, duration: 1.8, ease: 'power3.out' }, 11);

            // Bars fill one by one
            SCORE_BARS.forEach((bar, i) => {
                const el = barRefs.current[i];
                if (!el) return;
                tl.to(el, {
                    width: `${bar.score}%`,
                    duration: 1.2,
                    ease: 'power2.out',
                }, 12 + i * 0.4);
            });

            // Overall fit badge
            tl.to(fitBadgeRef.current, {
                opacity: 1, scale: 1, y: 0, duration: 0.8, ease: 'back.out(2)',
                boxShadow: '0 0 20px rgba(20,184,166,0.6)',
            }, 14.5);

            /* ══════════════════════════════════
               SLIDE 3 — INTERVIEW HUB (16 → 20)
            ═══════════════════════════════════ */

            // Hub slides in from right
            tl.to(hubRef.current, { opacity: 1, x: 0, y: 0, duration: 2, ease: 'power3.out' }, 16);

            // Recording pill
            tl.to(hubPillRef.current, { opacity: 1, x: 0, duration: 1, ease: 'expo.out' }, 17);

            // Questions stagger in
            hubQRefs.current.forEach((q, i) => {
                if (!q) return;
                tl.to(q, { opacity: 1, x: 0, duration: 0.8, ease: 'power2.out' }, 17.5 + i * 0.3);
            });

            /* ══════════════════════════════════
               SLIDE 4 — CLOSE: RATINGS + CTA (20 → 24)
            ═══════════════════════════════════ */

            tl.to(ratingsRef.current, { opacity: 1, y: 0, duration: 1.5, ease: 'power3.out' }, 20);

            tl.to(ctaRef.current, {
                opacity: 1, y: 0, scale: 1, duration: 1.5, ease: 'back.out(1.5)',
            }, 21.5);

            tl.to(ctaGlowRef.current, { opacity: 1, duration: 0.5 }, 22.5);

            // CTA glow pulse cycles
            tl.to(ctaRef.current, {
                boxShadow: '0 0 60px rgba(34,197,94,0.9), 0 0 120px rgba(34,197,94,0.5)',
                duration: 1,
            }, 23);
            tl.to(ctaRef.current, {
                boxShadow: '0 0 20px rgba(34,197,94,0.4)',
                duration: 1,
            }, 24);

            // Power line dot HIGH-INTENSITY pulse at finish
            tl.to(powerDotRef.current, {
                opacity: 1,
                scale: 2.5,
                boxShadow: '0 0 60px 20px rgba(34,197,94,0.9)',
                duration: 0.8,
                ease: 'power2.out',
            }, 23);
            tl.to(powerDotRef.current, {
                scale: 1,
                boxShadow: '0 0 20px rgba(34,197,94,0.4)',
                duration: 1.2,
                ease: 'elastic.out(1,0.5)',
            }, 23.8);

            /* — refresh scrolltrigger after layout is calculated — */
            ScrollTrigger.refresh();

        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <>
            {/* ── FIXED blueprint grid — sits behind everything ── */}
            <div
                aria-hidden
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 0,
                    pointerEvents: 'none',
                    backgroundImage: `
            linear-gradient(rgba(34,197,94,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,197,94,0.07) 1px, transparent 1px)
          `,
                    backgroundSize: '100px 100px',
                }}
            />

            <section
                ref={sectionRef}
                className="relative w-full h-screen overflow-hidden font-display"
                style={{ background: '#000000', zIndex: 1 }}
            >

                {/* ── Vertical Power Line ── */}
                <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px z-[5] pointer-events-none"
                    style={{ background: 'rgba(34,197,94,0.08)' }}
                >
                    <div
                        ref={powerLineRef}
                        className="relative w-full"
                        style={{
                            height: '0%',
                            background: 'linear-gradient(180deg, #22c55e 0%, #10b981 100%)',
                            boxShadow: '0 0 12px rgba(34,197,94,0.8), 0 0 24px rgba(34,197,94,0.4)',
                        }}
                    >
                        {/* glowing dot */}
                        <div
                            ref={powerDotRef}
                            className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3 h-3 rounded-full bg-emerald-400"
                            style={{ boxShadow: '0 0 20px rgba(34,197,94,0.8)', opacity: 0 }}
                        />
                    </div>
                </div>

                {/* ── inner viewport ── */}
                <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex flex-col items-center justify-center">

                    {/* TITLE */}
                    <div ref={titleRef} className="absolute top-20 left-0 w-full text-center z-30 pointer-events-none">
                        <span className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80 font-semibold block mb-4">
                            ◆ Expert Marketplace
                        </span>
                        <span className="text-4xl md:text-5xl font-black text-white tracking-tight block">
                            Find the best expert to <br />
                            <span className="text-emerald-400">interview your candidate.</span>
                        </span>
                    </div>

                    {/* AVATAR CLOUD */}
                    <div ref={cloudRef} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none w-full max-w-2xl aspect-square">
                        {AVATARS.map((av, i) => (
                            <div
                                key={av.id}
                                ref={el => avatarRefs.current[i] = el}
                                className="absolute left-1/2 top-1/2 flex flex-col items-center gap-1"
                                style={{ marginLeft: -28, marginTop: -28 }}
                            >
                                <div className="w-14 h-14 rounded-full border border-emerald-500/30 bg-emerald-500/8 backdrop-blur flex items-center justify-center text-[11px] font-bold text-emerald-300/80 select-none shadow-[0_0_20px_rgba(34,197,94,0.15)]">
                                    {av.id}
                                </div>
                                <span className="text-[8px] font-semibold text-emerald-400/60 bg-black/60 px-1.5 py-0.5 rounded-full border border-emerald-500/15 whitespace-nowrap">
                                    {av.label}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* ══════════════════════════════════════════
              GLASSMORPHIC PROFILE WINDOW (slide 1+2)
          ══════════════════════════════════════════ */}
                    <div
                        ref={windowRef}
                        className="relative z-30 w-full max-w-4xl rounded-3xl p-8"
                        style={{
                            background: 'rgba(255,255,255,0.025)',
                            backdropFilter: 'blur(28px)',
                            WebkitBackdropFilter: 'blur(28px)',
                            border: '1px solid rgba(255,255,255,0.07)',
                            boxShadow: '0 40px 100px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                        }}
                    >
                        {/* glossy top edge */}
                        <div className="absolute top-0 left-0 right-0 h-px rounded-t-3xl"
                            style={{ background: 'linear-gradient(90deg,transparent,rgba(34,197,94,0.5),transparent)' }}
                        />

                        <div className="flex items-start gap-8">
                            {/* LEFT — Profile */}
                            <div className="flex flex-col items-center w-[260px] shrink-0">
                                {/* Avatar */}
                                <div
                                    ref={jdAvatarRef}
                                    className="relative w-20 h-20 rounded-2xl flex items-center justify-center text-emerald-400 font-bold text-2xl font-mono"
                                    style={{
                                        background: 'linear-gradient(135deg,rgba(34,197,94,0.2),rgba(5,46,22,0.6))',
                                        border: '2px solid rgba(34,197,94,0.4)',
                                        boxShadow: '0 0 40px rgba(34,197,94,0.15)',
                                    }}
                                >
                                    JD
                                    <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-emerald-500 rounded-full border-2 border-black flex items-center justify-center">
                                        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                    </div>
                                </div>

                                {/* Profile card */}
                                <div
                                    ref={jdCardRef}
                                    className="relative w-full rounded-2xl overflow-hidden -mt-3 pt-7"
                                    style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.05)' }}
                                >
                                    {/* Scan line */}
                                    <div
                                        ref={scanLineRef}
                                        className="absolute left-0 w-full h-[2px] z-50"
                                        style={{ boxShadow: '0 0 15px rgba(34,197,94,0.9)', background: '#22c55e' }}
                                    />
                                    <div className="flex flex-col items-center px-5 pb-5">
                                        <h3 className="text-xl font-bold text-white mb-1">Jane Doe</h3>
                                        <p className="text-zinc-500 text-sm mb-4">Principal Systems Architect</p>

                                        <div ref={statsRef} className="grid grid-cols-2 gap-3 w-full mb-4">
                                            <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
                                                <div className="text-[9px] text-emerald-500/70 uppercase tracking-[0.15em] mb-1 font-semibold">Match</div>
                                                <div className="text-xl font-bold text-emerald-400 tabular-nums">99%</div>
                                            </div>
                                            <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                <div className="text-[9px] text-zinc-600 uppercase tracking-[0.15em] mb-1">Experience</div>
                                                <div className="text-xl font-bold text-white tabular-nums">14y</div>
                                            </div>
                                        </div>

                                        <div
                                            ref={verifiedRef}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-emerald-400 text-xs font-semibold"
                                            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
                                        >
                                            <BadgeCheck className="w-3.5 h-3.5" /> Verified Top 1%
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* RIGHT — Scorecard (slide 2) + Interview hub (slide 3) */}
                            <div className="flex-1 flex flex-col gap-4 min-w-0">

                                {/* TECHNICAL SCORECARD */}
                                <div
                                    ref={scorecardRef}
                                    className="rounded-2xl p-5"
                                    style={{
                                        background: 'rgba(0,0,0,0.55)',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        backdropFilter: 'blur(12px)',
                                    }}
                                >
                                    <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                                        <h4 className="font-bold text-white text-sm tracking-wide">Technical Scorecard</h4>
                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-emerald-400" style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)' }}>
                                            Validated
                                        </span>
                                    </div>

                                    <div className="space-y-3 mb-4">
                                        {SCORE_BARS.map((bar, i) => (
                                            <div key={bar.label}>
                                                <div className="flex justify-between text-sm mb-1.5">
                                                    <span className="text-zinc-400 text-xs">{bar.label}</span>
                                                    <span className="font-bold tabular-nums text-xs" style={{ color: bar.color }}>{bar.score}/100</span>
                                                </div>
                                                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                    <div
                                                        ref={el => barRefs.current[i] = el}
                                                        className="h-full rounded-full"
                                                        style={{ width: '0%', background: `linear-gradient(90deg, ${bar.color}99, ${bar.color})` }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Overall Fit badge */}
                                    <div
                                        ref={fitBadgeRef}
                                        className="py-2.5 rounded-xl text-center font-bold text-sm"
                                        style={{
                                            color: '#2dd4bf',
                                            background: 'rgba(20,184,166,0.08)',
                                            border: '1px solid rgba(20,184,166,0.25)',
                                        }}
                                    >
                                        Overall Fit Score: <span className="text-base">95%</span>
                                    </div>
                                </div>

                                {/* ══════════════════════════════
                    INTERVIEW HUB (slide 3)
                ═════════════════════════════= */}
                                <div
                                    ref={hubRef}
                                    className="rounded-2xl p-5"
                                    style={{
                                        background: 'rgba(0,0,0,0.55)',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        backdropFilter: 'blur(12px)',
                                    }}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2 text-white font-semibold text-sm">
                                            <Mic className="w-4 h-4 text-rose-400" />
                                            Interview Hub
                                        </div>
                                        {/* Recording pill */}
                                        <div
                                            ref={hubPillRef}
                                            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full"
                                            style={{
                                                background: 'rgba(236,72,153,0.1)',
                                                border: '1px solid rgba(236,72,153,0.25)',
                                                color: '#f472b6',
                                            }}
                                        >
                                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                                            Recording Saved & Analyzed
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        {IQ.map((q, i) => (
                                            <div
                                                key={i}
                                                ref={el => hubQRefs.current[i] = el}
                                                className="flex items-start gap-3"
                                            >
                                                <span className="text-[10px] font-bold text-rose-400/70 mt-0.5 font-mono w-4 shrink-0">0{i + 1}</span>
                                                <div className="flex-1 pl-3 border-l-2" style={{ borderColor: 'rgba(236,72,153,0.35)' }}>
                                                    <p className="text-zinc-400 text-xs leading-snug">{q}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Stat pills */}
                                    <div className="mt-3 flex gap-2 flex-wrap">
                                        {['Duration: 42 min', 'Transcript: Ready', 'Confidence: High'].map(s => (
                                            <span key={s} className="text-[10px] px-2 py-1 rounded-full text-zinc-500" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                                {s}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                            </div>
                        </div>

                        {/* ══════════════════════════════
                SLIDE 4 — RATINGS + CTA
            ═════════════════════════════= */}
                        <div
                            ref={ratingsRef}
                            className="mt-6 flex items-center justify-between pt-5"
                            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                        >
                            <div className="flex items-center gap-4">
                                <div>
                                    <div className="text-[10px] text-zinc-600 uppercase tracking-[0.15em] mb-1">Final Rating</div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-3xl font-black text-amber-400 tabular-nums">4.9</span>
                                        <span className="text-zinc-600 text-sm">/ 5.0</span>
                                    </div>
                                </div>
                                <div className="flex gap-0.5">
                                    {[...Array(5)].map((_, i) => (
                                        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                                    ))}
                                </div>
                                <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>
                                    Top 3% of Platform
                                </span>
                            </div>

                            {/* CTA */}
                            <div className="relative">
                                <div ref={ctaGlowRef} className="absolute -inset-4 rounded-2xl blur-xl pointer-events-none" style={{ background: 'rgba(34,197,94,0.2)' }} />
                                <button
                                    ref={ctaRef}
                                    className="relative flex items-center gap-2 font-bold text-sm px-7 py-3.5 rounded-xl"
                                    style={{
                                        background: '#22c55e',
                                        color: '#000',
                                        boxShadow: '0 0 20px rgba(34,197,94,0.4)',
                                    }}
                                >
                                    Request Expert <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                    </div>{/* /max-w-4xl window */}
                </div>{/* /inner */}
            </section>
        </>
    );
};

export default ExpertMarketplace;
