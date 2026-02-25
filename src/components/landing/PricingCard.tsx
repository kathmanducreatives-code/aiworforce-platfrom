import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const perks = [
    'Unlimited hires',
    'Unlimited lookalike searches',
    'AI resume screening',
    'Email reveal & auto-outreach',
    'Pipeline dashboard',
    'Team collaboration',
    'Meeting management',
    'Priority support',
];

const PricingCard = () => {
    const navigate = useNavigate();
    const sectionRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [priceVal, setPriceVal] = useState(0);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(cardRef.current, { opacity: 0, scale: 0.95, y: 30 }, {
                opacity: 1, scale: 1, y: 0, duration: 0.8, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });

            // Price count up
            ScrollTrigger.create({
                trigger: sectionRef.current,
                start: 'top 65%',
                onEnter: () => {
                    gsap.to({ val: 0 }, {
                        val: 149, duration: 1.5, ease: 'power2.out',
                        onUpdate: function () { setPriceVal(Math.round(this.targets()[0].val)); },
                    });
                },
            });

            // Perk stagger
            const checks = cardRef.current?.querySelectorAll('.perk-item');
            if (checks) {
                checks.forEach((el, i) => {
                    gsap.fromTo(el, { opacity: 0, x: -10 }, {
                        opacity: 1, x: 0, duration: 0.3, delay: 1.0 + i * 0.1,
                        ease: 'power2.out',
                        scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                    });
                });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-white px-4 py-28 md:py-36">
            <div className="max-w-lg mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-emerald-600 font-semibold text-center">
                    ◆ Pricing
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.6rem,4vw,2.5rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 text-center mb-12">
                    ONE PLAN. NO PER-HIRE FEES.<br />NO SURPRISES.
                </h2>

                <div ref={cardRef} className="bg-white rounded-2xl p-8 md:p-10 border border-zinc-200/60 shadow-[0_16px_50px_rgba(0,0,0,0.08)] opacity-0">
                    {/* Price */}
                    <div className="text-center mb-8">
                        <div className="font-mono font-extrabold text-5xl md:text-6xl text-emerald-600 tabular-nums tracking-tighter">
                            €{priceVal}<span className="text-xl text-zinc-400 font-normal">/month</span>
                        </div>
                        <p className="text-sm text-zinc-400 mt-2">Billed monthly. Cancel anytime.</p>
                    </div>

                    {/* Features */}
                    <div className="space-y-3 mb-8">
                        {perks.map((p, i) => (
                            <div key={i} className="perk-item flex items-center gap-3 opacity-0">
                                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                    <Check className="w-3 h-3 text-emerald-600" />
                                </div>
                                <span className="text-sm text-zinc-700">{p}</span>
                            </div>
                        ))}
                    </div>

                    {/* CTA */}
                    <button
                        onClick={() => navigate('/auth')}
                        className="group w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base py-4 rounded-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(5,150,105,0.3)]"
                    >
                        Start Hiring Today
                        <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </button>
                </div>

                <p className="text-sm text-zinc-400 text-center mt-6">
                    Compare: Agencies charge <span className="line-through">€15,000-€30,000 per hire</span>. You pay <strong className="text-emerald-600">€149/month total</strong>.
                </p>
            </div>
        </section>
    );
};

export default PricingCard;
