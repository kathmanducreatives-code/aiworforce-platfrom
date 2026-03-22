import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClaudeLogo, GeminiLogo, FirecrawlLogo, ApifyLogo,
  InstantlyLogo, PerplexityLogo, ElevenLabsLogo, ReplicateLogo,
  GPT4Logo, NotionLogo, LinearLogo, GitHubLogo,
  HunterLogo, CalLogo, CanvaLogo, GammaLogo,
} from "./ToolLogos";

interface ToolNode {
  id: string;
  name: string;
  Logo: React.FC<{ className?: string; width?: number; height?: number }>;
  ring: "inner" | "outer";
  description: string;
  status: "Connected" | "Partner";
  rooms: string[];
}

const TOOLS: ToolNode[] = [
  { id: "claude", name: "Claude", Logo: ClaudeLogo, ring: "inner", description: "Writing, analysis, and reasoning", status: "Connected", rooms: ["growth", "recruiting", "creative", "strategy"] },
  { id: "gemini", name: "Gemini", Logo: GeminiLogo, ring: "inner", description: "AI screening and evaluation", status: "Connected", rooms: ["recruiting"] },
  { id: "firecrawl", name: "Firecrawl", Logo: FirecrawlLogo, ring: "inner", description: "Web scraping and intelligence", status: "Connected", rooms: ["growth", "recruiting", "strategy"] },
  { id: "apify", name: "Apify", Logo: ApifyLogo, ring: "inner", description: "LinkedIn data extraction", status: "Connected", rooms: ["growth", "recruiting"] },
  { id: "instantly", name: "Instantly", Logo: InstantlyLogo, ring: "inner", description: "Cold email sequences", status: "Connected", rooms: ["growth"] },
  { id: "perplexity", name: "Perplexity", Logo: PerplexityLogo, ring: "inner", description: "Real-time research", status: "Connected", rooms: ["growth", "strategy"] },
  { id: "elevenlabs", name: "ElevenLabs", Logo: ElevenLabsLogo, ring: "inner", description: "Voice and audio generation", status: "Connected", rooms: ["creative"] },
  { id: "replicate", name: "Replicate", Logo: ReplicateLogo, ring: "inner", description: "Image and visual generation", status: "Connected", rooms: ["creative"] },
  { id: "gpt4", name: "GPT-4", Logo: GPT4Logo, ring: "outer", description: "Specialized AI tasks", status: "Partner", rooms: [] },
  { id: "notion", name: "Notion", Logo: NotionLogo, ring: "outer", description: "Documentation and knowledge", status: "Partner", rooms: ["strategy"] },
  { id: "linear", name: "Linear", Logo: LinearLogo, ring: "outer", description: "Task and project tracking", status: "Partner", rooms: ["strategy"] },
  { id: "github", name: "GitHub", Logo: GitHubLogo, ring: "outer", description: "Code management", status: "Partner", rooms: [] },
  { id: "hunter", name: "Hunter.io", Logo: HunterLogo, ring: "outer", description: "Email discovery", status: "Partner", rooms: ["growth"] },
  { id: "cal", name: "Cal.com", Logo: CalLogo, ring: "outer", description: "Meeting scheduling", status: "Partner", rooms: ["recruiting"] },
  { id: "canva", name: "Canva", Logo: CanvaLogo, ring: "outer", description: "Design handoff", status: "Partner", rooms: ["creative"] },
  { id: "gamma", name: "Gamma", Logo: GammaLogo, ring: "outer", description: "Presentation handoff", status: "Partner", rooms: ["creative"] },
];

const TABS = ["all", "growth", "recruiting", "creative", "strategy"] as const;
const TAB_LABELS: Record<string, string> = { all: "All Tools", growth: "Growth Room", recruiting: "Recruiting Room", creative: "Creative Room", strategy: "Strategy Room" };

const innerPositions = (cx: number, cy: number, r: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 8 - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

const outerPositions = (cx: number, cy: number, r: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 8 - Math.PI / 2 + Math.PI / 8;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

function useCountUp(target: number, duration = 1500, start = false) {
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
  const [phase, setPhase] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  const cx = 350, cy = 220;
  const innerR = 130, outerR = 195;
  const innerPos = innerPositions(cx, cy, innerR);
  const outerPos = outerPositions(cx, cy, outerR);

  const innerTools = TOOLS.filter(t => t.ring === "inner");
  const outerTools = TOOLS.filter(t => t.ring === "outer");

  const isToolActive = useCallback((tool: ToolNode) => {
    if (activeTab === "all") return true;
    return tool.rooms.includes(activeTab);
  }, [activeTab]);

  const activeCount = TOOLS.filter(t => isToolActive(t)).length;

  const stat1 = useCountUp(16, 1200, inView);
  const stat3 = useCountUp(0, 800, inView);

  return (
    <section ref={sectionRef} id="ecosystem" className="relative z-10 py-24 md:py-32">
      <div className="max-w-[1100px] mx-auto px-6">
        {/* Headline */}
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">THE ECOSYSTEM</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            Every AI tool your business needs.<br />All plugged into one brain.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            Pilot connects the world's best AI tools and makes them work together as a single coordinated team. Each tool knows what the others are doing. No switching. No re-explaining. No data lost between tabs.
          </p>
        </div>

        {/* Power Grid — Desktop */}
        <div className="hidden md:block relative mx-auto" style={{ maxWidth: 700, height: 440 }}>
          <svg width="700" height="440" viewBox="0 0 700 440" className="w-full h-full">
            {/* Connection lines */}
            {phase >= 1 && innerTools.map((tool, i) => {
              const pos = innerPos[i];
              const opacity = isToolActive(tool) ? 0.35 : 0.08;
              const bright = hoveredTool === tool.id;
              return (
                <line key={`line-i-${i}`} x1={cx} y1={cy} x2={pos.x} y2={pos.y}
                  stroke={bright ? "#34d399" : "white"} strokeWidth={bright ? 2 : 1} opacity={bright ? 0.7 : opacity}
                  className="transition-all duration-500">
                  <animate attributeName="stroke-dashoffset" from="300" to="0" dur="0.6s" fill="freeze"
                    begin={`${0.5 + i * 0.2}s`} />
                </line>
              );
            })}
            {phase >= 2 && outerTools.map((tool, i) => {
              const pos = outerPos[i];
              const opacity = isToolActive(tool) ? 0.2 : 0.05;
              const bright = hoveredTool === tool.id;
              return (
                <line key={`line-o-${i}`} x1={cx} y1={cy} x2={pos.x} y2={pos.y}
                  stroke={bright ? "#34d399" : "white"} strokeWidth={1} opacity={bright ? 0.6 : opacity}
                  strokeDasharray="4 4" className="transition-all duration-500" />
              );
            })}

            {/* Pulsing dots on lines */}
            {phase >= 3 && innerTools.map((_, i) => {
              const pos = innerPos[i];
              return (
                <circle key={`dot-${i}`} r="2" fill="#34d399" opacity="0.6">
                  <animateMotion dur={`${3 + i * 0.4}s`} repeatCount="indefinite"
                    path={`M${cx},${cy} L${pos.x},${pos.y}`} />
                </circle>
              );
            })}
          </svg>

          {/* Center Pilot node */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : {}}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="absolute flex flex-col items-center justify-center"
            style={{ left: cx - 36, top: cy - 36, width: 72, height: 72 }}
          >
            <div className="w-[72px] h-[72px] rounded-full bg-emerald-500/20 border-2 border-emerald-500/60 flex items-center justify-center shadow-[0_0_30px_rgba(5,150,105,0.4)]">
              <span className="font-display font-black text-sm text-white tracking-tight">Pilot</span>
            </div>
          </motion.div>

          {/* Inner ring tools */}
          {innerTools.map((tool, i) => {
            const pos = innerPos[i];
            const active = isToolActive(tool);
            return (
              <motion.div key={tool.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={phase >= 1 ? { scale: 1, opacity: active ? 1 : 0.3 } : {}}
                transition={{ duration: 0.4, delay: i * 0.15, ease: "easeOut" }}
                className="absolute flex flex-col items-center cursor-pointer transition-opacity duration-500"
                style={{ left: pos.x - 24, top: pos.y - 24 }}
                onMouseEnter={() => setHoveredTool(tool.id)}
                onMouseLeave={() => setHoveredTool(null)}
              >
                <div className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-300 ${
                  hoveredTool === tool.id ? "bg-white/10 border-emerald-500/50 scale-110" : "bg-white/[0.04] border-white/[0.08]"
                }`}>
                  <tool.Logo width={28} height={28} />
                </div>
                <span className="text-[10px] text-white/40 mt-1 font-medium whitespace-nowrap">{tool.name}</span>

                {/* Tooltip */}
                <AnimatePresence>
                  {hoveredTool === tool.id && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute -top-20 z-50 px-3 py-2 rounded-lg bg-[#0d1117] border border-white/[0.08] shadow-xl min-w-[160px]"
                    >
                      <div className="text-xs font-bold text-white">{tool.name}</div>
                      <div className="text-[10px] text-white/40 mt-0.5">{tool.description}</div>
                      <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full ${
                        tool.status === "Connected" ? "bg-emerald-500/20 text-emerald-400" : "bg-white/[0.06] text-white/30"
                      }`}>{tool.status}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {/* Outer ring tools */}
          {outerTools.map((tool, i) => {
            const pos = outerPos[i];
            const active = isToolActive(tool);
            return (
              <motion.div key={tool.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={phase >= 2 ? { scale: 1, opacity: active ? 0.7 : 0.2 } : {}}
                transition={{ duration: 0.4, delay: i * 0.12, ease: "easeOut" }}
                className="absolute flex flex-col items-center cursor-pointer transition-opacity duration-500"
                style={{ left: pos.x - 20, top: pos.y - 20 }}
                onMouseEnter={() => setHoveredTool(tool.id)}
                onMouseLeave={() => setHoveredTool(null)}
              >
                <div className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300 ${
                  hoveredTool === tool.id ? "bg-white/10 border-emerald-500/50 scale-110" : "bg-white/[0.03] border-white/[0.06]"
                }`}>
                  <tool.Logo width={22} height={22} />
                </div>
                <span className="text-[9px] text-white/30 mt-1 font-medium whitespace-nowrap">{tool.name}</span>

                <AnimatePresence>
                  {hoveredTool === tool.id && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute -top-20 z-50 px-3 py-2 rounded-lg bg-[#0d1117] border border-white/[0.08] shadow-xl min-w-[160px]"
                    >
                      <div className="text-xs font-bold text-white">{tool.name}</div>
                      <div className="text-[10px] text-white/40 mt-0.5">{tool.description}</div>
                      <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/30">{tool.status}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* Mobile — simplified grid */}
        <div className="md:hidden grid grid-cols-4 gap-4 mb-8">
          {innerTools.map(tool => (
            <div key={tool.id} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                <tool.Logo width={28} height={28} />
              </div>
              <span className="text-[10px] text-white/40 font-medium">{tool.name}</span>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 justify-center mt-12 mb-2 overflow-x-auto pb-2">
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
          <p className="text-center text-xs text-white/30 mb-8">{activeCount} tools powering this room</p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 mb-16">
          {[
            { num: `${stat1}+`, label: "AI tools connected", sub: "And growing every month" },
            { num: "1", label: "Company Brain", sub: "Shared across every tool" },
            { num: `${stat3}`, label: "Tabs to switch between", sub: "Everything runs from Pilot" },
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
          You bring the vision.<br />Pilot brings the tools.<br />Together you build something unstoppable.
        </p>
      </div>
    </section>
  );
};

export default EcosystemSection;
