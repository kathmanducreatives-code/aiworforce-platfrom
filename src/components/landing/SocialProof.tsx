import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Quote } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const testimonials = [
    { quote: "We cancelled our agency contract after 2 weeks. ScreeningPilot found better candidates in 15 minutes than they did in 3 months.", name: "Marcus König", title: "CTO, Velora Technologies", metric: "Saved €82K/year" },
    { quote: "In 48 hours, it surfaced 1,500 matches we'd never have found manually. The quality was better than any agency shortlist.", name: "Priya Sharma", title: "VP People, Helios SaaS", metric: "1,500 matches" },
    { quote: "We went from paying €30K per hire to €149/month for unlimited. It's absurd how much value this delivers.", name: "Daniel Okonkwo", title: "Founder, Cortex AI", metric: "€30K → €149/mo" },
];

const logos = ['Velora', 'Helios', 'Cortex AI', 'DataSync', 'Lumina', 'NovaTech'];

const SocialProof = () => {
    const sectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const cards = sectionRef.current?.querySelectorAll('.test-card');
            if (cards) {
                cards.forEach((card, i) => {
                    gsap.fromTo(card, { opacity: 0, y: 30 }, {
                        opacity: 1, y: 0, duration: 0.6, delay: i * 0.15, ease: 'power3.out',
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
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ Social Proof</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">TRUSTED BY GROWING TEAMS</h2>
                </div>
                <div className="flex flex-wrap justify-center gap-8 mb-14">
                    {logos.map((logo) => (
                        <span key={logo} className="text-sm font-display font-bold text-white/15 tracking-wide uppercase hover:text-white/30 transition-colors">{logo}</span>
                    ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {testimonials.map((t, i) => (
                        <div key={i} className="test-card glass rounded-2xl p-6 opacity-0 border-l-2 border-l-emerald-500/30 hover:border-l-emerald-500/60 transition-all duration-300">
                            <Quote className="w-5 h-5 text-emerald-500/30 mb-4" />
                            <p className="text-sm text-white/50 leading-relaxed mb-5 italic">"{t.quote}"</p>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-white">{t.name}</p>
                                    <p className="text-xs text-white/30">{t.title}</p>
                                </div>
                                <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/15">{t.metric}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default SocialProof;
