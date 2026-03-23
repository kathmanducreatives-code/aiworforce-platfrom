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
  { id: "claude", ring: 1, size: 72, departments: ["talent","growth","content","intelligence"], description: "Writing, analysis, and reasoning engine powering all departments" },
  { id: "gemini", ring: 1, size: 72, departments: ["talent"], description: "AI screening and candidate evaluation with deep analysis" },
  { id: "gpt4", ring: 1, size: 68, departments: ["intelligence"], description: "Specialized AI tasks including competitor analysis" },
  { id: "perplexity", ring: 1, size: 64, departments: ["growth","intelligence"], description: "Real-time web research and market intelligence" },
  { id: "firecrawl", ring: 2, size: 60, departments: ["growth","talent","intelligence"], description: "Web scraping & intelligence gathering at scale" },
  { id: "apify", ring: 2, size: 60, departments: ["growth","talent"], description: "LinkedIn data extraction and profile enrichment" },
  { id: "hunter", ring: 2, size: 56, departments: ["growth"], description: "Email discovery & verification for outreach" },
  { id: "instantly", ring: 2, size: 56, departments: ["growth"], description: "Cold email sequences with smart scheduling" },
  { id: "elevenlabs", ring: 3, size: 52, departments: ["content"], description: "Voice and audio generation for media content" },
  { id: "replicate", ring: 3, size: 52, departments: ["content"], description: "Image and visual generation via AI models" },
  { id: "notion", ring: 3, size: 52, departments: ["intelligence"], description: "Documentation, knowledge base, and team wiki" },
  { id: "linear", ring: 3, size: 52, departments: ["intelligence"], description: "Task and project tracking with automation" },
  { id: "github", ring: 3, size: 52, departments: [], description: "Code management and deployment pipeline" },
  { id: "cal", ring: 3, size: 48, departments: ["talent"], description: "Meeting scheduling with candidate self-booking" },
  { id: "canva", ring: 3, size: 48, departments: ["content"], description: "Design handoff and brand asset creation" },
  { id: "gamma", ring: 3, size: 48, departments: ["content"], description: "Presentation generation for client pitches" },
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

// ─── Detail Panel ───────────────────────────────────────────────────
const ToolDetailPanel = ({ toolId, onClose }: { toolId: string; onClose: () => void }) => {
  const brand = TOOL_BRANDS[toolId];
  const tool = ORBITAL_TOOLS.find(t => t.id === toolId);
  if (!brand || !tool) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.96 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="relative mx-auto max-w-lg mt-6 rounded-2xl border overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(10,14,20,0.95) 0%, rgba(15,20,30,0.95) 100%)",
        borderColor: `${brand.bg}33`,
        boxShadow: `0 0 40px ${brand.bg}15, 0 8px 32px rgba(0,0,0,0.4)`,
      }}
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
            style={{ background: `${brand.bg}15`, border: `1.5px solid ${brand.bg}44` }}>
            <ToolLogoImage toolId={toolId} size={36} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-lg text-white">{brand.label}</span>
              <span className="text-xs text-white/30 font-mono">{brand.sublabel}</span>
            </div>
            <p className="text-sm text-white/50 mt-1 leading-relaxed">{tool.description}</p>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {tool.departments.map(d => (
                <span key={d} className="text-[10px] px-2.5 py-1 rounded-full font-semibold"
                  style={{ background: `${DEPT_COLORS[d]}15`, color: DEPT_COLORS[d], border: `1px solid ${DEPT_COLORS[d]}25` }}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </span>
              ))}
            </div>
            {brand.agents.length > 0 && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-[10px] text-white/25 font-mono uppercase tracking-wider">Used by</span>
                <div className="flex gap-1.5">
                  {brand.agents.map(a => (
                    <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400/80 font-medium border border-emerald-500/15">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white/50 transition-colors text-lg mt-0.5">✕</button>
        </div>
      </div>
    </motion.div>
  );
};

// ─── Main Section ───────────────────────────────────────────────────
const EcosystemSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const orbitalRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [expandedMobileTool, setExpandedMobileTool] = useState<string | null>(null);
  const isMobile = useIsMobile();

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

  const handleToolClick = useCallback((toolId: string) => {
    setSelectedTool(prev => prev === toolId ? null : toolId);
  }, []);

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
        @keyframes data-flow {
          0% { stroke-dashoffset: 24; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes traveling-dot {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
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
            ScreeningPilot connects the world's best AI tools and orchestrates them as a single coordinated team. Click any tool to explore.
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
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelectedTool(null);
              }}
            >
              {/* SVG layer for rings, connection lines, and cross-connections */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 750 750">
                {/* Glow rings */}
                {([1, 2, 3] as const).map(ring => (
                  <g key={`ring-group-${ring}`}>
                    <circle cx={CENTER} cy={CENTER} r={RING_CONFIG[ring].radius}
                      fill="none" stroke="rgba(16,185,129,0.06)" strokeWidth="12" filter="url(#ringGlow)" />
                    <circle cx={CENTER} cy={CENTER} r={RING_CONFIG[ring].radius}
                      fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"
                      strokeDasharray="2 8" />
                  </g>
                ))}
                <defs>
                  <filter id="ringGlow">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>

                {/* Radial connection lines with data flow animation */}
                {ORBITAL_TOOLS.map(tool => {
                  const pos = NODE_POSITIONS[tool.id];
                  const active = isToolActive(tool);
                  const hovered = hoveredTool === tool.id;
                  const selected = selectedTool === tool.id;
                  const isHighlighted = hovered || selected;
                  return (
                    <line key={`line-${tool.id}`}
                      x1={CENTER} y1={CENTER}
                      x2={CENTER + pos.x} y2={CENTER + pos.y}
                      stroke={isHighlighted ? TOOL_BRANDS[tool.id].bg : "rgba(0,255,148,0.12)"}
                      strokeWidth={isHighlighted ? 2 : 1}
                      strokeDasharray={isHighlighted ? "none" : "6 12"}
                      opacity={active ? (hoveredTool && !isHighlighted ? 0.04 : (isHighlighted ? 1 : 0.5)) : 0.02}
                      style={{
                        transition: "all 0.4s ease",
                        animation: isHighlighted ? "data-flow 0.8s linear infinite" : "none",
                      }}
                    />
                  );
                })}

                {/* Cross-connections with traveling dot effect */}
                {crossConnections.map((conn, i) => {
                  const posA = NODE_POSITIONS[conn.from];
                  const posB = NODE_POSITIONS[conn.to];
                  if (!posA || !posB) return null;
                  const lineId = `cross-path-${i}`;
                  return (
                    <g key={`cross-${i}`}>
                      <line
                        x1={CENTER + posA.x} y1={CENTER + posA.y}
                        x2={CENTER + posB.x} y2={CENTER + posB.y}
                        stroke={conn.color}
                        strokeWidth={conn.active ? 2 : 1}
                        strokeDasharray={conn.active ? "none" : "4 6"}
                        opacity={conn.active ? 0.6 : (activeTab === "all" ? 0.12 : 0.02)}
                        style={{ transition: "all 0.4s ease" }}
                      />
                      {conn.active && (
                        <>
                          <path id={lineId} d={`M${CENTER + posA.x},${CENTER + posA.y} L${CENTER + posB.x},${CENTER + posB.y}`} fill="none" />
                          <circle r="3" fill={conn.color} opacity="0.9">
                            <animateMotion dur="2s" repeatCount="indefinite">
                              <mpath href={`#${lineId}`} />
                            </animateMotion>
                          </circle>
                        </>
                      )}
                    </g>
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

              {/* Orbital rings with tools */}
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
                      const selected = selectedTool === tool.id;
                      const isHighlighted = hovered || selected;
                      const dimmed = (hoveredTool !== null && !hovered) || (selectedTool !== null && !selected);
                      const logoSize = Math.max(36, Math.round(tool.size * 0.55));

                      return (
                        <motion.div
                          key={tool.id}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={inView ? {
                            scale: active ? (isHighlighted ? 1.2 : 1) : 0.6,
                            opacity: dimmed ? 0.15 : (active ? 1 : 0.1),
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
                          onClick={() => handleToolClick(tool.id)}
                        >
                          <div className="rounded-full flex items-center justify-center transition-all duration-300 overflow-hidden relative"
                            style={{
                              width: tool.size, height: tool.size,
                              background: "rgba(10,14,20,0.85)",
                              boxShadow: isHighlighted
                                ? `0 0 28px ${brand.bg}88, 0 0 56px ${brand.bg}44, inset 0 0 20px ${brand.bg}11`
                                : `0 0 8px ${brand.bg}22`,
                              border: `2px solid ${isHighlighted ? brand.bg : (selected ? `${brand.bg}88` : "rgba(255,255,255,0.12)")}`,
                            }}>
                            <ToolLogoImage toolId={tool.id} size={logoSize} />
                            {/* Selected ring indicator */}
                            {selected && (
                              <div className="absolute inset-[-4px] rounded-full border-2 animate-pulse pointer-events-none"
                                style={{ borderColor: `${brand.bg}88` }} />
                            )}
                          </div>
                          <span className="text-[9px] text-white/50 mt-1 font-medium whitespace-nowrap text-center">{brand.label}</span>

                          {/* Tooltip on hover (not when selected — detail panel shows instead) */}
                          <AnimatePresence>
                            {hovered && !selected && (
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
                                <p className="text-[10px] text-emerald-400/40 mt-2 italic">Click to explore →</p>
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

        {/* Selected tool detail panel — Desktop */}
        {!isMobile && (
          <AnimatePresence>
            {selectedTool && (
              <ToolDetailPanel toolId={selectedTool} onClose={() => setSelectedTool(null)} />
            )}
          </AnimatePresence>
        )}

        {/* Mobile — 4-column grid with tap-to-expand */}
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
              {ORBITAL_TOOLS.map((tool, idx) => {
                const brand = TOOL_BRANDS[tool.id];
                const active = isToolActive(tool);
                const isExpanded = expandedMobileTool === tool.id;
                return (
                  <motion.div key={tool.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: active ? 1 : 0.3, scale: 1 }}
                    viewport={{ once: true, amount: 0.1 }}
                    transition={{ duration: 0.4, delay: idx * 0.04 }}
                    className={`flex flex-col items-center gap-1 cursor-pointer ${isExpanded ? "col-span-2 row-span-2" : ""}`}
                    onClick={() => setExpandedMobileTool(prev => prev === tool.id ? null : tool.id)}
                    style={{
                      background: isExpanded ? "rgba(10,14,20,0.9)" : "transparent",
                      borderRadius: isExpanded ? 16 : 0,
                      border: isExpanded ? `1px solid ${brand.bg}33` : "none",
                      padding: isExpanded ? 12 : 0,
                      backgroundImage: !isExpanded ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.02) 50%, transparent 100%)" : "none",
                      backgroundSize: "200% 100%",
                    }}
                  >
                    <div className={`rounded-full flex items-center justify-center overflow-hidden transition-all duration-300 ${isExpanded ? "w-14 h-14" : "w-12 h-12"}`}
                      style={{
                        background: "rgba(10,14,20,0.8)",
                        border: `1.5px solid ${isExpanded ? brand.bg : `${brand.bg}44`}`,
                        boxShadow: isExpanded ? `0 0 20px ${brand.bg}33` : "none",
                      }}>
                      <ToolLogoImage toolId={tool.id} size={isExpanded ? 32 : 28} />
                    </div>
                    <span className={`font-medium text-center leading-tight ${isExpanded ? "text-xs text-white/70" : "text-[9px] text-white/50"}`}>{brand.label}</span>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="w-full"
                        >
                          <p className="text-[10px] text-white/40 mt-1 text-center">{tool.description}</p>
                          <div className="flex gap-1 mt-2 flex-wrap justify-center">
                            {tool.departments.map(d => (
                              <span key={d} className="text-[8px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: `${DEPT_COLORS[d]}15`, color: DEPT_COLORS[d] }}>
                                {d.charAt(0).toUpperCase() + d.slice(1)}
                              </span>
                            ))}
                          </div>
                          {brand.agents.length > 0 && (
                            <div className="flex gap-1 mt-1.5 justify-center">
                              {brand.agents.map(a => (
                                <span key={a} className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400/70 font-medium">{a}</span>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 justify-center mt-8 mb-2 overflow-x-auto pb-2 no-scrollbar">
          {TABS.map(tab => (
            <button key={tab} onClick={() => { setActiveTab(tab); setSelectedTool(null); }}
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

// ─── Energy Pulses ──────────────────────────────────────────────────
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
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {pulses.map(p => {
        const brand = TOOL_BRANDS[p.toolId];
        return (
          <div key={p.id} className="absolute rounded-full z-30 pointer-events-none"
            style={{
              left: p.x - 1, top: p.y - 1,
              width: 6, height: 6,
              backgroundColor: brand.bg,
              boxShadow: `0 0 12px ${brand.bg}, 0 0 4px ${brand.bg}`,
              animation: "pulse-to-center 1.2s ease-in forwards",
              ["--tx" as string]: `${CENTER - p.x}px`,
              ["--ty" as string]: `${CENTER - p.y}px`,
            }}>
            {/* Trail element */}
            <div className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                backgroundColor: brand.bg,
                opacity: 0.4,
                animation: "pulse-to-center 1.2s ease-in 0.1s forwards",
                ["--tx" as string]: `${CENTER - p.x}px`,
                ["--ty" as string]: `${CENTER - p.y}px`,
              }} />
          </div>
        );
      })}
    </>
  );
};

export default EcosystemSection;
