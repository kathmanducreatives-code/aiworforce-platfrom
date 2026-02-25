import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BarChart3, Target, Briefcase, Cpu } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const statCards = [
    { label: 'Total Candidates', value: '1,247', icon: BarChart3, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Avg Fit Score', value: '87%', icon: Target, color: 'bg-blue-50 text-blue-600' },
    { label: 'Active Roles', value: '12', icon: Briefcase, color: 'bg-purple-50 text-purple-600' },
    { label: 'AI Screening', value: '100%', icon: Cpu, color: 'bg-emerald-50 text-emerald-600' },
];

const actionBtns = ['Upload Resume', 'Start Scraping', 'Deep Search'];
const highlights = [
    { icon: '📊', text: 'Real-time candidate pipeline' },
    { icon: '🎯', text: 'AI fit scores auto-updated' },
    { icon: '⚡', text: 'One-click: Upload, Scrape, Deep Search' },
    { icon: '📈', text: 'Weekly activity tracking & charts' },
];

const ProductDashboard = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const mockupRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const highlightRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Text fade-in-up
            gsap.fromTo(textRef.current, { opacity: 0, y: 40 }, {
                opacity: 1, y: 0, duration: 0.7, ease: 'expo.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });

            // Highlight items stagger with slide-in
            highlightRefs.current.forEach((el, i) => {
                if (!el) return;
                gsap.fromTo(el, { opacity: 0, x: -20, scale: 0.95 }, {
                    opacity: 1, x: 0, scale: 1, duration: 0.5, delay: 0.4 + i * 0.12,
                    ease: 'back.out(1.5)',
                    scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                });
            });

            // Unified master timeline for the mockup
            const masterTL = gsap.timeline({
                scrollTrigger: {
                    trigger: mockupRef.current,
                    start: 'top 75%',
                    toggleActions: 'play none none none',
                },
            });

            // Mockup 3D entrance from right
            masterTL.fromTo(mockupRef.current, {
                opacity: 0, x: 80, rotateY: -5, scale: 0.92,
            }, {
                opacity: 1, x: 0, rotateY: 0, scale: 1, duration: 1, ease: 'expo.out',
            }, 0);

            // Stat cards light up one-by-one with green glow
            const stats = mockupRef.current?.querySelectorAll('.dash-stat');
            if (stats) {
                stats.forEach((card, i) => {
                    masterTL.fromTo(card, { opacity: 0.25, scale: 0.9, y: 8 }, {
                        opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.5)',
                    }, 0.8 + i * 0.25);
                    // Green glow pulse
                    masterTL.fromTo(card, { boxShadow: '0 0 0 0 rgba(5,150,105,0)' }, {
                        boxShadow: '0 0 0 3px rgba(5,150,105,0.35)', duration: 0.3,
                        yoyo: true, repeat: 1,
                    }, 0.8 + i * 0.25);
                });
            }

            // Action buttons sequential "click" 
            const btns = mockupRef.current?.querySelectorAll('.dash-btn');
            if (btns) {
                btns.forEach((btn, i) => {
                    masterTL.to(btn, {
                        scale: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut',
                    }, 2.0 + i * 0.35);
                    masterTL.fromTo(btn, { boxShadow: '0 0 0 0 rgba(5,150,105,0)' }, {
                        boxShadow: '0 0 10px 2px rgba(5,150,105,0.3)', duration: 0.2,
                        yoyo: true, repeat: 1,
                    }, 2.0 + i * 0.35);
                });
            }

            // Chart bars grow
            const bars = mockupRef.current?.querySelectorAll('.chart-bar');
            if (bars) {
                bars.forEach((bar, i) => {
                    gsap.fromTo(bar, { scaleY: 0 }, {
                        scaleY: 1, duration: 0.6, delay: 1.6 + i * 0.08,
                        ease: 'back.out(1.5)',
                        scrollTrigger: { trigger: mockupRef.current, start: 'top 75%', toggleActions: 'play none none none' },
                    });
                });
            }
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-zinc-50/50 px-4 py-28 md:py-36 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
                    {/* Left — Text */}
                    <div ref={textRef} className="flex-[45] opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-600 font-semibold">
                            ◆ Your Command Center
                        </p>
                        <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.03em] text-zinc-950 mb-5">
                            EVERYTHING.<br />ONE DASHBOARD.
                        </h2>
                        <p className="text-[#4b5563] text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Track every candidate, monitor fit scores, manage active roles, and launch sourcing campaigns — all in one place. No spreadsheets. No agency portal. You control everything.
                        </p>
                        <div className="space-y-3">
                            {highlights.map((h, i) => (
                                <div key={i} ref={el => { highlightRefs.current[i] = el; }} className="flex items-center gap-3 opacity-0 bg-white/60 rounded-lg px-4 py-2.5 border border-zinc-100/60 hover:border-emerald-200/50 hover:-translate-y-0.5 transition-all duration-300">
                                    <span className="text-lg">{h.icon}</span>
                                    <span className="text-sm font-medium text-zinc-700">{h.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right — Browser Mockup */}
                    <div ref={mockupRef} className="flex-[55] opacity-0" style={{ perspective: '1200px' }}>
                        <div className="rounded-xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.06),0_0_100px_rgba(5,150,105,0.06)] border border-zinc-200/50">
                            <div className="bg-[#1f2937] px-4 py-2.5 flex items-center gap-3">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
                                    <div className="w-3 h-3 rounded-full bg-[#eab308]" />
                                    <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
                                </div>
                                <div className="flex-1 text-center">
                                    <span className="text-xs text-zinc-400 bg-zinc-700/50 rounded-md px-3 py-1">app.screeningpilot.com</span>
                                </div>
                            </div>

                            <div className="bg-zinc-50 p-5">
                                <div className="grid grid-cols-4 gap-3 mb-4">
                                    {statCards.map((s, i) => (
                                        <div key={i} className="dash-stat bg-white rounded-lg p-3 border border-zinc-100 opacity-25 transition-all">
                                            <p className="text-[10px] text-zinc-400 mb-1">{s.label}</p>
                                            <p className="text-lg font-bold text-zinc-900">{s.value}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2 mb-4">
                                    {actionBtns.map((btn) => (
                                        <div key={btn} className="dash-btn bg-emerald-600 text-white text-[10px] font-semibold px-3 py-1.5 rounded-md cursor-default transition-all">
                                            {btn}
                                        </div>
                                    ))}
                                </div>
                                <div className="bg-white rounded-lg border border-zinc-100 p-4 mb-3">
                                    <p className="text-[10px] text-zinc-400 mb-3 font-medium">Weekly Activity</p>
                                    <div className="flex items-end gap-1 h-16">
                                        {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                                            <div key={i} className="chart-bar flex-1 bg-emerald-100 rounded-t origin-bottom" style={{ height: `${h}%`, transform: 'scaleY(0)' }}>
                                                <div className="w-full bg-emerald-500 rounded-t" style={{ height: '60%' }} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="bg-white rounded-lg border border-zinc-100 p-3">
                                    <p className="text-[10px] text-zinc-400 mb-2 font-medium">Recent Activity</p>
                                    {['New screening completed — Senior Engineer', 'ICP match found — 94% score', '3 candidates shortlisted'].map((a, i) => (
                                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-zinc-50 last:border-0">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            <p className="text-[10px] text-zinc-600">{a}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="h-8 bg-gradient-to-b from-zinc-200/20 to-transparent rounded-b-xl" />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductDashboard;
