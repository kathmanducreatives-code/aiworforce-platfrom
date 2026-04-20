import { useEffect, useRef, useState } from "react";

const AGENTS = [
  { name: "Scout", dept: "Talent", color: "#00FF94", avatar: "S", left: "10%", top: "50%" },
  { name: "Aria",  dept: "Growth", color: "#05CFAA", avatar: "A", left: "37%", top: "50%" },
  { name: "Penn",  dept: "Intel",  color: "#059652", avatar: "P", left: "63%", top: "50%" },
  { name: "Hawk",  dept: "Research", color: "#00D4AA", avatar: "H", left: "90%", top: "50%" },
];

const ORG_SLOTS = [
  { label: "Head of Talent",      left: "10%", top: "50%" },
  { label: "Head of Growth",      left: "37%", top: "50%" },
  { label: "Head of Intelligence",left: "63%", top: "50%" },
  { label: "Head of Research",    left: "90%", top: "50%" },
];

export default function AssemblyLineSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0); // 0 = empty chart, 1 = agents slide in, 2 = brain lines

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Stagger phase transitions via setTimeout
            setPhase(0);
            setTimeout(() => setPhase(1), 600);
            setTimeout(() => setPhase(2), 1800);
          } else {
            setPhase(0);
          }
        });
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-32 px-6 overflow-hidden"
      style={{ background: "#030507" }}
    >
      {/* Blueprint grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-20">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-6"
            style={{
              background: "rgba(0,255,148,0.06)",
              border: "1px solid rgba(0,255,148,0.2)",
              color: "#00FF94",
            }}
          >
            How It Works
          </div>
          <h2
            className="text-4xl lg:text-5xl font-black text-white leading-tight"
          >
            Your org chart.
            <br />
            <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 300, fontStyle: "italic" }}>
              AI&#8209;staffed.
            </span>
          </h2>
          <p className="mt-4 text-lg max-w-xl mx-auto" style={{ color: "rgba(255,255,255,0.45)" }}>
            Watch your departments go from empty requisitions to fully autonomous AI operatives.
          </p>
        </div>

        {/* Phase labels */}
        <div className="flex justify-center gap-8 mb-12">
          {[
            { n: 1, label: "Open Requisitions" },
            { n: 2, label: "Deployment" },
            { n: 3, label: "Company Brain" },
          ].map(({ n, label }) => (
            <div
              key={n}
              className="flex items-center gap-2 text-sm transition-all duration-500"
              style={{ color: phase >= n - 1 ? "#00FF94" : "rgba(255,255,255,0.25)" }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500"
                style={{
                  background: phase >= n - 1 ? "rgba(0,255,148,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${phase >= n - 1 ? "rgba(0,255,148,0.4)" : "rgba(255,255,255,0.1)"}`,
                }}
              >
                {n}
              </div>
              {label}
            </div>
          ))}
        </div>

        {/* Org Chart Canvas */}
        <div
          className="relative w-full mx-auto"
          style={{
            height: "300px",
            background: "rgba(255,255,255,0.015)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "20px",
            overflow: "hidden",
          }}
        >
          {/* "CEO / Platform" node at top-center */}
          <div
            className="absolute"
            style={{ top: "18%", left: "50%", transform: "translate(-50%,-50%)" }}
          >
            <div
              className="px-4 py-2 rounded-xl text-xs font-semibold text-center"
              style={{
                background: "rgba(0,255,148,0.1)",
                border: "1px solid rgba(0,255,148,0.3)",
                color: "#00FF94",
                whiteSpace: "nowrap",
              }}
            >
              ScreeningPilot Platform
            </div>
          </div>

          {/* Vertical line from CEO to horizontal bar */}
          <div
            className="absolute"
            style={{
              top: "26%",
              left: "50%",
              width: "1px",
              height: "10%",
              background: "rgba(0,255,148,0.25)",
              transform: "translateX(-50%)",
            }}
          />

          {/* Horizontal connector bar */}
          <div
            className="absolute"
            style={{
              top: "36%",
              left: "10%",
              right: "10%",
              height: "1px",
              background: "rgba(0,255,148,0.2)",
            }}
          />

          {/* Company Brain glowing connector (phase 2) */}
          {phase === 2 && (
            <div
              className="absolute"
              style={{
                top: "36%",
                left: "10%",
                right: "10%",
                height: "2px",
                background: "linear-gradient(90deg, #00FF94, #05CFAA, #059652, #00D4AA)",
                boxShadow: "0 0 12px rgba(0,255,148,0.6), 0 0 24px rgba(0,255,148,0.3)",
                animation: "brainLine 1.5s ease-out",
                borderRadius: "2px",
              }}
            />
          )}

          {/* Slot columns */}
          {ORG_SLOTS.map((slot, i) => {
            const agent = AGENTS[i];
            const deployed = phase >= 1;
            const brainActive = phase === 2;

            return (
              <div
                key={slot.label}
                className="absolute flex flex-col items-center gap-2"
                style={{
                  left: slot.left,
                  top: "36%",
                  transform: "translateX(-50%)",
                }}
              >
                {/* Vertical drop line */}
                <div
                  style={{
                    width: "1px",
                    height: "32px",
                    background: `rgba(0,255,148,${deployed ? "0.25" : "0.12"})`,
                    transition: "background 0.6s",
                  }}
                />

                {/* Empty slot → Agent card */}
                <div
                  className="w-28 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-700"
                  style={{
                    height: "90px",
                    background: deployed
                      ? `rgba(${i === 0 ? "0,255,148" : i === 1 ? "5,207,170" : i === 2 ? "5,150,82" : "0,212,170"},0.08)`
                      : "rgba(255,255,255,0.025)",
                    border: deployed
                      ? `1px solid ${agent.color}35`
                      : "1px dashed rgba(255,255,255,0.15)",
                    boxShadow: brainActive ? `0 0 20px ${agent.color}20` : "none",
                    transform: deployed ? "scale(1)" : "scale(0.95)",
                    opacity: 1,
                  }}
                >
                  {!deployed ? (
                    <>
                      <div
                        className="text-xs font-mono"
                        style={{ color: "rgba(255,255,255,0.25)" }}
                      >
                        [ OPEN ]
                      </div>
                      <div className="text-xs text-center px-2" style={{ color: "rgba(255,255,255,0.2)" }}>
                        {slot.label}
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm"
                        style={{
                          background: `${agent.color}18`,
                          border: `1px solid ${agent.color}40`,
                          color: agent.color,
                        }}
                      >
                        {agent.avatar}
                      </div>
                      <div className="text-white font-semibold text-xs">{agent.name}</div>
                      <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {agent.dept}
                      </div>
                      {brainActive && (
                        <div
                          className="w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ background: agent.color, boxShadow: `0 0 6px ${agent.color}` }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* "Company Brain" label overlay at phase 2 */}
          {phase === 2 && (
            <div
              className="absolute left-1/2 -translate-x-1/2 animate-fade-in-up"
              style={{ bottom: "12px" }}
            >
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold"
                style={{
                  background: "rgba(0,255,148,0.1)",
                  border: "1px solid rgba(0,255,148,0.35)",
                  color: "#00FF94",
                  boxShadow: "0 0 20px rgba(0,255,148,0.2)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] animate-pulse shadow-[0_0_6px_#00FF94]" />
                Shared Company Brain — Active
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes brainLine {
          from { opacity: 0; transform: scaleX(0); transform-origin: left; }
          to   { opacity: 1; transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </section>
  );
}
