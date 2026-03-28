import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  Eye,
  TrendingUp,
  Users,
} from "lucide-react";

const ENTRANCE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const BOOT_TEXT = "Assembling your AI team...";
const BOOT_DOTS = [0, 1, 2, 3, 4];

const STAR_LAYER_ONE = Array.from({ length: 120 }, (_, index) => ({
  id: `far-${index}`,
  left: `${((index * 13.7 + 11) % 100).toFixed(2)}%`,
  top: `${((index * 17.9 + 9) % 88).toFixed(2)}%`,
  size: index % 9 === 0 ? 1.4 : 1,
  opacity: 0.18 + (index % 5) * 0.04,
}));

const STAR_LAYER_TWO = Array.from({ length: 80 }, (_, index) => ({
  id: `mid-${index}`,
  left: `${((index * 19.1 + 7) % 100).toFixed(2)}%`,
  top: `${((index * 23.3 + 13) % 82).toFixed(2)}%`,
  size: 1.5,
  opacity: 0.5 + (index % 4) * 0.05,
}));

const TWINKLE_DURATIONS = [3, 4, 5, 6, 7];

const STAR_LAYER_THREE = Array.from({ length: 15 }, (_, index) => ({
  id: `bright-${index}`,
  left: `${((index * 27.5 + 16) % 92).toFixed(2)}%`,
  top: `${((index * 31.2 + 12) % 72).toFixed(2)}%`,
  size: index % 3 === 0 ? 3 : 2.2,
  opacity: 0.72 + (index % 4) * 0.07,
  glow: index % 4 === 0,
  twinkleDuration: index < 5 ? TWINKLE_DURATIONS[index] : null,
}));

const POWERED_BY_TOOLS = [
  {
    id: "claude",
    name: "Claude",
    logo: "https://logo.clearbit.com/anthropic.com",
    glow: "#CC785C",
    fallback: "C",
  },
  {
    id: "gpt4",
    name: "GPT-4",
    logo: "https://logo.clearbit.com/openai.com",
    glow: "#10A37F",
    fallback: "G",
  },
  {
    id: "gemini",
    name: "Gemini",
    logo: "https://logo.clearbit.com/deepmind.google",
    glow: "#4285F4",
    fallback: "G",
  },
  {
    id: "banana",
    name: "Nano Banana",
    logo: "https://logo.clearbit.com/nanobanana.ai",
    glow: "#FFAA00",
    fallback: "B",
  },
  {
    id: "elevenlabs",
    name: "11Labs",
    logo: "https://logo.clearbit.com/elevenlabs.io",
    glow: "#9333EA",
    fallback: "1",
  },
] as const;

const DEPARTMENT_CARDS = [
  {
    id: "talent",
    label: "TALENT",
    accent: "hsl(var(--primary))",
    icon: Users,
    lines: ["Scout found", "127 candidates", "overnight"],
    floatDelay: "0s",
  },
  {
    id: "growth",
    label: "GROWTH",
    accent: "#60A5FA",
    icon: TrendingUp,
    lines: ["34% reply rate", "on outreach", "this week"],
    floatDelay: "1.3s",
  },
  {
    id: "intel",
    label: "INTEL",
    accent: "#F59E0B",
    icon: Eye,
    lines: ["Competitor alert", "detected 40min", "ago by Hawk"],
    floatDelay: "2.6s",
  },
] as const;

const PoweredTool = ({
  tool,
}: {
  tool: (typeof POWERED_BY_TOOLS)[number];
}) => {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="hero-logo-group flex flex-col items-center gap-[5px]"
      style={{ ["--hero-logo-glow" as string]: `0 0 6px ${tool.glow}` }}
    >
      {failed ? (
        <div
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] bg-white/8 text-[10px] font-semibold text-white/90"
          aria-label={tool.name}
        >
          {tool.fallback}
        </div>
      ) : (
        <img
          src={tool.logo}
          alt={tool.name}
          loading="lazy"
          className="hero-logo-image h-[22px] w-[22px] rounded-[4px] object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="whitespace-nowrap text-[9px] leading-none text-white/70">{tool.name}</span>
    </div>
  );
};

const HeroHook = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const farStarsRef = useRef<HTMLDivElement>(null);
  const midStarsRef = useRef<HTMLDivElement>(null);
  const closeStarsRef = useRef<HTMLDivElement>(null);
  const mouseHandlerRef = useRef<((event: MouseEvent) => void) | null>(null);
  const leaveHandlerRef = useRef<(() => void) | null>(null);
  const [bootLine, setBootLine] = useState("");
  const [visibleBootDots, setVisibleBootDots] = useState(0);
  const [bootComplete, setBootComplete] = useState(false);

  useEffect(() => {
    const timeouts: number[] = [];
    let index = 0;

    const typeNext = () => {
      if (index >= BOOT_TEXT.length) {
        timeouts.push(
          window.setTimeout(() => {
            BOOT_DOTS.forEach((_, dotIndex) => {
              timeouts.push(
                window.setTimeout(() => {
                  setVisibleBootDots(dotIndex + 1);
                }, dotIndex * 130)
              );
            });

            timeouts.push(
              window.setTimeout(() => {
                setBootComplete(true);
              }, BOOT_DOTS.length * 130 + 340)
            );
          }, 300)
        );

        return;
      }

      index += 1;
      setBootLine(BOOT_TEXT.slice(0, index));

      const nextDelay = BOOT_TEXT[index - 1] === "." ? 90 : 52;
      timeouts.push(window.setTimeout(typeNext, nextDelay));
    };

    timeouts.push(window.setTimeout(typeNext, 220));

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.set(
        [
          ".hero-system-pill",
          ".hero-headline",
          ".hero-green-line",
          ".hero-subheadline",
          ".hero-powered-pill",
          ".hero-primary-cta",
          ".hero-secondary-cta",
          ".hero-trust",
          ".hero-orbit-label",
          ".hero-orbit-shell",
        ],
        { opacity: 0, y: 12 }
      );
      gsap.set(".hero-floating-card", { opacity: 0, y: 16 });
      gsap.set(".hero-logo-group", { opacity: 0, y: 6 });

      if (!bootComplete) return;

      const timeline = gsap.timeline({ defaults: { duration: 0.45, ease: ENTRANCE_EASE } });

      timeline.fromTo(
        ".hero-system-pill",
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0 },
        0
      );
      timeline.fromTo(
        ".hero-headline",
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0 },
        0.12
      );
      timeline.fromTo(
        ".hero-green-line",
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0 },
        0.24
      );
      timeline.fromTo(
        ".hero-subheadline",
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0 },
        0.38
      );
      timeline.to(
        ".hero-floating-card",
        {
          opacity: 1,
          y: 0,
          stagger: 0.15,
          duration: 0.45,
          ease: ENTRANCE_EASE,
        },
        0.52
      );
      timeline.fromTo(
        ".hero-powered-pill",
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0 },
        0.68
      );
      timeline.to(
        ".hero-logo-group",
        {
          opacity: 1,
          y: 0,
          stagger: 0.1,
          duration: 0.35,
          ease: ENTRANCE_EASE,
        },
        0.8
      );
      timeline.fromTo(
        ".hero-primary-cta",
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0 },
        0.88
      );
      timeline.fromTo(
        ".hero-secondary-cta",
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0 },
        0.96
      );
      timeline.fromTo(".hero-trust", { opacity: 0 }, { opacity: 1, y: 0 }, 1.06);
      timeline.fromTo(
        [".hero-orbit-label", ".hero-orbit-shell"],
        { opacity: 0 },
        { opacity: 1, y: 0 },
        1.12
      );
    }, sectionRef);

    return () => ctx.revert();
  }, [bootComplete]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const updateLayerTransforms = (xPercent: number, yPercent: number) => {
      const motionScale = window.innerWidth < 768 ? 0.4 : 1;

      if (farStarsRef.current) {
        farStarsRef.current.style.transform = `translate(${xPercent * 8 * motionScale}px, ${yPercent * 8 * motionScale}px)`;
      }
      if (midStarsRef.current) {
        midStarsRef.current.style.transform = `translate(${xPercent * 16 * motionScale}px, ${yPercent * 16 * motionScale}px)`;
      }
      if (closeStarsRef.current) {
        closeStarsRef.current.style.transform = `translate(${xPercent * 28 * motionScale}px, ${yPercent * 28 * motionScale}px)`;
      }
    };

    mouseHandlerRef.current = (event: MouseEvent) => {
      const xPercent = event.clientX / window.innerWidth - 0.5;
      const yPercent = event.clientY / window.innerHeight - 0.5;
      updateLayerTransforms(xPercent, yPercent);
    };

    leaveHandlerRef.current = () => updateLayerTransforms(0, 0);

    const moveHandler = mouseHandlerRef.current;
    const leaveHandler = leaveHandlerRef.current;

    if (!moveHandler || !leaveHandler) return;

    section.addEventListener("mousemove", moveHandler, { passive: true });
    section.addEventListener("mouseleave", leaveHandler);

    return () => {
      section.removeEventListener("mousemove", moveHandler);
      section.removeEventListener("mouseleave", leaveHandler);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="hero-scanline relative flex min-h-screen items-center justify-center overflow-hidden bg-transparent px-4 pb-24 pt-24 md:px-6"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-top-aura absolute inset-x-[12%] top-[-18%] h-[24rem] md:h-[30rem]" />

        <div ref={farStarsRef} className="hero-star-layer absolute -inset-[6%]">
          {STAR_LAYER_ONE.map((star) => (
            <span
              key={star.id}
              className="absolute rounded-full bg-white"
              style={{
                left: star.left,
                top: star.top,
                width: `${star.size}px`,
                height: `${star.size}px`,
                opacity: star.opacity,
              }}
            />
          ))}
        </div>

        <div ref={midStarsRef} className="hero-star-layer absolute -inset-[8%]">
          {STAR_LAYER_TWO.map((star) => (
            <span
              key={star.id}
              className="absolute rounded-full bg-[rgba(220,255,245,0.95)]"
              style={{
                left: star.left,
                top: star.top,
                width: `${star.size}px`,
                height: `${star.size}px`,
                opacity: star.opacity,
              }}
            />
          ))}
        </div>

        <div ref={closeStarsRef} className="hero-star-layer absolute -inset-[10%]">
          {STAR_LAYER_THREE.map((star) => (
            <span
              key={star.id}
              className={`absolute rounded-full bg-white ${star.twinkleDuration ? "hero-star-twinkle" : ""}`}
              style={{
                left: star.left,
                top: star.top,
                width: `${star.size}px`,
                height: `${star.size}px`,
                opacity: star.opacity,
                boxShadow: star.glow ? "0 0 4px hsl(var(--primary) / 0.5)" : "0 0 3px rgba(255,255,255,0.2)",
                animationDuration: star.twinkleDuration ? `${star.twinkleDuration}s` : undefined,
              }}
            />
          ))}
        </div>

        <div className="hero-floor-radial absolute inset-x-0 bottom-[20%] h-[14rem]" />
        <div className="absolute inset-x-0 bottom-0 h-[38vh] overflow-hidden">
          <div className="hero-floor-horizon absolute inset-x-[20%] top-[14%] h-px" />
          <div className="hero-floor-grid absolute inset-[-12%]" />
        </div>

        <div className="hero-orbit-shell pointer-events-none absolute bottom-[8%] right-[-2%] h-[240px] w-[360px] md:h-[320px] md:w-[520px]">
          <svg
            viewBox="0 0 520 320"
            className="absolute inset-0 h-full w-full"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              id="hero-pilot-orbit-path"
              className="hero-orbit-path"
              d="M515 320C468 284 404 223 330 172C283 140 240 118 192 96"
              stroke="hsl(var(--primary) / 0.75)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {[0, 1, 2].map((delay) => (
              <circle
                key={delay}
                r="3"
                fill="hsl(var(--primary) / 0.9)"
                style={{ filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.8))" }}
              >
                <animateMotion dur="3s" repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#hero-pilot-orbit-path" />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.1;0.9;1"
                  dur="3s"
                  repeatCount="indefinite"
                  begin={`${delay}s`}
                />
              </circle>
            ))}
          </svg>
        </div>

        <div className="hero-orbit-label pointer-events-none absolute bottom-[18%] right-[4%] hidden font-mono text-[9px] uppercase tracking-[0.1em] text-primary/60 md:block">
          PILOT BRAIN ORBIT →
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#030405] transition-opacity duration-500"
        style={{ opacity: bootComplete ? 0 : 1 }}
        aria-hidden={bootComplete}
      >
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="font-mono text-[clamp(0.95rem,1.8vw,1.2rem)] tracking-[0.18em] text-white/84">
            {bootLine}
            <span className="hero-boot-cursor ml-1 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-primary align-middle" />
          </div>
          <div className="flex items-center gap-3">
            {BOOT_DOTS.map((dotIndex) => {
              const active = visibleBootDots > dotIndex;

              return (
                <span
                  key={dotIndex}
                  className={`hero-boot-dot block h-[10px] w-[10px] rounded-full ${active ? "hero-boot-dot-active" : "bg-primary/10"}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        <div className="hero-system-pill mb-5 font-mono text-[10px] uppercase tracking-[0.42em] text-white/46 md:text-[11px]">
          THE AI WORKFORCE PLATFORM
        </div>

        <h1 className="hero-headline max-w-5xl text-[clamp(2.9rem,7.2vw,6.4rem)] font-bold leading-[0.95] tracking-[-0.04em] text-white">
          <span className="block">You are doing the work</span>
          <span className="mt-1 block">of ten people.</span>
        </h1>

        <div className="hero-green-line relative mb-5 mt-3 w-full">
          <div className="hero-primary-line-halo absolute inset-x-[18%] inset-y-0 rounded-full" />
          <span className="hero-primary-glow relative z-10 inline-block px-4 py-2 text-[clamp(3.05rem,8.2vw,8.2rem)] font-black leading-[0.9] tracking-[-0.05em]">
            Now you don&apos;t have to.
          </span>
        </div>

        <p className="hero-subheadline mx-auto mb-6 max-w-[480px] px-4 text-center text-[18px] font-medium leading-[1.6] text-white/60">
          Five departments. Fifteen agents. One company brain. Set up in 10 minutes.
        </p>

        <div className="mb-7 flex flex-wrap justify-center gap-3">
          {DEPARTMENT_CARDS.map((card, index) => {
            const Icon = card.icon;

            return (
              <div
                key={card.id}
                className={`hero-floating-card ${index === 2 ? "hidden min-[480px]:block" : ""}`}
              >
                <div
                  className="hero-floating-card-inner relative w-[148px] rounded-[10px] bg-white/[0.04] px-[14px] py-[12px] text-left backdrop-blur-[20px]"
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 16px 28px rgba(0, 0, 0, 0.24)",
                    animationDelay: card.floatDelay,
                  }}
                >
                  <div
                    className="absolute inset-y-[10px] left-[9px] w-[2px] rounded-full"
                    style={{ background: card.accent }}
                  />
                  <div className="pl-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="h-3 w-3" style={{ color: card.accent }} />
                      <span
                        className="font-mono text-[9px] uppercase tracking-[0.18em]"
                        style={{ color: card.accent }}
                      >
                        {card.label}
                      </span>
                    </div>
                    <div className="space-y-[2px] text-[12px] leading-[1.4] text-white">
                      {card.lines.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className="block h-[6px] w-[6px] rounded-full hero-card-pulse"
                        style={{ background: card.accent, color: card.accent }}
                      />
                      <span
                        className="font-mono text-[9px] uppercase tracking-[0.15em]"
                        style={{ color: card.accent }}
                      >
                        ACTIVE
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hero-powered-pill mb-7 inline-flex flex-wrap items-center justify-center gap-[14px] rounded-[100px] bg-white/[0.05] px-[20px] py-[10px] backdrop-blur-[10px]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-white/45">
            Powered by
          </span>
          {POWERED_BY_TOOLS.map((tool, index) => (
            <div key={tool.id} className="flex items-center gap-[14px]">
              <PoweredTool tool={tool} />
              {index < POWERED_BY_TOOLS.length - 1 ? (
                <span className="block h-[3px] w-[3px] rounded-full bg-primary/80" />
              ) : null}
            </div>
          ))}
        </div>

        <div className="mb-0 flex w-full max-w-[540px] flex-col items-center justify-center gap-3 px-2 sm:flex-row">
          <button
            onClick={() => navigate("/auth")}
            className="hero-primary-cta primary-cta-shimmer h-[52px] w-full rounded-[12px] px-8 text-[16px] font-bold text-black sm:w-auto"
          >
            <span className="relative z-10 flex items-center justify-center">
              Build your AI workforce <ArrowRight className="ml-2 h-4 w-4" />
            </span>
          </button>

          <button
            onClick={() => navigate("/features")}
            className="hero-secondary-cta h-[52px] w-full rounded-[12px] px-7 text-[16px] font-medium sm:w-auto"
          >
            See how it works
          </button>
        </div>

        <div className="hero-trust mt-[14px] flex flex-col items-center justify-center gap-1 text-[12px] tracking-[0.02em] text-white/60 md:flex-row md:gap-2">
          <span>Set up in 10 minutes</span>
          <span className="hidden text-primary md:inline">·</span>
          <span>No credit card</span>
          <span className="hidden text-primary md:inline">·</span>
          <span>Join 50+ countries</span>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;
