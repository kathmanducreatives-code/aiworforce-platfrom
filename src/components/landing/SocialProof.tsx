import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Quote } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const testimonials = [
    { quote: "We were paying our agency €8,200 per hire. ScreeningPilot replaced them in one afternoon. Same quality candidates, 97% less cost.", name: "Marcus König", title: "CTO, Velora Technologies", metric: "€80K saved/year" },
    { quote: "Our agency took 6 weeks to send 5 mediocre profiles. ScreeningPilot scored 300 applicants in under a minute. We'll never go back.", name: "Priya Sharma", title: "VP People, Helios SaaS", metric: "6 weeks → 60 sec" },
    { quote: "I was skeptical — but after seeing the AI reject the same candidates our team would have rejected, I cancelled our agency contract that week.", name: "Daniel Okonkwo", title: "Founder, Cortex AI", metric: "Agency cancelled" },
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
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ Agency Refugees</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">COMPANIES THAT FIRED THEIR AGENCY</h2>
                </div>
                <div className="flex flex-wrap justify-center gap-8 mb-14">
                    {logos.map((logo) => (
                        <span key={logo} className="text-sm font-display font-bold text-white/25 tracking-wide uppercase hover:text-white/40 transition-colors">{logo}</span>
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
                                    <p className="text-xs text-white/45">{t.title}</p>
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
