import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const STYLES = `
#hero-to-expert-sequence {
  position: relative;
  height: 400vh;
  background: #04060d;
}

#hero-to-expert-sequence .sequence-viewport {
  position: sticky;
  top: 0;
  height: 100vh;
  perspective: 1500px;
  overflow: hidden;
}

#hero-to-expert-sequence .blueprint-grid {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.2;
  background:
    radial-gradient(circle at 20% 18%, rgba(0, 255, 150, 0.2), transparent 44%),
    radial-gradient(circle at 82% 22%, rgba(0, 255, 150, 0.15), transparent 42%),
    linear-gradient(rgba(0, 255, 150, 0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 255, 150, 0.18) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 68px 68px, 68px 68px;
}

#hero-to-expert-sequence .sequence-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.9);
  z-index: 2;
  will-change: transform, opacity;
  transform-style: preserve-3d;
}

#hero-to-expert-sequence .sequence-card {
  width: min(980px, 92vw);
  height: min(72vh, 640px);
  border-radius: 24px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 255, 150, 0.2);
  box-shadow: 0 0 40px rgba(0, 255, 150, 0.15);
  overflow: hidden;
  display: grid;
  grid-template-columns: 1.06fr 0.94fr;
  transform-style: preserve-3d;
  will-change: transform, opacity;
}

#hero-to-expert-sequence .sequence-content {
  padding: 34px;
  border-right: 1px solid rgba(0, 255, 150, 0.14);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

#hero-to-expert-sequence .sequence-ui {
  padding: 22px;
  display: flex;
  align-items: stretch;
}

#hero-to-expert-sequence .seq-label {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #4ade80;
}

#hero-to-expert-sequence .seq-title {
  margin-top: 12px;
  font-size: clamp(1.8rem, 3.2vw, 3rem);
  line-height: 1.03;
  letter-spacing: -0.04em;
  color: #fff;
  font-weight: 900;
}

#hero-to-expert-sequence .seq-copy {
  margin-top: 14px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.62;
  font-size: 14px;
}

#hero-to-expert-sequence .seq-bullets {
  margin-top: 14px;
  display: grid;
  gap: 8px;
}

#hero-to-expert-sequence .seq-bullet {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 12px;
}

#hero-to-expert-sequence .seq-bullet-mark {
  color: #34d399;
  line-height: 1.3;
}

#hero-to-expert-sequence .ui-panel {
  width: 100%;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.38);
  padding: 14px;
  display: grid;
  gap: 10px;
  transform-style: preserve-3d;
}

#hero-to-expert-sequence .ui-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

#hero-to-expert-sequence .ui-row:last-child {
  border-bottom: none;
}

#hero-to-expert-sequence .ui-badge,
#hero-to-expert-sequence .ui-widget,
#hero-to-expert-sequence .ui-bar {
  will-change: transform, opacity;
}

#hero-to-expert-sequence .ui-badge {
  transform: translateZ(34px);
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 150, 0.35);
  background: rgba(0, 255, 150, 0.12);
  color: #4ade80;
  font-size: 10px;
  padding: 4px 10px;
  white-space: nowrap;
}

#hero-to-expert-sequence .ui-widget {
  transform: translateZ(24px);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 10px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
}

#hero-to-expert-sequence .ui-bar-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

#hero-to-expert-sequence .ui-bar {
  height: 100%;
  transform: translateZ(40px);
  background: linear-gradient(90deg, #16a34a, #34d399);
}

@media (max-width: 1024px) {
  #hero-to-expert-sequence .sequence-card {
    grid-template-columns: 1fr;
    height: min(80vh, 720px);
  }

  #hero-to-expert-sequence .sequence-content {
    border-right: 0;
    border-bottom: 1px solid rgba(0, 255, 150, 0.14);
    padding: 24px;
  }

  #hero-to-expert-sequence .sequence-ui {
    padding: 16px;
  }
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

      gsap.set(stages, {
        opacity: 0,
        scale: 0.9,
        y: 80,
        rotateX: 0,
        transformOrigin: 'center center',
      });

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: '#hero-to-expert-sequence',
          start: 'top top',
          end: '+=400%',
          scrub: 1.2,
          pin: true,
          anticipatePin: 1,
        },
      });

      // Stage 1
      tl.to('.stage-1', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-1 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-1 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-1 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-1', { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });

      // Stage 2
      tl.to('.stage-2', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-2 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-2 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-2 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-2', { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });

      // Stage 3
      tl.to('.stage-3', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-3 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-3 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-3 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-3', { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });

      // Stage 4
      tl.to('.stage-4', { opacity: 1, scale: 1, y: 0, duration: 0.75 })
        .to('.stage-4 .ui-badge', { y: -24, duration: 0.55 }, '<')
        .to('.stage-4 .ui-bar', { y: -34, duration: 0.55 }, '<')
        .to('.stage-4 .ui-widget', { y: -18, duration: 0.55 }, '<')
        .to('.stage-4', { boxShadow: '0 0 60px rgba(0,255,150,0.22)', duration: 0.6 });

      // Keep subtle global depth motion tied to same pinned trigger (no extra child triggers)
      tl.to(uiBadges, { yPercent: -10, duration: 0.001 }, 0)
        .to(uiBars, { yPercent: -12, duration: 0.001 }, 0)
        .to(uiWidgets, { yPercent: -8, duration: 0.001 }, 0);
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <>
      <style>{STYLES}</style>
      <section id="hero-to-expert-sequence" ref={sectionRef}>
        <div className="sequence-viewport">
          <div className="blueprint-grid" />

          <div className="sequence-stage stage-1">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Stage 1 · AI Screening</div>
                <h3 className="seq-title">AI Filters Out 95% of Unqualified Candidates</h3>
                <p className="seq-copy">
                  ScreeningPilot automatically evaluates resumes, experience relevance, and screening responses so only high-fit profiles move to interviews.
                </p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Resume quality</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Experience relevance</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Answers to screening questions</span></div>
                </div>
                <p className="seq-copy">Result: Every candidate receives an AI screening score.</p>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-row"><span className="text-xs text-white/80">Candidate: Alex R.</span><span className="ui-badge">Score 92</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Candidate: Sara P.</span><span className="ui-badge">Score 87</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Candidate: James K.</span><span className="ui-badge">Score 41</span></div>
                  <div className="ui-widget">Auto-filtered queue updated in real time</div>
                </div>
              </div>
            </div>
          </div>

          <div className="sequence-stage stage-2">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Stage 2 · Interview Blueprint</div>
                <h3 className="seq-title">AI Generates an Interview Blueprint</h3>
                <p className="seq-copy">
                  For shortlisted candidates, ScreeningPilot prepares a structured guide with claim checks, verification questions, and focus areas.
                </p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Claims made in the resume</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Suggested verification questions</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Key areas to evaluate</span></div>
                </div>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-widget">Blueprint: Senior Frontend Engineer</div>
                  <div className="ui-row"><span className="text-xs text-white/80">React architecture depth</span><span className="ui-badge">Priority</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">System design ownership</span><span className="ui-badge">Verify</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Cross-team communication</span><span className="ui-badge">Probe</span></div>
                  <div className="ui-bar-track"><div className="ui-bar" style={{ width: '84%' }} /></div>
                </div>
              </div>
            </div>
          </div>

          <div className="sequence-stage stage-3">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Stage 3 · Expert Marketplace</div>
                <h3 className="seq-title">Send Candidates to Expert Interviewers</h3>
                <p className="seq-copy">
                  Instead of hiring full-time recruiters, teams can use fractional expert interviewers on demand directly from ScreeningPilot.
                </p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Select interviewers</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Send interview invitations</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Schedule candidate interviews</span></div>
                </div>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-row"><span className="text-xs text-white/80">Sarah K. · Principal Engineer</span><span className="ui-badge">Available</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Nisha R. · Staff Product Lead</span><span className="ui-badge">Available</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Daniel M. · Senior Architect</span><span className="ui-badge">Invited</span></div>
                  <div className="ui-widget">3 interview invitations generated</div>
                </div>
              </div>
            </div>
          </div>

          <div className="sequence-stage stage-4">
            <div className="sequence-card">
              <div className="sequence-content">
                <div className="seq-label">Stage 4 · Final Interview Decision</div>
                <h3 className="seq-title">Interviewers Conduct the Final Interview</h3>
                <p className="seq-copy">
                  Interviewers receive candidate resume, AI score, blueprint, and verification prompts inside one dashboard before approving or rejecting.
                </p>
                <div className="seq-bullets">
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Candidate resume + AI results</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Suggested verification questions</span></div>
                  <div className="seq-bullet"><span className="seq-bullet-mark">•</span><span>Approve / Reject decision flow</span></div>
                </div>
                <p className="seq-copy"><strong className="text-white">90% of recruiting completed automatically.</strong></p>
              </div>
              <div className="sequence-ui">
                <div className="ui-panel">
                  <div className="ui-row"><span className="text-xs text-white/80">Candidate fit confidence</span><span className="ui-badge">High</span></div>
                  <div className="ui-row"><span className="text-xs text-white/80">Interview completeness</span><span className="ui-badge">92%</span></div>
                  <div className="ui-bar-track"><div className="ui-bar" style={{ width: '92%' }} /></div>
                  <div className="ui-widget">Decision actions: Approve / Reject / Hold</div>
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
