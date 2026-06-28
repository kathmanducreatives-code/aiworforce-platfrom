import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, ArrowRight, Sparkles, ShieldCheck } from 'lucide-react';
import { PRICING_PLANS } from '@/lib/pricing/plans';

gsap.registerPlugin(ScrollTrigger);

const HOW_IT_WORKS = [
  { n: 1, label: 'Choose a workflow', sub: 'From the Workflow Center.' },
  { n: 2, label: 'See the estimated credits', sub: 'Before anything runs.' },
  { n: 3, label: 'Agentory does the work', sub: 'Real workforce, real output.' },
  { n: 4, label: 'You pay only for useful output', sub: 'Partial results are charged fairly.' },
];

const PLAN_VALUE: Record<string, string[]> = {
  starter: ['~8 lead scans', '~80 enrichments', '~30 outreach drafts'],
  founder_pro: ['~20 lead scans', '~50 enrichments', '~100 outreach drafts', 'Weekly radar'],
  growth: ['~60 lead scans', '~200 enrichments', '~400 outreach drafts'],
  scale: ['~180 lead scans', '~600 enrichments', 'Agency workflows'],
};

const PricingCard = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 40 },
        {
          opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
        },
      );
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="pricing"
      className="relative px-4 py-28 md:py-36"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="text-center mb-12 max-w-3xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ PRICING</p>
        <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
          Pay for workflows,<br />not seats of software you don't use.
        </h2>
        <p className="mt-5 text-[15px] text-white/55 leading-relaxed">
          Every plan includes monthly workflow credits. Credits are used when your AI workforce runs real work:
          finding signals, enriching companies, discovering decision-makers, drafting outreach, and creating content.
        </p>
      </div>

      <div ref={cardRef} className="max-w-6xl mx-auto opacity-0">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {PRICING_PLANS.map((plan) => {
            const value = PLAN_VALUE[plan.id];
            return (
              <div
                key={plan.id}
                className="rounded-2xl p-5 relative flex flex-col"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: plan.highlighted ? '1px solid rgba(0,255,148,0.35)' : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: plan.highlighted ? '0 0 40px rgba(0,255,148,0.08)' : 'none',
                }}
              >
                {plan.highlighted && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
                    style={{ background: '#10b981', color: '#022c22' }}
                  >
                    ★ Most Popular
                  </span>
                )}
                <h3 className="font-display font-bold text-white text-[15px]">{plan.name}</h3>
                <p className="text-[11.5px] text-white/45 mt-1 min-h-[2.5em]">{plan.description}</p>
                <p className="tabular-nums mt-3">
                  <span className="font-mono font-black text-white text-3xl">€{plan.priceMonthly}</span>
                  <span className="text-xs text-white/30">/mo</span>
                </p>
                <div className="mt-1 text-[12px] text-emerald-300 font-mono tabular-nums">
                  {plan.credits.toLocaleString()} credits · {plan.seats} seat{plan.seats > 1 ? 's' : ''}
                </div>
                {plan.overagePerCredit > 0 && (
                  <div className="mt-0.5 text-[10.5px] text-white/35">
                    Overage ${plan.overagePerCredit.toFixed(2)}/credit
                  </div>
                )}

                <div className="space-y-1.5 mt-4 mb-4">
                  {plan.features.slice(0, 5).map((f, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <Check className="w-3 h-3 text-emerald-400 mt-1 shrink-0" />
                      <span className="text-[11.5px] text-white/55 leading-snug">{f}</span>
                    </div>
                  ))}
                </div>

                {value && (
                  <div className="rounded-lg border border-white/[0.05] bg-white/[0.015] p-2.5 mb-4">
                    <div className="text-[10px] uppercase tracking-wider text-white/40 font-mono mb-1">
                      Approx. credits
                    </div>
                    <ul className="space-y-0.5">
                      {value.map((v) => (
                        <li key={v} className="text-[11px] text-white/55">• {v}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => navigate('/auth')}
                  className={`mt-auto w-full inline-flex items-center justify-center gap-1.5 font-semibold py-2.5 rounded-lg transition-all text-[12.5px] ${
                    plan.highlighted
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  {plan.priceMonthly === 0 ? 'Start free trial' : 'Start with this plan'}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* How credits work */}
        <div className="mt-16 max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.15em] text-emerald-400 font-semibold mb-3">
              ◆ HOW CREDITS WORK
            </p>
            <h3 className="font-display font-bold text-white text-2xl">
              Fair credits for real work.
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.n} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="text-emerald-400 font-mono text-[11px] mb-1.5">Step {s.n}</div>
                <div className="text-white text-[13.5px] font-semibold">{s.label}</div>
                <div className="text-white/45 text-[11.5px] mt-1">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-emerald-300 mt-0.5 shrink-0" />
              <div className="text-[13px] text-white/70 leading-relaxed">
                <span className="text-white font-semibold">Example.</span>{' '}
                Find 5 hiring-signal leads ≈ ~15 credits. Scout may review 20+ raw signals,
                reject weak matches, and return 5 qualified accounts with source, fit score,
                and next step.
              </div>
            </div>
            <div className="flex items-start gap-2.5 mt-3 pt-3 border-t border-white/[0.04]">
              <ShieldCheck className="h-4 w-4 text-emerald-300 mt-0.5 shrink-0" />
              <div className="text-[12.5px] text-white/55">
                Nothing is sent automatically. All outreach is draft-only and approval-gated.
                You always see the estimated cost before a workflow runs.
              </div>
            </div>
          </div>

          <p className="text-center text-[11px] text-white/30 mt-6">
            Every plan includes monthly workflow credits. Credit usage depends on workflow type and provider availability.
          </p>
        </div>
      </div>
    </section>
  );
};

export default PricingCard;
