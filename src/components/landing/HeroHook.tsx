/**
 * HERO — typography is the graphic.
 *
 * Everything below this section already carries rich product visuals, so the
 * hero deliberately holds none: no portraits, no cards, no diagrams. What
 * makes it feel alive is the writing, the line composition, a masked reveal,
 * and a background that responds very slightly to the cursor.
 *
 * THE CAST CAME OUT. The hero used to introduce all four employees with
 * portraits, names and tags — which is now exactly what section two does, one
 * screen later, in more depth. Meeting them twice in the first two screens
 * made the hero read as a summary of the page rather than an opening line.
 *
 * COPY leads into section two rather than competing with it. The hero states
 * the problem in the founder's own terms; "Your next four hires might not be
 * human" is the answer, and the scroll cue hands over to it.
 *
 * MOTION is masked line reveal, roughly 1.1s end to end, then almost nothing:
 * a highlight that crosses the accent phrase every twelve seconds and a 3px
 * parallax on the background. It should read as alive, not as animated.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ArrowRight } from 'lucide-react';

const HeroHook = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = gsap.context(() => {
      if (reduce) {
        gsap.set('.hero-reveal', { y: '0%', opacity: 1 });
        gsap.set('.hero-fade', { opacity: 1, y: 0 });
        return;
      }
      // Lines rise through their own mask, each a beat behind the last. The
      // accent line lands last so the eye finishes on the point.
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.to('.hero-eyebrow', { opacity: 1, duration: 0.6 }, 0)
        .to('.hero-reveal', { y: '0%', opacity: 1, duration: 1.0, stagger: 0.11 }, 0.14)
        .to('.hero-copy', { opacity: 1, y: 0, duration: 0.9 }, 0.62)
        .to('.hero-cta', { opacity: 1, y: 0, duration: 0.8 }, 0.78)
        .to('.hero-cue', { opacity: 1, duration: 0.8 }, 0.98);
    }, sectionRef);

    // A few pixels of counter-movement is enough to give the type something to
    // sit in front of. Any more and it reads as a gimmick.
    if (reduce) return () => ctx.revert();
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const x = (e.clientX / window.innerWidth - 0.5) * -6;
        const y = (e.clientY / window.innerHeight - 0.5) * -6;
        el.style.setProperty('--px', `${x.toFixed(2)}px`);
        el.style.setProperty('--py', `${y.toFixed(2)}px`);
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frame) cancelAnimationFrame(frame);
      ctx.revert();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="hero relative min-h-[100svh] flex flex-col items-center justify-center overflow-hidden px-6 pt-28 pb-20"
    >
      {/* Atmosphere. Nothing here is an object — it only frames the type. */}
      <div className="hero-bloom" aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />

      <div className="relative z-20 w-full max-w-[1000px] mx-auto">
        <p className="hero-eyebrow opacity-0 font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-400/90 mb-9">
          Built for the AI-native company
        </p>

        {/* Editorial composition: a restrained opening line, a heavier middle,
            and the accent landing last and indented. */}
        <h1 className="hero-h1 font-display font-black text-white mb-9">
          <span className="hero-line">
            <span className="hero-reveal hero-line--sm">Your best hours</span>
          </span>
          <span className="hero-line">
            <span className="hero-reveal">shouldn’t go to work</span>
          </span>
          <span className="hero-line hero-line--indent">
            <span className="hero-reveal hero-accent">that runs itself.</span>
          </span>
        </h1>

        <p className="hero-copy opacity-0 translate-y-4 text-white/55 text-[17px] md:text-[19px] leading-[1.55] max-w-[540px]">
          Agentory gives recurring business work an owner.
          <br className="hidden sm:block" /> Your team keeps the decisions.
        </p>

        <div className="hero-cta opacity-0 translate-y-3 mt-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <button
              onClick={() => navigate('/auth')}
              className="hero-primary group h-[46px] inline-flex items-center gap-2.5 bg-emerald-500 text-[#04120b] font-semibold text-[15px] px-7 rounded-full"
            >
              Put Agentory to work
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <a
              href="#your-next-hires"
              className="hero-secondary h-[46px] inline-flex items-center text-white/65 font-semibold text-[15px] px-7 rounded-full border border-white/12"
            >
              See how it works
            </a>
          </div>
          <p className="text-[13.5px] text-white/32 mt-5">Set up in minutes · Start free · Cancel anytime</p>
        </div>
      </div>

      {/* Hands over to section two. */}
      <a
        href="#your-next-hires"
        className="hero-cue opacity-0 absolute bottom-9 left-1/2 -translate-x-1/2 inline-flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.2em] text-white/30 hover:text-white/60 transition-colors duration-300"
      >
        Meet your next hires
        <span className="hero-cue__arrow">↓</span>
      </a>

      <style>{`
        .hero { --px: 0px; --py: 0px; }

        /* Ambient light behind the headline, drifting with the cursor. */
        .hero-bloom {
          position: absolute; inset: -10%; z-index: 1; pointer-events: none;
          background: radial-gradient(58% 46% at 38% 44%, rgba(16,185,129,0.13), transparent 68%);
          transform: translate3d(var(--px), var(--py), 0);
          transition: transform 700ms cubic-bezier(0.22,1,0.36,1);
        }
        /* Darkens the edges so the grid never competes with the type. */
        .hero-vignette {
          position: absolute; inset: 0; z-index: 2; pointer-events: none;
          background:
            radial-gradient(72% 60% at 40% 46%, rgba(0,0,0,0.72), transparent 70%),
            linear-gradient(180deg, rgba(0,0,0,0.35), transparent 22%, transparent 72%, rgba(0,0,0,0.55));
        }

        .hero-h1 {
          font-size: clamp(2.4rem, 6.4vw, 5.4rem);
          line-height: 0.98;
          letter-spacing: -0.05em;
        }
        /* Each line is its own mask; the span inside rises through it. */
        .hero-line { display: block; overflow: hidden; padding-bottom: 0.08em; }
        .hero-line--sm { font-size: 0.62em; letter-spacing: -0.035em; color: rgba(255,255,255,0.5); }
        .hero-line--indent { padding-left: clamp(0px, 5vw, 74px); }
        .hero-reveal { display: block; transform: translateY(105%); opacity: 0; will-change: transform; }

        .hero-accent {
          color: #34d399;
          position: relative;
          transition: letter-spacing 400ms cubic-bezier(0.22,1,0.36,1), text-shadow 400ms ease;
        }
        /* One highlight crossing the accent every twelve seconds. */
        .hero-accent::after {
          content: ''; position: absolute; inset: -0.1em -0.2em; pointer-events: none;
          background: linear-gradient(100deg, transparent 42%, rgba(255,255,255,0.22) 50%, transparent 58%);
          transform: translateX(-120%);
          animation: heroSheen 12s ease-in-out infinite;
        }
        @keyframes heroSheen { 0%, 78% { transform: translateX(-120%); } 92%, 100% { transform: translateX(120%); } }
        .hero-h1:hover .hero-accent {
          letter-spacing: -0.062em;
          text-shadow: 0 0 34px rgba(52,211,153,0.42);
        }

        .hero-primary {
          box-shadow: 0 4px 26px rgba(16,185,129,0.28);
          transition: box-shadow 300ms ease, background-color 300ms ease;
        }
        .hero-primary:hover { background-color: #4ade80; box-shadow: 0 6px 34px rgba(16,185,129,0.42); }
        .hero-secondary { transition: color 250ms ease, border-color 250ms ease, background-color 250ms ease; }
        .hero-secondary:hover { color: #fff; border-color: rgba(255,255,255,0.28); background: rgba(255,255,255,0.04); }

        .hero-cue__arrow { display: inline-block; animation: heroCue 2.6s ease-in-out infinite; }
        @keyframes heroCue { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }

        @media (prefers-reduced-motion: reduce) {
          .hero-bloom { transition: none; }
          .hero-accent::after, .hero-cue__arrow { animation: none; }
          .hero-accent::after { opacity: 0; }
        }
      `}</style>
    </section>
  );
};

export default HeroHook;
export { HeroHook };
