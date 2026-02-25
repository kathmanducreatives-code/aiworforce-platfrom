import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Users, Target, Briefcase, Cpu } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const statCards = [
    { label: 'Total Candidates', value: '1,247', icon: Users, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Avg Fit Score', value: '87%', icon: Target, color: 'bg-blue-50 text-blue-600' },
    { label: 'Active Roles', value: '12', icon: Briefcase, color: 'bg-purple-50 text-purple-600' },
    { label: 'AI Screening', value: '100%', icon: Cpu, color: 'bg-emerald-50 text-emerald-600' },
];

const actionBtns = ['Upload Resume', 'Start Scraping', 'Deep Search'];

const ProductDashboard = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const mockupRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(textRef.current, { opacity: 0, x: -40 }, {
                opacity: 1, x: 0, duration: 0.8, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });

            gsap.fromTo(mockupRef.current, {
                opacity: 0, x: 60, rotateY: -5,
            }, {
                opacity: 1, x: 0, rotateY: 0, duration: 1, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
            });

            // Stat card highlights
            const cards = mockupRef.current?.querySelectorAll('.dash-stat');
            if (cards) {
                cards.forEach((card, i) => {
                    gsap.fromTo(card, { opacity: 0.4, scale: 0.95 }, {
                        opacity: 1, scale: 1, duration: 0.4, delay: 0.8 + i * 0.3,
                        ease: 'power2.out',
                        scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
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
                    <div ref={textRef} className="flex-[4] opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-emerald-600 font-semibold">
                            ◆ Your Command Center
                        </p>
                        <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-5">
                            EVERYTHING YOU NEED.<br />ONE DASHBOARD.
                        </h2>
                        <p className="text-zinc-500 text-base md:text-lg leading-relaxed mb-8 max-w-md">
                            Track candidates, monitor fit scores, manage active roles, and see AI screening results — all in real time. No spreadsheets. No agency middlemen.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            {statCards.map((s) => (
                                <div key={s.label} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-zinc-100">
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
                                        <s.icon className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-400 font-medium">{s.label}</p>
                                        <p className="text-sm font-bold text-zinc-900">{s.value}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right — Browser Mockup */}
                    <div ref={mockupRef} className="flex-[6] opacity-0" style={{ perspective: '1200px' }}>
                        <div className="rounded-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.1),0_8px_20px_rgba(0,0,0,0.05)] border border-zinc-200/50">
                            {/* Title bar */}
                            <div className="bg-zinc-800 px-4 py-2.5 flex items-center gap-3">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-400" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                                    <div className="w-3 h-3 rounded-full bg-green-400" />
                                </div>
                                <div className="flex-1 text-center">
                                    <span className="text-xs text-zinc-400 bg-zinc-700/50 rounded-md px-3 py-1">
                                        app.screeningpilot.com/dashboard
                                    </span>
                                </div>
                            </div>

                            {/* Dashboard UI */}
                            <div className="bg-zinc-50 p-5">
                                {/* Stat cards row */}
                                <div className="grid grid-cols-4 gap-3 mb-4">
                                    {statCards.map((s, i) => (
                                        <div key={i} className="dash-stat bg-white rounded-lg p-3 border border-zinc-100 opacity-40">
                                            <p className="text-[10px] text-zinc-400 mb-1">{s.label}</p>
                                            <p className="text-lg font-bold text-zinc-900">{s.value}</p>
                                        </div>
                                    ))}
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2 mb-4">
                                    {actionBtns.map((btn) => (
                                        <div key={btn} className="bg-emerald-600 text-white text-[10px] font-semibold px-3 py-1.5 rounded-md">
                                            {btn}
                                        </div>
                                    ))}
                                </div>

                                {/* Chart placeholder */}
                                <div className="bg-white rounded-lg border border-zinc-100 p-4 mb-3">
                                    <p className="text-[10px] text-zinc-400 mb-3 font-medium">Weekly Activity</p>
                                    <div className="flex items-end gap-1 h-16">
                                        {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                                            <div key={i} className="flex-1 bg-emerald-100 rounded-t" style={{ height: `${h}%` }}>
                                                <div className="w-full bg-emerald-500 rounded-t" style={{ height: '60%' }} />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Recent activity */}
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
                        {/* Reflection */}
                        <div className="h-8 bg-gradient-to-b from-zinc-200/20 to-transparent rounded-b-xl" />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductDashboard;
