import React, { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────
   DATA
───────────────────────────────────────────────────────────── */

const AVATAR_DATA = [
    { initials: 'AK', role: 'AI Engineer', size: 72, top: '10%', left: '8%' },
    { initials: 'MS', role: 'Legal', size: 52, top: '18%', left: '72%' },
    { initials: 'LC', role: 'Finance', size: 64, top: '55%', left: '80%' },
    { initials: 'DB', role: 'Design', size: 56, top: '72%', left: '12%' },
    { initials: 'RW', role: 'DevOps', size: 68, top: '40%', left: '5%' },
    { initials: 'PT', role: 'Data Science', size: 48, top: '8%', left: '44%' },
    { initials: 'SG', role: 'Product', size: 60, top: '78%', left: '60%' },
    { initials: 'NV', role: 'Security', size: 52, top: '62%', left: '38%' },
    { initials: 'YT', role: 'ML Research', size: 72, top: '30%', left: '88%' },
    { initials: 'BO', role: 'Blockchain', size: 48, top: '85%', left: '30%' },
];

const SCORE_BARS = [
    { label: 'System Design', score: 98, color: 'from-teal-500 to-teal-400' },
    { label: 'Distributed Systems', score: 94, color: 'from-teal-600 to-teal-500' },
    { label: 'Communication', score: 91, color: 'from-indigo-500 to-indigo-400' },
    { label: 'Problem Solving', score: 96, color: 'from-teal-500 to-teal-400' },
];

const INTERVIEW_QUESTIONS = [
    'Walk me through a system you designed at scale.',
    'How do you handle conflicting stakeholder priorities?',
    'Describe your approach to debugging in production.',
    "What's your experience with cross-functional AI deployment?",
];

/* ─────────────────────────────────────────────────────────────
   HOOK — returns true once the ref element is visible
───────────────────────────────────────────────────────────── */
function useInView(ref: React.RefObject<HTMLElement | null>, threshold = 0.35) {
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } },
            { threshold }
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [ref, threshold]);
    return inView;
}

/* ─────────────────────────────────────────────────────────────
   CARD 1 — SOURCING (indigo)
───────────────────────────────────────────────────────────── */
function Card1Panel({ inView }: { inView: boolean }) {
    const [janeVisible, setJaneVisible] = useState(false);

    useEffect(() => {
        if (inView) {
            const t = setTimeout(() => setJaneVisible(true), 1600);
            return () => clearTimeout(t);
        }
    }, [inView]);

    return (
        <div className="relative w-full h-full min-h-[340px] overflow-hidden rounded-2xl"
            style={{ background: 'rgba(99,102,241,0.04)' }}>
            {/* Radial glow top-right */}
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle at top right, rgba(99,102,241,0.22), transparent 70%)' }} />

            {/* Avatar cloud */}
            {AVATAR_DATA.map((a, i) => (
                <div
                    key={a.initials}
                    className="absolute flex flex-col items-center gap-1 transition-all"
                    style={{
                        top: a.top,
                        left: a.left,
                        opacity: inView ? (janeVisible ? 0.25 : 0.85) : 0,
                        transform: inView ? 'scale(1)' : 'scale(0.4)',
                        transitionDelay: `${i * 0.09}s`,
                        transitionDuration: '0.7s',
                        transitionProperty: 'opacity, transform',
                        willChange: 'transform, opacity',
                    }}
                >
                    <div
                        className="rounded-full border-2 border-indigo-400/40 bg-indigo-500/10 flex items-center justify-center font-bold text-indigo-300 select-none"
                        style={{ width: a.size, height: a.size, fontSize: a.size * 0.28 }}
                    >
                        {a.initials}
                    </div>
                    <span className="text-[9px] font-semibold text-indigo-300/70 bg-indigo-500/10 px-1.5 py-0.5 rounded-full border border-indigo-400/20 whitespace-nowrap">
                        {a.role}
                    </span>
                </div>
            ))}

            {/* Jane Doe card */}
            <div
                className="absolute inset-x-4 bottom-4 rounded-2xl p-5 flex items-center gap-4 transition-all duration-700"
                style={{
                    background: 'rgba(10,10,20,0.9)',
                    border: '1px solid rgba(99,102,241,0.35)',
                    boxShadow: janeVisible ? '0 0 30px rgba(99,102,241,0.4)' : 'none',
                    opacity: janeVisible ? 1 : 0,
                    transform: janeVisible ? 'translateY(0)' : 'translateY(30px)',
                    backdropFilter: 'blur(16px)',
                    willChange: 'transform, opacity',
                }}
            >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-900/60 border-2 border-indigo-400/50 flex items-center justify-center text-indigo-300 font-bold text-lg shrink-0">
                    JD
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-base">Jane Doe</p>
                    <p className="text-zinc-400 text-sm">Senior AI Consultant</p>
                </div>
                <span className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Available Now
                </span>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   CARD 2 — SCREENING (teal)
───────────────────────────────────────────────────────────── */
function Card2Panel({ inView }: { inView: boolean }) {
    const [barsActive, setBarsActive] = useState(false);
    const [badgeVisible, setBadgeVisible] = useState(false);

    useEffect(() => {
        if (inView) {
            const t1 = setTimeout(() => setBarsActive(true), 300);
            const t2 = setTimeout(() => setBadgeVisible(true), 1800);
            return () => { clearTimeout(t1); clearTimeout(t2); };
        }
    }, [inView]);

    return (
        <div className="relative w-full h-full min-h-[340px] rounded-2xl p-6 overflow-hidden"
            style={{ background: 'rgba(20,184,166,0.04)' }}>
            {/* Radial glow */}
            <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
                style={{ background: 'radial-gradient(circle at top right, rgba(20,184,166,0.22), transparent 70%)' }} />

            {/* Header */}
            <div
                className="mb-5 pb-3 border-b border-white/8 transition-all duration-500"
                style={{ opacity: inView ? 1 : 0, transform: inView ? 'translateX(0)' : 'translateX(20px)', transitionDelay: '0.1s' }}
            >
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-400">Technical Scorecard</p>
                <div className="mt-1 h-px w-16 bg-gradient-to-r from-teal-400 to-transparent" />
            </div>

            {/* Skill bars */}
            <div className="space-y-4 mb-6">
                {SCORE_BARS.map((bar, i) => (
                    <div
                        key={bar.label}
                        className="transition-all duration-500"
                        style={{
                            opacity: inView ? 1 : 0,
                            transform: inView ? 'translateX(0)' : 'translateX(20px)',
                            transitionDelay: `${0.15 + i * 0.15}s`,
                        }}
                    >
                        <div className="flex justify-between text-sm mb-1.5">
                            <span className="text-zinc-300">{bar.label}</span>
                            <span className="text-teal-400 font-bold tabular-nums">{bar.score}/100</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full bg-gradient-to-r ${bar.color} transition-all duration-[800ms] ease-out`}
                                style={{
                                    width: barsActive ? `${bar.score}%` : '0%',
                                    transitionDelay: `${i * 0.15}s`,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>

            {/* Overall fit badge */}
            <div
                className="flex items-center justify-center py-3 rounded-xl font-bold text-teal-300 transition-all duration-700"
                style={{
                    background: 'rgba(20,184,166,0.1)',
                    border: '1px solid rgba(20,184,166,0.3)',
                    boxShadow: badgeVisible ? '0 0 20px rgba(20,184,166,0.5)' : 'none',
                    opacity: badgeVisible ? 1 : 0,
                    transform: badgeVisible ? 'scale(1)' : 'scale(0.9)',
                    animation: badgeVisible ? 'teal-pulse 2s ease-in-out infinite' : undefined,
                }}
            >
                Overall Fit Score: <span className="ml-2 text-lg">95%</span>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   CARD 3 — INTERVIEW HUB (rose)
───────────────────────────────────────────────────────────── */
function Card3Panel({ inView }: { inView: boolean }) {
    return (
        <div className="relative w-full h-full min-h-[340px] rounded-2xl p-6 overflow-hidden"
            style={{ background: 'rgba(236,72,153,0.04)' }}>
            {/* Radial glow */}
            <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
                style={{ background: 'radial-gradient(circle at top right, rgba(236,72,153,0.22), transparent 70%)' }} />

            {/* Jane header strip */}
            <div
                className="flex items-center gap-3 mb-4 pb-3 border-b border-white/8 transition-all duration-500"
                style={{ opacity: inView ? 1 : 0, transform: inView ? 'translateX(0)' : 'translateX(30px)', transitionDelay: '0.1s' }}
            >
                <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-400/30 flex items-center justify-center text-rose-300 font-bold text-sm shrink-0">JD</div>
                <div>
                    <p className="text-white font-semibold text-sm leading-none">Jane Doe</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Senior AI Consultant</p>
                </div>
                {/* Recording pill */}
                <div
                    className="ml-auto flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full transition-all duration-500"
                    style={{
                        background: 'rgba(236,72,153,0.12)',
                        border: '1px solid rgba(236,72,153,0.3)',
                        color: '#f472b6',
                        opacity: inView ? 1 : 0,
                        transform: inView ? 'translateX(0)' : 'translateX(30px)',
                        transitionDelay: '0.25s',
                    }}
                >
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    Recording Saved &amp; Analyzed
                </div>
            </div>

            {/* Questions */}
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-400 mb-3" style={{ opacity: inView ? 1 : 0, transition: 'opacity 0.4s 0.3s' }}>
                Questions Prepared
            </p>
            <div className="space-y-2.5">
                {INTERVIEW_QUESTIONS.map((q, i) => (
                    <div
                        key={i}
                        className="flex items-start gap-3 transition-all duration-500"
                        style={{
                            opacity: inView ? 1 : 0,
                            transform: inView ? 'translateX(0)' : 'translateX(30px)',
                            transitionDelay: `${0.35 + i * 0.12}s`,
                        }}
                    >
                        <span className="shrink-0 text-[10px] font-bold text-rose-400/70 mt-0.5 font-mono w-4">0{i + 1}</span>
                        <div className="flex-1 pl-3 border-l-2 border-rose-500/40">
                            <p className="text-zinc-300 text-sm leading-snug">{q}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Bottom stat pills */}
            <div
                className="mt-4 flex gap-2 flex-wrap transition-all duration-500"
                style={{ opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(10px)', transitionDelay: '0.85s' }}
            >
                {['Duration: 42 min', 'Transcript: Ready', 'Confidence: High'].map(s => (
                    <span key={s} className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-zinc-400">{s}</span>
                ))}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   CARD 4 — RATING & FEEDBACK (amber)
───────────────────────────────────────────────────────────── */
function Card4Panel({ inView, onUnlock }: { inView: boolean; onUnlock: () => void }) {
    const [starsActive, setStarsActive] = useState(false);
    const [scoreVisible, setScoreVisible] = useState(false);
    const [ctaVisible, setCtaVisible] = useState(false);

    useEffect(() => {
        if (inView) {
            const t1 = setTimeout(() => setStarsActive(true), 900);
            const t2 = setTimeout(() => setScoreVisible(true), 1400);
            const t3 = setTimeout(() => { setCtaVisible(true); onUnlock(); }, 1900);
            return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
        }
    }, [inView, onUnlock]);

    return (
        <div className="relative w-full h-full min-h-[340px] rounded-2xl p-6 overflow-hidden"
            style={{ background: 'rgba(245,158,11,0.04)' }}>
            {/* Radial glow */}
            <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
                style={{ background: 'radial-gradient(circle at top right, rgba(245,158,11,0.22), transparent 70%)' }} />

            {/* Jane strip */}
            <div
                className="flex items-center gap-3 mb-4 pb-3 border-b border-white/8 transition-all duration-500"
                style={{ opacity: inView ? 1 : 0, transform: inView ? 'translateX(0)' : 'translateX(30px)', transitionDelay: '0.1s' }}
            >
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300 font-bold text-sm shrink-0">JD</div>
                <div>
                    <p className="text-white font-semibold text-sm leading-none">Jane Doe</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Senior AI Consultant</p>
                </div>
            </div>

            {/* Client quote */}
            <div
                className="rounded-xl p-4 mb-4 transition-all duration-500"
                style={{
                    background: 'rgba(245,158,11,0.06)',
                    border: '1px solid rgba(245,158,11,0.15)',
                    opacity: inView ? 1 : 0,
                    transform: inView ? 'translateX(0)' : 'translateX(30px)',
                    transitionDelay: '0.25s',
                }}
            >
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300 font-bold text-[10px]">MT</div>
                    <div>
                        <p className="text-white font-semibold text-xs">Mark T.</p>
                        <p className="text-zinc-500 text-[10px]">CTO at Vercel</p>
                    </div>
                </div>
                <p className="text-zinc-300 text-sm leading-relaxed italic">
                    "Jane delivered an exceptional architecture review — 3 days ahead of schedule. Will hire again."
                </p>
            </div>

            {/* Stars */}
            <div
                className="flex items-center gap-1.5 mb-4 transition-all duration-500"
                style={{ opacity: inView ? 1 : 0, transitionDelay: '0.6s' }}
            >
                {[0, 1, 2, 3, 4].map(i => (
                    <span
                        key={i}
                        className="text-2xl transition-all duration-300"
                        style={{
                            opacity: starsActive && i <= 4 ? 1 : 0,
                            transform: starsActive ? 'scale(1)' : 'scale(0.4)',
                            filter: starsActive ? 'drop-shadow(0 0 4px rgba(245,158,11,0.8))' : 'none',
                            transitionDelay: `${i * 0.12}s`,
                        }}
                    >⭐</span>
                ))}
            </div>

            {/* Score + badge */}
            <div
                className="flex items-center gap-3 mb-5 transition-all duration-500"
                style={{ opacity: scoreVisible ? 1 : 0, transform: scoreVisible ? 'translateY(0)' : 'translateY(10px)' }}
            >
                <span className="text-4xl font-black text-amber-400 tabular-nums" style={{ textShadow: '0 0 20px rgba(245,158,11,0.5)' }}>4.9</span>
                <span className="text-zinc-500 text-xl font-light">/ 5.0</span>
                <span className="ml-auto text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/30">
                    Top 3% of Platform
                </span>
            </div>

            {/* CTA button */}
            <button
                className="w-full font-bold text-sm px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all duration-500"
                style={{
                    background: 'rgba(10,8,4,0.9)',
                    border: '1px solid rgba(245,158,11,0.5)',
                    color: '#fbbf24',
                    opacity: ctaVisible ? 1 : 0,
                    transform: ctaVisible ? 'translateY(0)' : 'translateY(15px)',
                    animation: ctaVisible ? 'amber-pulse 1.5s ease-in-out infinite' : undefined,
                }}
            >
                Request Expert →
            </button>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   CARD WRAPPER — sticky stack
───────────────────────────────────────────────────────────── */
interface CardConfig {
    step: string;
    icon: string;
    headline: string;
    description: string;
    bullets: string[];
    accent: string;
    accentText: string;
    glow: string;
    zIndex: number;
    panel: React.ReactNode;
}

function StackCard({ card, index }: { card: CardConfig; index: number }) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [buried, setBuried] = useState(false);
    const inViewRef = useRef<HTMLDivElement>(null);
    const inView = useInView(inViewRef as React.RefObject<HTMLElement | null>, 0.3);

    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        let lastY = 0;
        const obs = new IntersectionObserver(
            ([entry]) => {
                // If next sibling is covering this card, scale it down
                const ratio = entry.intersectionRatio;
                setBuried(ratio < 0.85 && lastY < window.scrollY);
                lastY = window.scrollY;
            },
            { threshold: [0.5, 0.85, 1] }
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    return (
        <div
            ref={cardRef}
            style={{
                position: 'sticky',
                top: '80px',
                zIndex: card.zIndex,
                marginBottom: '2px',
            }}
        >
            {/* IntersectionObserver target — placed at card top so it fires when card enters view */}
            <div ref={inViewRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1 }} />

            <div
                className="relative w-full max-w-6xl mx-auto transition-transform duration-500 ease-out"
                style={{
                    transform: buried ? 'scale(0.96)' : 'scale(1)',
                    willChange: 'transform',
                }}
            >
                {/* The card itself */}
                <div
                    className="relative rounded-[28px] overflow-hidden"
                    style={{
                        background: 'rgba(8,10,16,0.92)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        backdropFilter: 'blur(24px)',
                        boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
                    }}
                >
                    {/* Accent glow */}
                    <div className="absolute top-0 right-0 w-[45%] h-full pointer-events-none" style={{ background: card.glow }} />

                    {/* Top glossy edge */}
                    <div className="absolute top-0 left-0 right-0 h-px opacity-30" style={{ background: `linear-gradient(90deg, transparent, ${card.accentText}, transparent)` }} />

                    <div className="relative z-10 flex flex-col lg:flex-row gap-0 min-h-[560px]">

                        {/* ── LEFT TEXT COLUMN ── */}
                        <div className="flex flex-col justify-center px-10 py-12 lg:w-[40%] shrink-0">
                            {/* Step badge */}
                            <div className="inline-flex items-center gap-2 mb-6 self-start">
                                <span
                                    className="text-[10px] font-black uppercase tracking-[0.22em] px-3 py-1.5 rounded-full"
                                    style={{ background: `${card.accent}22`, color: card.accentText, border: `1px solid ${card.accent}44` }}
                                >
                                    {card.step}
                                </span>
                                <span className="text-2xl">{card.icon}</span>
                            </div>

                            {/* Headline */}
                            <h2 className="text-3xl lg:text-4xl font-black text-white mb-4 leading-tight">
                                {card.headline}
                            </h2>

                            {/* Description */}
                            <p className="text-zinc-400 text-base leading-relaxed mb-8 max-w-sm">
                                {card.description}
                            </p>

                            {/* Bullets */}
                            <ul className="space-y-3">
                                {card.bullets.map((b, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                                        <span className="mt-0.5 text-sm" style={{ color: card.accentText }}>✓</span>
                                        {b}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* ── RIGHT UI PANEL COLUMN ── */}
                        <div className="flex-1 flex items-stretch py-8 pr-8 pl-4 lg:pl-0">
                            <div
                                className="w-full rounded-2xl overflow-hidden"
                                style={{
                                    backdropFilter: 'blur(16px)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                            >
                                {card.panel}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   STAR PARTICLES BACKGROUND
───────────────────────────────────────────────────────────── */
function StarField() {
    const stars = useRef(
        Array.from({ length: 80 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            r: 0.5 + Math.random() * 1.5,
            dur: 2 + Math.random() * 4,
            delay: Math.random() * 3,
        }))
    );

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                {stars.current.map(s => (
                    <circle
                        key={s.id}
                        cx={`${s.x}%`}
                        cy={`${s.y}%`}
                        r={s.r}
                        fill="white"
                        style={{
                            opacity: 0.2,
                            animation: `star-twinkle ${s.dur}s ${s.delay}s ease-in-out infinite alternate`,
                        }}
                    />
                ))}
            </svg>
            {/* Dot grid */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                }}
            />
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   VERTICAL TIMELINE SPINE
───────────────────────────────────────────────────────────── */
function TimelineSpine({ unlocked }: { unlocked: boolean }) {
    return (
        <div className="absolute left-6 top-0 bottom-0 w-px pointer-events-none z-50" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
                className="absolute top-0 left-0 w-full transition-all duration-[2000ms] ease-out"
                style={{
                    height: unlocked ? '100%' : '0%',
                    background: 'linear-gradient(180deg, rgba(20,184,166,0.9) 0%, rgba(99,102,241,0.6) 100%)',
                    boxShadow: unlocked ? '0 0 12px rgba(20,184,166,0.8), 0 0 24px rgba(20,184,166,0.4)' : 'none',
                }}
            />
            {/* Neon dot at bottom */}
            {unlocked && (
                <div
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-teal-400 animate-ping"
                    style={{ boxShadow: '0 0 20px rgba(20,184,166,0.9)' }}
                />
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   MAIN EXPORT
───────────────────────────────────────────────────────────── */
export const ExpertJourney: React.FC = () => {
    const [spineUnlocked, setSpineUnlocked] = useState(false);

    // Card 4 panel needs its own ref for inView — we lift the unlock callback
    const card4PanelRef = useRef<HTMLDivElement>(null);
    const card4InView = useInView(card4PanelRef as React.RefObject<HTMLElement | null>, 0.3);

    const cards: Omit<CardConfig, 'panel'>[] = [
        {
            step: '01',
            icon: '🔍',
            headline: 'Finding Your\nPerfect Expert',
            description: 'We scan our entire network of 12,000+ vetted professionals and surface the ones that match your exact requirement — skills, industry, timezone, and budget.',
            bullets: [
                'Global talent pool across 60+ categories',
                'Real-time availability matching',
                'Shortlisted in under 48 hours',
            ],
            accent: 'rgb(99,102,241)',
            accentText: '#818cf8',
            glow: 'radial-gradient(ellipse at top right, rgba(99,102,241,0.18) 0%, transparent 65%)',
            zIndex: 10,
        },
        {
            step: '02',
            icon: '🛡️',
            headline: 'Screened Before\nYou Ever See Them',
            description: 'Every expert goes through a rigorous technical and behavioural pre-screening. You receive a full scorecard — not just a CV.',
            bullets: [
                'Technical skills verified by domain experts',
                'Behavioural and culture-fit assessment',
                'Transparent scoring with no black boxes',
            ],
            accent: 'rgb(20,184,166)',
            accentText: '#2dd4bf',
            glow: 'radial-gradient(ellipse at top right, rgba(20,184,166,0.18) 0%, transparent 65%)',
            zIndex: 20,
        },
        {
            step: '03',
            icon: '🎙️',
            headline: 'Interview Ready.\nQuestions Done.',
            description: 'We prepare the interview, record it, and analyze it for you. Every session is structured, scored, and stored — so your team can review on their own time.',
            bullets: [
                'AI-generated role-specific questions',
                'Video recording saved and transcribed',
                'Sentiment and confidence analysis included',
            ],
            accent: 'rgb(236,72,153)',
            accentText: '#f472b6',
            glow: 'radial-gradient(ellipse at top right, rgba(236,72,153,0.18) 0%, transparent 65%)',
            zIndex: 30,
        },
        {
            step: '04',
            icon: '⭐',
            headline: 'Transparent Feedback.\nZero Guesswork.',
            description: "After every engagement, both sides leave structured feedback. Ratings are verified, disputes are mediated, and the record follows the expert's profile permanently.",
            bullets: [
                'Verified post-project reviews only',
                'Client and expert mutual ratings',
                'Dispute resolution included',
            ],
            accent: 'rgb(245,158,11)',
            accentText: '#fbbf24',
            glow: 'radial-gradient(ellipse at top right, rgba(245,158,11,0.18) 0%, transparent 65%)',
            zIndex: 40,
        },
    ];

    // Build panels — card1/2/3 use useInView inside their own components
    // Card4 uses lifted state so we can trigger spine unlock
    const card1Ref = useRef<HTMLDivElement>(null);
    const card2Ref = useRef<HTMLDivElement>(null);
    const card3Ref = useRef<HTMLDivElement>(null);

    const inView1 = useInView(card1Ref as React.RefObject<HTMLElement | null>, 0.3);
    const inView2 = useInView(card2Ref as React.RefObject<HTMLElement | null>, 0.3);
    const inView3 = useInView(card3Ref as React.RefObject<HTMLElement | null>, 0.3);

    const panels = [
        <div ref={card1Ref} className="w-full h-full"><Card1Panel inView={inView1} /></div>,
        <div ref={card2Ref} className="w-full h-full"><Card2Panel inView={inView2} /></div>,
        <div ref={card3Ref} className="w-full h-full"><Card3Panel inView={inView3} /></div>,
        <div ref={card4PanelRef} className="w-full h-full"><Card4Panel inView={card4InView} onUnlock={() => setSpineUnlocked(true)} /></div>,
    ];

    const fullCards: CardConfig[] = cards.map((c, i) => ({ ...c, panel: panels[i] }));

    return (
        <>
            {/* Keyframe injection */}
            <style>{`
        @keyframes star-twinkle { from { opacity: 0.1; } to { opacity: 0.5; } }
        @keyframes teal-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(20,184,166,0.5); }
          50%        { box-shadow: 0 0 35px rgba(20,184,166,0.8); }
        }
        @keyframes amber-pulse {
          0%, 100% { box-shadow: 0 0 10px rgba(245,158,11,0.4); }
          50%        { box-shadow: 0 0 40px rgba(245,158,11,0.9); }
        }
      `}</style>

            <section
                className="relative font-display"
                style={{ background: '#04060d' }}
            >
                {/* Background texture */}
                <StarField />

                {/* Section header */}
                <div className="relative z-10 max-w-6xl mx-auto px-6 pt-24 pb-16 text-center">
                    <span className="font-mono text-xs uppercase tracking-[0.22em] text-indigo-400/80 font-semibold block mb-5">
                        ◆ The Expert Journey
                    </span>
                    <h2 className="text-4xl md:text-6xl font-black text-white leading-tight mb-5">
                        From search to hire —<br />
                        <span style={{ background: 'linear-gradient(135deg, #818cf8, #2dd4bf)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            every step, handled.
                        </span>
                    </h2>
                    <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
                        Watch how we source, vet, interview, and rate every expert so you never have to guess.
                    </p>
                </div>

                {/* The stacked cards wrapper */}
                <div className="relative z-10 max-w-6xl mx-auto px-6 pb-32">
                    {/* Timeline spine */}
                    <div className="relative">
                        <TimelineSpine unlocked={spineUnlocked} />

                        {/* Each card sits in its own 100vh-min wrapper so one card fills one scroll beat */}
                        <div className="flex flex-col gap-0">
                            {fullCards.map((card, i) => (
                                <div key={card.step} style={{ minHeight: i < fullCards.length - 1 ? '120vh' : 'auto' }}>
                                    <StackCard card={card} index={i} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
};

export default ExpertJourney;
