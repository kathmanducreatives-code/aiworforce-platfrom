import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const plans = [
  {
    name: 'Founder', monthlyPrice: 79, annualPrice: 63,
    desc: 'For solo founders getting started',
    features: ['Talent Department (Scout + Aria + Lens)','Intelligence Department (Hawk + Signal + Brief)','Company Brain — full context storage','500 Firecrawl credits/month','50 AI screening interviews/month','1 custom agent','Email support'],
    cta: 'Start free trial', popular: false,
  },
  {
    name: 'Startup', monthlyPrice: 149, annualPrice: 119,
    desc: 'For founders running a full business',
    features: ['All 5 pre-built departments','15 AI agents fully active','Company Brain unlimited','2,000 Firecrawl credits/month','Unlimited AI screening','Unlimited custom agents','Cross-department intelligence sharing','Weekly AI performance brief','Priority support'],
    cta: 'Build your workforce', popular: true,
  },
  {
    name: 'Business', monthlyPrice: 349, annualPrice: 279,
    desc: 'For teams replacing or augmenting headcount',
    features: ['Everything in Startup plus:','Multiple company workspaces','White label for client delivery','Full API access','Custom agent publishing','Dedicated onboarding session','Slack support channel','SLA guarantees'],
    cta: 'Talk to us', popular: false,
  },
];

const PricingCard = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isAnnual, setIsAnnual] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(cardRef.current, { opacity: 0, y: 40, scale: 0.95 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'back.out(1.4)',
        scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} id="pricing" className="relative px-4 py-28 md:py-36" style={{ background: "#080C10", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="text-center mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ PRICING</p>
        <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
          Less than one month of one human employee.<br />For your entire AI workforce.
        </h2>
      </div>

      <div className="flex items-center justify-center gap-3 mb-12">
        <span className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-white/40'}`}>Monthly</span>
        <button onClick={() => setIsAnnual(!isAnnual)} className={`relative w-12 h-6 rounded-full transition-colors ${isAnnual ? 'bg-emerald-600' : 'bg-white/10'}`}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isAnnual ? 'translate-x-7' : 'translate-x-1'}`} />
        </button>
        <span className={`text-sm font-medium ${isAnnual ? 'text-white' : 'text-white/40'}`}>Annual <span className="text-emerald-400 text-xs">2 months free</span></span>
      </div>

      <div ref={cardRef} className="max-w-5xl mx-auto opacity-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div key={plan.name} className="rounded-3xl p-6 md:p-8 relative"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: plan.popular ? "1px solid rgba(0,255,148,0.35)" : "1px solid rgba(255,255,255,0.06)",
                boxShadow: plan.popular ? "0 0 40px rgba(0,255,148,0.08)" : "none",
                transform: plan.popular ? "scale(1.02)" : "scale(1)",
              }}>
              {plan.popular && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-full"
                  style={{ background: "#10b981", color: "#022c22" }}>
                  ⭐ Most Popular
                </span>
              )}
              <h3 className="font-display font-bold text-lg text-white mb-1">{plan.name}</h3>
              <p className="text-xs text-white/40 mb-4">{plan.desc}</p>
              <p className="tabular-nums mb-1">
                <span className="font-mono font-black text-white" style={{ fontSize: 52 }}>
                  €{isAnnual ? plan.annualPrice : plan.monthlyPrice}
                </span>
                <span className="text-sm text-white/30 font-normal">/mo</span>
              </p>
              {isAnnual && <p className="text-[10px] text-white/30 mb-6">billed annually</p>}
              {!isAnnual && <div className="mb-6" />}

              <div className="space-y-2.5 mb-6">
                {plan.features.map((f, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20 shrink-0 mt-0.5">
                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                    </div>
                    <span className="text-xs text-white/50">{f}</span>
                  </div>
                ))}
              </div>

              <button onClick={() => navigate('/auth')} className={`w-full inline-flex items-center justify-center gap-2 font-semibold py-3 rounded-xl transition-all duration-300 text-sm ${
                plan.popular
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white hover:shadow-[0_8px_32px_rgba(5,150,105,0.4)]'
                  : 'bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08]'
              }`}>
                {plan.cta} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-white/20 mt-8">
          14-day free trial · No credit card required · If your AI workforce does not save you 10 hours in the first month we refund everything. No questions.
        </p>
      </div>
    </section>
  );
};

export default PricingCard;
