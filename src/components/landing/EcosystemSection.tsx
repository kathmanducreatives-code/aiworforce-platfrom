import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { TOOL_BRANDS, ToolLogoImage } from "./ToolLogos";
import { useIsMobile } from "@/hooks/use-mobile";

interface OrbitalTool {
  id: string;
  ring: 1 | 2 | 3;
  size: number;
  departments: string[];
  description: string;
}

const ORBITAL_TOOLS: OrbitalTool[] = [
  { id: "claude", ring: 1, size: 72, departments: ["talent","growth","content","intelligence"], description: "Writing, analysis, and reasoning engine" },
  { id: "gemini", ring: 1, size: 72, departments: ["talent"], description: "AI screening and evaluation" },
  { id: "gpt4", ring: 1, size: 68, departments: ["intelligence"], description: "Specialized AI tasks" },
  { id: "perplexity", ring: 1, size: 64, departments: ["growth","intelligence"], description: "Real-time web research" },
  { id: "firecrawl", ring: 2, size: 60, departments: ["growth","talent","intelligence"], description: "Web scraping & intelligence" },
  { id: "apify", ring: 2, size: 60, departments: ["growth","talent"], description: "LinkedIn data extraction" },
  { id: "hunter", ring: 2, size: 56, departments: ["growth"], description: "Email discovery & verification" },
  { id: "instantly", ring: 2, size: 56, departments: ["growth"], description: "Cold email sequences" },
  { id: "elevenlabs", ring: 3, size: 52, departments: ["content"], description: "Voice and audio generation" },
  { id: "replicate", ring: 3, size: 52, departments: ["content"], description: "Image and visual generation" },
  { id: "notion", ring: 3, size: 52, departments: ["intelligence"], description: "Documentation and knowledge" },
  { id: "linear", ring: 3, size: 52, departments: ["intelligence"], description: "Task and project tracking" },
  { id: "github", ring: 3, size: 52, departments: [], description: "Code management" },
  { id: "cal", ring: 3, size: 48, departments: ["talent"], description: "Meeting scheduling" },
  { id: "canva", ring: 3, size: 48, departments: ["content"], description: "Design handoff" },
  { id: "gamma", ring: 3, size: 48, departments: ["content"], description: "Presentation generation" },
];

const TABS = ["all", "talent", "growth", "content", "intelligence"] as const;
const TAB_LABELS: Record<string, string> = { all: "All Tools", talent: "Talent", growth: "Growth", content: "Content", intelligence: "Intelligence" };
const DEPT_COLORS: Record<string, string> = { talent: "#34d399", growth: "#60a5fa", content: "#a78bfa", intelligence: "#fbbf24" };

const RING_CONFIG = {
  1: { radius: 160, duration: 120, direction: "normal" as const, offsetAngle: -Math.PI / 4 },
  2: { radius: 250, duration: 90, direction: "reverse" as const, offsetAngle: 0 },
  3: { radius: 350, duration: 150, direction: "normal" as const, offsetAngle: Math.PI / 8 },
};

const DEPT_CONNECTIONS: Record<string, [string, string][]> = {
  talent: [["claude","gemini"],["apify","firecrawl"],["gemini","apify"]],
  growth: [["claude","instantly"],["firecrawl","claude"],["hunter","instantly"]],
  intelligence: [["firecrawl","perplexity"],["perplexity","gpt4"]],
  content: [["claude","replicate"],["claude","elevenlabs"]],
};

const getNodePosition = (index: number, total: number, radius: number, offsetAngle: number = 0) => {
  const angle = (index / total) * 2 * Math.PI + offsetAngle;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle };
};

const NODE_POSITIONS: Record<string, { x: number; y: number }> = {};
([1, 2, 3] as const).forEach(ring => {
  const tools = ORBITAL_TOOLS.filter(t => t.ring === ring);
  const cfg = RING_CONFIG[ring];
  tools.forEach((tool, i) => {
    const pos = getNodePosition(i, tools.length, cfg.radius, cfg.offsetAngle);
    NODE_POSITIONS[tool.id] = pos;
  });
});

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

const CENTER = 375;

const EcosystemSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const orbitalRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // Scroll-driven parallax for the orbital system
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const orbitalRotate = useTransform(scrollYProgress, [0, 1], [0, 30]);
  const orbitalScale = useTransform(scrollYProgress, [0, 0.3, 0.5, 0.8, 1], [0.85, 1, 1.02, 1, 0.95]);
  const orbitalY = useTransform(scrollYProgress, [0, 0.3, 1], [60, 0, -40]);

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

  const crossConnections = useMemo(() => {
    const lines: { from: string; to: string; color: string; active: boolean }[] = [];
    Object.entries(DEPT_CONNECTIONS).forEach(([dept, pairs]) => {
      pairs.forEach(([a, b]) => {
        const posA = NODE_POSITIONS[a];
        const posB = NODE_POSITIONS[b];
        if (posA && posB) {
          lines.push({ from: a, to: b, color: DEPT_COLORS[dept], active: activeTab === dept });
        }
      });
    });
    return lines;
  }, [activeTab]);

  return (
    <section ref={sectionRef} id="ecosystem" className="relative z-10 py-24 md:py-32" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <style>{`
        @keyframes orbit1 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbit2 { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes breathe { 0%,100% { box-shadow: 0 0 40px rgba(0,255,148,0.2), 0 0 80px rgba(0,255,148,0.08); } 50% { box-shadow: 0 0 60px rgba(0,255,148,0.4), 0 0 120px rgba(0,255,148,0.15); } }
        @keyframes pulse-to-center {
          0% { transform: translate(0,0); opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)); opacity: 0; }
        }
      `}</style>

      <div className="max-w-[1100px] mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">THE ECOSYSTEM</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            Every AI tool your business needs.<br />All plugged into one brain.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            ScreeningPilot connects the world's best AI tools and orchestrates them as a single coordinated team. Each tool knows what the others are doing. No switching. No re-explaining. No data lost between tabs.
          </p>
        </motion.div>

        {/* Orbital System — Desktop with scroll parallax */}
        {!isMobile && (
          <div className="hidden md:flex justify-center items-center mb-8">
            <motion.div
              ref={orbitalRef}
              className="relative"
              style={{
                width: 750, height: 750,
                rotateX: orbitalRotate,
                scale: orbitalScale,
                y: orbitalY,
                perspective: 1200,
              }}
            >
              {/* SVG layer for rings, connection lines, and cross-connections */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 750 750">
                {([1, 2, 3] as const).map(ring => (
                  <circle key={ring} cx={CENTER} cy={CENTER} r={RING_CONFIG[ring].radius}
                    fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                ))}
                {ORBITAL_TOOLS.map(tool => {
                  const pos = NODE_POSITIONS[tool.id];
                  const active = isToolActive(tool);
                  const hovered = hoveredTool === tool.id;
                  return (
                    <line key={`line-${tool.id}`}
                      x1={CENTER} y1={CENTER}
                      x2={CENTER + pos.x} y2={CENTER + pos.y}
                      stroke={hovered ? TOOL_BRANDS[tool.id].bg : "rgba(0,255,148,0.12)"}
                      strokeWidth={hovered ? 2 : 1}
                      opacity={active ? (hoveredTool && !hovered ? 0.05 : 1) : 0.03}
                      style={{ transition: "all 0.4s ease" }}
                    />
                  );
                })}
                {crossConnections.map((conn, i) => {
                  const posA = NODE_POSITIONS[conn.from];
                  const posB = NODE_POSITIONS[conn.to];
                  if (!posA || !posB) return null;
                  return (
                    <line key={`cross-${i}`}
                      x1={CENTER + posA.x} y1={CENTER + posA.y}
                      x2={CENTER + posB.x} y2={CENTER + posB.y}
                      stroke={conn.color}
                      strokeWidth={conn.active ? 2 : 1}
                      strokeDasharray={conn.active ? "none" : "4 6"}
                      opacity={conn.active ? 0.6 : (activeTab === "all" ? 0.15 : 0.03)}
                      style={{ transition: "all 0.4s ease" }}
                    />
                  );
                })}
              </svg>

              {/* Center Pilot Brain */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={inView ? { scale: 1, opacity: 1 } : {}}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute z-20 flex flex-col items-center justify-center"
                style={{ left: CENTER - 50, top: CENTER - 50, width: 100, height: 100 }}
              >
                <div className="w-[100px] h-[100px] rounded-full flex items-center justify-center border-2 border-emerald-400/60"
                  style={{ background: "radial-gradient(circle, #0D2818 0%, #051208 100%)", animation: "breathe 3s ease-in-out infinite" }}>
                  <span className="font-display font-black text-base text-emerald-400 tracking-tight">Pilot</span>
                </div>
                <span className="text-[10px] text-emerald-400/60 mt-1 font-mono">BRAIN</span>
              </motion.div>

              {/* Orbital rings with tools — real logos */}
              {([1, 2, 3] as const).map(ring => {
                const ringTools = ORBITAL_TOOLS.filter(t => t.ring === ring);
                const cfg = RING_CONFIG[ring];
                const animName = cfg.direction === "normal" ? "orbit1" : "orbit2";
                const counterAnim = cfg.direction === "normal" ? "orbit2" : "orbit1";

                return (
                  <div key={ring} className="absolute z-10"
                    style={{
                      width: cfg.radius * 2, height: cfg.radius * 2,
                      top: CENTER - cfg.radius, left: CENTER - cfg.radius,
                      animation: `${animName} ${cfg.duration}s linear infinite`,
                      willChange: "transform",
                    }}>
                    {ringTools.map((tool, i) => {
                      const pos = getNodePosition(i, ringTools.length, cfg.radius, cfg.offsetAngle);
                      const brand = TOOL_BRANDS[tool.id];
                      const active = isToolActive(tool);
                      const hovered = hoveredTool === tool.id;
                      const dimmed = hoveredTool !== null && !hovered;
                      const logoSize = Math.round(tool.size * 0.55);

                      return (
                        <motion.div
                          key={tool.id}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={inView ? {
                            scale: active ? (hovered ? 1.15 : 1) : 0.85,
                            opacity: dimmed ? 0.2 : (active ? 1 : 0.15),
                          } : {}}
                          transition={{ duration: 0.5, delay: ring * 0.3 + i * 0.08, ease: "easeOut" }}
                          className="absolute flex flex-col items-center cursor-pointer"
                          style={{
                            left: cfg.radius + pos.x - tool.size / 2,
                            top: cfg.radius + pos.y - tool.size / 2,
                            width: tool.size, height: tool.size + 22,
                            animation: `${counterAnim} ${cfg.duration}s linear infinite`,
                            willChange: "transform",
                          }}
                          onMouseEnter={() => setHoveredTool(tool.id)}
                          onMouseLeave={() => setHoveredTool(null)}
                        >
                          <div className="rounded-full flex items-center justify-center transition-all duration-300 overflow-hidden"
                            style={{
                              width: tool.size, height: tool.size,
                              background: "rgba(10,14,20,0.8)",
                              boxShadow: hovered ? `0 0 24px ${brand.bg}88, 0 0 48px ${brand.bg}44` : `0 0 8px ${brand.bg}22`,
                              border: `2px solid ${hovered ? brand.bg : "rgba(255,255,255,0.12)"}`,
                            }}>
                            <ToolLogoImage toolId={tool.id} size={logoSize} />
                          </div>
                          <span className="text-[9px] text-white/50 mt-1 font-medium whitespace-nowrap text-center">{brand.label}</span>

                          {/* Tooltip */}
                          <AnimatePresence>
                            {hovered && (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                                transition={{ duration: 0.15 }}
                                className="absolute z-50 px-4 py-3 rounded-xl border shadow-2xl min-w-[200px]"
                                style={{ bottom: tool.size + 28, left: "50%", transform: "translateX(-50%)", background: "#0d1117", borderColor: "rgba(255,255,255,0.08)" }}>
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
            </motion.div>
          </div>
        )}

        {/* Mobile — 4-column grid with real logos */}
        {isMobile && (
          <div className="md:hidden mb-8">
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
                const active = isToolActive(tool);
                return (
                  <motion.div key={tool.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: active ? 1 : 0.3, scale: 1 }}
                    viewport={{ once: true, amount: 0.1 }}
                    transition={{ duration: 0.4 }}
                    className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden"
                      style={{ background: "rgba(10,14,20,0.8)", border: `1.5px solid ${brand.bg}44` }}>
                      <ToolLogoImage toolId={tool.id} size={28} />
                    </div>
                    <span className="text-[9px] text-white/50 font-medium text-center leading-tight">{brand.label}</span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 justify-center mt-8 mb-2 overflow-x-auto pb-2 no-scrollbar">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 whitespace-nowrap ${
                activeTab === tab
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-white/[0.03] text-white/30 border border-white/[0.06] hover:text-white/50"
              }`}>
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
            <motion.div key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ duration: 0.5 }}
              className="text-center">
              <div className="font-display font-black text-4xl text-white tabular-nums">{s.num}</div>
              <div className="text-sm text-white/60 font-semibold mt-1">{s.label}</div>
              <div className="text-xs text-white/30 mt-0.5">{s.sub}</div>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.5 }}
          className="text-center font-display font-bold text-xl md:text-2xl text-white/80 max-w-[560px] mx-auto leading-relaxed">
          You bring the vision.<br />ScreeningPilot brings the team.<br />Together you build something unstoppable.
        </motion.p>
      </div>
    </section>
  );
};

// Energy pulse component
const EnergyPulses = () => {
  const [pulses, setPulses] = useState<Array<{ id: number; toolId: string; x: number; y: number }>>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const tool = ORBITAL_TOOLS[Math.floor(Math.random() * ORBITAL_TOOLS.length)];
      const pos = NODE_POSITIONS[tool.id];
      if (!pos) return;
      const x = CENTER + pos.x;
      const y = CENTER + pos.y;
      const id = nextId.current++;
      setPulses(prev => [...prev, { id, toolId: tool.id, x, y }].slice(-6));
      setTimeout(() => setPulses(prev => prev.filter(p => p.id !== id)), 1200);
    }, 600);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {pulses.map(p => {
        const brand = TOOL_BRANDS[p.toolId];
        return (
          <div key={p.id} className="absolute w-2 h-2 rounded-full z-30 pointer-events-none"
            style={{
              left: p.x, top: p.y,
              backgroundColor: brand.bg,
              boxShadow: `0 0 8px ${brand.bg}`,
              animation: "pulse-to-center 1.2s ease-in forwards",
              ["--tx" as string]: `${CENTER - p.x}px`,
              ["--ty" as string]: `${CENTER - p.y}px`,
            }} />
        );
      })}
    </>
  );
};

export default EcosystemSection;
