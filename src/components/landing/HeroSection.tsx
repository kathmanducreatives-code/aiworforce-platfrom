import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";

// ─── Operative Card Data ─────────────────────────────────────────────────────
const OPERATIVES = [
  {
    id: "scout",
    name: "Scout",
    role: "Talent Acquisition AI",
    status: "ACTIVE",
    metric: "Currently Sourcing: 42 Leads",
    avatar: "S",
    color: "#00FF94",
    stat: "247 profiles / hr",
    dept: "Talent",
    zIndex: 30,
    baseRotate: -12,
    baseTranslateX: -160,
    baseTranslateY: 20,
  },
  {
    id: "aria",
    name: "Aria",
    role: "Growth Operations AI",
    status: "ACTIVE",
    metric: "Screened 12 Candidates Today",
    avatar: "A",
    color: "#05CFAA",
    stat: "98% accuracy rate",
    dept: "Growth",
    zIndex: 40,
    baseRotate: 0,
    baseTranslateX: 0,
    baseTranslateY: -10,
  },
  {
    id: "penn",
    name: "Penn",
    role: "Intelligence & Research AI",
    status: "ACTIVE",
    metric: "Monitoring 18 Competitors",
    avatar: "P",
    color: "#059652",
    stat: "Live market data",
    dept: "Intelligence",
    zIndex: 20,
    baseRotate: 12,
    baseTranslateX: 160,
    baseTranslateY: 20,
  },
];

// ─── Single Holographic Operative Card ───────────────────────────────────────
interface OperativeCardProps {
  op: (typeof OPERATIVES)[0];
  mouseX: number;
  mouseY: number;
  containerRef: React.RefObject<HTMLDivElement>;
}

const OperativeCard = ({ op, mouseX, mouseY, containerRef }: OperativeCardProps) => {
  const [tooltip, setTooltip] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Compute parallax tilt from mouse position
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (mouseX - cx) / (rect.width / 2);
    const dy = (mouseY - cy) / (rect.height / 2);
    // Each card tilts a bit differently based on its position
    const factor = op.id === "aria" ? 1 : 0.6;
    setTilt({ x: dy * -8 * factor, y: dx * 8 * factor });
  }, [mouseX, mouseY, containerRef, op.id]);

  const transform = `
    perspective(800px)
    translateX(${op.baseTranslateX}px)
    translateY(${op.baseTranslateY}px)
    rotateY(${op.baseRotate + tilt.y}deg)
    rotateX(${tilt.x}deg)
  `;

  return (
    <div
      ref={cardRef}
      className="absolute"
      style={{ zIndex: op.zIndex, transform, transition: "transform 0.1s ease-out" }}
      onMouseEnter={() => setTooltip(true)}
      onMouseLeave={() => setTooltip(false)}
    >
      {/* Card */}
      <div
        className="relative w-52 cursor-pointer select-none"
        style={{
          background: "rgba(3,5,7,0.85)",
          border: `1px solid ${op.color}30`,
          borderRadius: "16px",
          backdropFilter: "blur(24px)",
          boxShadow: `0 0 40px ${op.color}18, 0 20px 60px rgba(0,0,0,0.6)`,
          padding: "20px",
        }}
      >
        {/* Holographic shimmer strip */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${op.color}80, transparent)`,
          }}
        />

        {/* Avatar */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
            style={{
              background: `${op.color}18`,
              border: `1px solid ${op.color}40`,
              color: op.color,
              fontSize: "16px",
            }}
          >
            {op.avatar}
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-none mb-1">{op.name}</div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
              {op.dept}
            </div>
          </div>
          {/* Online dot */}
          <div className="ml-auto flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: op.color, boxShadow: `0 0 6px ${op.color}` }}
            />
          </div>
        </div>

        {/* Role */}
        <div className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>
          {op.role}
        </div>

        {/* Stat bar */}
        <div
          className="text-xs font-mono px-2 py-1.5 rounded-lg"
          style={{
            background: `${op.color}10`,
            border: `1px solid ${op.color}20`,
            color: op.color,
          }}
        >
          {op.stat}
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 mt-3">
          <div
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: `${op.color}15`, color: op.color, border: `1px solid ${op.color}25` }}
          >
            ● {op.status}
          </div>
        </div>
      </div>

      {/* Glassmorphic Tooltip */}
      {tooltip && (
        <div
          className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap z-50 animate-fade-in-up"
          style={{
            background: "rgba(0,255,148,0.08)",
            border: "1px solid rgba(0,255,148,0.3)",
            backdropFilter: "blur(16px)",
            borderRadius: "10px",
            padding: "8px 14px",
            color: "#00FF94",
            fontSize: "12px",
            fontWeight: 500,
            boxShadow: "0 0 20px rgba(0,255,148,0.15)",
          }}
        >
          {op.metric}
        </div>
      )}
    </div>
  );
};

// ─── Main Hero Section ────────────────────────────────────────────────────────
const HeroSection = () => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handler = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  return (
    <section
      className="relative flex items-center justify-center min-h-screen px-6 overflow-hidden"
      style={{ paddingTop: "100px" }}
    >
      {/* Blueprint grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      {/* Subtle radial glow from center */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "30%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "900px",
          height: "600px",
          background: "radial-gradient(ellipse, rgba(0,255,148,0.04) 0%, transparent 70%)",
        }}
      />

      <div className="max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-16 items-center">
        {/* ── Left Column: Copy ── */}
        <div
          className={`space-y-8 text-center lg:text-left transition-all duration-700 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium"
            style={{
              background: "rgba(0,255,148,0.06)",
              border: "1px solid rgba(0,255,148,0.2)",
              color: "#00FF94",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] animate-pulse shadow-[0_0_6px_#00FF94]" />
            The First AI Workforce Platform
          </div>

          {/* Headline — large serif feel via font-weight + tracking */}
          <h1
            className="text-5xl lg:text-7xl font-black leading-[1.02] tracking-tight text-white"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Hire a{" "}
            <span className="relative inline-block">
              world&#8209;class
              <span
                className="absolute bottom-1 left-0 w-full h-px"
                style={{ background: "linear-gradient(90deg, #00FF94, transparent)" }}
              />
            </span>
            <br />
            team.{" "}
            <span
              className="italic"
              style={{ color: "rgba(255,255,255,0.35)", fontWeight: 300 }}
            >
              Zero headcount.
            </span>
          </h1>

          {/* Sub-headline */}
          <p className="text-lg lg:text-xl leading-relaxed max-w-xl" style={{ color: "rgba(255,255,255,0.55)" }}>
            The first AI workforce platform. Deploy autonomous talent, growth, and intelligence
            agents in{" "}
            <span className="text-white font-semibold">10 minutes.</span>
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 justify-center lg:justify-start">
            {["Scout · Talent", "Aria · Growth", "Penn · Intelligence", "Hawk · Research"].map((pill) => (
              <span
                key={pill}
                className="text-xs px-3 py-1.5 rounded-full font-medium"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                {pill}
              </span>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex items-center gap-4 justify-center lg:justify-start pt-2">
            <button
              onClick={() => navigate("/auth")}
              className="group relative flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm overflow-hidden transition-all duration-300"
              style={{
                background: "rgba(0,255,148,0.12)",
                border: "1px solid rgba(0,255,148,0.4)",
                color: "#00FF94",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(0,255,148,0.2)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 25px rgba(0,255,148,0.25)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(0,255,148,0.12)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              Deploy Your Workforce
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>

            <button
              onClick={() => navigate("/get-demo")}
              className="group flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-300"
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.7)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,148,0.3)";
                (e.currentTarget as HTMLElement).style.color = "#00FF94";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.7)";
              }}
            >
              Meet Your Workforce →
            </button>
          </div>
        </div>

        {/* ── Right Column: 3D Operative Cards ── */}
        <div
          ref={containerRef}
          className="relative flex items-center justify-center"
          style={{ height: "420px" }}
        >
          {/* Soft glow behind cards */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at center, rgba(0,255,148,0.06) 0%, transparent 70%)",
            }}
          />

          {/* Cards */}
          {OPERATIVES.map((op) => (
            <OperativeCard
              key={op.id}
              op={op}
              mouseX={mouse.x}
              mouseY={mouse.y}
              containerRef={containerRef}
            />
          ))}
        </div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          scroll
        </div>
        <div
          className="w-px h-8"
          style={{ background: "linear-gradient(to bottom, rgba(0,255,148,0.4), transparent)" }}
        />
      </div>
    </section>
  );
};

export default HeroSection;
