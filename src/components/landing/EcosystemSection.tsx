import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TOOL_BRANDS, TOOL_LOGO_MAP } from "./ToolLogos";

interface OrbitalTool {
  id: string;
  ring: 1 | 2 | 3;
  size: number;
  departments: string[];
  description: string;
}

const ORBITAL_TOOLS: OrbitalTool[] = [
  // Ring 1 — Core Brain (innermost)
  { id: "claude",     ring: 1, size: 72, departments: ["talent","growth","content","intelligence"], description: "Writing, analysis, and reasoning engine" },
  { id: "gemini",     ring: 1, size: 72, departments: ["talent"],                                   description: "AI screening and evaluation" },
  { id: "gpt4",       ring: 1, size: 68, departments: ["intelligence"],                              description: "Specialized AI tasks" },
  { id: "perplexity", ring: 1, size: 64, departments: ["growth","intelligence"],                     description: "Real-time web research" },
  // Ring 2 — Data & Scraping
  { id: "firecrawl",  ring: 2, size: 60, departments: ["growth","talent","intelligence"],            description: "Web scraping & intelligence" },
  { id: "apify",      ring: 2, size: 60, departments: ["growth","talent"],                           description: "LinkedIn data extraction" },
  { id: "hunter",     ring: 2, size: 56, departments: ["growth"],                                    description: "Email discovery & verification" },
  { id: "instantly",  ring: 2, size: 56, departments: ["growth"],                                    description: "Cold email sequences" },
  // Ring 3 — Action Tools (outermost)
  { id: "elevenlabs", ring: 3, size: 52, departments: ["content"],                                   description: "Voice and audio generation" },
  { id: "replicate",  ring: 3, size: 52, departments: ["content"],                                   description: "Image and visual generation" },
  { id: "notion",     ring: 3, size: 52, departments: ["intelligence"],                              description: "Documentation and knowledge" },
  { id: "linear",     ring: 3, size: 52, departments: ["intelligence"],                              description: "Task and project tracking" },
  { id: "github",     ring: 3, size: 52, departments: [],                                            description: "Code management" },
  { id: "cal",        ring: 3, size: 48, departments: ["talent"],                                    description: "Meeting scheduling" },
  { id: "canva",      ring: 3, size: 48, departments: ["content"],                                   description: "Design handoff" },
  { id: "gamma",      ring: 3, size: 48, departments: ["content"],                                   description: "Presentation generation" },
];

const TABS = ["all", "talent", "growth", "content", "intelligence"] as const;
const TAB_LABELS: Record<string, string> = { all: "All Tools", talent: "Talent", growth: "Growth", content: "Content", intelligence: "Intelligence" };
const DEPT_COLORS: Record<string, string> = { talent: "#34d399", growth: "#60a5fa", content: "#a78bfa", intelligence: "#fbbf24" };

const RING_RADII = { 1: 140, 2: 220, 3: 310 };
const RING_DURATIONS = { 1: 120, 2: 90, 3: 150 };
const RING_DIRECTIONS = { 1: "normal", 2: "reverse", 3: "normal" };

function useCountUp(target: number, duration = 1200, start = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setVal(Math.round(target * p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [start, target, duration]);
  return val;
}

const EcosystemSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.1, rootMargin: "-50px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const isToolActive = useCallback((tool: OrbitalTool) => {
    if (activeTab === "all") return true;
    return tool.departments.includes(activeTab);
  }, [activeTab]);

  const stat1 = useCountUp(16, 1200, inView);

  return (
    <section ref={sectionRef} id="ecosystem" className="relative z-10 py-24 md:py-32">
      <style>{`
        @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes breathe { 0%,100% { box-shadow: 0 0 40px rgba(0,255,148,0.2), 0 0 80px rgba(0,255,148,0.08); } 50% { box-shadow: 0 0 60px rgba(0,255,148,0.4), 0 0 120px rgba(0,255,148,0.15); } }
      `}</style>

      <div className="max-w-[1100px] mx-auto px-6">
        {/* Headline */}
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">THE ECOSYSTEM</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            Every AI tool your business needs.<br />All plugged into one brain.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            ScreeningPilot connects the world's best AI tools and orchestrates them as a single coordinated team. Each tool knows what the others are doing. No switching. No re-explaining. No data lost between tabs.
          </p>
        </div>

        {/* Orbital System — Desktop */}
        <div className="hidden md:flex justify-center items-center mb-8">
          <div className="relative" style={{ width: 700, height: 700 }}>
            {/* Orbital ring lines */}
            {([1, 2, 3] as const).map(ring => (
              <div key={ring} className="absolute rounded-full border border-white/[0.04]"
                style={{
                  width: RING_RADII[ring] * 2,
                  height: RING_RADII[ring] * 2,
                  top: 350 - RING_RADII[ring],
                  left: 350 - RING_RADII[ring],
                }} />
            ))}

            {/* Center Pilot Brain */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={inView ? { scale: 1, opacity: 1 } : {}}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="absolute z-20 flex flex-col items-center justify-center"
              style={{ left: 350 - 50, top: 350 - 50, width: 100, height: 100 }}
            >
              <div
                className="w-[100px] h-[100px] rounded-full flex items-center justify-center border-2 border-emerald-400/60"
                style={{
                  background: "radial-gradient(circle, #0D2818 0%, #051208 100%)",
                  animation: "breathe 3s ease-in-out infinite",
                }}
              >
                <span className="font-display font-black text-base text-emerald-400 tracking-tight">Pilot</span>
              </div>
              <span className="text-[10px] text-emerald-400/60 mt-1 font-mono">BRAIN</span>
            </motion.div>

            {/* Orbital rings with tools */}
            {([1, 2, 3] as const).map(ring => {
              const ringTools = ORBITAL_TOOLS.filter(t => t.ring === ring);
              const radius = RING_RADII[ring];
              const dur = RING_DURATIONS[ring];
              const dir = RING_DIRECTIONS[ring];

              return (
                <div key={ring} className="absolute z-10"
                  style={{
                    width: radius * 2,
                    height: radius * 2,
                    top: 350 - radius,
                    left: 350 - radius,
                    animation: `orbit ${dur}s linear infinite ${dir}`,
                    willChange: "transform",
                  }}>
                  {ringTools.map((tool, i) => {
                    const angle = (i * 2 * Math.PI) / ringTools.length - Math.PI / 2;
                    const x = radius + radius * Math.cos(angle);
                    const y = radius + radius * Math.sin(angle);
                    const brand = TOOL_BRANDS[tool.id];
                    const Logo = TOOL_LOGO_MAP[tool.id];
                    const active = isToolActive(tool);
                    const hovered = hoveredTool === tool.id;
                    const dimmed = hoveredTool !== null && !hovered;

                    return (
                      <motion.div
                        key={tool.id}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={inView ? {
                          scale: active ? 1 : 0.85,
                          opacity: dimmed ? 0.2 : (active ? 1 : 0.15),
                        } : {}}
                        transition={{
                          duration: 0.5,
                          delay: ring * 0.3 + i * 0.08,
                          ease: "easeOut",
                        }}
                        className="absolute flex flex-col items-center cursor-pointer"
                        style={{
                          left: x - tool.size / 2,
                          top: y - tool.size / 2,
                          width: tool.size,
                          height: tool.size + 20,
                          // Counter-rotate to keep upright
                          animation: `orbit ${dur}s linear infinite ${dir === "normal" ? "reverse" : "normal"}`,
                          willChange: "transform",
                        }}
                        onMouseEnter={() => setHoveredTool(tool.id)}
                        onMouseLeave={() => setHoveredTool(null)}
                      >
                        <div
                          className="rounded-full flex items-center justify-center transition-all duration-300"
                          style={{
                            width: tool.size,
                            height: tool.size,
                            background: brand.bg.startsWith("linear") ? brand.bg : undefined,
                            backgroundColor: !brand.bg.startsWith("linear") ? brand.bg : undefined,
                            transform: hovered ? "scale(1.15)" : "scale(1)",
                            boxShadow: hovered
                              ? `0 0 20px ${brand.bg}66, 0 0 40px ${brand.bg}33`
                              : `0 0 8px ${brand.bg}22`,
                            border: `2px solid ${hovered ? brand.bg : "rgba(255,255,255,0.1)"}`,
                          }}
                        >
                          {Logo && <Logo width={tool.size * 0.5} height={tool.size * 0.5} />}
                        </div>
                        <span className="text-[9px] text-white/50 mt-1 font-medium whitespace-nowrap text-center">
                          {brand.label}
                        </span>

                        {/* Tooltip */}
                        <AnimatePresence>
                          {hovered && (
                            <motion.div
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 4 }}
                              transition={{ duration: 0.15 }}
                              className="absolute z-50 px-4 py-3 rounded-xl border shadow-2xl min-w-[200px]"
                              style={{
                                bottom: tool.size + 28,
                                left: "50%",
                                transform: "translateX(-50%)",
                                background: "#0d1117",
                                borderColor: "rgba(255,255,255,0.08)",
                              }}
                            >
                              <div className="text-sm font-bold text-white">{brand.label}</div>
                              <div className="text-xs text-white/40 mt-0.5">{tool.description}</div>
                              <div className="text-xs text-white/30 mt-1">{brand.sublabel}</div>
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {tool.departments.map(d => (
                                  <span key={d} className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                                    style={{ background: `${DEPT_COLORS[d]}20`, color: DEPT_COLORS[d] }}>
                                    {d.charAt(0).toUpperCase() + d.slice(1)}
                                  </span>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              );
            })}

            {/* Energy Pulses */}
            {inView && <EnergyPulses />}
          </div>
        </div>

        {/* Mobile — 4-column grid */}
        <div className="md:hidden mb-8">
          {/* Pilot Brain card */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-emerald-400/60"
              style={{ background: "radial-gradient(circle, #0D2818 0%, #051208 100%)", boxShadow: "0 0 30px rgba(0,255,148,0.3)" }}>
              <span className="font-display font-black text-sm text-emerald-400">Pilot</span>
            </div>
            <span className="text-xs text-emerald-400/60 mt-1 font-mono">BRAIN</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {ORBITAL_TOOLS.map(tool => {
              const brand = TOOL_BRANDS[tool.id];
              const Logo = TOOL_LOGO_MAP[tool.id];
              const active = isToolActive(tool);
              return (
                <motion.div key={tool.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={inView ? { opacity: active ? 1 : 0.3, scale: 1 } : {}}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: brand.bg, border: "1px solid rgba(255,255,255,0.1)" }}>
                    {Logo && <Logo width={20} height={20} />}
                  </div>
                  <span className="text-[9px] text-white/50 font-medium text-center leading-tight">{brand.label}</span>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 justify-center mt-8 mb-2 overflow-x-auto pb-2">
          {TABS.map(tab => (
            <button key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 whitespace-nowrap ${
                activeTab === tab
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-white/[0.03] text-white/30 border border-white/[0.06] hover:text-white/50"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        {activeTab !== "all" && (
          <p className="text-center text-xs text-white/30 mb-4">
            {ORBITAL_TOOLS.filter(t => t.departments.includes(activeTab)).length} tools powering this department
          </p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 mb-16">
          {[
            { num: `${stat1}+`, label: "AI tools connected", sub: "And growing every month" },
            { num: "1", label: "Company Brain", sub: "Shared across every tool" },
            { num: "0", label: "Tabs to switch between", sub: "Everything runs from ScreeningPilot" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="font-display font-black text-4xl text-white tabular-nums">{s.num}</div>
              <div className="text-sm text-white/60 font-semibold mt-1">{s.label}</div>
              <div className="text-xs text-white/30 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Closing */}
        <p className="text-center font-display font-bold text-xl md:text-2xl text-white/80 max-w-[560px] mx-auto leading-relaxed">
          You bring the vision.<br />ScreeningPilot brings the team.<br />Together you build something unstoppable.
        </p>
      </div>
    </section>
  );
};

// Energy pulse component — random colored dots traveling to center
const EnergyPulses = () => {
  const [pulses, setPulses] = useState<Array<{ id: number; toolId: string; x: number; y: number }>>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const tool = ORBITAL_TOOLS[Math.floor(Math.random() * ORBITAL_TOOLS.length)];
      const ring = tool.ring;
      const radius = RING_RADII[ring];
      const ringTools = ORBITAL_TOOLS.filter(t => t.ring === ring);
      const idx = ringTools.indexOf(tool);
      const angle = (idx * 2 * Math.PI) / ringTools.length - Math.PI / 2;
      const x = 350 + radius * Math.cos(angle);
      const y = 350 + radius * Math.sin(angle);

      const id = nextId.current++;
      setPulses(prev => {
        const next = [...prev, { id, toolId: tool.id, x, y }];
        return next.slice(-6); // max 6 concurrent
      });

      // Remove after animation
      setTimeout(() => {
        setPulses(prev => prev.filter(p => p.id !== id));
      }, 1200);
    }, 600);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {pulses.map(p => {
        const brand = TOOL_BRANDS[p.toolId];
        return (
          <div
            key={p.id}
            className="absolute w-2 h-2 rounded-full z-30 pointer-events-none"
            style={{
              left: p.x,
              top: p.y,
              backgroundColor: brand.bg,
              boxShadow: `0 0 8px ${brand.bg}`,
              animation: "pulse-to-center 1.2s ease-in forwards",
              // CSS custom properties for the animation target
              ["--target-x" as string]: `${350 - p.x}px`,
              ["--target-y" as string]: `${350 - p.y}px`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes pulse-to-center {
          0% { transform: translate(0,0); opacity: 1; }
          100% { transform: translate(var(--target-x), var(--target-y)); opacity: 0; }
        }
      `}</style>
    </>
  );
};

export default EcosystemSection;
