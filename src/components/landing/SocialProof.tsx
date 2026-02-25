import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Quote } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const companies = ['TechFlow', 'ScaleUp', 'HireBase', 'CloudStack', 'GrowthOS', 'LaunchPad'];

const testimonials = [
    {
        quote: "We were paying our agency €82,000 a year for 10 hires. ScreeningPilot found better candidates in 15 minutes. We cancelled our agency contract that week.",
        name: 'Sarah Chen',
        title: 'CEO',
        company: 'TechFlow (32 employees)',
    },
    {
        quote: "I was spending 13 hours a week sourcing candidates myself. Now I paste one profile and get 1,500 ranked matches before my coffee gets cold.",
        name: 'Marcus Rivera',
        title: 'Founder',
        company: 'ScaleUp',
    },
    {
        quote: "The lookalike engine found candidates our agency never surfaced. Better matches. Zero per-hire fees. It's not even close.",
        name: 'Priya Sharma',
        title: 'VP Ops',
        company: 'CloudStack',
    },
];

const SocialProof = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const logoRefs = useRef<(HTMLDivElement | null)[]>([]);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            logoRefs.current.forEach((logo, i) => {
                if (!logo) return;
                gsap.fromTo(logo, { opacity: 0, y: 15 }, {
                    opacity: 1, y: 0, duration: 0.5, delay: i * 0.08,
                    ease: 'power2.out',
                    scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', toggleActions: 'play none none none' },
                });
            });
            cardRefs.current.forEach((card, i) => {
                if (!card) return;
                gsap.fromTo(card, { opacity: 0, y: 30 }, {
                    opacity: 1, y: 0, duration: 0.7, delay: i * 0.15,
                    ease: 'power3.out',
                    scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none none' },
                });
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-zinc-50/50 px-4 py-28 md:py-36">
            <div className="max-w-6xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-emerald-600 font-semibold text-center">
                    ◆ Social Proof
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3.5rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 text-center mb-16">
                    TRUSTED BY GROWING TEAMS
                </h2>

                <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14 mb-20">
                    {companies.map((name, i) => (
                        <div key={name} ref={el => { logoRefs.current[i] = el; }} className="opacity-0 transition-colors duration-300 hover:text-emerald-500">
                            <span className="font-sans font-bold text-xl md:text-2xl text-zinc-300 tracking-tight select-none hover:text-emerald-400 transition-colors cursor-default">
                                {name}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {testimonials.map((t, i) => (
                        <div key={i} ref={el => { cardRefs.current[i] = el; }} className="bg-white border border-zinc-200/60 border-l-[3px] border-l-emerald-500 rounded-2xl p-7 opacity-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)]">
                            <Quote className="w-8 h-8 text-emerald-200 mb-4" />
                            <p className="font-sans text-sm text-zinc-600 leading-relaxed mb-6 italic">"{t.quote}"</p>
                            <div className="border-t border-zinc-100 pt-4">
                                <p className="font-sans font-semibold text-sm text-zinc-900">{t.name}</p>
                                <p className="font-sans text-xs text-zinc-400">{t.title}, {t.company}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default SocialProof;
