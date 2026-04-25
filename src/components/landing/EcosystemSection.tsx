import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { TOOL_BRANDS } from "./ToolLogos";

/* ─── Tool placement data ─── */
const TOOLS = [
  // INNER RING — Brain Models (r: 140)
  { id: "claude",     angle: 210, r: 140, role: "Reasoning & Writing",     use: "Used across orchestration and decision layers",         activeStages: [2, 3, 4, 5] },
  { id: "gpt4",       angle: 330, r: 140, role: "Specialized Tasks",       use: "Used for targeted high-precision workflows",            activeStages: [2, 3, 4, 5] },
  { id: "gemini",     angle:  90, r: 140, role: "Screening & Analysis",    use: "Used for evaluation and multimodal reasoning",          activeStages: [2, 3, 4, 5] },

  // MIDDLE RING — Data & Intelligence (r: 260)
  { id: "firecrawl",  angle: 225, r: 260, role: "Web Intelligence",        use: "Used to monitor and enrich live web data",              activeStages: [3, 4, 5] },
  { id: "apify",      angle:  45, r: 260, role: "LinkedIn Extraction",     use: "Used to source and structure profile data at scale",    activeStages: [3, 4, 5] },

  // OUTER RING — Action & Execution (r: 390)
  { id: "nanobanana", angle:   0, r: 390, role: "Visual Creation",         use: "Used to generate branded content assets",               activeStages: [4, 5] },
  { id: "elevenlabs", angle:  60, r: 390, role: "Voice Generation",        use: "Used for spoken content and audio output",              activeStages: [4, 5] },
  { id: "instantly",  angle: 120, r: 390, role: "Email Sending",           use: "Used for outbound delivery and follow-up execution",    activeStages: [4, 5] },
  { id: "notion",     angle: 180, r: 390, role: "Operating Memory",        use: "Used for documentation and persistent internal context", activeStages: [5] },
  { id: "linear",     angle: 240, r: 390, role: "Task Coordination",       use: "Used for routing and tracking execution",              activeStages: [5] },
  { id: "github",     angle: 300, r: 390, role: "Technical Shipping",      use: "Used for code execution and product delivery",         activeStages: [5] },
];

const ORBIT_TRACKS = [
  { r: 88, minStage: 1, dashed: false },
  { r: 140, minStage: 2, dashed: false },
  { r: 260, minStage: 3, dashed: true },
  { r: 390, minStage: 4, dashed: true },
];

const STAGE_LABELS = ["CORE ONLINE", "INTELLIGENCE MODELS", "DATA LAYER", "ACTION LAYER", "FULL SYSTEM"];

/* ─── Helpers ─── */
const getR = (r: number, mobile: boolean) => mobile ? r * 0.52 : r;
const toXY = (deg: number, r: number) => {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
};

/* ═══════════════════════════════════════════════════
   EcosystemSection Component
   ═══════════════════════════════════════════════════ */
const EcosystemSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [stage, setStage] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Slow 80° orbit rotation over entire scroll
  const orbitRotate = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const counterRotate = useTransform(scrollYProgress, [0, 1], [0, -80]);

  useEffect(() => {
    return scrollYProgress.on("change", (p) => {
      const s = Math.min(5, Math.max(1, Math.ceil(p * 5)));
      if (s !== stage) setStage(s);
    });
  }, [scrollYProgress, stage]);

  const surge = stage === 5;
  const cx = 500;
  const cy = 500;
  const orbitSize = isMobile ? 360 : 860;
  const tilt = isMobile ? 38 : 43;
  const orbitScale = isMobile ? 0.82 : 0.9;
  const nodeSize = isMobile ? 54 : 60;
  const logoSize = isMobile ? 22 : 26;
  const coreSize = isMobile ? 96 : 136;
  const packetColor = "#00FF94";

  return (
    <section
      ref={sectionRef}
      id="ecosystem"
      className="relative w-full"
      style={{ height: "500vh", background: "transparent" }}
    >
      {/* Grid background texture */}
      <div className="sticky top-0 w-full h-screen overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(0,255,148,0.06) 0%, rgba(5,7,8,0.96) 34%, rgba(3,4,5,1) 72%)",
          }}
        />

        {/* Technical grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: "72px 72px",
          }}
        />

        {/* Centered system glow */}
        <div
          className="absolute inset-0 pointer-events-none transition-all duration-[2000ms]"
          style={{
            background: `radial-gradient(ellipse 560px 420px at 50% 50%, ${surge ? "rgba(0,255,148,0.14)" : "rgba(0,255,148,0.08)"} 0%, rgba(0,255,148,0.03) 24%, transparent 64%)`,
          }}
        />

        {/* Stage indicator */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30">
          <AnimatePresence mode="wait">
            <motion.span
              key={stage}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 0.35, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.5 }}
              className="font-mono text-[10px] uppercase tracking-[0.5em] font-bold text-accent-mint select-none"
            >
              {STAGE_LABELS[stage - 1]}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* ─── ORBIT SYSTEM ─── */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative pointer-events-auto"
            style={{
              width: orbitSize,
              height: orbitSize,
              transform: `perspective(1000px) rotateX(${tilt}deg) scale(${orbitScale})`,
              transformStyle: "preserve-3d",
            }}
          >
            <motion.div
              className="relative h-full w-full"
              style={{
                rotate: orbitRotate,
                transformStyle: "preserve-3d",
              }}
            >
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: isMobile ? 240 : 460,
                  height: isMobile ? 240 : 460,
                  background:
                    "radial-gradient(circle, rgba(0,255,148,0.12) 0%, rgba(0,255,148,0.05) 28%, rgba(0,255,148,0.015) 46%, transparent 72%)",
                  filter: "blur(54px)",
                  transform: "translateZ(-28px)",
                }}
              />

              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 1000 1000"
                style={{ overflow: "visible" }}
              >
                <defs>
                  <filter id="packetGlow" x="-200%" y="-200%" width="400%" height="400%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {ORBIT_TRACKS.map((track, i) => {
                  const r = getR(track.r, isMobile);
                  const ringActive = stage >= track.minStage;

                  return (
                    <circle
                      key={`ring-${track.r}`}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke={`rgba(255,255,255,${ringActive ? 0.1 : 0.06})`}
                      strokeWidth="1"
                      strokeDasharray={track.dashed ? "6 8" : undefined}
                      style={{ transition: "stroke 1s ease, opacity 1s ease" }}
                    />
                  );
                })}

                {ORBIT_TRACKS.filter((track) => stage >= track.minStage).map((track, i) => {
                  const r = getR(track.r, isMobile);
                  const orbitPath = `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
                  const dur = `${8 + i * 1.8}s`;

                  return (
                    <g key={`orbit-packet-${track.r}`}>
                      <circle
                        r="3"
                        fill="rgba(0,255,148,0.16)"
                        filter="url(#packetGlow)"
                      >
                        <animateMotion path={orbitPath} dur={dur} rotate="auto" repeatCount="indefinite" />
                      </circle>
                      <circle
                        r="2"
                        fill={packetColor}
                        opacity="0.95"
                      >
                        <animateMotion path={orbitPath} dur={dur} rotate="auto" repeatCount="indefinite" />
                      </circle>
                    </g>
                  );
                })}

                {TOOLS.map((tool) => {
                  const active = tool.activeStages.includes(stage);
                  const isH = hovered === tool.id;
                  const r = getR(tool.r, isMobile);
                  const pos = toXY(tool.angle, r);

                  const fx = cx + pos.x;
                  const fy = cy + pos.y;
                  const d = `M ${fx} ${fy} L ${cx} ${cy}`;
                  const lineVisible = active || isH;
                  const dur = `${2.8 + tool.r * 0.002}s`;

                  return (
                    <g key={`conn-${tool.id}`}>
                      <path
                        d={d}
                        fill="none"
                        stroke={isH ? "rgba(0,255,148,0.18)" : "rgba(255,255,255,0.08)"}
                        strokeWidth="1"
                        opacity={lineVisible ? 1 : 0}
                        style={{ transition: "stroke 0.6s ease, opacity 0.8s ease" }}
                      />

                      {lineVisible && (
                        <>
                          <circle
                            r="3"
                            fill="rgba(0,255,148,0.18)"
                            filter="url(#packetGlow)"
                            opacity="0.5"
                          >
                            <animateMotion path={d} dur={dur} repeatCount="indefinite" />
                            <animate
                              attributeName="opacity"
                              values="0;0.5;0.5;0"
                              keyTimes="0;0.12;0.88;1"
                              dur={dur}
                              repeatCount="indefinite"
                            />
                          </circle>
                          <circle
                            r="2"
                            fill={packetColor}
                            opacity="0.95"
                          >
                            <animateMotion path={d} dur={dur} repeatCount="indefinite" />
                            <animate
                              attributeName="opacity"
                              values="0;1;1;0"
                              keyTimes="0;0.1;0.9;1"
                              dur={dur}
                              repeatCount="indefinite"
                            />
                          </circle>
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>

              {TOOLS.map((tool) => {
                const active = tool.activeStages.includes(stage);
                const isH = hovered === tool.id;
                const dimmed = hovered !== null && hovered !== tool.id;
                const r = getR(tool.r, isMobile);
                const pos = toXY(tool.angle, r);
                const brand = TOOL_BRANDS[tool.id];
                const glowColor = brand?.bg || packetColor;

                return (
                  <div
                    key={tool.id}
                    className="absolute pointer-events-auto"
                    style={{
                      left: `calc(50% + ${pos.x}px)`,
                      top: `calc(50% + ${pos.y}px)`,
                      transform: "translate(-50%, -50%)",
                      zIndex: isH ? 60 : 24,
                    }}
                    onMouseEnter={() => active && setHovered(tool.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <motion.div
                      style={{ rotate: counterRotate }}
                      className="relative"
                    >
                      <div
                        className="flex flex-col items-center gap-2"
                        style={{
                          transformStyle: "preserve-3d",
                          transform: `translateZ(${isH ? 54 : 40}px) rotateX(-${tilt}deg) scale(${!active ? 0.68 : isH ? 1.04 : dimmed ? 0.9 : 1})`,
                          opacity: !active ? 0 : dimmed ? 0.18 : 1,
                          transition: "transform 0.45s cubic-bezier(0.23,1,0.32,1), opacity 0.8s ease",
                        }}
                      >
                        <div
                          className="relative flex items-center justify-center overflow-hidden rounded-2xl"
                          style={{
                            width: nodeSize,
                            height: nodeSize,
                            background: "rgba(20, 25, 22, 0.6)",
                            backdropFilter: "blur(16px)",
                            border: "1px solid rgba(0, 255, 148, 0.2)",
                            boxShadow:
                              "0 12px 28px rgba(0,0,0,0.32), 0 4px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
                          }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                isH
                                  ? "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.1) 0%, transparent 68%)"
                                  : "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.06) 0%, transparent 68%)",
                            }}
                          />
                          {brand?.logo ? (
                            <img
                              src={brand.logo}
                              alt={brand.label}
                              className="relative z-10 object-contain pointer-events-none"
                              style={{ width: logoSize, height: logoSize }}
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                                const parent = e.currentTarget.parentElement;
                                if (parent) {
                                  parent.innerHTML = `<span style="position:relative;z-index:10;font-weight:800;color:rgba(255,255,255,0.82);font-size:${logoSize * 0.7}px;font-family:var(--font-display)">${brand.label.charAt(0)}</span>`;
                                }
                              }}
                            />
                          ) : (
                            <span
                              className="relative z-10 font-display font-extrabold text-white/80"
                              style={{ fontSize: logoSize * 0.7 }}
                            >
                              {tool.id.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <span
                          className="font-mono whitespace-nowrap select-none text-center"
                          style={{
                            fontSize: isMobile ? 8 : 10,
                            letterSpacing: "0.08em",
                            color: isH ? "#ffffff" : "rgba(255,255,255,0.44)",
                            textShadow: isH ? "0 0 8px rgba(255,255,255,0.18)" : "none",
                          }}
                        >
                          {brand?.label || tool.id}
                        </span>

                        <AnimatePresence>
                          {isH && !isMobile && (
                            <motion.div
                              initial={{ opacity: 0, y: 10, scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 6, scale: 0.96 }}
                              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                              className="absolute top-full mt-2 min-w-[220px] rounded-xl border p-4 text-center pointer-events-none z-[70]"
                              style={{
                                background: "rgba(8, 10, 10, 0.9)",
                                backdropFilter: "blur(18px)",
                                borderColor: "rgba(255,255,255,0.08)",
                                boxShadow: `0 18px 42px rgba(0,0,0,0.38), 0 0 18px ${glowColor}12`,
                              }}
                            >
                              <div
                                className="font-display mb-1 font-bold tracking-tight"
                                style={{ color: "#fff", fontSize: 16 }}
                              >
                                {brand?.label || tool.id}
                              </div>
                              <div className="mb-1 text-[12px] font-medium text-white/70">{tool.role}</div>
                              <div className="text-[11px] leading-relaxed text-white/35">{tool.use}</div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  </div>
                );
              })}

              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                style={{ zIndex: 50 }}
              >
                <motion.div style={{ rotate: counterRotate }} className="relative">
                  <div
                    className="relative flex items-center justify-center"
                    style={{
                      transformStyle: "preserve-3d",
                      transform: `translateZ(${isMobile ? 58 : 78}px) rotateX(-${tilt}deg) scale(${hovered ? 0.94 : surge ? 1.08 : 1})`,
                      transition: "transform 0.8s cubic-bezier(0.23,1,0.32,1)",
                    }}
                  >
                    <div
                      className="absolute rounded-full pointer-events-none"
                      style={{
                        width: coreSize * 2.35,
                        height: coreSize * 2.35,
                        background:
                          "radial-gradient(circle, rgba(0,255,148,0.14) 0%, rgba(0,255,148,0.05) 26%, transparent 72%)",
                        filter: "blur(50px)",
                      }}
                    />

                    <div
                      className="relative overflow-hidden rounded-full border"
                      style={{
                        width: coreSize,
                        height: coreSize,
                        background: "rgba(5, 8, 7, 0.9)",
                        borderColor: surge ? "rgba(0,255,148,0.38)" : "rgba(0,255,148,0.22)",
                        boxShadow:
                          "inset 0 0 20px rgba(0,255,148,0.08), inset 0 0 40px rgba(0,255,148,0.04), 0 0 24px rgba(0,255,148,0.14), 0 0 110px rgba(0,255,148,0.08)",
                      }}
                    >
                      <div
                        className="absolute inset-[-18%] rounded-full"
                        style={{
                          background:
                            "conic-gradient(from var(--conic-angle), rgba(255,255,255,0.03), rgba(0,255,148,0.42), rgba(0,255,148,0.06), rgba(255,255,255,0.06), rgba(0,255,148,0.28), rgba(255,255,255,0.03))",
                          animation: "conic-spin 14s linear infinite",
                        }}
                      />
                      <div
                        className="absolute inset-[14%] rounded-full pointer-events-none"
                        style={{
                          boxShadow:
                            "inset 0 0 18px rgba(0,255,148,0.55), 0 0 24px rgba(0,255,148,0.28), 0 0 80px rgba(0,255,148,0.1)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      />
                      <div className="relative z-10 flex h-full flex-col items-center justify-center">
                        <span
                          className="font-display font-black leading-none tracking-tighter"
                          style={{
                            fontSize: isMobile ? 22 : 34,
                            color: "#ffffff",
                            textShadow: "0 0 14px rgba(0,255,148,0.28)",
                          }}
                        >
                          Pilot
                        </span>
                        <span
                          className="font-bold uppercase"
                          style={{
                            fontSize: isMobile ? 7 : 10,
                            letterSpacing: "0.35em",
                            marginTop: 2,
                            color: packetColor,
                          }}
                        >
                          BRAIN
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default EcosystemSection;
