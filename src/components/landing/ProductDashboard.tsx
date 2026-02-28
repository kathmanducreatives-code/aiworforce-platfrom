import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BarChart3, Target, Briefcase, Cpu } from 'lucide-react';
import { GyroTilt } from '../shared/GyroTilt';

gsap.registerPlugin(ScrollTrigger);

const statCards = [
    { label: 'Total Candidates', value: '1,247', icon: BarChart3 },
    { label: 'Avg Fit Score', value: '87%', icon: Target },
    { label: 'Active Roles', value: '12', icon: Briefcase },
    { label: 'AI Screening', value: '100%', icon: Cpu },
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
            gsap.fromTo(textRef.current, { opacity: 0, y: 40, filter: 'blur(10px)' }, {
                opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.0, ease: 'expo.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });

            highlightRefs.current.forEach((el, i) => {
                if (!el) return;
                gsap.fromTo(el, { opacity: 0, x: -20, scale: 0.95, filter: 'blur(5px)' }, {
                    opacity: 1, x: 0, scale: 1, filter: 'blur(0px)', duration: 0.8, delay: 0.4 + i * 0.12,
                    ease: 'expo.out',
                    scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                });
            });

            const masterTL = gsap.timeline({
                scrollTrigger: { trigger: mockupRef.current, start: 'top 75%', toggleActions: 'play none none none' },
            });
            masterTL.fromTo(mockupRef.current, { opacity: 0, x: 80, rotateY: -5, scale: 0.92, filter: 'blur(10px)' }, {
                opacity: 1, x: 0, rotateY: 0, scale: 1, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out',
            }, 0);
            const stats = mockupRef.current?.querySelectorAll('.dash-stat');
            if (stats) {
                stats.forEach((card, i) => {
                    masterTL.fromTo(card, { opacity: 0.2, scale: 0.9, y: 8 }, {
                        opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.5)',
                    }, 0.8 + i * 0.25);
                    masterTL.fromTo(card, { boxShadow: '0 0 0 0 rgba(5,150,105,0)' }, {
                        boxShadow: '0 0 0 2px rgba(5,150,105,0.4)', duration: 0.3, yoyo: true, repeat: 1,
                    }, 0.8 + i * 0.25);
                });
            }
            const btns = mockupRef.current?.querySelectorAll('.dash-btn');
            if (btns) {
                btns.forEach((btn, i) => {
                    masterTL.to(btn, { scale: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut' }, 2.0 + i * 0.35);
                });
            }
            const bars = mockupRef.current?.querySelectorAll('.chart-bar');
            if (bars) {
                bars.forEach((bar, i) => {
                    gsap.fromTo(bar, { scaleY: 0 }, {
                        scaleY: 1, duration: 0.6, delay: 1.6 + i * 0.08, ease: 'back.out(1.5)',
                        scrollTrigger: { trigger: mockupRef.current, start: 'top 75%', toggleActions: 'play none none none' },
                    });
                });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative px-4 py-28 md:py-36 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
                    <div ref={textRef} className="flex-[45] opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">
                            ◆ Your Command Center
                        </p>
                        <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.03em] text-white mb-5">
                            EVERYTHING.<br />ONE DASHBOARD.
                        </h2>
                        <p className="text-white/40 text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Track every candidate, monitor fit scores, manage active roles, and launch sourcing campaigns — all in one place. No spreadsheets. No agency portal. You control everything.
                        </p>
                        <div className="space-y-3">
                            {highlights.map((h, i) => (
                                <div key={i} ref={el => { highlightRefs.current[i] = el; }} className="flex items-center gap-3 opacity-0 glass rounded-xl px-4 py-3 hover:border-emerald-500/20 hover:-translate-y-0.5 transition-all duration-300 group">
                                    <span className="text-lg">{h.icon}</span>
                                    <span className="text-sm font-medium text-white/60 group-hover:text-white/80 transition-colors">{h.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div ref={mockupRef} className="flex-[55] opacity-0">
                        <GyroTilt intensity={8} contentClassName="rounded-xl overflow-hidden glow-green border border-white/[0.06] bg-[#0a0a0a]">
                            <div className="bg-white/[0.03] px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06]">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-400/60" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
                                    <div className="w-3 h-3 rounded-full bg-green-400/60" />
                                </div>
                                <div className="flex-1 text-center">
                                    <span className="text-xs text-white/30 bg-white/5 rounded-md px-3 py-1">app.screeningpilot.com</span>
                                </div>
                            </div>

                            <div className="p-5">
                                <div className="grid grid-cols-4 gap-3 mb-4">
                                    {statCards.map((s, i) => (
                                        <div key={i} className="dash-stat glass rounded-lg p-3 opacity-20 transition-all hover:border-emerald-500/20">
                                            <p className="text-[10px] text-white/30 mb-1">{s.label}</p>
                                            <p className="text-lg font-bold text-white">{s.value}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2 mb-4">
                                    {actionBtns.map((btn) => (
                                        <div key={btn} className="dash-btn bg-emerald-600/80 text-white text-[10px] font-semibold px-3 py-1.5 rounded-md cursor-default transition-all">
                                            {btn}
                                        </div>
                                    ))}
                                </div>
                                <div className="glass rounded-lg p-4 mb-3">
                                    <p className="text-[10px] text-white/30 mb-3 font-medium">Weekly Activity</p>
                                    <div className="flex items-end gap-1 h-16">
                                        {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                                            <div key={i} className="chart-bar flex-1 bg-emerald-900/30 rounded-t origin-bottom" style={{ height: `${h}%`, transform: 'scaleY(0)' }}>
                                                <div className="w-full bg-emerald-500/70 rounded-t" style={{ height: '60%' }} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="glass rounded-lg p-3">
                                    <p className="text-[10px] text-white/30 mb-2 font-medium">Recent Activity</p>
                                    {['New screening completed — Senior Engineer', 'ICP match found — 94% score', '3 candidates shortlisted'].map((a, i) => (
                                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(5,150,105,0.5)]" />
                                            <p className="text-[10px] text-white/50">{a}</p>
                                        </div>
                                    ))}
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
