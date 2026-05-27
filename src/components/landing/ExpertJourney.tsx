import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const STYLES = `
#hero-to-expert-sequence {
  position: relative;
  height: 400vh;
  background: transparent;
}
#hero-to-expert-sequence .sequence-viewport {
  position: sticky;
  top: 0;
  height: 100vh;
  perspective: 1500px;
  overflow: hidden;
}
#hero-to-expert-sequence .blueprint-grid {
  position: absolute; inset: 0; z-index: 0; opacity: 0.2;
  background:
    radial-gradient(circle at 20% 18%, rgba(0,255,150,0.2), transparent 44%),
    radial-gradient(circle at 82% 22%, rgba(0,255,150,0.15), transparent 42%),
    linear-gradient(rgba(0,255,150,0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,255,150,0.18) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 68px 68px, 68px 68px;
}
#hero-to-expert-sequence .sequence-stage {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: scale(0.9); z-index: 2; will-change: transform, opacity; transform-style: preserve-3d;
}
#hero-to-expert-sequence .sequence-card {
  width: min(980px, 92vw); height: min(72vh, 640px); border-radius: 24px;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(0,255,150,0.2);
  box-shadow: 0 0 40px rgba(0,255,150,0.15); overflow: hidden;
  display: grid; grid-template-columns: 1.06fr 0.94fr; transform-style: preserve-3d; will-change: transform, opacity;
}
#hero-to-expert-sequence .sequence-content {
  padding: 34px; border-right: 1px solid rgba(0,255,150,0.14); display: flex; flex-direction: column; justify-content: center;
}
#hero-to-expert-sequence .sequence-ui { padding: 22px; display: flex; align-items: stretch; }
#hero-to-expert-sequence .seq-label { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #4ade80; }
#hero-to-expert-sequence .seq-title { margin-top: 12px; font-size: clamp(1.8rem,3.2vw,3rem); line-height: 1.03; letter-spacing: -0.04em; color: #fff; font-weight: 900; }
#hero-to-expert-sequence .seq-copy { margin-top: 14px; color: rgba(255,255,255,0.75); line-height: 1.62; font-size: 14px; }
#hero-to-expert-sequence .seq-bullets { margin-top: 14px; display: grid; gap: 8px; }
#hero-to-expert-sequence .seq-bullet { display: flex; align-items: flex-start; gap: 8px; color: rgba(255,255,255,0.82); font-size: 12px; }
#hero-to-expert-sequence .seq-bullet-mark { color: #34d399; line-height: 1.3; }
#hero-to-expert-sequence .ui-panel {
  width: 100%; border-radius: 16px; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.38); padding: 14px; display: grid; gap: 10px; transform-style: preserve-3d;
}
#hero-to-expert-sequence .ui-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08);
}
#hero-to-expert-sequence .ui-row:last-child { border-bottom: none; }
#hero-to-expert-sequence .ui-badge, #hero-to-expert-sequence .ui-widget, #hero-to-expert-sequence .ui-bar { will-change: transform, opacity; }
#hero-to-expert-sequence .ui-badge {
  transform: translateZ(34px); border-radius: 999px; border: 1px solid rgba(0,255,150,0.35);
  background: rgba(0,255,150,0.12); color: #4ade80; font-size: 10px; padding: 4px 10px; white-space: nowrap;
}
#hero-to-expert-sequence .ui-widget {
  transform: translateZ(24px); border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05); padding: 8px 10px; color: rgba(255,255,255,0.8); font-size: 11px;
}
#hero-to-expert-sequence .ui-bar-track { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.1); overflow: hidden; }
#hero-to-expert-sequence .ui-bar { height: 100%; transform: translateZ(40px); background: linear-gradient(90deg, #16a34a, #34d399); }
#hero-to-expert-sequence .intel-chart-bar { display: inline-block; border-radius: 3px 3px 0 0; margin: 0 2px; vertical-align: bottom; }
#hero-to-expert-sequence .agent-status-row { display: flex; align-items: center; gap: 6px; font-size: 10px; color: rgba(255,255,255,0.6); padding: 4px 0; }
#hero-to-expert-sequence .agent-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: agentPulse 2s ease-in-out infinite; }
@keyframes agentPulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.4); } 50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(34,197,94,0); } }
@media (max-width: 1024px) {
  #hero-to-expert-sequence .sequence-card { grid-template-columns: 1fr; height: min(80vh, 720px); }
  #hero-to-expert-sequence .sequence-content { border-right: 0; border-bottom: 1px solid rgba(0,255,150,0.14); padding: 24px; }
  #hero-to-expert-sequence .sequence-ui { padding: 16px; }
}
`;

export const ExpertJourney = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const ctx = gsap.context(() => {
      const stages = gsap.utils.toArray<HTMLElement>('#hero-to-expert-sequence .sequence-stage');
      const uiBadges = gsap.utils.toArray<HTMLElement>('#hero-to-expert-sequence .ui-badge');
      const uiWidgets = gsap.utils.toArray<HTMLElement>('#hero-to-expert-sequence .ui-widget');
      const uiBars = gsap.utils.toArray<HTMLElement>('#hero-to-expert-sequence .ui-bar');
      gsap.set(stages, { opacity: 0, scale: 0.9, y: 80, rotateX: 0, transformOrigin: 'center center' });
      const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' }, scrollTrigger: {
        trigger: '#hero-to-expert-sequence', start: 'top top', end: '+=400%', scrub: 1.2, pin: true, anticipatePin: 1,
      }});
      tl.to('.stage-1', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-1 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-1 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-1 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-1', { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });
      tl.to('.stage-2', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-2 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-2 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-2 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-2', { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });
      tl.to('.stage-3', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-3 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-3 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-3 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-3', { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });
      tl.to('.stage-4', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-4 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-4 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-4 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-4', { boxShadow: '0 0 60px rgba(0,255,150,0.22)', duration: 0.6 });
      tl.to(uiBadges, { yPercent: -10, duration: 0.001 }, 0)
        .to(uiBars, { yPercent: -12, duration: 0.001 }, 0)
        .to(uiWidgets, { yPercent: -8, duration: 0.001 }, 0);
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  // Competitor chart data (CSS bars)
  const chartData = [
    { week: 'W1', ashby: 3, greenhouse: 2, us: 1 },
    { week: 'W2', ashby: 4, greenhouse: 2, us: 2 },
    { week: 'W3', ashby: 2, greenhouse: 5, us: 3 },
    { week: 'W4', ashby: 6, greenhouse: 3, us: 4 },
  ];
  const maxVal = 6;

  return (
    <>
      <style>{STYLES}</style>
      <section id="hero-to-expert-sequence" ref={sectionRef}>
        <div className="sequence-viewport">
          <div className="blueprint-grid" />

          {/* Stage 1 — Hawk */}
          <div className="sequence-stage stage-1">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Intelligence · Hawk Agent</div>
                <h3 className="seq-title">Knows what your competitors did last night.</h3>
                <p className="seq-copy">Hawk monitors competitor pricing, product launches, hiring patterns, and G2 reviews — around the clock.</p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Pricing change detection</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Hiring pattern analysis</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Product launch monitoring</span></div>
                </div>
                <p className="seq-copy">Result: 5 competitors monitored 24/7. Zero manual research.</p>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-row"><span className="text-xs text-white/80">Ashby — pricing dropped 20%</span><span className="ui-badge">Urgent</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Greenhouse — hired 6 engineers</span><span className="ui-badge">Flagged</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Lever — new product feature</span><span className="ui-badge">Monitor</span></div>
                  <div className="ui-widget">5 competitors tracked · 3 signals detected this week</div>
                </div>
              </div>
            </div>
          </div>

          {/* Stage 2 — Hawk market lens */}
          <div className="sequence-stage stage-2">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Intelligence · Hawk (Market Lens)</div>
                <h3 className="seq-title">Tracks market shifts in real time.</h3>
                <p className="seq-copy">Hawk also tracks talent markets, salary benchmarks, and industry funding — so you always know what the market looks like.</p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Salary benchmark updates</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Funding round tracking</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Talent market trends</span></div>
                </div>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-widget">Market Intelligence Dashboard</div>
                  <div className="ui-row"><span className="text-xs text-white/80">Senior Engineer salary range</span><span className="ui-badge">$145K–$190K</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">3 companies raised this week</span><span className="ui-badge">Tracked</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Open-to-work signals up 12%</span><span className="ui-badge">Trend</span></div>
                  <div className="ui-bar-track"><div className="ui-bar" style={{ width: '84%' }} /></div>
                </div>
              </div>
            </div>
          </div>

          {/* Stage 3 — Scribe daily brief */}
          <div className="sequence-stage stage-3">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Content · Scribe (Daily Brief)</div>
                <h3 className="seq-title">Your 3-minute morning report. Every day at 7am.</h3>
                <p className="seq-copy">Scribe synthesizes Hawk's overnight findings into your daily morning report. What happened overnight. What needs your attention.</p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Competitor moves overnight</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Action items prioritized</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Cross-department intelligence</span></div>
                </div>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-row"><span className="text-xs text-white/80">1 urgent signal</span><span className="ui-badge">Action</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">2 informational updates</span><span className="ui-badge">FYI</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Growth: 4 leads drafted</span><span className="ui-badge">Summary</span></div>
                  <div className="ui-widget">Morning brief · Delivered 7:00am · 3 min read</div>
                </div>
              </div>
            </div>
          </div>

          {/* Stage 4 — Full Intelligence (ENRICHED) */}
          <div className="sequence-stage stage-4">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Intelligence Department · Complete</div>
                <h3 className="seq-title">Your research team never sleeps.</h3>
                <p className="seq-copy">Hawk watches competitors and the market. Scribe turns it into a daily brief you can read in 3 minutes.</p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Hawk: 5 competitors monitored 24/7</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Hawk: Market and salary data refreshed daily</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Scribe: Morning report drafted at 7am</span></div>
                </div>
                <p className="seq-copy"><strong className="text-white">Intelligence costs: €0 in research staff.</strong></p>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel" style={{ gap: 14 }}>
                  {/* Competitor bar chart */}
                  <div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      New job postings this month
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 80 }}>
                      {chartData.map((d, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
                            <div className="intel-chart-bar" style={{ width: 8, height: `${(d.ashby / maxVal) * 100}%`, background: '#ef4444' }} />
                            <div className="intel-chart-bar" style={{ width: 8, height: `${(d.greenhouse / maxVal) * 100}%`, background: '#3b82f6' }} />
                            <div className="intel-chart-bar" style={{ width: 8, height: `${(d.us / maxVal) * 100}%`, background: '#22c55e' }} />
                          </div>
                          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>{d.week}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 8 }}>
                      <span style={{ color: '#ef4444' }}>● Ashby</span>
                      <span style={{ color: '#3b82f6' }}>● Greenhouse</span>
                      <span style={{ color: '#22c55e' }}>● You</span>
                    </div>
                  </div>

                  {/* Market research saved counter */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Market research saved
                    </span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>€40,000</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>/year</span>
                  </div>

                  {/* Agent status rows */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                    {[
                      { name: 'Hawk', status: 'Monitoring 5 competitors now' },
                      { name: 'Hawk', status: 'Market scan: 12 signals found' },
                      { name: 'Scribe', status: 'Next brief: tomorrow 7:00 AM' },
                    ].map((a, i) => (
                      <div key={`${a.name}-${i}`} className="agent-status-row">
                        <div className="agent-dot" />
                        <span style={{ fontWeight: 600, color: '#fbbf24' }}>{a.name}</span>
                        <span>— {a.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default ExpertJourney;
