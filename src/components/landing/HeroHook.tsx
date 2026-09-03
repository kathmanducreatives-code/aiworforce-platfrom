/**
 * HERO — typography is the graphic.
 *
 * Everything below the fold already carries product visuals, so the hero holds
 * none: no portraits, no cards, no diagrams. It states what Agentory is and
 * hands to section two, which introduces the employees.
 *
 * What makes it feel expensive is refinement rather than furniture — a masked
 * line reveal, an ambient field that follows the cursor with heavy smoothing,
 * ghost words holding the corners, and a scroll exit that compresses into the
 * next section instead of cutting.
 *
 * PERFORMANCE. Transform and opacity only. Two rAF-throttled listeners
 * (pointer, scroll) write CSS variables; everything else is CSS. No canvas, no
 * particles, no WebGL. Cursor-driven effects are desktop-only and every
 * animation stops under prefers-reduced-motion.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ArrowRight } from 'lucide-react';

/** Atmospheric only — the disciplines the product covers, held at the edges. */
const GHOSTS = [
  { word: 'Research', className: 'hero-ghost--tl' },
  { word: 'Leads', className: 'hero-ghost--tr' },
  { word: 'Content', className: 'hero-ghost--bl' },
  { word: 'Signals', className: 'hero-ghost--br' },
];

const HeroHook = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;

    const ctx = gsap.context(() => {
      if (reduce) {
        gsap.set('.hero-reveal', { y: '0%', opacity: 1 });
        gsap.set('.hero-eyebrow, .hero-copy, .hero-cta, .hero-cue', { opacity: 1, y: 0 });
        return;
      }
      // Roughly 1.15s end to end. Each line rises through its own mask a beat
      // behind the last, so the eye finishes on the accent.
      gsap.timeline({ defaults: { ease: 'expo.out' } })
        .to('.hero-eyebrow', { opacity: 1, y: 0, duration: 0.7 }, 0)
        .to('.hero-reveal', { y: '0%', opacity: 1, duration: 1.05, stagger: 0.1 }, 0.16)
        .to('.hero-copy', { opacity: 1, y: 0, duration: 0.9 }, 0.66)
        .to('.hero-cta', { opacity: 1, y: 0, duration: 0.8 }, 0.82)
        .to('.hero-cue', { opacity: 1, duration: 0.9 }, 1.0);
    }, sectionRef);

    const cleanups: (() => void)[] = [() => ctx.revert()];

    // Scroll exit: the hero compresses rather than cutting. Written as a
    // variable so the whole composition can key off one number.
    let sFrame = 0;
    const onScroll = () => {
      if (sFrame) return;
      sFrame = requestAnimationFrame(() => {
        sFrame = 0;
        const h = el.offsetHeight || 1;
        el.style.setProperty('--s', String(Math.min(1, Math.max(0, window.scrollY / h))));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => { window.removeEventListener('scroll', onScroll); if (sFrame) cancelAnimationFrame(sFrame); });

    if (fine && !reduce) {
      // Heavily smoothed so it reads as ambience, not as a cursor toy.
      let px = 50, py = 46, tx = 50, ty = 46, raf = 0;
      const tick = () => {
        px += (tx - px) * 0.045;
        py += (ty - py) * 0.045;
        el.style.setProperty('--mx', `${px.toFixed(2)}%`);
        el.style.setProperty('--my', `${py.toFixed(2)}%`);
        raf = requestAnimationFrame(tick);
      };
      const onMove = (e: PointerEvent) => {
        tx = (e.clientX / window.innerWidth) * 100;
        ty = (e.clientY / window.innerHeight) * 100;
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      raf = requestAnimationFrame(tick);
      cleanups.push(() => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); });

      // A couple of pixels of pull on the primary CTA. Any more is a gimmick.
      const btn = primaryRef.current;
      if (btn) {
        const onBtn = (e: PointerEvent) => {
          const r = btn.getBoundingClientRect();
          btn.style.setProperty('--bx', `${((e.clientX - r.left) / r.width - 0.5) * 6}px`);
          btn.style.setProperty('--by', `${((e.clientY - r.top) / r.height - 0.5) * 4}px`);
        };
        const offBtn = () => { btn.style.setProperty('--bx', '0px'); btn.style.setProperty('--by', '0px'); };
        btn.addEventListener('pointermove', onBtn);
        btn.addEventListener('pointerleave', offBtn);
        cleanups.push(() => { btn.removeEventListener('pointermove', onBtn); btn.removeEventListener('pointerleave', offBtn); });
      }
    }

    return () => cleanups.forEach((f) => f());
  }, []);

  return (
    <section ref={sectionRef} className="hero relative min-h-[100svh] flex flex-col items-center justify-center overflow-hidden px-6 pt-28 pb-24">
      {/* Atmosphere. None of this is an object; it only frames the type. */}
      {GHOSTS.map((g) => (
        <span key={g.word} className={`hero-ghost ${g.className}`} aria-hidden="true">{g.word}</span>
      ))}
      <span className="hero-field" aria-hidden="true" />
      <span className="hero-bloom" aria-hidden="true" />
      <span className="hero-scan" aria-hidden="true" />
      <span className="hero-vignette" aria-hidden="true" />

      <div className="hero-inner relative z-20 w-full text-center">
        <p className="hero-eyebrow opacity-0 translate-y-2 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.03] backdrop-blur-md px-4 py-1.5 mb-9">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-emerald-300/90">
            AI employees for business
          </span>
        </p>

        <h1 className="hero-h1 font-display font-black text-white mx-auto">
          <span className="hero-line">
            <span className="hero-reveal hero-line--intro">
              Agentory <span className="hero-serif">is where you</span>
            </span>
          </span>
          <span className="hero-line">
            <span className="hero-reveal">build, assign, and manage</span>
          </span>
          <span className="hero-line">
            <span className="hero-reveal hero-accent">AI employees.</span>
          </span>
        </h1>

        <p className="hero-copy opacity-0 translate-y-4 text-white/60 text-[18px] md:text-[20px] leading-[1.6] max-w-[700px] mx-auto mt-8">
          Create specialized AI employees, give them responsibilities, and run their work across
          your business — all from one place.
        </p>

        <div className="hero-cta opacity-0 translate-y-3 mt-10">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5">
            <button ref={primaryRef} onClick={() => navigate('/auth')} className="hero-primary group">
              Put Agentory to work
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-[4px]" />
            </button>
            <a href="#your-next-hires" className="hero-secondary">See how it works</a>
          </div>
          <p className="text-[13.5px] text-white/35 mt-6">Set up in minutes · Start free · Cancel anytime</p>
        </div>
      </div>

      {/* Hands over to "Your next four hires might not be human." */}
      <a href="#your-next-hires" className="hero-cue opacity-0 absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-300/45 hover:text-emerald-300/80 transition-colors duration-300">
          Meet your next hires ↓
        </span>
        <span className="hero-cue__line" aria-hidden="true" />
      </a>

      <style>{`
        .hero { --mx: 50%; --my: 46%; --s: 0; }

        /* ── Atmosphere ─────────────────────────────────────────────────── */
        /* Ambient field following the cursor. Large, dim, slow. */
        .hero-field {
          position: absolute; inset: -20%; z-index: 1; pointer-events: none;
          background: radial-gradient(46% 42% at var(--mx) var(--my), rgba(16,185,129,0.11), transparent 66%);
        }
        /* Fixed bloom behind the headline, breathing on a 13s cycle. */
        .hero-bloom {
          position: absolute; left: 50%; top: 44%; width: min(1100px, 92vw); height: 620px;
          transform: translate(-50%, -50%); z-index: 1; pointer-events: none; border-radius: 9999px;
          background: radial-gradient(closest-side, rgba(16,185,129,0.15), transparent 72%);
          filter: blur(40px); animation: heroBreathe 13s ease-in-out infinite;
        }
        @keyframes heroBreathe { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
        /* One light crossing a grid line. The only moving decoration. */
        .hero-scan {
          position: absolute; left: 0; right: 0; top: 34%; height: 1px; z-index: 1; pointer-events: none;
          background: linear-gradient(90deg, transparent, rgba(52,211,153,0.5), transparent);
          transform: translateX(-100%); animation: heroScan 17s ease-in-out infinite;
        }
        @keyframes heroScan { 0%, 62% { transform: translateX(-100%); } 88%, 100% { transform: translateX(100%); } }
        .hero-vignette {
          position: absolute; inset: 0; z-index: 2; pointer-events: none;
          background:
            radial-gradient(64% 54% at 50% 46%, rgba(0,0,0,0.72), transparent 70%),
            linear-gradient(180deg, rgba(0,0,0,0.4), transparent 20%, transparent 74%, rgba(0,0,0,0.6));
        }
        /* Ghost words. Outlined, cropped, barely there. */
        .hero-ghost {
          position: absolute; z-index: 0; pointer-events: none; user-select: none;
          font-family: 'Inter Tight', system-ui, sans-serif; font-weight: 900;
          font-size: clamp(90px, 13vw, 210px); line-height: 0.8; letter-spacing: -0.05em;
          color: transparent; -webkit-text-stroke: 1px rgba(255,255,255,0.026);
          animation: heroDrift 22s ease-in-out infinite;
        }
        .hero-ghost--tl { top: 3%;  left: -8%;  }
        .hero-ghost--tr { top: 8%;  right: -9%; animation-delay: -6s; }
        .hero-ghost--bl { bottom: 4%; left: -9%; animation-delay: -12s; }
        .hero-ghost--br { bottom: 1%; right: -8%; animation-delay: -18s; }
        @keyframes heroDrift { 0%, 100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(6px,-8px,0); } }

        /* ── Composition, compressing as the hero exits ─────────────────── */
        .hero-inner {
          max-width: 1120px; margin-inline: auto;
          transform: translateY(calc(var(--s) * -26px)) scale(calc(1 - var(--s) * 0.04));
          opacity: calc(1 - var(--s) * 0.9);
          will-change: transform, opacity;
        }
        /* The eyebrow goes first, so the headline is the last thing holding. */
        .hero-eyebrow { opacity: calc(1 - var(--s) * 2.4); }

        /* ── Headline ──────────────────────────────────────────────────── */
        .hero-h1 {
          font-size: clamp(2.3rem, 5.4vw, 4.6rem);
          line-height: 1.03; letter-spacing: -0.045em; max-width: 1050px;
        }
        .hero-line { display: block; overflow: hidden; padding-bottom: 0.09em; }
        .hero-reveal { display: block; transform: translateY(105%); opacity: 0; will-change: transform; }
        /* Line one stays fully readable — it is the sentence's subject. */
        .hero-line--intro { font-size: 0.74em; letter-spacing: -0.035em; color: rgba(255,255,255,0.94); }
        .hero-serif {
          font-family: 'Instrument Serif', Georgia, serif;
          font-style: italic; font-weight: 400; letter-spacing: -0.01em;
          color: rgba(255,255,255,0.78);
        }
        .hero-accent {
          position: relative; display: inline-block;
          background: linear-gradient(178deg, #6ee7b7 4%, #34d399 52%, #10b981 100%);
          -webkit-background-clip: text; background-clip: text; color: transparent;
          transition: letter-spacing 420ms cubic-bezier(0.22,1,0.36,1), filter 420ms ease;
          filter: drop-shadow(0 0 26px rgba(16,185,129,calc(0.3 - var(--s) * 0.3)));
        }
        .hero-accent::after {
          content: ''; position: absolute; inset: -0.12em -0.25em; pointer-events: none;
          background: linear-gradient(100deg, transparent 42%, rgba(255,255,255,0.2) 50%, transparent 58%);
          transform: translateX(-125%); animation: heroSheen 11s ease-in-out infinite;
        }
        @keyframes heroSheen { 0%, 76% { transform: translateX(-125%); } 92%, 100% { transform: translateX(125%); } }
        .hero-h1:hover .hero-accent { letter-spacing: -0.058em; filter: drop-shadow(0 0 40px rgba(16,185,129,0.5)); }

        /* ── Buttons ───────────────────────────────────────────────────── */
        .hero-primary {
          --bx: 0px; --by: 0px;
          height: 48px; display: inline-flex; align-items: center; gap: 10px;
          padding-inline: 28px; border-radius: 9999px;
          background: linear-gradient(180deg, #4ade80, #10b981);
          color: #04120b; font-weight: 650; font-size: 15px;
          box-shadow: 0 1px 0 rgba(255,255,255,0.3) inset, 0 6px 30px rgba(16,185,129,0.3);
          transform: translate3d(var(--bx), var(--by), 0);
          transition: transform 260ms cubic-bezier(0.22,1,0.36,1), box-shadow 260ms ease;
        }
        .hero-primary:hover { box-shadow: 0 1px 0 rgba(255,255,255,0.38) inset, 0 8px 40px rgba(16,185,129,0.46); }
        .hero-primary:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 3px; }
        .hero-secondary {
          height: 48px; display: inline-flex; align-items: center; padding-inline: 26px;
          border-radius: 9999px; font-weight: 600; font-size: 15px;
          color: rgba(255,255,255,0.68); border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.03); backdrop-filter: blur(10px);
          transition: color 220ms ease, border-color 220ms ease, background-color 220ms ease;
        }
        .hero-secondary:hover { color: #fff; border-color: rgba(52,211,153,0.4); background: rgba(255,255,255,0.06); }
        .hero-secondary:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 3px; }

        /* ── Bottom cue ────────────────────────────────────────────────── */
        /* Brightens as the hero leaves, so the handover feels intentional. */
        .hero-cue { opacity: calc(1 - var(--s) * 1.6); }
        .hero-cue__line {
          display: block; width: 1px; height: 34px;
          background: linear-gradient(180deg, rgba(52,211,153,0.5), transparent);
          transform-origin: top; animation: heroCueLine 3.4s ease-in-out infinite;
        }
        @keyframes heroCueLine { 0%, 100% { transform: scaleY(0.45); opacity: 0.5; } 50% { transform: scaleY(1); opacity: 1; } }

        @media (max-width: 1023px) {
          /* Ghost words become clutter before they become atmosphere. */
          .hero-ghost { display: none; }
          .hero-scan { display: none; }
          .hero-h1 { font-size: clamp(2rem, 8vw, 2.9rem); }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-bloom, .hero-scan, .hero-ghost, .hero-accent::after, .hero-cue__line { animation: none; }
          .hero-accent::after { opacity: 0; }
          .hero-inner, .hero-eyebrow, .hero-cue { transform: none; opacity: 1; }
          .hero-primary { transition: box-shadow 260ms ease; }
        }
      `}</style>
    </section>
  );
};

export default HeroHook;
export { HeroHook };
