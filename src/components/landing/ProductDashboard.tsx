import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BarChart3, Target, Briefcase, Cpu, Check } from 'lucide-react';
import { GyroTilt } from '@/components/shared/GyroTilt';

gsap.registerPlugin(ScrollTrigger);

const statCards = [
    { label: 'Candidates Screened', value: 1247, icon: BarChart3 },
    { label: 'Auto-Rejected', value: 95, suffix: '%', icon: Target },
    { label: 'Interview-Ready', value: 63, icon: Briefcase },
    { label: 'Agency Cost Saved', value: 97, suffix: '%', icon: Cpu },
];

const highlights = [
    { text: 'Track every candidate score in real time — no agency black box' },
    { text: 'See exactly why each candidate was accepted or rejected' },
    { text: 'Full pipeline visibility your agency never gave you' },
];

const barHeights = [40, 65, 45, 80, 55, 90, 70];

const activityItems = [
    'AI rejected 47 unqualified applicants in 8 seconds',
    '3 candidates scored 90%+ — moved to final round',
    'Agency would have charged €72,000 for this search',
];

const actionBtns = ['Create Screening Link', 'Export Shortlist'];

const ProductDashboard = () => {
    const sectionRef = useRef<HTMLDivElement>(null);

    const [hoveredBar, setHoveredBar] = useState<number | null>(null);
    const [activeBtn, setActiveBtn] = useState<string | null>(null);

    const handleBtnClick = (btn: string) => {
        if (activeBtn) return;
        setActiveBtn(btn);
        setTimeout(() => setActiveBtn(null), 1200);
    };

    useEffect(() => {
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top top',
                    end: '+=1400',
                    pin: true,
                    scrub: 1.2,
                    anticipatePin: 1,
                    fastScrollEnd: true,
                }
            });

            tl.fromTo('.dash-power-line', { height: '0%' }, { height: '100%', duration: 13, ease: 'none' }, 0);
            tl.fromTo('.dash-title', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.5, ease: 'expo.out' }, 0);
            tl.fromTo('.dash-mockup', { opacity: 0, y: 60, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 2, ease: 'expo.out' }, 0.3);
            tl.fromTo('.dash-text-block', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 1.5, ease: 'expo.out' }, 0.5);

            const statEls = sectionRef.current?.querySelectorAll('.dash-stat');
            if (statEls) {
                statEls.forEach((card, i) => {
                    tl.fromTo(card, { opacity: 0.2, y: 10, scale: 0.9 }, {
                        opacity: 1, y: 0, scale: 1, duration: 1, ease: 'back.out(1.5)'
                    }, 2 + i * 0.3);
                    tl.fromTo(card, { boxShadow: '0 0 0 0 rgba(34,197,94,0)' }, {
                        boxShadow: '0 0 15px 2px rgba(34,197,94,0.3)', duration: 0.5, yoyo: true, repeat: 1
                    }, 2.5 + i * 0.3);
                });
            }

            const bars = sectionRef.current?.querySelectorAll('.chart-bar');
            if (bars) {
                bars.forEach((bar, i) => {
                    tl.fromTo(bar, { scaleY: 0 }, {
                        scaleY: 1, duration: 1.2, ease: 'back.out(1.5)'
                    }, 5 + i * 0.15);
                });
            }

            const actItems = sectionRef.current?.querySelectorAll('.activity-item');
            if (actItems) {
                actItems.forEach((item, i) => {
                    tl.fromTo(item, { opacity: 0, x: 40 }, {
                        opacity: 1, x: 0, duration: 1, ease: 'power3.out'
                    }, 8 + i * 0.6);
                    tl.fromTo(item.querySelector('.activity-dot'), { scale: 0 }, {
                        scale: 1, duration: 0.3, ease: 'back.out(3)'
                    }, 8.3 + i * 0.6);
                });
            }

            const hlItems = sectionRef.current?.querySelectorAll('.dash-highlight');
            if (hlItems) {
                hlItems.forEach((el, i) => {
                    tl.fromTo(el, { opacity: 0, x: -20 }, {
                        opacity: 1, x: 0, duration: 1, ease: 'expo.out'
                    }, 0.8 + i * 0.2);
                });
            }

        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
    <section ref={sectionRef} className="relative w-full py-24 md:py-48 bg-black overflow-hidden border-t border-white/5">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        
        {/* TEXT CONTENT (LEFT) */}
        <div>
          <div className="look-title inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/40 bg-accent-mint/5 mb-8">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold mt-px">COMMAND CENTER</span>
          </div>
          
          <h2 className="font-display font-bold text-4xl md:text-6xl text-white leading-[1.0] mb-8 tracking-tight">
            Everything your agency does, but 97% cheaper.
          </h2>
          
          <p className="text-white/40 text-lg leading-relaxed mb-12 max-w-md">
            Track every candidate, see every score, control every decision. No more waiting weeks for an agency to send you 5 mediocre profiles.
          </p>

          <div className="space-y-6">
            {[
              'Track every candidate score in real time — no agency black box',
              'See exactly why each candidate was accepted or rejected',
              'Full pipeline visibility your agency never gave you',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-accent-mint/10 flex items-center justify-center shrink-0 mt-1 border border-accent-mint/20">
                  <Check className="w-3 h-3 text-accent-mint" />
                </div>
                <span className="text-white/80 font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* MOCKUP (RIGHT) */}
        <div className="relative">
          {/* Large Glow */}
          <div className="absolute -inset-24 bg-accent-mint/[0.03] blur-[120px] rounded-full pointer-events-none" />
          
          <div className="glass-card-premium rounded-3xl border-white/10 shadow-[0_50px_120px_rgba(0,0,0,0.9)] overflow-hidden scale-105 lg:scale-110">
            {/* macOS Bar */}
            <div className="bg-white/[0.05] px-6 py-4 flex items-center justify-between border-b border-white/10">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/30" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/30" />
                <div className="w-3 h-3 rounded-full bg-green-500/30" />
              </div>
              <div className="text-[10px] font-black text-white/40 uppercase tracking-widest">Founder Control Panel</div>
            </div>

            <div className="p-8">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                {[
                  { label: 'Agency Savings', val: '€92,400', sub: '+12% this month' },
                  { label: 'Screened', val: '1,247', sub: 'Across 4 roles' },
                ].map((s, i) => (
                  <div key={i} className="p-5 rounded-2xl bg-white/5 border border-white/5">
                    <p className="text-[10px] text-white/50 font-bold uppercase mb-2 tracking-widest">{s.label}</p>
                    <p className="text-2xl font-black text-white mb-1">{s.val}</p>
                    <p className="text-[10px] text-accent-mint font-bold uppercase">{s.sub}</p>
                  </div>
                ))}
              </div>

              {/* Minimalist Graph */}
              <div className="mb-8 p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="flex justify-between items-center mb-6">
                   <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">Cumulative Savings</p>
                   <div className="flex gap-2">
                      <div className="w-2 h-2 rounded-full bg-accent-mint" />
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                   </div>
                </div>
                <div className="flex items-end gap-2 h-32">
                   {[30, 45, 35, 60, 50, 85, 75, 95].map((h, i) => (
                     <div key={i} className="flex-1 bg-accent-mint/10 border-t border-accent-mint/40 rounded-t-sm transition-all hover:bg-accent-mint/30" style={{ height: `${h}%` }} />
                   ))}
                </div>
              </div>

              {/* Live Activity Feed */}
              <div className="space-y-4">
                 <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-4">Agent Activity Feed</p>
                 {[
                   'Aria rejected 47 unqualified applicants in 8s',
                   'Penn drafted personalized outreach for 12 leads',
                   'Hawk detected competitor pricing shift (+20%)',
                 ].map((t, i) => (
                   <div key={i} className="flex items-center gap-4 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
                      <span className="text-white/60 font-medium">{t}</span>
                   </div>
                 ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
    );
};

export default ProductDashboard;
