import { type ComponentType, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Clock3, Briefcase, Users, Target } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

type FeatureSlide = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  bullets: string[];
  stat: string;
};

const slides: FeatureSlide[] = [
  {
    icon: Clock3,
    title: 'Hire in Days, Not Months',
    description: 'Agencies take 6–8 weeks to send you 5 profiles. ScreeningPilot scores hundreds of candidates in seconds.',
    bullets: ['Instant candidate scoring', 'Same-day shortlists', 'No waiting for agency callbacks'],
    stat: '8 weeks → 8 seconds',
  },
  {
    icon: Briefcase,
    title: 'Kill the 20% Agency Fee',
    description: 'Stop paying €24,000 per hire for what is essentially a glorified LinkedIn search. Do it yourself for €149/month.',
    bullets: ['No per-hire placement fees', '97% cheaper than agencies', 'Unlimited screenings included'],
    stat: '€24K → €149/mo',
  },
  {
    icon: Users,
    title: 'No Recruiter Army Needed',
    description: 'One person with ScreeningPilot outperforms a team of 5 agency recruiters. AI handles the grunt work.',
    bullets: ['AI screens every applicant', 'Auto-generated interview prep', 'One dashboard, zero chaos'],
    stat: '1 Person = 5 Recruiters',
  },
  {
    icon: Target,
    title: 'Only Interview the Best',
    description: 'Agencies send you candidates who waste your time. ScreeningPilot auto-rejects 95% of bad fits before they reach you.',
    bullets: ['AI-powered fit scoring', 'Only top candidates surface', 'Zero wasted interviews'],
    stat: '95% Auto-Rejected',
  },
];

const STYLES = `
.features-3d-section {
  position: relative;
  min-height: 100vh;
  background: #02060a;
  perspective: 1500px;
  overflow: clip;
}

.features-grid-background {
  position: sticky;
  top: 0;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 25% 20%, rgba(0,255,150,0.1), transparent 45%),
    radial-gradient(circle at 78% 26%, rgba(0,255,150,0.08), transparent 44%),
    linear-gradient(rgba(0,255,150,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,255,150,0.05) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 64px 64px, 64px 64px;
}

.features-wrapper {
  position: relative;
  z-index: 2;
  height: 100vh;
  transform-style: preserve-3d;
}

.fs-intro {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  width: min(940px, 92vw);
  text-align: center;
  z-index: 18;
}

.fs-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-style: preserve-3d;
}

.fs-card {
  position: absolute;
  width: min(900px, 92vw);
  height: min(70vh, 600px);
  border-radius: 24px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 255, 150, 0.2);
  box-shadow: 0 0 40px rgba(0, 255, 150, 0.15);
  overflow: hidden;
  display: grid;
  grid-template-columns: 0.95fr 1.05fr;
  will-change: transform, opacity;
  transform-style: preserve-3d;
}

.fs-left {
  padding: 34px;
  border-right: 1px solid rgba(0,255,150,0.12);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.fs-right {
  padding: 24px;
  display: flex;
  align-items: stretch;
}

.fs-panel {
  width: 100%;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.36);
  padding: 16px;
  display: grid;
  gap: 10px;
  transform-style: preserve-3d;
}

.fs-icon-wrap {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  border: 1px solid rgba(0,255,150,0.3);
  background: rgba(0,255,150,0.12);
  display: grid;
  place-items: center;
  color: #34d399;
}

.fs-kicker {
  margin-top: 14px;
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #4ade80;
}

.fs-title {
  margin-top: 12px;
  font-size: clamp(1.55rem, 2.1vw, 2rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
  font-weight: 900;
  color: #fff;
}

.fs-description {
  margin-top: 12px;
  color: rgba(255,255,255,0.68);
  line-height: 1.62;
  font-size: 14px;
}

.fs-bullets {
  margin-top: 16px;
  display: grid;
  gap: 8px;
}

.fs-bullet {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: rgba(255,255,255,0.78);
}

.fs-check {
  color: #34d399;
  line-height: 1.3;
}

.fs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.fs-row:last-child {
  border-bottom: none;
}

.fs-card-badge {
  transform: translateZ(34px);
  border-radius: 999px;
  border: 1px solid rgba(0,255,150,0.35);
  background: rgba(0,255,150,0.1);
  color: #4ade80;
  font-size: 10px;
  padding: 4px 10px;
  white-space: nowrap;
}

.fs-card-widget {
  transform: translateZ(22px);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.11);
  background: rgba(255,255,255,0.04);
  padding: 8px 10px;
  color: rgba(255,255,255,0.8);
  font-size: 11px;
}

.fs-bar-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.1);
  overflow: hidden;
}

.fs-card-bar {
  height: 100%;
  transform: translateZ(40px);
  background: linear-gradient(90deg, #16a34a, #34d399);
}

@media (max-width: 1024px) {
  .fs-card {
    grid-template-columns: 1fr;
    height: min(78vh, 700px);
  }

  .fs-left {
    border-right: none;
    border-bottom: 1px solid rgba(0,255,150,0.12);
    padding: 22px;
  }

  .fs-right {
    padding: 16px;
  }
}
`;

const FeatureSet = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = gsap.context(() => {
      const featureCards = gsap.utils.toArray<HTMLElement>('.fs-card');
      const intro = section.querySelector<HTMLElement>('.fs-intro');

      if (!featureCards.length) return;

      gsap.set(featureCards, {
        scale: 0.8,
        opacity: 0,
        y: 80,
        rotateX: 6,
        z: -120,
        transformOrigin: 'center center',
      });
      gsap.set('.fs-focus-item', { opacity: 0, y: 16 });
      featureCards.forEach((card, index) => gsap.set(card, { zIndex: index + 1 }));

      const timeline = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=460%',
          pin: true,
          scrub: prefersReduced ? false : 1.1,
          anticipatePin: 1,
        },
      });

      if (intro) {
        timeline.to(intro, { y: -56, opacity: 0.2, duration: 0.6 }, 0);
      }

      featureCards.forEach((card, index) => {
        const point = index * 0.92;

        timeline.fromTo(
          card,
          { scale: 0.8, opacity: 0, y: 80, rotateX: 6, z: -120 },
          { scale: 1, opacity: 1, y: 0, rotateX: 0, z: 0, duration: 0.9 },
          point,
        );

        timeline.to(card, { boxShadow: '0 0 48px rgba(0,255,150,0.2)', duration: 0.3 }, point + 0.3);

        const focusNodes = card.querySelectorAll('.fs-focus-item');
        if (focusNodes.length) {
          timeline.to(
            focusNodes,
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.05 },
            point + 0.24,
          );
        }

        if (index < featureCards.length - 1) {
          timeline.to(
            card,
            { rotateX: -10, scale: 0.9, opacity: 0, y: -44, z: -220, duration: 0.82 },
            point + 0.74,
          );
        }
      });

      featureCards.forEach((card, index) => {
        const badges = card.querySelectorAll('.fs-card-badge');
        const bars = card.querySelectorAll('.fs-card-bar');
        const widgets = card.querySelectorAll('.fs-card-widget');

        if (badges.length) {
          gsap.to(badges, {
            y: -20 - index * 3,
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: '+=460%',
              scrub: true,
            },
          });
        }

        if (bars.length) {
          gsap.to(bars, {
            y: -34 - index * 4,
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: '+=460%',
              scrub: true,
            },
          });
        }

        if (widgets.length) {
          gsap.to(widgets, {
            y: -16 - index * 3,
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: '+=460%',
              scrub: true,
            },
          });
        }
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <>
      <style>{STYLES}</style>
      <section id="features" className="features-3d-section" ref={sectionRef}>
        <div className="features-grid-background" />

        <div className="features-wrapper">
          <div className="fs-intro">
            <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ Why Smart Companies Ditch Agencies</p>
            <h2 className="font-display font-black text-[clamp(1.9rem,4.2vw,3.4rem)] leading-[1.04] tracking-[-0.04em] text-white">
              EVERYTHING YOUR AGENCY DOES
              <span className="block text-emerald-400">BUT 97% CHEAPER AND 10× FASTER</span>
            </h2>
          </div>

          <div className="fs-stage">
            {slides.map((slide) => {
              const Icon = slide.icon;
              return (
                <article className="fs-card" key={slide.title}>
                  <div className="fs-left">
                    <div className="fs-icon-wrap">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="fs-kicker">Agency Killer</div>
                    <h3 className="fs-title">{slide.title}</h3>
                    <p className="fs-description">{slide.description}</p>
                    <div className="fs-bullets">
                      {slide.bullets.map((item) => (
                        <div className="fs-bullet" key={item}>
                          <span className="fs-check">✓</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="fs-right">
                    <div className="fs-panel">
                      <div className="fs-row fs-focus-item">
                        <span className="text-xs text-white/75">Impact</span>
                        <span className="fs-card-badge">{slide.stat}</span>
                      </div>
                      <div className="fs-row fs-focus-item">
                        <span className="text-xs text-white/75">Setup time</span>
                        <span className="fs-card-badge">30 seconds</span>
                      </div>
                      <div className="fs-row fs-focus-item">
                        <span className="text-xs text-white/75">Agency replacement</span>
                        <span className="fs-card-badge">Complete</span>
                      </div>

                      <div className="fs-focus-item">
                        <div className="flex items-center justify-between text-xs text-white/75 mb-2">
                          <span>Agency fee eliminated</span>
                          <span>97%</span>
                        </div>
                        <div className="fs-bar-track">
                          <div className="fs-card-bar" style={{ width: '97%' }} />
                        </div>
                      </div>

                      <div className="fs-card-widget fs-focus-item">Replaces sourcing, screening, and shortlisting agencies</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
};

export default FeatureSet;
