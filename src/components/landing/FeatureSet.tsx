import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Search, Bot, Mail, BarChart3, Users, Calendar, MessageSquare } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
    { icon: Search, title: 'Lookalike Search', desc: 'One profile → 2,000+ ranked matches. Exhaust your entire talent market.', color: 'text-emerald-400' },
    { icon: Bot, title: 'AI Screening', desc: '300 resumes scored in 8 minutes with match % and reasoning.', color: 'text-emerald-400' },
    { icon: Mail, title: 'Email & Outreach', desc: 'One-click email reveal. Automated personalized sequences.', color: 'text-blue-400' },
    { icon: BarChart3, title: 'Pipeline Dashboard', desc: 'Track every candidate: discovered → contacted → interviewing → hired.', color: 'text-purple-400' },
    { icon: Users, title: 'Team Collaboration', desc: 'Notes, ratings, feedback. Everyone aligned on every candidate.', color: 'text-teal-400' },
    { icon: Calendar, title: 'Meeting Management', desc: 'Schedule interviews directly. No back-and-forth.', color: 'text-amber-400' },
];

const FeatureSet = () => {
    const sectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const cards = sectionRef.current?.querySelectorAll('.feat-card');
            if (cards) {
                cards.forEach((card, i) => {
                    gsap.fromTo(card, { opacity: 0, y: 30, scale: 0.95 }, {
                        opacity: 1, y: 0, scale: 1, duration: 0.5, delay: i * 0.1, ease: 'power3.out',
                        scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                    });
                });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative px-4 py-28 md:py-36">
            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-14">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ The Full Platform</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
                        EVERY TOOL YOU NEED.<br />ONE SUBSCRIPTION.
                    </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {features.map((f, i) => (
                        <div key={i} className="feat-card glass rounded-2xl p-6 opacity-0 group hover:border-emerald-500/20 hover:-translate-y-1 transition-all duration-300 cursor-default">
                            <f.icon className={`w-8 h-8 mb-4 ${f.color} transition-transform group-hover:scale-110`} />
                            <h3 className="font-display font-bold text-base text-white mb-2">{f.title}</h3>
                            <p className="text-sm text-white/35 leading-relaxed">{f.desc}</p>
                        </div>
                    ))}
                    <div className="feat-card glass rounded-2xl p-6 opacity-0 border-dashed !border-white/10 hover:border-emerald-500/15 transition-all duration-300">
                        <MessageSquare className="w-8 h-8 mb-4 text-white/20" />
                        <h3 className="font-display font-bold text-base text-white/40 mb-2">AI Behavioral Screening</h3>
                        <p className="text-sm text-white/20 leading-relaxed">Chat-based culture fit interviews.</p>
                        <span className="inline-block mt-3 text-[10px] font-semibold text-white/25 bg-white/[0.04] border border-white/[0.08] px-3 py-1 rounded-full">Coming Soon</span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default FeatureSet;
