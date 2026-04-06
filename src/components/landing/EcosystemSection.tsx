import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useScroll } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { TOOL_BRANDS } from "./ToolLogos";

/* ─────────────────────────────────────────────
   DATA
───────────────────────────────────────────── */
const TOOLS = [
  // INNER — AI Models (r 140)
  { id: "claude",     angle:  30, r: 140, ring: 1, role: "Reasoning & Writing",     use: "Used across orchestration and decision layers",           activeStages: [2,3,4,5] },
  { id: "gpt4",       angle: 150, r: 140, ring: 1, role: "Specialized Tasks",       use: "Used for targeted high-precision workflows",              activeStages: [2,3,4,5] },
  { id: "gemini",     angle: 270, r: 140, ring: 1, role: "Screening & Analysis",    use: "Used for evaluation and multimodal reasoning",            activeStages: [2,3,4,5] },
  // MIDDLE — Data (r 260)
  { id: "firecrawl",  angle:  90, r: 260, ring: 2, role: "Web Intelligence",        use: "Used to monitor and enrich live web data",                activeStages: [3,4,5] },
  { id: "apify",      angle: 210, r: 260, ring: 2, role: "LinkedIn Extraction",     use: "Used to source and structure profile data at scale",      activeStages: [3,4,5] },
  // OUTER — Execution (r 390)
  { id: "nanobanana", angle:   0, r: 390, ring: 3, role: "Visual Creation",         use: "Used to generate branded content assets",                 activeStages: [4,5] },
  { id: "elevenlabs", angle:  60, r: 390, ring: 3, role: "Voice Generation",        use: "Used for spoken content and audio output",                activeStages: [4,5] },
  { id: "instantly",  angle: 120, r: 390, ring: 3, role: "Email Sending",           use: "Used for outbound delivery and follow-up execution",      activeStages: [4,5] },
  { id: "notion",     angle: 180, r: 390, ring: 3, role: "Operating Memory",        use: "Used for documentation and persistent internal context",  activeStages: [5] },
  { id: "linear",     angle: 240, r: 390, ring: 3, role: "Task Coordination",       use: "Used for routing and tracking execution",                 activeStages: [5] },
  { id: "github",     angle: 300, r: 390, ring: 3, role: "Technical Shipping",      use: "Used for code execution and product delivery",            activeStages: [5] },
];

// Inter-tool mesh visible at stage 5
const MESH: [string, string][] = [
  ["claude", "gpt4"], ["gpt4", "gemini"], ["gemini", "claude"],
  ["firecrawl", "apify"],
  ["claude", "firecrawl"], ["gpt4", "apify"],
  ["elevenlabs", "instantly"], ["notion", "linear"], ["linear", "github"],
];

const STAGE_LABELS = [
  "CORE ONLINE",
  "INTELLIGENCE MODELS",
  "DATA LAYER",
  "ACTION LAYER",
  "FULL SYSTEM",
];

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const toXY = (deg: number, r: number) => {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
};

const getR = (r: number, mobile: boolean) => (mobile ? r * 0.52 : r);

// Gentle quadratic bezier curve from tool toward brain center
const cablePath = (fx: number, fy: number, tx: number, ty: number) => {
  const ctrlX = (fx + tx) / 2 + (ty - fy) * 0.12;
  const ctrlY = (fy + ty) / 2 + (fx - tx) * 0.12;
  return `M ${fx} ${fy} Q ${ctrlX} ${ctrlY} ${tx} ${ty}`;
};

/* ═══════════════════════════════════════════════════
   EcosystemSection
═══════════════════════════════════════════════════ */
const EcosystemSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [stage, setStage]   = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useEffect(
    () =>
      scrollYProgress.on("change", (p) =>
        setStage(Math.min(5, Math.max(1, Math.ceil(p * 5))))
      ),
    [scrollYProgress]
  );

  // Layout constants
  const SVG_W    = isMobile ? 380 : 900;
  const SVG_H    = isMobile ? 380 : 900;
  const SCALE    = SVG_W / 1000;
  const cx = 500, cy = 500;
  const nodeSize = isMobile ? 52 : 58;
  const logoSize = isMobile ? 21 : 25;
  const coreSize = isMobile ? 88 : 128;
  const surge    = stage === 5;
  const MINT     = "#10B981";

  // CSS pixel coord of a SVG-space point for absolute node positioning
  const svgToCss = (svgX: number, svgY: number) => ({
    left: (svgX / 1000) * SVG_W,
    top:  (svgY / 1000) * SVG_H,
  });

  return (
    <section
      ref={sectionRef}
      id="ecosystem"
      className="relative w-full"
      style={{ height: "500vh", background: "transparent" }}
    >
      {/* ── KEYFRAMES injected once ── */}
      <style>{`
        @keyframes rs1 {
          0%   { transform: rotateX(68deg) rotateY(0deg)    rotateZ(0deg);   }
          100% { transform: rotateX(68deg) rotateY(0deg)    rotateZ(360deg); }
        }
        @keyframes rs2 {
          0%   { transform: rotateX(68deg) rotateY(60deg)   rotateZ(0deg);   }
          100% { transform: rotateX(68deg) rotateY(60deg)   rotateZ(360deg); }
        }
        @keyframes rs3 {
          0%   { transform: rotateX(68deg) rotateY(-60deg)  rotateZ(0deg);   }
          100% { transform: rotateX(68deg) rotateY(-60deg)  rotateZ(360deg); }
        }
        @keyframes accrtn {
          0%   { transform: translate(-50%,-50%) rotate(0deg);   }
          100% { transform: translate(-50%,-50%) rotate(360deg); }
        }
        @keyframes hbreathe {
          0%,100% {
            box-shadow: 0 0 0 1px rgba(16,185,129,0.12),
                        0 0 44px rgba(16,185,129,0.22),
                        0 0 90px rgba(16,185,129,0.08),
                        inset 0 0 32px rgba(16,185,129,0.12);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(16,185,129,0.3),
                        0 0 72px rgba(16,185,129,0.4),
                        0 0 140px rgba(16,185,129,0.14),
                        inset 0 0 48px rgba(16,185,129,0.24);
          }
        }
        @keyframes orbhalo {
          0%,100% { opacity:0.5;  transform: translate(-50%,-50%) scale(1);    }
          50%     { opacity:0.85; transform: translate(-50%,-50%) scale(1.16); }
        }
      `}</style>

      <div className="sticky top-0 w-full h-screen overflow-hidden flex items-center justify-center">

        {/* ── ATMOSPHERE ── */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute inset-0" style={{
            background: "radial-gradient(ellipse 90% 80% at 50% 50%, rgba(16,185,129,0.055) 0%, rgba(3,7,10,0.96) 52%, #03070A 100%)",
          }}/>
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)`,
            backgroundSize: "72px 72px",
          }}/>
          <div className="absolute inset-0 transition-all duration-[2000ms]" style={{
            background: `radial-gradient(ellipse 560px 420px at 50% 50%, ${
              surge ? "rgba(16,185,129,0.12)" : "rgba(16,185,129,0.065)"
            } 0%, transparent 60%)`,
          }}/>
        </div>

        {/* ── STAGE LABEL ── */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30">
          <AnimatePresence mode="wait">
            <motion.span
              key={stage}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 0.42, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4 }}
              className="font-mono text-[10px] uppercase tracking-[0.5em] font-bold select-none"
              style={{ color: MINT }}
            >
              {STAGE_LABELS[stage - 1]}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* ── SCENE ── */}
        <div className="relative z-10" style={{ width: SVG_W, height: SVG_H }}>

          {/* ── 3-D DECORATIVE RINGS ── */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ perspective: "1200px", transformStyle: "preserve-3d" }}
          >
            {/* Ring A — inner atmosphere */}
            {[
              { w: isMobile ? 176 : 416, anim: "rs1 24s linear infinite",  border: "rgba(16,185,129,0.16)", shadow: "0 0 14px rgba(16,185,129,0.06)" },
              { w: isMobile ? 272 : 644, anim: "rs2 32s linear infinite",  border: "rgba(16,185,129,0.10)", shadow: "none" },
              { w: isMobile ? 358 : 844, anim: "rs3 40s linear infinite",  border: "rgba(16,185,129,0.07)", shadow: "none" },
            ].map(({ w, anim, border, shadow }, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  top: "50%", left: "50%",
                  width: w, height: w,
                  marginTop: -w / 2, marginLeft: -w / 2,
                  border: `1px solid ${border}`,
                  boxShadow: shadow,
                  animation: anim,
                  transformOrigin: "center center",
                }}
              />
            ))}
          </div>

          {/* ── SVG LAYER: flat orbit guides + cables + packets ── */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 1000 1000"
            style={{ overflow: "visible" }}
          >
            <defs>
              <filter id="pkGlow" x="-150%" y="-150%" width="400%" height="400%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="hoverGlow" x="-150%" y="-150%" width="400%" height="400%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            {/* Flat orbital guides (subtle dashed circles at each radius) */}
            {([
              { r: 140, minStage: 2, dash: undefined },
              { r: 260, minStage: 3, dash: "5 9" },
              { r: 390, minStage: 4, dash: "3 11" },
            ] as const).map(({ r, minStage, dash }) => {
              const rr = getR(r, isMobile);
              const on = stage >= minStage;
              return (
                <circle key={r} cx={cx} cy={cy} r={rr} fill="none"
                  stroke={`rgba(255,255,255,${on ? 0.065 : 0.025})`}
                  strokeWidth="1"
                  strokeDasharray={dash}
                  style={{ transition: "stroke 1.2s ease" }}
                />
              );
            })}

            {/* Mesh connections — stage 5 */}
            <AnimatePresence>
              {stage >= 5 && MESH.map(([a, b]) => {
                const ta = TOOLS.find(t => t.id === a)!;
                const tb = TOOLS.find(t => t.id === b)!;
                const pa = toXY(ta.angle, getR(ta.r, isMobile));
                const pb = toXY(tb.angle, getR(tb.r, isMobile));
                return (
                  <motion.line key={`m-${a}-${b}`}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 1.2 }}
                    x1={cx + pa.x} y1={cy + pa.y}
                    x2={cx + pb.x} y2={cy + pb.y}
                    stroke="rgba(16,185,129,0.08)" strokeWidth="1" strokeDasharray="3 10"
                  />
                );
              })}
            </AnimatePresence>

            {/* Tool → Brain cables + data packets */}
            {TOOLS.map((tool) => {
              const active = tool.activeStages.includes(stage);
              const isH    = hovered === tool.id;
              if (!active && !isH) return null;

              const r   = getR(tool.r, isMobile);
              const pos = toXY(tool.angle, r);
              const fx  = cx + pos.x, fy = cy + pos.y;
              const d   = cablePath(fx, fy, cx, cy);
              const dur = `${2.0 + tool.r * 0.003}s`;

              return (
                <g key={`cable-${tool.id}`}>
                  {/* base cable */}
                  <path d={d} fill="none"
                    stroke={isH ? "rgba(16,185,129,0.55)" : "rgba(16,185,129,0.13)"}
                    strokeWidth={isH ? 1.5 : 1}
                    filter={isH ? "url(#hoverGlow)" : undefined}
                    style={{ transition: "stroke 0.35s, stroke-width 0.35s" }}
                  />
                  {/* hover soft bloom */}
                  {isH && (
                    <path d={d} fill="none"
                      stroke="rgba(16,185,129,0.22)" strokeWidth="6"
                      filter="url(#hoverGlow)"
                    />
                  )}
                  {/* travelling packet */}
                  <circle r={isH ? 4 : 2.8} fill={MINT} filter="url(#pkGlow)">
                    <animateMotion path={d} dur={dur} repeatCount="indefinite"/>
                    <animate attributeName="opacity"
                      values="0;1;1;0" keyTimes="0;0.08;0.9;1"
                      dur={dur} repeatCount="indefinite"/>
                  </circle>
                  {/* second offset packet on hover */}
                  {isH && (
                    <circle r="2.5" fill="#fff">
                      <animateMotion path={d} dur={`${parseFloat(dur) * 0.7}s`}
                        begin={`-${parseFloat(dur) * 0.35}s`} repeatCount="indefinite"/>
                      <animate attributeName="opacity"
                        values="0;0.7;0.7;0" keyTimes="0;0.1;0.88;1"
                        dur={`${parseFloat(dur) * 0.7}s`} repeatCount="indefinite"/>
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>

          {/* ── TOOL NODES ── */}
          {TOOLS.map((tool) => {
            const active  = tool.activeStages.includes(stage);
            const isH     = hovered === tool.id;
            const dimmed  = hovered !== null && !isH;
            const r       = getR(tool.r, isMobile);
            const pos     = toXY(tool.angle, r);
            const brand   = TOOL_BRANDS[tool.id];
            const glowHex = brand?.bg ?? "#10B981";

            const { left, top } = svgToCss(cx + pos.x, cy + pos.y);

            return (
              <div
                key={tool.id}
                className="absolute pointer-events-auto"
                style={{ left, top, transform: "translate(-50%,-50%)", zIndex: isH ? 60 : 20 }}
                onMouseEnter={() => active && setHovered(tool.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.35 }}
                  animate={{
                    opacity: active ? (dimmed ? 0.18 : 1) : 0,
                    scale:   active ? (isH ? 1.12 : dimmed ? 0.9 : 1) : 0.35,
                  }}
                  transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
                  className="relative flex flex-col items-center gap-[6px]"
                >
                  {/* ── Glass Badge ── */}
                  <div
                    className="relative flex items-center justify-center overflow-hidden"
                    style={{
                      width: nodeSize, height: nodeSize, borderRadius: "50%",
                      background: "rgba(10,16,12,0.72)",
                      backdropFilter: "blur(20px) saturate(150%)",
                      border: `1px solid ${isH ? "rgba(16,185,129,0.65)" : "rgba(16,185,129,0.22)"}`,
                      boxShadow: isH
                        ? `0 0 0 1px rgba(16,185,129,0.14), 0 0 28px rgba(16,185,129,0.42), 0 8px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.09)`
                        : `0 6px 22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)`,
                      transition: "all 0.3s cubic-bezier(0.23,1,0.32,1)",
                    }}
                  >
                    {/* specular highlight */}
                    <div className="absolute inset-0 pointer-events-none" style={{
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 36% 26%, rgba(255,255,255,0.11) 0%, transparent 55%)",
                    }}/>
                    {/* logo */}
                    {brand?.logo ? (
                      <img
                        src={brand.logo}
                        alt={brand.label}
                        className="relative z-10 object-contain pointer-events-none"
                        style={{ width: logoSize, height: logoSize }}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          const p = e.currentTarget.parentElement;
                          if (p) p.innerHTML = `<span style="position:relative;z-index:10;font-weight:800;color:rgba(255,255,255,0.82);font-size:${Math.round(logoSize * 0.62)}px;font-family:system-ui">${brand.label.charAt(0)}</span>`;
                        }}
                      />
                    ) : (
                      <span className="relative z-10 font-extrabold text-white/80"
                        style={{ fontSize: Math.round(logoSize * 0.62) }}>
                        {tool.id.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* label */}
                  <span
                    className="font-mono select-none text-center leading-[1.1]"
                    style={{
                      fontSize: isMobile ? 8 : 10,
                      letterSpacing: "0.07em",
                      color: isH ? "#fff" : "rgba(255,255,255,0.4)",
                      transition: "color 0.3s",
                      maxWidth: isMobile ? "54px" : "80px",
                      wordBreak: "break-word"
                    }}
                  >
                    {brand?.label ?? tool.id}
                  </span>

                  {/* tooltip */}
                  <AnimatePresence>
                    {isH && !isMobile && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.94 }}
                        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                        className="absolute top-full mt-3 min-w-[210px] rounded-xl p-4 text-center pointer-events-none z-[70]"
                        style={{
                          background: "rgba(5,8,7,0.94)",
                          backdropFilter: "blur(20px)",
                          border: "1px solid rgba(16,185,129,0.18)",
                          boxShadow: `0 20px 52px rgba(0,0,0,0.42), 0 0 22px rgba(16, 185, 129, 0.1)`,
                        }}
                      >
                        <div className="font-bold tracking-tight text-white mb-1" style={{ fontSize: 15 }}>
                          {brand?.label ?? tool.id}
                        </div>
                        <div className="text-[12px] font-medium text-white/65 mb-1">{tool.role}</div>
                        <div className="text-[11px] leading-relaxed text-white/35">{tool.use}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            );
          })}

          {/* ── PILOT BRAIN — Glass Orb ── */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              zIndex: 50,
            }}
          >
            {/* outer halo */}
            <div
              className="absolute rounded-full"
              style={{
                top: "50%", left: "50%",
                width: coreSize * 2.9, height: coreSize * 2.9,
                background: "radial-gradient(ellipse, rgba(16,185,129,0.11) 0%, transparent 65%)",
                filter: "blur(32px)",
                animation: "orbhalo 3.8s ease-in-out infinite",
              }}
            />

            {/* accretion disk */}
            <div
              className="absolute rounded-full"
              style={{
                top: "50%", left: "50%",
                width: coreSize * 1.45, height: coreSize * 1.45,
                background: `conic-gradient(
                  from 0deg,
                  transparent 0%,
                  transparent 28%,
                  rgba(16,185,129,0.40) 42%,
                  rgba(16,185,129,0.75) 50%,
                  rgba(16,185,129,0.40) 58%,
                  transparent 72%,
                  transparent 100%
                )`,
                filter: "blur(3.5px)",
                animation: "accrtn 9s linear infinite",
              }}
            />

            {/* glass orb */}
            <div
              className="relative flex flex-col items-center justify-center overflow-hidden rounded-full"
              style={{
                width: coreSize, height: coreSize,
                background: [
                  "radial-gradient(circle at 30% 26%, rgba(16,185,129,0.36) 0%, rgba(16,185,129,0.04) 38%, transparent 58%)",
                  "radial-gradient(circle at 70% 74%, rgba(0,28,18,0.88) 0%, #040d07 55%)",
                  "#030a06",
                ].join(", "),
                border: surge ? "1px solid rgba(16,185,129,0.48)" : "1px solid rgba(16,185,129,0.26)",
                animation: "hbreathe 3.2s ease-in-out infinite",
              }}
            >
              {/* conic spin layer */}
              <div
                className="absolute inset-[-18%] rounded-full"
                style={{
                  background: "conic-gradient(from var(--conic-angle), rgba(255,255,255,0.03), rgba(16,185,129,0.44), rgba(16,185,129,0.06), rgba(255,255,255,0.04), rgba(16,185,129,0.3), rgba(255,255,255,0.03))",
                  animation: "conic-spin 14s linear infinite",
                }}
              />
              {/* inner rim glow */}
              <div
                className="absolute pointer-events-none"
                style={{
                  inset: "14%", borderRadius: "50%",
                  boxShadow: "inset 0 0 20px rgba(16,185,129,0.52), 0 0 22px rgba(16,185,129,0.28)",
                  border: "1px solid rgba(255,255,255,0.055)",
                }}
              />
              {/* specular highlight */}
              <div
                className="absolute pointer-events-none"
                style={{
                  top: "11%", left: "19%", width: "31%", height: "21%",
                  borderRadius: "50%",
                  background: "rgba(16,185,129,0.2)",
                  filter: "blur(7px)",
                  transform: "rotate(-18deg)",
                }}
              />
              {/* text */}
              <div className="relative z-10 flex flex-col items-center justify-center">
                <span
                  className="font-black leading-none tracking-tighter text-white"
                  style={{
                    fontSize: isMobile ? 20 : 30,
                    textShadow: "0 0 18px rgba(16,185,129,0.35)",
                  }}
                >
                  Pilot
                </span>
                <span
                  className="font-bold uppercase"
                  style={{
                    fontSize: isMobile ? 7 : 9,
                    letterSpacing: "0.38em",
                    marginTop: 3,
                    color: MINT,
                  }}
                >
                  BRAIN
                </span>
              </div>
            </div>
          </div>

        </div>{/* /scene */}
      </div>
    </section>
  );
};

export default EcosystemSection;
