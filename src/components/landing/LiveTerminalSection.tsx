import { useEffect, useRef, useState } from "react";

// Feed messages simulating agent work streams
const FEED: Array<{ agent: string; color: string; message: string; delay: number }> = [
  { agent: "Scout",  color: "#00FF94", message: "Sourced 42 new leads from LinkedIn · Senior Engineers",      delay: 0 },
  { agent: "Aria",   color: "#05CFAA", message: "Screened 12 candidates · Avg fit score 94%",                 delay: 1600 },
  { agent: "Hawk",   color: "#00D4AA", message: "Competitor pricing changed · Greenhouse +12% · flagged",     delay: 3200 },
  { agent: "Penn",   color: "#059652", message: "Market intel: AI Engineer demand up 34% this quarter",        delay: 4800 },
  { agent: "Scout",  color: "#00FF94", message: "Outreach sent to 8 passive candidates · 3 opened",           delay: 6400 },
  { agent: "Aria",   color: "#05CFAA", message: "Interview scheduled with Jordan M. · Fri 10:00 AM",          delay: 8000 },
  { agent: "Hawk",   color: "#00D4AA", message: "New job posting detected at Stripe · SWE II · $200k",        delay: 9600 },
  { agent: "Penn",   color: "#059652", message: "Report compiled: Q2 Talent Pipeline · 18 pages",             delay: 11200 },
  { agent: "Scout",  color: "#00FF94", message: "Candidate Priya S. replied · moving to offer stage",         delay: 12800 },
  { agent: "Aria",   color: "#05CFAA", message: "Email sequence opened by 71% · 14 replies received",         delay: 14400 },
];

interface FeedLine {
  agent: string;
  color: string;
  message: string;
  timestamp: string;
  typed: string;
  done: boolean;
}

function getTimestamp() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

export default function LiveTerminalSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [started, setStarted] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const startFeed = () => {
    if (started) return;
    setStarted(true);
    setLines([]);

    FEED.forEach((item, idx) => {
      const t = setTimeout(() => {
        const newLine: FeedLine = {
          ...item,
          timestamp: getTimestamp(),
          typed: "",
          done: false,
        };

        setLines((prev) => [...prev, newLine]);

        // Typewriter effect per character
        let charIdx = 0;
        const typeTimer = setInterval(() => {
          charIdx++;
          setLines((prev) =>
            prev.map((l, i) =>
              i === prev.length - 1 ? { ...l, typed: item.message.slice(0, charIdx) } : l
            )
          );
          if (charIdx >= item.message.length) {
            clearInterval(typeTimer);
            setLines((prev) =>
              prev.map((l, i) => (i === prev.length - 1 ? { ...l, done: true } : l))
            );
          }
        }, 18);
        timers.current.push(typeTimer as unknown as ReturnType<typeof setTimeout>);

        // Auto scroll
        setTimeout(() => {
          terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" });
        }, 50);
      }, item.delay);

      timers.current.push(t);
    });

    // Loop after all messages
    const loopTimer = setTimeout(() => {
      timers.current.forEach(clearTimeout);
      setStarted(false);
    }, 17000);
    timers.current.push(loopTimer);
  };

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) startFeed();
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-32 px-6 overflow-hidden"
      style={{ background: "#030507" }}
    >
      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-6"
            style={{
              background: "rgba(0,255,148,0.06)",
              border: "1px solid rgba(0,255,148,0.2)",
              color: "#00FF94",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] animate-pulse shadow-[0_0_6px_#00FF94]" />
            Live Activity Feed
          </div>
          <h2 className="text-4xl lg:text-5xl font-black text-white leading-tight">
            Your agents,{" "}
            <span
              style={{ color: "rgba(255,255,255,0.35)", fontWeight: 300, fontStyle: "italic" }}
            >
              always working.
            </span>
          </h2>
          <p className="mt-4 text-lg max-w-lg mx-auto" style={{ color: "rgba(255,255,255,0.45)" }}>
            Not a mockup. This is exactly what the activity feed looks like inside your workspace.
          </p>
        </div>

        {/* Terminal Window */}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: "rgba(3,5,7,0.95)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(24px)",
            boxShadow: "0 0 80px rgba(0,255,148,0.06), 0 40px 120px rgba(0,0,0,0.8)",
          }}
        >
          {/* Title bar */}
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: "#FF5F57" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#FFBD2E" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#28C840" }} />
            </div>
            <span className="text-xs font-mono ml-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              screeningpilot — live agent activity
            </span>
            {/* Live dot */}
            <div className="ml-auto flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: "#00FF94", boxShadow: "0 0 6px #00FF94" }}
              />
              <span className="text-xs font-mono" style={{ color: "#00FF94" }}>
                LIVE
              </span>
            </div>
          </div>

          {/* Feed body */}
          <div
            ref={terminalRef}
            className="p-6 font-mono text-sm space-y-3 overflow-y-auto"
            style={{ minHeight: "380px", maxHeight: "420px" }}
          >
            {/* Prompt line at top */}
            <div style={{ color: "rgba(255,255,255,0.2)" }}>
              <span style={{ color: "#00FF94" }}>$</span> screeningpilot stream --agents=all --live
            </div>

            {lines.map((line, i) => (
              <div
                key={i}
                className="flex items-start gap-3 animate-fade-in-up"
                style={{ animationDuration: "0.3s" }}
              >
                {/* Timestamp */}
                <span className="shrink-0 text-xs pt-0.5" style={{ color: "rgba(255,255,255,0.2)", minWidth: "56px" }}>
                  {line.timestamp}
                </span>

                {/* Agent badge */}
                <span
                  className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-md"
                  style={{
                    background: `${line.color}15`,
                    border: `1px solid ${line.color}30`,
                    color: line.color,
                    minWidth: "52px",
                    textAlign: "center",
                  }}
                >
                  {line.agent}
                </span>

                {/* Message with cursor */}
                <span style={{ color: "rgba(255,255,255,0.8)" }}>
                  {line.typed}
                  {!line.done && (
                    <span
                      className="inline-block w-0.5 h-4 ml-0.5 align-middle"
                      style={{
                        background: "#00FF94",
                        animation: "blink 0.7s step-end infinite",
                      }}
                    />
                  )}
                </span>
              </div>
            ))}

            {lines.length === 0 && (
              <div style={{ color: "rgba(255,255,255,0.2)" }}>Connecting to agent stream...</div>
            )}
          </div>

          {/* Green glow reflection at bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none"
            style={{
              background: "linear-gradient(to top, rgba(0,255,148,0.04), transparent)",
            }}
          />
        </div>

        {/* Replay button */}
        <div className="text-center mt-6">
          <button
            onClick={() => {
              timers.current.forEach(clearTimeout);
              setStarted(false);
              setLines([]);
              setTimeout(startFeed, 200);
            }}
            className="text-xs px-4 py-2 rounded-lg transition-all duration-200"
            style={{
              color: "rgba(255,255,255,0.35)",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#00FF94")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)")}
          >
            ↺ Replay Feed
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </section>
  );
}
