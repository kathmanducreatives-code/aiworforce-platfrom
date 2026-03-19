import { useEffect, useRef } from 'react';
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

    useEffect(() => {
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top top',
                    end: '+=1400',
                    pin: true,
                    scrub: 1.2,
                    anticipatePin: 1,
                    fastScrollEnd: true,
                }
            });

            tl.fromTo('.look-power-line', { height: '0%' }, { height: '100%', duration: 10, ease: 'none' }, 0);
            tl.fromTo('.look-title', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.5, ease: 'expo.out' }, 0);
            tl.fromTo('.look-subtitle', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1.5, ease: 'expo.out' }, 0.3);
            tl.fromTo('.look-mockup', { opacity: 0, y: 60, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 2, ease: 'expo.out' }, 0.5);

            const pills = sectionRef.current?.querySelectorAll('.filter-pill');
            if (pills) {
                pills.forEach((pill, i) => {
                    tl.fromTo(pill, { scale: 0, opacity: 0 }, {
                        scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(2.5)'
                    }, 2 + i * 0.15);
                });
            }

            const cards = sectionRef.current?.querySelectorAll('.candidate-card');
            if (cards) {
                cards.forEach((card, i) => {
                    tl.fromTo(card, { opacity: 0, y: 20 }, {
                        opacity: 1, y: 0, duration: 1, ease: 'expo.out'
                    }, 2.5 + i * 0.15);
                });
            }

            const skeletons = sectionRef.current?.querySelectorAll('.candidate-skeleton');
            if (skeletons) {
                tl.to(skeletons, { opacity: 0, duration: 0.5 }, 2.8);
            }

            const badges = sectionRef.current?.querySelectorAll('.match-badge');
            if (badges) {
                badges.forEach((badge, i) => {
                    tl.fromTo(badge, { scale: 0 }, {
                        scale: 1, duration: 0.4, ease: 'back.out(3)'
                    }, 3.0 + i * 0.15);
                    tl.fromTo(badge, { boxShadow: '0 0 0 0 rgba(34,197,94,0)' }, {
                        boxShadow: '0 0 12px 3px rgba(34,197,94,0.4)', duration: 0.3, yoyo: true, repeat: 1
                    }, 3.2 + i * 0.15);
                });
            }

            tl.fromTo('.look-counter', { opacity: 0 }, { opacity: 1, duration: 1 }, 5);

        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section
            ref={sectionRef}
            className="relative w-full h-screen overflow-hidden font-display"
            style={{ background: '#000000' }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: `linear-gradient(rgba(34,197,94,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.07) 1px, transparent 1px)`,
                backgroundSize: '100px 100px',
            }} />

            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-emerald-500/10 z-[5] pointer-events-none">
                <div className="look-power-line relative w-full bg-emerald-500" style={{ height: '0%', boxShadow: '0 0 12px rgba(34,197,94,0.8), 0 0 24px rgba(34,197,94,0.4)' }}>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_20px_4px_rgba(34,197,94,0.8)] animate-ping" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)]" />
                </div>
            </div>

            <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex flex-col justify-center">
                <div className="text-center mb-6">
                    <div className="look-title inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/40 bg-transparent mb-4 opacity-0 mx-auto">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <span className="font-mono text-[11px] uppercase tracking-[2px] text-primary font-semibold mt-px">BETTER THAN ANY AGENCY SHORTLIST</span>
                    </div>
                    <h2 className="look-title font-display font-black text-[clamp(1.8rem,4.5vw,3.5rem)] leading-[1.0] tracking-[-0.04em] text-white mb-3 opacity-0">
                        YOUR AGENCY SENDS 5 PROFILES.<br />WE SCORE HUNDREDS IN SECONDS.
                    </h2>
                    <p className="look-subtitle text-white/60 text-base md:text-lg leading-[1.7] max-w-[700px] mx-auto opacity-0">
                        Stop waiting weeks for a recruiter to cherry-pick candidates. ScreeningPilot scores every applicant instantly and surfaces only the best fits.
                    </p>
                </div>

                <div className="look-mockup max-w-5xl mx-auto w-full opacity-0">
                    <div className="rounded-xl overflow-hidden border border-border bg-background shadow-[0_0_60px_rgba(16,185,129,0.08)]">
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
                                    <h3 className="text-sm font-bold text-white">Candidate Matches / Frontend Engineer</h3>
                                    <p className="look-counter text-[10px] text-white/30 mt-0.5 opacity-0">
                                        <span className="font-bold text-emerald-400 tabular-nums">247</span> candidates scored · <span className="font-bold text-emerald-400 tabular-nums">6</span> top matches — agency would've sent 5 in 6 weeks
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <div className="bg-emerald-600/80 text-white text-[10px] font-semibold px-3 py-1.5 rounded-md">Score All</div>
                                    <div className="glass text-white/60 text-[10px] font-semibold px-3 py-1.5 rounded-md">Export</div>
                                </div>
                            </div>

                            <div className="flex gap-2 mb-4">
                                {filters.map((f, i) => (
                                    <div key={f} className={`filter-pill text-[10px] px-3 py-1 rounded-full font-medium scale-0 opacity-0 ${i === 0 ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] text-white/40'}`}>{f}</div>
                                ))}
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pointer-events-none">
                                    {[1, 2, 3, 4, 5, 6].map((i) => (
                                        <div key={`skel-${i}`} className="candidate-skeleton glass rounded-lg p-3 opacity-50 flex flex-col space-y-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse" />
                                                <div className="space-y-1">
                                                    <div className="h-3 w-20 bg-white/5 rounded animate-pulse" />
                                                    <div className="h-2 w-24 bg-white/5 rounded animate-pulse" />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="h-2 w-16 bg-white/5 rounded animate-pulse" />
                                                <div className="h-2 w-12 bg-white/5 rounded animate-pulse" />
                                            </div>
                                            <div className="flex gap-1.5 mt-1">
                                                <div className="h-4 w-16 bg-white/5 rounded animate-pulse" />
                                                <div className="h-4 w-20 bg-white/5 rounded animate-pulse" />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 relative z-10">
                                    {candidates.map((c, i) => (
                                        <div key={i} className="candidate-card glass rounded-lg p-3 opacity-0 hover:border-primary/20 transition-all duration-300 hover:-translate-y-0.5 bg-card/80 backdrop-blur-md">
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
                                            <div className="flex items-center gap-3 text-[10px] text-white/30 mb-2">
                                                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.location}</span>
                                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{c.yoe}</span>
                                            </div>
                                            <div className="flex gap-1.5">
                                                <div className="flex items-center gap-1 text-[9px] text-blue-400 bg-blue-500/10 border border-blue-500/15 px-2 py-0.5 rounded transition-colors hover:bg-blue-500/20 cursor-pointer"><Linkedin className="w-2.5 h-2.5" /> Profile</div>
                                                <div className="flex items-center gap-1 text-[9px] text-white/60 bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded transition-colors hover:bg-white/10 cursor-pointer"><Mail className="w-2.5 h-2.5" /> Contact</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductLookalike;
