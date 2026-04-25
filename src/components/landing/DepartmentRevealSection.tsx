import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { TOOL_BRANDS } from "./ToolLogos";

/* ═══════════════════════════════════════════════════
   Agent Data
   ═══════════════════════════════════════════════════ */
interface AgentDef {
  id: string;
  name: string;
  role: string;
  desc: string;
  actions: string[];
  tools: string[];
  statusLine: string;
  accent: string;
}

const AGENTS: AgentDef[] = [
  {
    id: "scout", name: "Scout", role: "Talent Scout", accent: "#97D700",
    desc: "Finds top candidates, scans signals, and builds talent shortlists across the web.",
    actions: ["Sources high-fit candidates", "Enriches public profiles", "Scans hiring signals", "Assembles shortlists"],
    tools: ["apify", "firecrawl", "github"],
    statusLine: "Scanning 1,247 profiles…",
  },
  {
    id: "aria", name: "Aria", role: "AI Screener", accent: "#CC785C",
    desc: "Evaluates candidates, reasons through fit, and produces structured screening insight.",
    actions: ["Screens against role criteria", "Summarizes strengths & risks", "Compares candidate quality", "Produces evaluation notes"],
    tools: ["claude", "gemini"],
    statusLine: "Evaluating candidate #38…",
  },
  {
    id: "radar", name: "Radar", role: "Intelligence Lead", accent: "#4285F4",
    desc: "Monitors markets, competitors, and external signals to keep your team ahead.",
    actions: ["Tracks competitor moves", "Monitors pricing changes", "Captures market intelligence", "Delivers signal summaries"],
    tools: ["firecrawl", "gpt4", "notion"],
    statusLine: "3 new signals detected",
  },
  {
    id: "penn", name: "Penn", role: "Outreach Writer", accent: "#6366F1",
    desc: "Turns intelligence into persuasive outreach, messages, and campaign-ready copy.",
    actions: ["Drafts outbound sequences", "Personalizes messaging", "Rewrites by persona", "Prepares send-ready content"],
    tools: ["claude", "instantly", "elevenlabs"],
    statusLine: "Drafting sequence v3…",
  },
  {
    id: "constructor", name: "Constructor", role: "Build Your Own", accent: "#00FF94",
    desc: "Design the role, choose the tools, and create a custom AI employee for any function in your business.",
    actions: ["Define the role", "Assign tools", "Describe responsibilities", "Launch employee"],
    tools: ["claude", "gpt4", "gemini", "firecrawl", "apify", "instantly", "elevenlabs", "notion", "linear", "github", "nanobanana"],
    statusLine: "Ready to configure",
  },
];

/* ═══════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════ */
const DepartmentRevealSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [activeIdx, setActiveIdx] = useState(0);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    return scrollYProgress.on("change", (p) => {
      const idx = Math.min(4, Math.max(0, Math.floor(p * 5)));
      if (idx !== activeIdx) setActiveIdx(idx);
    });
  }, [scrollYProgress, activeIdx]);

  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const rafRef = useRef<number>(0);
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const currentRef = useRef({ x: 0.5, y: 0.5 });

  /* ── Eased cursor tracking ── */
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    targetRef.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  useEffect(() => {
    if (isMobile) return;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const tick = () => {
      currentRef.current.x = lerp(currentRef.current.x, targetRef.current.x, 0.06);
      currentRef.current.y = lerp(currentRef.current.y, targetRef.current.y, 0.06);
      setMousePos({ x: currentRef.current.x, y: currentRef.current.y });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isMobile]);

  return (
    <section
      ref={sectionRef}
      id="department-reveal"
      className="relative w-full"
      style={{ height: "400vh" }}
    >
      {/* ── Sticky viewport ── */}
      <div className="sticky top-0 w-full h-screen overflow-hidden flex items-center justify-center">
        {/* Atmosphere is now global in Landing.tsx */}


        {/* ── RIGHT SIDE PROGRESS BAR ── */}
        <div
          className="absolute z-50 flex flex-col items-center gap-3"
          style={{ right: isMobile ? 12 : 32, top: "50%", transform: "translateY(-50%)" }}
        >
          {AGENTS.map((agent, i) => (
            <div key={agent.id} className="flex flex-col items-center gap-1">
              <div
                className="rounded-full transition-all duration-500"
                style={{
                  width: i === activeIdx ? 8 : 5,
                  height: i === activeIdx ? 28 : 14,
                  background: i === activeIdx ? agent.accent : "rgba(255,255,255,0.1)",
                  boxShadow: i === activeIdx ? `0 0 12px ${agent.accent}50` : "none",
                }}
              />
            </div>
          ))}
        </div>

        {/* ── GIANT GLASS WINDOW CONTAINER ── */}
        <div
          className="relative"
          style={{
            width: isMobile ? "94vw" : "84vw",
            maxWidth: 1440,
            height: isMobile ? "78vh" : "74vh",
          }}
        >
          {/* Window chrome — always visible */}
          <div
            className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none z-0"
            style={{
              border: "1px solid rgba(0,255,148,0.12)",
              background: "rgba(10,10,10,0.3)",
              backdropFilter: "blur(40px) saturate(140%)",
              boxShadow: "0 0 80px rgba(0,255,148,0.04), 0 40px 120px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06)",
            }}
          />

          {/* Window top bar */}
          <div
            className="absolute top-0 left-0 right-0 z-30 flex items-center px-5 border-b"
            style={{
              height: 44,
              borderColor: "rgba(255,255,255,0.04)",
              background: "rgba(8,8,8,0.6)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div className="flex gap-[6px]">
              <div className="w-[10px] h-[10px] rounded-full bg-[#FF5F57]" />
              <div className="w-[10px] h-[10px] rounded-full bg-[#FFBD2E]" />
              <div className="w-[10px] h-[10px] rounded-full bg-[#28CA41]" />
            </div>
            <span className="ml-4 font-mono text-[10px] uppercase tracking-[0.3em] text-white/25 font-bold">
              ScreeningPilot — AI Workforce
            </span>
          </div>

          {/* ── STACKED AGENT WINDOWS ── */}
          <div
            className="absolute inset-0 rounded-2xl overflow-hidden"
            style={{ top: 44 }}
          >
            {AGENTS.map((agent, i) => {
              const isActive = i === activeIdx;
              const isPast = i < activeIdx;
              const isFuture = i > activeIdx;
              const offsetFromActive = i - activeIdx;

              return (
                <motion.div
                  key={agent.id}
                  className="absolute inset-0"
                  animate={{
                    y: isFuture ? "100%" : isPast ? `${offsetFromActive * 4}%` : "0%",
                    scale: isPast ? 0.95 + offsetFromActive * 0.01 : 1,
                    opacity: isPast ? 0.3 : isFuture ? 0 : 1,
                  }}
                  transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
                  style={{
                    zIndex: 10 + i,
                    borderRadius: 16,
                  }}
                >
                  <div
                    className="w-full h-full fiesta-halo transition-all duration-500 rounded-2xl overflow-hidden"
                    style={{
                      background: `rgba(20, 25, 22, 0.4)`,
                      borderTop: `1px solid rgba(0, 255, 148, 0.3)`,
                      backdropFilter: `blur(24px)`,
                      WebkitBackdropFilter: `blur(24px)`,
                    }}
                  >
                    {i < 4 ? (
                      <AgentWindow agent={agent} isActive={isActive} isMobile={isMobile} />
                    ) : (
                      <ConstructorWindow agent={agent} isActive={isActive} isMobile={isMobile} />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════════════════
   Agent Window (Windows 1-4)
   ═══════════════════════════════════════════════════ */
const AgentWindow = ({ agent, isActive, isMobile }: { agent: AgentDef; isActive: boolean; isMobile: boolean }) => {
  return (
    <div className={`w-full h-full flex ${isMobile ? "flex-col" : ""} p-6 md:p-10 gap-6 md:gap-10`}>
      {/* LEFT COLUMN — Identity + Info */}
      <div className="flex flex-col justify-center flex-shrink-0" style={{ width: isMobile ? "100%" : "42%" }}>

        {/* Avatar Circle */}
        <div className="relative mb-6 md:mb-8" style={{ width: isMobile ? 72 : 100, height: isMobile ? 72 : 100 }}>
          <div
            className="w-full h-full rounded-full flex items-center justify-center relative overflow-hidden"
            style={{
              background: `radial-gradient(circle, ${agent.accent}18 0%, transparent 70%)`,
              border: `2px solid ${agent.accent}40`,
              boxShadow: `0 0 30px ${agent.accent}20`,
            }}
          >
            <span
              className="font-display font-black"
              style={{ fontSize: isMobile ? 28 : 38, color: agent.accent }}
            >
              {agent.name.charAt(0)}
            </span>
            {/* Pulse halo */}
            {isActive && (
              <>
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: `1px solid ${agent.accent}30`,
                    animation: "active-ring 2s ease-out infinite",
                  }}
                />
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: `1px solid ${agent.accent}20`,
                    animation: "active-ring 2.5s ease-out 0.6s infinite",
                  }}
                />
              </>
            )}
          </div>
          {/* Status dot */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2"
            style={{
              background: agent.accent,
              borderColor: "#0a0a0a",
              boxShadow: `0 0 8px ${agent.accent}60`,
            }}
          />
        </div>

        {/* Name + Role */}
        <div className="mb-4 md:mb-6">
          <h3
            className="font-display font-black tracking-tight leading-none mb-1"
            style={{ fontSize: isMobile ? 32 : 48, color: "#fff" }}
          >
            {agent.name}
          </h3>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.25em] font-bold"
            style={{ color: `${agent.accent}90` }}
          >
            {agent.role}
          </span>
        </div>

        {/* Description */}
        <p className="text-[14px] md:text-[15px] text-white/45 leading-relaxed mb-5 md:mb-8 max-w-[420px]">
          {agent.desc}
        </p>

        {/* Action chips */}
        <div className="flex flex-wrap gap-2 mb-6 md:mb-8">
          {agent.actions.map((action, i) => (
            <motion.span
              key={action}
              initial={isActive ? { opacity: 0, y: 8 } : false}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.3 + i * 0.08, duration: 0.4, ease: "easeOut" }}
              className="px-3 py-1.5 rounded-lg text-[11px] md:text-[12px] font-medium border"
              style={{
                background: `${agent.accent}08`,
                borderColor: `${agent.accent}18`,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              {action}
            </motion.span>
          ))}
        </div>

        {/* Tool Stack */}
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/20 font-bold block mb-3">
            TOOL STACK
          </span>
          <div className="flex gap-2.5 flex-wrap">
            {agent.tools.map((toolId, i) => {
              const brand = TOOL_BRANDS[toolId];
              if (!brand) return null;
              return (
                <motion.div
                  key={toolId}
                  initial={isActive ? { opacity: 0, scale: 0.6, y: 10 } : false}
                  animate={isActive ? { opacity: 1, scale: 1, y: 0 } : {}}
                  transition={{ delay: 0.5 + i * 0.12, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                  className="w-9 h-9 md:w-10 md:h-10 rounded-lg border flex items-center justify-center"
                  title={brand.label}
                  style={{
                    background: "rgba(10,10,10,0.8)",
                    borderColor: `${brand.bg}30`,
                    boxShadow: `0 0 10px ${brand.bg}10`,
                  }}
                >
                  <img
                    src={brand.logo}
                    alt={brand.label}
                    className="w-5 h-5 object-contain"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const p = e.currentTarget.parentElement;
                      if (p) p.innerHTML = `<span style="font-weight:700;color:${brand.bg};font-size:14px">${brand.label.charAt(0)}</span>`;
                    }}
                  />
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN — Live Product Panel */}
      {!isMobile && (
        <div className="flex-1 flex items-center justify-center">
          <LivePanel agent={agent} isActive={isActive} />
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   Live Panel — faux product UI per agent
   ═══════════════════════════════════════════════════ */
const LivePanel = ({ agent, isActive }: { agent: AgentDef; isActive: boolean }) => {
  const panelData = PANEL_DATA[agent.id] || [];

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="w-full max-w-[480px] rounded-xl border overflow-hidden"
      style={{
        background: "rgba(8,8,8,0.7)",
        borderColor: `${agent.accent}15`,
        backdropFilter: "blur(10px)",
      }}
    >
      {/* Panel header */}
      <div
        className="px-4 py-3 border-b flex items-center gap-2"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: agent.accent }}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">
          {agent.statusLine}
        </span>
      </div>

      {/* Panel rows */}
      <div className="p-4 flex flex-col gap-2.5">
        {panelData.map((row, i) => (
          <motion.div
            key={i}
            initial={isActive ? { opacity: 0, y: 6 } : false}
            animate={isActive ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.4 + i * 0.1, duration: 0.35 }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
            style={{
              background: "rgba(255,255,255,0.015)",
              borderColor: "rgba(255,255,255,0.04)",
            }}
          >
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: `${agent.accent}12`, color: agent.accent }}
            >
              <span className="text-[11px] font-bold">{row.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-white/70 font-medium truncate">{row.title}</div>
              <div className="text-[10px] text-white/30 truncate">{row.sub}</div>
            </div>
            <div
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
              style={{ background: `${agent.accent}12`, color: `${agent.accent}cc` }}
            >
              {row.badge}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

/* Panel content data */
const PANEL_DATA: Record<string, { icon: string; title: string; sub: string; badge: string }[]> = {
  scout: [
    { icon: "→", title: "Sarah Chen — Sr. Engineer", sub: "GitHub: 847 contributions · 4y React", badge: "98%" },
    { icon: "→", title: "Marcus Rivera — ML Lead", sub: "Apify scan · 12 open-source repos", badge: "94%" },
    { icon: "→", title: "Anika Patel — Full Stack", sub: "Firecrawl enrichment · YC alum", badge: "91%" },
    { icon: "◉", title: "Shortlist compiled", sub: "14 candidates · avg fit 93%", badge: "DONE" },
  ],
  aria: [
    { icon: "◆", title: "Technical Depth", sub: "Strong systems design background", badge: "9.2" },
    { icon: "◆", title: "Culture Alignment", sub: "Fast-paced startup experience", badge: "8.7" },
    { icon: "◆", title: "Risk Assessment", sub: "Short tenures at 2 companies", badge: "MED" },
    { icon: "✓", title: "Recommendation", sub: "Proceed to final interview", badge: "PASS" },
  ],
  radar: [
    { icon: "⚡", title: "Competitor X launched V3", sub: "Pricing dropped 20% · new tier added", badge: "NEW" },
    { icon: "⚡", title: "Market signal detected", sub: "3 prospects hiring for AI roles", badge: "HOT" },
    { icon: "📊", title: "Weekly intelligence digest", sub: "12 signals · 3 action items", badge: "SENT" },
    { icon: "🎯", title: "Target account activity", sub: "Acme Corp expanded engineering team", badge: "LIVE" },
  ],
  penn: [
    { icon: "✉", title: "Sequence: Enterprise Outreach", sub: "3-step · personalized per ICP", badge: "v3" },
    { icon: "📝", title: "Subject line A/B ready", sub: "\"Quick question\" vs \"Your AI stack\"", badge: "TEST" },
    { icon: "🎤", title: "Voice memo generated", sub: "ElevenLabs · 32s · warm tone", badge: "DONE" },
    { icon: "🚀", title: "Batch queued", sub: "47 contacts · Instantly pipeline", badge: "SEND" },
  ],
};

/* ═══════════════════════════════════════════════════
   Constructor Window (Window 5)
   ═══════════════════════════════════════════════════ */
const ConstructorWindow = ({ agent, isActive, isMobile }: { agent: AgentDef; isActive: boolean; isMobile: boolean }) => {
  const allTools = agent.tools;

  return (
    <div className={`w-full h-full flex flex-col items-center justify-center p-6 md:p-12 text-center`}>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 0.15, duration: 0.6 }}
        className="mb-3"
      >
        <h3
          className="font-display font-black tracking-tight leading-none"
          style={{
            fontSize: isMobile ? 28 : 52,
            background: "linear-gradient(135deg, #fff 30%, #00FF94 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Build Your Own AI Employee
        </h3>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={isActive ? { opacity: 1 } : {}}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-[14px] md:text-[16px] text-white/40 max-w-[520px] leading-relaxed mb-8 md:mb-12"
      >
        {agent.desc}
      </motion.p>

      {/* Tool Grid */}
      <div
        className="grid gap-3 mb-8 md:mb-10"
        style={{
          gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : "repeat(6, 1fr)",
          maxWidth: isMobile ? 300 : 480,
        }}
      >
        {allTools.map((toolId, i) => {
          const brand = TOOL_BRANDS[toolId];
          if (!brand) return null;
          return (
            <motion.div
              key={toolId}
              initial={isActive ? { opacity: 0, scale: 0.4, y: 20 } : false}
              animate={isActive ? { opacity: 1, scale: 1, y: 0 } : {}}
              transition={{
                delay: 0.5 + i * 0.09,
                duration: 0.45,
                ease: [0.23, 1, 0.32, 1],
              }}
              className="flex flex-col items-center gap-1.5 group"
            >
              <div
                className="rounded-xl border flex items-center justify-center cursor-default transition-all duration-300"
                style={{
                  width: isMobile ? 44 : 56,
                  height: isMobile ? 44 : 56,
                  background: "rgba(10,10,10,0.8)",
                  borderColor: `${brand.bg}25`,
                  boxShadow: `0 0 8px ${brand.bg}08`,
                }}
              >
                <img
                  src={brand.logo}
                  alt={brand.label}
                  className="object-contain"
                  style={{ width: isMobile ? 20 : 26, height: isMobile ? 20 : 26 }}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const p = e.currentTarget.parentElement;
                    if (p) p.innerHTML = `<span style="font-weight:700;color:${brand.bg};font-size:16px">${brand.label.charAt(0)}</span>`;
                  }}
                />
              </div>
              <span className="font-mono text-[8px] md:text-[9px] text-white/25 text-center leading-tight">
                {brand.label}
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={isActive ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 1.2, duration: 0.5 }}
      >
        <button
          className="px-8 py-3.5 rounded-xl font-display font-bold text-[14px] tracking-tight transition-all duration-300 cursor-pointer relative overflow-hidden group"
          style={{
            background: "rgba(0,255,148,0.1)",
            border: "1px solid rgba(0,255,148,0.3)",
            color: "#00FF94",
            boxShadow: "0 0 30px rgba(0,255,148,0.08)",
          }}
        >
          <span className="relative z-10">Start Building →</span>
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{ background: "linear-gradient(135deg, rgba(0,255,148,0.15), rgba(0,255,148,0.05))" }}
          />
        </button>
      </motion.div>
    </div>
  );
};

export default DepartmentRevealSection;
