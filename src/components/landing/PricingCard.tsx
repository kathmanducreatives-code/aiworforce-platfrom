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
    <section ref={sectionRef} id="pricing" className="relative px-6 py-16 md:py-24 bg-black overflow-hidden border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/40 bg-accent-mint/5 mb-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold">PREMIUM ACCESS</span>
          </div>
          <h2 className="font-display font-bold text-[clamp(2rem,4.5vw,3.5rem)] text-white leading-[1.0] mb-8 tracking-tight">
            Less than one month of one employee.
          </h2>
          <p className="text-white/40 text-lg max-w-2xl mx-auto leading-relaxed font-medium">
             For your entire AI workforce. Unlimited scalability. No overhead.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-16">
          <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${!isAnnual ? 'text-white' : 'text-white/50'}`}>Monthly</span>
          <button
            role="switch"
            aria-checked={isAnnual}
            aria-label="Toggle annual billing"
            onClick={() => setIsAnnual(!isAnnual)}
            className={`relative w-14 h-7 rounded-full transition-all duration-300 ${isAnnual ? 'bg-accent-mint' : 'bg-white/10'}`}
          >
            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform duration-300 ${isAnnual ? 'translate-x-8 shadow-[0_0_10px_rgba(255,255,255,1)]' : 'translate-x-1'}`} />
          </button>
          <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${isAnnual ? 'text-white' : 'text-white/50'}`}>Annual <span className="text-accent-mint text-[9px] ml-1">(-20%)</span></span>
        </div>

        <div ref={cardRef} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.name} className={`glass-card-premium rounded-[2rem] p-10 relative transition-all duration-500 hover:-translate-y-2 ${plan.popular ? 'border-accent-mint/30 shadow-[0_50px_100px_rgba(0,255,148,0.05)]' : 'border-white/5'}`}>
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-accent-mint rounded-full shadow-[0_10px_30px_rgba(0,255,148,0.3)]">
                   <span className="text-[10px] font-black uppercase tracking-widest text-black mt-px">INITIALIZE STARTUP</span>
                </div>
              )}
              
              <h3 className="font-display font-bold text-xl text-white mb-2">{plan.name}</h3>
              <p className="text-xs text-white/50 mb-8 font-medium leading-relaxed">{plan.desc}</p>
              
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-5xl font-black text-white tracking-tighter">€{isAnnual ? plan.annualPrice : plan.monthlyPrice}</span>
                <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">/mo</span>
              </div>

              <div className="space-y-4 mb-12">
                {plan.features.map((f, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Check className="w-3.5 h-3.5 text-accent-mint shrink-0 mt-0.5" />
                    <span className="text-sm text-white/60 font-medium">{f}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => navigate('/auth')}
                className={`w-full py-4 rounded-xl text-xs font-black uppercase tracking-[0.2em] transition-all duration-300 ${
                  plan.popular
                    ? 'bg-accent-mint text-black shadow-[0_15px_40px_rgba(0,255,148,0.2)] hover:shadow-[0_20px_60px_rgba(0,255,148,0.4)]'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {plan.cta}
              </button>
              <p className="text-[10px] text-white/40 text-center mt-3 font-medium tracking-wide">Per workspace · cancel anytime</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingCard;
