import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Linkedin, Mail, MapPin, Clock } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const candidates = [
    { name: 'Alex Chen', title: 'Sr. Frontend Engineer', location: 'San Francisco, CA', yoe: '7 yrs', match: 96, tier: 'Excellent' },
    { name: 'Sara Patel', title: 'Full Stack Developer', location: 'Austin, TX', yoe: '5 yrs', match: 92, tier: 'Excellent' },
    { name: 'James Kim', title: 'React Lead', location: 'New York, NY', yoe: '8 yrs', match: 89, tier: 'Strong' },
    { name: 'Maria Garcia', title: 'Frontend Architect', location: 'Seattle, WA', yoe: '6 yrs', match: 87, tier: 'Strong' },
    { name: 'David Okafor', title: 'UI Engineer', location: 'Chicago, IL', yoe: '4 yrs', match: 84, tier: 'Strong' },
    { name: 'Lisa Wang', title: 'Sr. React Developer', location: 'Denver, CO', yoe: '6 yrs', match: 81, tier: 'Good' },
];

const filters = ['All Results', 'Excellent (2)', 'Strong (3)', 'Good (1)'];

const ProductLookalike = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const mockupRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const [resultCount, setResultCount] = useState(0);
    const [avgMatch, setAvgMatch] = useState(0);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Text entrance
            gsap.fromTo(textRef.current, { opacity: 0, y: 30 }, {
                opacity: 1, y: 0, duration: 0.6, ease: 'expo.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', toggleActions: 'play none none none' },
            });

            // === FIXED: Single unified timeline, NO scrub ===
            // The mockup zoom + all child animations fire as one clean sequence
            const masterTL = gsap.timeline({
                scrollTrigger: {
                    trigger: mockupRef.current,
                    start: 'top 80%',
                    toggleActions: 'play none none none',
                },
            });

            // Phase 1: Zoom-in + unblur (0-0.8s)
            masterTL.fromTo(mockupRef.current, {
                scale: 0.6, opacity: 0, filter: 'blur(6px)',
            }, {
                scale: 1, opacity: 1, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out',
            }, 0);

            // Phase 2: Perspective tilt straightens
            masterTL.fromTo(mockupRef.current, { rotateX: 3 }, {
                rotateX: 0, duration: 1.2, ease: 'expo.out',
            }, 0);

            // Phase 3: Counters count up (starts at 0.4s)
            masterTL.add(() => {
                gsap.to({ val: 0 }, {
                    val: 49, duration: 1.5, ease: 'power2.out',
                    onUpdate: function () { setResultCount(Math.round(this.targets()[0].val)); },
                });
                gsap.to({ val: 0 }, {
                    val: 42, duration: 1.5, delay: 0.15, ease: 'power2.out',
                    onUpdate: function () { setAvgMatch(Math.round(this.targets()[0].val)); },
                });
            }, 0.5);

            // Phase 4: Filter pills pop in (starts at 0.7s)
            const pills = mockupRef.current?.querySelectorAll('.filter-pill');
            if (pills) {
                pills.forEach((pill, i) => {
                    masterTL.fromTo(pill, { scale: 0, opacity: 0 }, {
                        scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.5)',
                    }, 0.7 + i * 0.08);
                });
            }

            // Phase 5: Candidate cards stagger (starts at 1.0s)
            const cards = mockupRef.current?.querySelectorAll('.candidate-card');
            if (cards) {
                cards.forEach((card, i) => {
                    masterTL.fromTo(card, { opacity: 0, y: 25, scale: 0.95 }, {
                        opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'power3.out',
                    }, 1.0 + i * 0.12);
                });
            }

            // Phase 6: Match badges pop + green flash (starts at 1.4s)
            const badges = mockupRef.current?.querySelectorAll('.match-badge');
            if (badges) {
                badges.forEach((badge, i) => {
                    masterTL.fromTo(badge, { scale: 0 }, {
                        scale: 1, duration: 0.3, ease: 'back.out(3)',
                    }, 1.4 + i * 0.12);
                    masterTL.fromTo(badge, { boxShadow: '0 0 0 0 rgba(5,150,105,0)' }, {
                        boxShadow: '0 0 10px 3px rgba(5,150,105,0.4)', duration: 0.25,
                        yoyo: true, repeat: 1,
                    }, 1.4 + i * 0.12);
                });
            }

            // Phase 7: Action buttons pulse (starts at 2.2s)
            const actionBtns = mockupRef.current?.querySelectorAll('.action-btn');
            if (actionBtns) {
                actionBtns.forEach((btn, i) => {
                    masterTL.fromTo(btn, { boxShadow: '0 0 0 0 rgba(5,150,105,0)' }, {
                        boxShadow: '0 0 14px 4px rgba(5,150,105,0.35)', duration: 0.35,
                        yoyo: true, repeat: 1,
                    }, 2.4 + i * 0.4);
                });
            }
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-zinc-50/50 px-4 py-28 md:py-40 overflow-hidden">
            {/* Green glow behind */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[700px] h-[500px] bg-emerald-500/[0.05] blur-[120px] rounded-full" />
            </div>

            <div className="max-w-6xl mx-auto relative z-10">
                {/* Centered text */}
                <div ref={textRef} className="text-center mb-16 opacity-0 max-w-[700px] mx-auto">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-600 font-semibold">
                        ◆ Lookalike Engine
                    </p>
                    <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4.5vw,3.5rem)] leading-[1.1] tracking-[-0.03em] text-zinc-950 mb-5">
                        PASTE ONE PROFILE.<br />GET 2,000 RANKED MATCHES.
                    </h2>
                    <p className="text-[#4b5563] text-base md:text-lg leading-[1.7]">
                        This is what it looks like when you exhaust your entire addressable talent market. Every matching professional on LinkedIn — found, ranked, and ready to contact. In 15 minutes.
                    </p>
                </div>

                {/* Full-width Browser Mockup */}
                <div ref={mockupRef} className="max-w-5xl mx-auto opacity-0" style={{ perspective: '1200px', transformOrigin: 'center center' }}>
                    <div className="rounded-xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.06),0_0_100px_rgba(5,150,105,0.06)] border border-zinc-200/50">
                        {/* Title bar */}
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

                        {/* Lookalike Results UI */}
                        <div className="bg-white p-5">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-sm font-bold text-zinc-900">Lookalike Results / SaaS-founders</h3>
                                    <p className="text-[10px] text-zinc-400 mt-0.5">
                                        <span className="font-bold text-emerald-600 tabular-nums">{resultCount}</span> found · AVG MATCH <span className="font-bold text-emerald-600 tabular-nums">{avgMatch}%</span>
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <div className="action-btn bg-emerald-600 text-white text-[10px] font-semibold px-3 py-1.5 rounded-md cursor-default transition-all">Find Emails</div>
                                    <div className="action-btn bg-white border border-zinc-200 text-zinc-600 text-[10px] font-semibold px-3 py-1.5 rounded-md cursor-default transition-all">Export CSV</div>
                                </div>
                            </div>

                            {/* Filter bar */}
                            <div className="flex gap-2 mb-4">
                                {filters.map((f, i) => (
                                    <div key={f} className={`filter-pill text-[10px] px-3 py-1 rounded-full font-medium scale-0 ${i === 0 ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                                        {f}
                                    </div>
                                ))}
                            </div>

                            {/* Candidate cards grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {candidates.map((c, i) => (
                                    <div key={i} className="candidate-card bg-white border border-zinc-100 rounded-lg p-3 opacity-0 hover:border-emerald-200/60 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-sm">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center text-[10px] font-bold text-emerald-700">
                                                    {c.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold text-zinc-900">{c.name}</p>
                                                    <p className="text-[10px] text-zinc-400">{c.title}</p>
                                                </div>
                                            </div>
                                            <span className={`match-badge text-[10px] font-bold px-2 py-0.5 rounded-full scale-0 ${c.tier === 'Excellent' ? 'bg-emerald-100 text-emerald-700' :
                                                    c.tier === 'Strong' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-zinc-100 text-zinc-600'
                                                }`}>
                                                {c.match}%
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] text-zinc-400 mb-2">
                                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.location}</span>
                                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{c.yoe}</span>
                                        </div>
                                        <div className="flex gap-1.5">
                                            <div className="flex items-center gap-1 text-[9px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                                                <Linkedin className="w-2.5 h-2.5" /> LinkedIn
                                            </div>
                                            <div className="flex items-center gap-1 text-[9px] text-zinc-500 bg-zinc-50 px-2 py-0.5 rounded">
                                                <Mail className="w-2.5 h-2.5" /> Reveal Email
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="h-8 bg-gradient-to-b from-zinc-200/20 to-transparent rounded-b-xl" />
                </div>
            </div>
        </section>
    );
};

export default ProductLookalike;
