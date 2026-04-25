import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Quote } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const testimonials = [
    { quote: "I was doing 6 jobs. Now I review decisions. The talent department alone saved me €80,000 in agency fees in the first quarter.", name: "Co-Founder, Series A SaaS", metric: "€80K saved · Q1" },
    { quote: "The agents brief each other. I did not believe that was real until I watched Hawk flag a competitor move and Quill write a response post without me asking. That was the moment I knew.", name: "Solo Founder, Developer Tools", metric: "Zero prompting required" },
    { quote: "48 hours from posting the job to having a shortlist of 6 qualified candidates. Our recruiting agency took 6 weeks to do the same thing. We cancelled the contract that afternoon.", name: "VP People, Seed Fintech", metric: "6 weeks → 48 hours" },
];

const stages = ['Series A · SaaS', 'Seed · Fintech', 'Solo · DevTools', 'Series B · Healthtech', 'Pre-seed · AI', 'Seed · E-commerce'];

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
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ EARLY ADOPTERS</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
                        Founders who replaced their team<br />with an AI workforce.
                    </h2>
                </div>
                <div className="flex flex-wrap justify-center gap-4 mb-14">
                    {stages.map((s) => (
                        <span key={s} className="text-xs font-medium text-white/30 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-full">{s}</span>
                    ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {testimonials.map((t, i) => (
                        <div key={i} className="test-card glass-card-premium rounded-3xl p-8 opacity-0 transition-all duration-500 hover:border-accent-mint/30 flex flex-col justify-between">
                            <div>
                               <div className="flex gap-1 mb-6">
                                  {[1,2,3,4,5].map(s => <div key={s} className="w-1.5 h-1.5 rounded-full bg-accent-mint" />)}
                               </div>
                               <p className="text-white/60 text-base leading-relaxed mb-10 font-medium italic">"{t.quote}"</p>
                            </div>
                            <div className="flex items-center justify-between mt-auto pt-6 border-t border-white/5">
                                <div>
                                    <p className="text-xs font-black text-white uppercase tracking-widest">{t.name}</p>
                                </div>
                                <span className="text-[9px] font-black text-accent-mint bg-accent-mint/5 px-2 py-1 rounded border border-accent-mint/20 uppercase tracking-tighter">{t.metric}</span>
                            </div>
                        </div>
                    ))}
                </div>
                <p className="text-center text-xs text-white/20 mt-8">
                    Early access users · Outcomes verified · Names anonymized pending permission
                </p>
            </div>
        </section>
    );
};

export default SocialProof;