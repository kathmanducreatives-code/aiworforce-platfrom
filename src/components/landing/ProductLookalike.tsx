import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Linkedin, Mail, MapPin, Clock } from 'lucide-react';
import { GyroTilt } from '../shared/GyroTilt';

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
            gsap.fromTo(textRef.current, { opacity: 0, y: 30, filter: 'blur(10px)' }, {
                opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.0, ease: 'expo.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', toggleActions: 'play none none none' },
            });

            const masterTL = gsap.timeline({
                scrollTrigger: { trigger: mockupRef.current, start: 'top 80%', toggleActions: 'play none none none' },
            });
            masterTL.fromTo(mockupRef.current, { scale: 0.6, opacity: 0, filter: 'blur(6px)', rotateX: 3 }, {
                scale: 1, opacity: 1, filter: 'blur(0px)', rotateX: 0, duration: 1.2, ease: 'expo.out',
            }, 0);
            masterTL.add(() => {
                gsap.to({ val: 0 }, { val: 49, duration: 1.5, ease: 'power2.out', onUpdate: function () { setResultCount(Math.round(this.targets()[0].val)); } });
                gsap.to({ val: 0 }, { val: 42, duration: 1.5, delay: 0.15, ease: 'power2.out', onUpdate: function () { setAvgMatch(Math.round(this.targets()[0].val)); } });
            }, 0.5);
            const pills = mockupRef.current?.querySelectorAll('.filter-pill');
            if (pills) { pills.forEach((pill, i) => { masterTL.fromTo(pill, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.5)' }, 0.7 + i * 0.08); }); }
            const cards = mockupRef.current?.querySelectorAll('.candidate-card');
            if (cards) { cards.forEach((card, i) => { masterTL.fromTo(card, { opacity: 0, y: 25, scale: 0.95, filter: 'blur(5px)' }, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.8, ease: 'expo.out' }, 1.0 + i * 0.12); }); }
            const badges = mockupRef.current?.querySelectorAll('.match-badge');
            if (badges) {
                badges.forEach((badge, i) => {
                    masterTL.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, 1.4 + i * 0.12);
                    masterTL.fromTo(badge, { boxShadow: '0 0 0 0 rgba(5,150,105,0)' }, { boxShadow: '0 0 10px 3px rgba(5,150,105,0.4)', duration: 0.25, yoyo: true, repeat: 1 }, 1.4 + i * 0.12);
                });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative px-4 py-28 md:py-40 overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[700px] h-[500px] bg-emerald-500/[0.06] blur-[150px] rounded-full" />
            </div>

            <div className="max-w-6xl mx-auto relative z-10">
                <div ref={textRef} className="text-center mb-16 opacity-0 max-w-[700px] mx-auto">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ Lookalike Engine</p>
                    <h2 className="font-display font-black text-[clamp(1.8rem,4.5vw,3.5rem)] leading-[1.1] tracking-[-0.03em] text-white mb-5">
                        PASTE ONE PROFILE.<br />GET 2,000 RANKED MATCHES.
                    </h2>
                    <p className="text-white/40 text-base md:text-lg leading-[1.7]">
                        This is what it looks like when you exhaust your entire addressable talent market. Every matching professional on LinkedIn — found, ranked, and ready to contact. In 15 minutes.
                    </p>
                </div>

                <div ref={mockupRef} className="max-w-5xl mx-auto opacity-0">
                    <GyroTilt intensity={8} contentClassName="rounded-xl overflow-hidden glow-green-strong border border-white/[0.06] bg-[#0a0a0a]">
                        <div className="bg-white/[0.03] px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06]">
                            <div className="flex gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-400/60" />
                                <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
                                <div className="w-3 h-3 rounded-full bg-green-400/60" />
                            </div>
                            <div className="flex-1 text-center"><span className="text-xs text-white/30 bg-white/5 rounded-md px-3 py-1">app.screeningpilot.com</span></div>
                        </div>

                        <div className="p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-sm font-bold text-white">Lookalike Results / SaaS-founders</h3>
                                    <p className="text-[10px] text-white/30 mt-0.5">
                                        <span className="font-bold text-emerald-400 tabular-nums">{resultCount}</span> found · AVG MATCH <span className="font-bold text-emerald-400 tabular-nums">{avgMatch}%</span>
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <div className="action-btn bg-emerald-600/80 text-white text-[10px] font-semibold px-3 py-1.5 rounded-md">Find Emails</div>
                                    <div className="action-btn glass text-white/60 text-[10px] font-semibold px-3 py-1.5 rounded-md">Export CSV</div>
                                </div>
                            </div>

                            <div className="flex gap-2 mb-4">
                                {filters.map((f, i) => (
                                    <div key={f} className={`filter-pill text-[10px] px-3 py-1 rounded-full font-medium scale-0 ${i === 0 ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] text-white/40'}`}>{f}</div>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {candidates.map((c, i) => (
                                    <div key={i} className="candidate-card glass rounded-lg p-3 opacity-0 hover:border-emerald-500/20 transition-all duration-300 hover:-translate-y-0.5">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                                                    {c.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold text-white">{c.name}</p>
                                                    <p className="text-[10px] text-white/30">{c.title}</p>
                                                </div>
                                            </div>
                                            <span className={`match-badge text-[10px] font-bold px-2 py-0.5 rounded-full scale-0 ${c.tier === 'Excellent' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                                                c.tier === 'Strong' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' :
                                                    'bg-white/[0.06] text-white/50 border border-white/10'
                                                }`}>{c.match}%</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] text-white/25 mb-2">
                                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.location}</span>
                                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{c.yoe}</span>
                                        </div>
                                        <div className="flex gap-1.5">
                                            <div className="flex items-center gap-1 text-[9px] text-blue-400 bg-blue-500/10 border border-blue-500/15 px-2 py-0.5 rounded"><Linkedin className="w-2.5 h-2.5" /> LinkedIn</div>
                                            <div className="flex items-center gap-1 text-[9px] text-white/40 bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded"><Mail className="w-2.5 h-2.5" /> Reveal Email</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </GyroTilt>
                </div>
            </div>
        </section>
    );
};

export default ProductLookalike;
