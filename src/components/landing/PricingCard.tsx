import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
    'Unlimited screening campaigns',
    'AI candidate scoring (12+ criteria)',
    'Auto-reject 95% of bad fits',
    'Interview blueprint generation',
    'Expert interviewer marketplace',
    'Full pipeline dashboard',
    'Team collaboration',
    'Priority support'
];

const PricingCard = () => {
    const navigate = useNavigate();
    const sectionRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [price, setPrice] = useState(0);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(cardRef.current, { opacity: 0, y: 40, scale: 0.95 }, {
                opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'back.out(1.4)',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
            });
            ScrollTrigger.create({
                trigger: sectionRef.current, start: 'top 60%',
                onEnter: () => { gsap.to({ val: 0 }, { val: 149, duration: 1.5, ease: 'power3.out', onUpdate: function () { setPrice(Math.round(this.targets()[0].val)); } }); },
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} id="pricing" className="relative px-4 py-28 md:py-36">
            <div className="text-center mb-14">
                <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ Pricing</p>
                <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">LESS THAN YOUR AGENCY'S LUNCH BUDGET</h2>
            </div>
            <div ref={cardRef} className="max-w-md mx-auto opacity-0">
                <div className="glass-strong rounded-3xl p-8 text-center glow-green">
                    <p className="font-mono text-6xl font-black text-emerald-400 tabular-nums mb-1">€{price}</p>
                    <p className="text-sm text-white/30 mb-8">per month · no per-hire fees · cancel anytime</p>
                    <div className="space-y-3 mb-8 text-left">
                        {features.map((f, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20">
                                    <Check className="w-3 h-3 text-emerald-400" />
                                </div>
                                <span className="text-sm text-white/50">{f}</span>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => navigate('/get-demo')} className="conic-border group w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-xl transition-all duration-300 hover:shadow-[0_8px_32px_rgba(5,150,105,0.4)]">
                        Fire Your Agency Today <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <p className="text-xs text-white/20 mt-4">Your agency charges €24,000 per hire. We charge €149/month. You do the math.</p>
                </div>
            </div>
        </section>
    );
};

export default PricingCard;
