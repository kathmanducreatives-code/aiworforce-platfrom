import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BarChart3, Target, Briefcase, Cpu } from 'lucide-react';
import { GyroTilt } from '@/components/shared/GyroTilt';

gsap.registerPlugin(ScrollTrigger);

const statCards = [
    { label: 'Total Candidates', value: 1247, icon: BarChart3 },
    { label: 'Avg Fit Score', value: 87, suffix: '%', icon: Target },
    { label: 'Active Roles', value: 12, icon: Briefcase },
    { label: 'AI Screening', value: 100, suffix: '%', icon: Cpu },
];

const highlights = [
    { text: 'Real-time AI scoring auto-updated' },
    { text: 'Candidate pipeline & sourcing view' },
    { text: 'One-click outreach & scheduling' },
];

const barHeights = [40, 65, 45, 80, 55, 90, 70];

const activityItems = [
    'New screening completed — Senior Engineer',
    'ICP match found — 94% score',
    '3 candidates shortlisted',
];

const actionBtns = ['Run Scraper', 'Generate Outreach'];

const ProductDashboard = () => {
    const sectionRef = useRef<HTMLDivElement>(null);

    const [hoveredBar, setHoveredBar] = useState<number | null>(null);
    const [activeBtn, setActiveBtn] = useState<string | null>(null);

    const handleBtnClick = (btn: string) => {
        if (activeBtn) return;
        setActiveBtn(btn);
        setTimeout(() => setActiveBtn(null), 1200);
    };

    useEffect(() => {
        const ctx = gsap.context(() => {
            // --- MASTER PINNED TIMELINE ---
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top top',
                    end: '+=2000',
                    pin: true,
                    scrub: 2.5,
                    anticipatePin: 1,
                }
            });

            // Power line grows from top to bottom
            tl.fromTo('.dash-power-line', { height: '0%' }, { height: '100%', duration: 13, ease: 'none' }, 0);

            // Phase 0: Title + mockup fly in (0 → 2)
            tl.fromTo('.dash-title', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.5, ease: 'expo.out' }, 0);
            tl.fromTo('.dash-mockup', { opacity: 0, y: 60, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 2, ease: 'expo.out' }, 0.3);
            tl.fromTo('.dash-text-block', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 1.5, ease: 'expo.out' }, 0.5);

            // Phase 1: Stat cards count up (2 → 5)
            const statEls = sectionRef.current?.querySelectorAll('.dash-stat');
            if (statEls) {
                statEls.forEach((card, i) => {
                    tl.fromTo(card, { opacity: 0.2, y: 10, scale: 0.9 }, {
                        opacity: 1, y: 0, scale: 1, duration: 1, ease: 'back.out(1.5)'
                    }, 2 + i * 0.3);
                    // Glow pulse
                    tl.fromTo(card, { boxShadow: '0 0 0 0 rgba(34,197,94,0)' }, {
                        boxShadow: '0 0 15px 2px rgba(34,197,94,0.3)', duration: 0.5, yoyo: true, repeat: 1
                    }, 2.5 + i * 0.3);
                });
            }

            // Phase 2: Bar charts rise from zero (5 → 8)
            const bars = sectionRef.current?.querySelectorAll('.chart-bar');
            if (bars) {
                bars.forEach((bar, i) => {
                    tl.fromTo(bar, { scaleY: 0 }, {
                        scaleY: 1, duration: 1.2, ease: 'back.out(1.5)'
                    }, 5 + i * 0.15);
                });
            }

            // Phase 3: Activity feed items slide in (8 → 11)
            const actItems = sectionRef.current?.querySelectorAll('.activity-item');
            if (actItems) {
                actItems.forEach((item, i) => {
                    tl.fromTo(item, { opacity: 0, x: 40 }, {
                        opacity: 1, x: 0, duration: 1, ease: 'power3.out'
                    }, 8 + i * 0.6);
                    // Pulse the dot
                    tl.fromTo(item.querySelector('.activity-dot'), { scale: 0 }, {
                        scale: 1, duration: 0.3, ease: 'back.out(3)'
                    }, 8.3 + i * 0.6);
                });
            }

            // Phase 4: Highlights fade in staggered (11 → 13)
            const hlItems = sectionRef.current?.querySelectorAll('.dash-highlight');
            if (hlItems) {
                hlItems.forEach((el, i) => {
                    tl.fromTo(el, { opacity: 0, x: -20 }, {
                        opacity: 1, x: 0, duration: 1, ease: 'expo.out'
                    }, 0.8 + i * 0.2); // Fades in quickly alongside the text block to balance height!
                });
            }

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
                backgroundImage: `linear-gradient(rgba(34,197,94,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.07) 1px, transparent 1px)`,
                backgroundSize: '100px 100px',
            }} />

            {/* Vertical Power Line */}
            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-emerald-500/10 z-[5] pointer-events-none">
                <div className="dash-power-line relative w-full bg-emerald-500" style={{ height: '0%', boxShadow: '0 0 12px rgba(34,197,94,0.8), 0 0 24px rgba(34,197,94,0.4)' }}>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_20px_4px_rgba(34,197,94,0.8)] animate-ping" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)]" />
                </div>
            </div>

            <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex items-center">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16 w-full">
                    {/* LEFT: Text */}
                    <div className="flex-[45] dash-text-block opacity-0">
                        <div className="dash-title inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00c853]/40 bg-transparent mb-6 opacity-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#00c853]" />
                            <span className="font-mono text-[11px] uppercase tracking-[2px] text-emerald-400 font-semibold mt-px">YOUR COMMAND CENTER</span>
                        </div>
                        <h2 className="dash-title font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.0] tracking-[-0.04em] text-white mb-5 opacity-0">
                            EVERYTHING.<br />ONE DASHBOARD.
                        </h2>
                        <p className="text-white/60 text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Track every candidate, monitor fit scores, manage active roles, and launch sourcing campaigns — all in one place.
                        </p>
                        <div className="space-y-4">
                            {highlights.map((h, i) => (
                                <div key={i} className="dash-highlight flex items-start gap-3 opacity-0">
                                    <div className="w-5 h-5 rounded-full bg-[#00c853]/20 flex items-center justify-center shrink-0 mt-0.5 border border-[#00c853]/30">
                                        <svg className="w-3 h-3 text-[#00c853]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    </div>
                                    <span className="text-[15px] font-medium text-white/90">{h.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* RIGHT: Mockup */}
                    <div className="flex-[55] dash-mockup opacity-0">
                        <GyroTilt intensity={15}>
                            <div className="rounded-xl overflow-hidden border border-white/[0.1] bg-[#111111] shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_40px_rgba(34,197,94,0.15)] relative">
                                {/* Soft glow behind mockup content to enhance contrast */}
                                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 blur-[80px] rounded-full pointer-events-none" />

                                {/* Browser chrome */}
                                <div className="bg-white/[0.04] px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.08] relative z-10">
                                    <div className="flex gap-1.5">
                                        <div className="w-3 h-3 rounded-full bg-red-400/60" />
                                        <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
                                        <div className="w-3 h-3 rounded-full bg-green-400/60" />
                                    </div>
                                    <div className="flex-1 text-center">
                                        <span className="text-xs text-white/30 bg-white/5 rounded-md px-3 py-1 cursor-default select-none hover:bg-white/10 transition-colors">app.screeningpilot.com</span>
                                    </div>
                                </div>

                                <div className="p-5">
                                    {/* Stat Cards */}
                                    <div className="grid grid-cols-4 gap-3 mb-4">
                                        {statCards.map((s, i) => (
                                            <div key={i} className="dash-stat glass rounded-lg p-3 opacity-20 transition-all hover:border-emerald-500/30 hover:shadow-[0_4px_15px_rgba(5,150,105,0.15)] hover:-translate-y-0.5 cursor-default group">
                                                <p className="text-[10px] text-white/30 mb-1 group-hover:text-emerald-400/60 transition-colors">{s.label}</p>
                                                <p className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">
                                                    {s.value.toLocaleString()}{s.suffix || ''}
                                                </p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex gap-2 mb-4">
                                        {actionBtns.map((btn) => (
                                            <div
                                                key={btn}
                                                onClick={() => handleBtnClick(btn)}
                                                className={`dash-btn text-[10px] font-semibold px-3 py-1.5 rounded-md cursor-pointer transition-all duration-300 select-none flex items-center justify-center min-w-[100px] ${activeBtn === btn
                                                    ? 'bg-emerald-500 text-black scale-[0.98] shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                                                    : 'bg-emerald-600/80 text-white hover:bg-emerald-500'
                                                    }`}
                                            >
                                                {activeBtn === btn ? 'Processing...' : btn}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Bar Chart */}
                                    <div className="glass rounded-lg p-4 mb-3 relative group">
                                        <p className="text-[10px] text-white/30 mb-3 font-medium flex justify-between">
                                            Weekly Activity
                                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400">Interactive</span>
                                        </p>
                                        <div className="flex items-end gap-1 h-16" onMouseLeave={() => setHoveredBar(null)}>
                                            {barHeights.map((h, i) => (
                                                <div
                                                    key={i}
                                                    onMouseEnter={() => setHoveredBar(i)}
                                                    className={`chart-bar flex-1 rounded-t origin-bottom cursor-pointer transition-all duration-300 relative ${hoveredBar !== null && hoveredBar !== i
                                                        ? 'opacity-30'
                                                        : 'opacity-100 bg-emerald-500/30 hover:bg-emerald-400/50'
                                                        }`}
                                                    style={{ height: `${h}%`, transform: 'scaleY(0)' }}
                                                >
                                                    <div className="w-full bg-emerald-500/80 rounded-t transition-colors pointer-events-none" style={{ height: '60%' }} />

                                                    {hoveredBar === i && (
                                                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-white text-black text-[9px] font-bold px-2 py-1 rounded shadow-lg pointer-events-none z-10 whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
                                                            {Math.round((h / 100) * 85)} users
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Activity Feed */}
                                    <div className="glass rounded-lg p-3 group hover:border-white/10 transition-colors">
                                        <p className="text-[10px] text-white/30 mb-2 font-medium flex justify-between">
                                            Recent Activity
                                            <span className="text-white/20 hover:text-white/60 cursor-pointer transition-colors">View All</span>
                                        </p>
                                        {activityItems.map((a, i) => (
                                            <div key={i} className="activity-item flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] -mx-2 px-2 rounded cursor-pointer transition-colors opacity-0">
                                                <div className="activity-dot w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(5,150,105,0.5)] scale-0" />
                                                <p className="text-[10px] text-white/50">{a}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </GyroTilt>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductDashboard;
