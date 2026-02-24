import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Quote } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const companies = ['TechFlow', 'ScaleUp', 'HireBase', 'CloudStack', 'GrowthOS'];

const testimonials = [
    {
        quote: "We eliminated $180K in annual agency fees in our first quarter. The ICP engine found candidates our recruiters never would have.",
        name: 'Sarah Chen',
        title: 'VP of Engineering',
        company: 'TechFlow',
    },
    {
        quote: "From 6 hours of manual screening to 8 minutes. Our hiring velocity increased 3x and quality actually improved.",
        name: 'Marcus Rodriguez',
        title: 'Head of Talent',
        company: 'ScaleUp',
    },
    {
        quote: "The behavioral DNA matching is incredible. Every shortlisted candidate felt like they were already part of our team culture.",
        name: 'Priya Sharma',
        title: 'CTO',
        company: 'CloudStack',
    },
];

const SocialProof = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const logoRefs = useRef<(HTMLDivElement | null)[]>([]);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Logo fade-in
            logoRefs.current.forEach((logo, i) => {
                if (!logo) return;
                gsap.fromTo(logo, { opacity: 0, y: 15 }, {
                    opacity: 1, y: 0, duration: 0.5, delay: i * 0.08,
                    ease: 'power2.out',
                    scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', toggleActions: 'play none none none' },
                });
            });

            // Testimonial cards stagger
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
                {/* Label */}
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-emerald-600 font-semibold text-center">
                    ◆ Social Proof
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3.5rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 text-center mb-16">
                    TRUSTED BY GROWING TEAMS
                </h2>

                {/* Company Logos */}
                <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14 mb-20">
                    {companies.map((name, i) => (
                        <div
                            key={name}
                            ref={el => { logoRefs.current[i] = el; }}
                            className="opacity-0"
                        >
                            <span className="font-sans font-bold text-xl md:text-2xl text-zinc-300 tracking-tight select-none">
                                {name}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Testimonial Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {testimonials.map((t, i) => (
                        <div
                            key={i}
                            ref={el => { cardRefs.current[i] = el; }}
                            className="bg-white border border-zinc-200/60 rounded-2xl p-7 opacity-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)]"
                        >
                            <Quote className="w-8 h-8 text-emerald-200 mb-4" />
                            <p className="font-sans text-sm text-zinc-600 leading-relaxed mb-6 italic">
                                "{t.quote}"
                            </p>
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
