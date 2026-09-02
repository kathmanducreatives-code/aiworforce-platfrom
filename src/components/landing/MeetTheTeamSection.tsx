import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, MessageSquare, Eye, Radio, PenLine, Send,
  Target, TrendingUp, ArrowRight, ChevronDown, User,
} from 'lucide-react';
import { TOOL_BRANDS, TOOL_LOGO_MAP } from './ToolLogos';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPLOYEE_BY_ID, type EmployeeId } from './employees';
import { EmployeeAvatar } from './EmployeePortrait';

const DEPT = {
  talent: { color: "#34d399", label: "Research", bg: "rgba(52,211,153,0.12)" },
  growth: { color: "#60a5fa", label: "Review", bg: "rgba(96,165,250,0.12)" },
  content: { color: "#a78bfa", label: "Content", bg: "rgba(167,139,250,0.12)" },
  intelligence: { color: "#fbbf24", label: "Signals", bg: "rgba(251,191,36,0.12)" },
  founder: { color: "#e2e8f0", label: "You", bg: "rgba(226,232,240,0.12)" },
} as const;

type DeptKey = keyof typeof DEPT;

interface Agent {
  id: string; name: string; title: string; department: Exclude<DeptKey, "founder">; icon: React.ElementType;
  job: string; tools: string[]; talksTo: string[];
}

// PUBLIC IDENTITIES ONLY. The legacy backend slugs (scout / aria / hawk / penn /
// scribe) still power execution, but `@/config/agentRegistry` states they must
// never be rendered publicly — this simulation used to show all five by name.
const AGENTS: Agent[] = [
  { id: "mira", name: "Lisa", title: "Signal Intelligence", department: "intelligence", icon: Target, job: "Watches hiring, funding, growth and competitor moves, and tells you what changed.", tools: ["firecrawl","perplexity"], talksTo: ["Atlas","Founder"] },
  { id: "atlas", name: "Atlas", title: "Lead Intelligence", department: "talent", icon: Search, job: "Searches the market, matches companies to your ICP, and ranks who is worth your time.", tools: ["apify","firecrawl"], talksTo: ["Lyra","Orion"] },
  { id: "lyra", name: "Lyra", title: "Content Intelligence", department: "content", icon: PenLine, job: "Turns company knowledge and market intelligence into content worth publishing.", tools: ["claude"], talksTo: ["Founder"] },
  { id: "orion", name: "Orion", title: "Executive Intelligence", department: "growth", icon: MessageSquare, job: "Combines what the team found into one short briefing, and says what deserves your attention.", tools: ["claude"], talksTo: ["Founder"] },
];

interface FeedMessage {
  agentId: string; agentName: string; department: DeptKey; tools: string[]; time: string; text: string;
  passedTo?: string; passedToDept?: DeptKey; isFounder?: boolean;
}

const MESSAGES: FeedMessage[] = [
  { agentId: "mira", agentName: "Lisa", department: "intelligence", tools: ["firecrawl","perplexity"], time: "07:00 AM",
    text: "Overnight scan done. A competitor changed their pricing, and two companies in your market raised. Flagging the pricing change for you.",
    passedTo: "You", passedToDept: "founder" },
  { agentId: "founder", agentName: "You", department: "founder", tools: [], time: "07:12 AM", isFounder: true,
    text: "Reviewed. Asked Lyra to draft a response post on our pricing." },
  { agentId: "lyra", agentName: "Lyra", department: "content", tools: ["claude"], time: "07:18 AM",
    text: "Post drafted in your brand voice. Ready for your review.",
    passedTo: "You", passedToDept: "founder" },
  { agentId: "atlas", agentName: "Atlas", department: "talent", tools: ["apify","firecrawl"], time: "09:04 AM",
    text: "Researched 40 companies against your ICP. 12 qualified, ranked by fit, each with the evidence attached.",
    passedTo: "Lyra", passedToDept: "content" },
  { agentId: "lyra", agentName: "Lyra", department: "content", tools: ["claude"], time: "09:14 AM",
    text: "Outreach drafted for the top 3, each referencing the signal that made them relevant. Nothing sends until you approve it.",
    passedTo: "You", passedToDept: "founder" },
  { agentId: "founder", agentName: "You", department: "founder", tools: [], time: "09:22 AM", isFounder: true,
    text: "Drafts look right. Approved. I'll send them from my inbox." },
  { agentId: "atlas", agentName: "Atlas", department: "talent", tools: ["gemini","claude"], time: "11:30 AM",
    text: "Screened this week's applicants against the role. Six worth your time, ranked, with the reasoning for each.",
    passedTo: "Orion", passedToDept: "growth" },
  { agentId: "orion", agentName: "Orion", department: "growth", tools: ["claude"], time: "18:00 PM",
    text: "End of day: 1 outreach approved, 12 companies qualified, 6 candidates shortlisted, 1 competitor alert handled. Your time today: 47 minutes." },
];

const DEPARTMENTS_LIST = [
  { key: "talent" as const, label: "Research", count: 1 },
  { key: "intelligence" as const, label: "Signals", count: 1 },
  { key: "content" as const, label: "Content", count: 1 },
  { key: "growth" as const, label: "Review", count: 1 },
];


const MeetTheTeamSection = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  /** Which way the reader is moving. Drives the enter/exit direction below. */
  const [direction, setDirection] = useState<"down" | "up">("down");

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.05, rootMargin: "-50px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // SCROLL-PINNED REVEAL, read from scroll position rather than ratcheted.
  //
  // This used to be eight IntersectionObservers doing
  // `setCurrentStep(prev => Math.max(prev, i))`. `Math.max` meant the step
  // could only ever go up: scrolling back through the section left the feed
  // fully revealed, the progress rail pinned at 8/8 and the summary bar
  // showing. The section played once and was inert on the way back.
  //
  // Deriving the step from the track's own offset makes it symmetric — the
  // same scroll position always yields the same state, in either direction —
  // and gives us the direction itself, which the animation below needs.
  const stepRef = useRef(-1);
  useEffect(() => {
    if (isMobile) return;
    const track = trackRef.current;
    if (!track) return;

    let frame = 0;
    const read = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / travel));
      // Steps are spread across 94% of the track and the last 6% holds on the
      // final message, so the summary has a beat to land before the pin
      // releases. Spreading them over less than that left a long stretch at
      // the end where scrolling changed nothing, which reads as broken.
      const raw = Math.floor((progress / 0.94) * MESSAGES.length);
      const step = Math.max(-1, Math.min(MESSAGES.length - 1, raw));
      if (step !== stepRef.current) {
        setDirection(step > stepRef.current ? "down" : "up");
        stepRef.current = step;
        setCurrentStep(step);
      }
    };

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isMobile]);

  const visibleMessages = isMobile ? MESSAGES : MESSAGES.slice(0, currentStep + 1);
  const displayMessages = visibleMessages.slice(-5);
  /** Who is speaking right now, and who they are handing to — drives the rail. */
  const activeMessage = currentStep >= 0 ? MESSAGES[Math.min(currentStep, MESSAGES.length - 1)] : null;
  const handoffTarget = activeMessage?.passedTo ?? null;
  const allRevealed = currentStep >= MESSAGES.length - 1;

  return (
    <section id="how-it-works" ref={sectionRef} className="relative w-full overflow-visible" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      {/* Headline — outside the pinned area */}
      <div className="px-4 pt-24 md:pt-32 pb-4">
        <div className="max-w-[1100px] mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.6 }} className="text-center">
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-primary mb-4">A DAY INSIDE AGENTORY</p>
            <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.04em] text-foreground mb-6">
              They work together.<br />You just decide.
            </h2>
            <p className="text-foreground/40 text-base md:text-lg max-w-[600px] mx-auto leading-relaxed">
              Every AI employee has a job, the tools for it, and colleagues they hand work to. When one finds something another should act on, it passes it over — without you setting it up.
            </p>
          </motion.div>
        </div>
      </div>

      {/* War Room — scroll-pinned on desktop */}
      <div ref={trackRef} className="relative" style={{ height: isMobile ? "auto" : "280vh" }}>
        <div className={isMobile ? "" : "sticky top-0 h-screen flex items-center"} style={{ zIndex: 10 }}>
          <div className="max-w-[1100px] mx-auto w-full px-4">
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden relative"
              style={{ background: "linear-gradient(180deg, #0a0e14 0%, #060a10 100%)" }}>
              {/* Chrome bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <span className="font-mono text-[11px] text-foreground/30">Agentory · your AI team</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-[10px] text-primary/60">All systems active</span>
                </div>
              </div>

              <div className="flex">
                {/* Sidebar — desktop only */}
                <div className="w-[200px] border-r border-white/[0.06] p-4 hidden lg:block shrink-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/20 mb-3">THE WORK</p>
                  {DEPARTMENTS_LIST.map(d => (
                    <div key={d.key} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: DEPT[d.key].color }} />
                        <span className="text-xs text-white/50">{d.label}</span>
                      </div>
                      <span className="text-[10px] text-white/20">{d.count}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-1.5 opacity-40">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white/20" />
                      <span className="text-xs text-white/30">More work</span>
                    </div>
                    <span className="text-[9px] text-white/15">Soon</span>
                  </div>
                  {/* HANDOFF RAIL.
                      This column used to end here with four 9px name chips and
                      then ~45% dead height. It now carries the section's whole
                      argument: who is holding the work right now, and who it
                      goes to next. The active employee lifts and lights in
                      their accent colour; the connector below them fills when
                      they hand off. */}
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/20 mt-6 mb-3">THE TEAM</p>
                  <div className="relative">
                    {AGENTS.map((a, ai) => {
                      const employee = EMPLOYEE_BY_ID[a.id as EmployeeId];
                      const active = activeMessage?.agentId === a.id;
                      const handedOn = handoffTarget === a.name;
                      const last = ai === AGENTS.length - 1;
                      return (
                        <div key={a.id} className="relative">
                          <div
                            className="flex items-center gap-2.5 py-1.5 rounded-lg pl-1 pr-2 transition-all duration-500"
                            style={{
                              background: active ? `${employee?.accent ?? "#10b981"}14` : "transparent",
                              transform: active ? "translateX(3px)" : "none",
                            }}
                          >
                            <span
                              className="rounded-full transition-all duration-500 shrink-0"
                              style={{
                                boxShadow: active
                                  ? `0 0 0 2px ${employee?.accent ?? "#10b981"}, 0 0 12px ${employee?.accent ?? "#10b981"}66`
                                  : "none",
                                opacity: active ? 1 : 0.4,
                              }}
                            >
                              {employee && <EmployeeAvatar employee={employee} size={26} ring={false} />}
                            </span>
                            <span className="min-w-0">
                              <span
                                className="block text-[12px] font-semibold leading-tight transition-colors duration-500"
                                style={{ color: active ? employee?.accent ?? "#fff" : "rgba(255,255,255,0.45)" }}
                              >
                                {a.name}
                              </span>
                              <span className="block text-[9px] text-white/25 leading-tight truncate">{a.title}</span>
                            </span>
                          </div>
                          {!last && (
                            <div className="ml-[14px] h-3 w-px bg-white/[0.07] relative overflow-hidden">
                              <div
                                className="absolute inset-x-0 top-0 transition-all duration-500"
                                style={{
                                  height: active || handedOn ? "100%" : "0%",
                                  background: employee?.accent ?? "#10b981",
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Message Feed */}
                <div className="flex-1 min-w-0 relative overflow-hidden" style={{ height: isMobile ? 380 : 470 }}>
                  <div className="absolute top-0 left-0 right-0 h-16 z-10 pointer-events-none"
                    style={{ background: "linear-gradient(to bottom, #0a0e14, transparent)" }} />
                  <div className="p-4 flex flex-col justify-end h-full gap-3">
                    <AnimatePresence mode="popLayout">
                      {displayMessages.map((msg, vi) => {
                        const dept = DEPT[msg.department];
                        const isFounder = msg.isFounder;
                        return (
                          <motion.div key={`${msg.agentId}-${msg.time}`}
                            initial={{ opacity: 0, y: direction === "down" ? 26 : -26, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: direction === "down" ? -18 : 18, scale: 0.985 }}
                            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }} layout
                            className={`rounded-xl border p-4 ${isFounder ? "border-white/[0.1] bg-white/[0.04]" : "border-white/[0.05] bg-white/[0.02]"}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {/* The face, not a glyph — the employee speaking here is the
                                    same character the visitor met in the hero. */}
                                {isFounder ? (
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center"
                                    style={{ backgroundColor: "rgba(226,232,240,0.15)" }}>
                                    <User className="w-3.5 h-3.5 text-white/60" />
                                  </div>
                                ) : (() => {
                                  const employee = EMPLOYEE_BY_ID[msg.agentId as EmployeeId];
                                  return employee ? <EmployeeAvatar employee={employee} size={28} /> : null;
                                })()}
                                <span className="text-xs font-bold" style={{ color: isFounder ? "#e2e8f0" : dept.color }}>{msg.agentName}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: dept.bg, color: dept.color }}>{dept.label}</span>
                              </div>
                              <span className="font-mono text-[10px] text-white/20">{msg.time}</span>
                            </div>
                            {msg.tools.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2.5">
                                {msg.tools.map(t => {
                                  const Logo = TOOL_LOGO_MAP[t];
                                  const brand = TOOL_BRANDS[t];
                                  return (
                                    <span key={t}
                                      className="inline-flex items-center gap-1.5 rounded-md border py-0.5 pl-1 pr-2"
                                      style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }}>
                                      <span className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                                        style={{ backgroundColor: brand?.bg || "#333" }}>
                                        {Logo && <Logo width={10} height={10} />}
                                      </span>
                                      <span className="text-[10px] text-white/45">{brand?.label ?? t}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <p className="text-xs text-white/50 leading-relaxed">{msg.text}</p>
                            {msg.passedTo && msg.passedToDept && (
                              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.3, duration: 0.3 }}
                                className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04]">
                                <ArrowRight className="w-3 h-3 text-white/20" />
                                <span className="text-[10px] text-white/20">Passed to:</span>
                                <span className="text-[10px] font-semibold" style={{ color: DEPT[msg.passedToDept].color }}>
                                  {msg.passedToDept === "founder"
                                    ? msg.passedTo
                                    : `${msg.passedTo} · ${DEPT[msg.passedToDept].label}`}
                                </span>
                              </motion.div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>

                  {/* Scroll indicator */}
                  {!isMobile && !allRevealed && (
                    <div className="absolute bottom-2 left-0 right-0 flex justify-center z-20">
                      <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.5, repeat: Infinity }}
                        className="flex items-center gap-1 text-[10px] text-emerald-400/60 font-mono">
                        <ChevronDown className="w-3 h-3" /> Scroll to continue
                      </motion.div>
                    </div>
                  )}
                </div>

                {/* Progress bar — desktop */}
                {!isMobile && (
                  <div className="w-10 border-l border-white/[0.06] hidden lg:flex flex-col items-center justify-between py-4 shrink-0">
                    <div className="flex-1 w-[3px] bg-white/[0.07] rounded-full relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full rounded-full transition-all duration-500"
                        style={{
                          height: `${(Math.max(0, currentStep + 1) / MESSAGES.length) * 100}%`,
                          background: "linear-gradient(180deg, #34d399 0%, #10b981 100%)",
                          boxShadow: "0 0 8px rgba(16,185,129,0.5)",
                        }} />
                    </div>
                    <span className="text-[10px] text-white/35 font-mono mt-2 tabular-nums">
                      {Math.max(0, Math.min(currentStep + 1, MESSAGES.length))}/{MESSAGES.length}
                    </span>
                  </div>
                )}
              </div>

              {/* Summary stats — after all revealed */}
              {!isMobile && allRevealed && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}
                  className="border-t border-white/[0.06] px-6 py-4">
                  <div className="flex items-center justify-center gap-8 text-center">
                    {[
                      { value: "47min", label: "Your time today" },
                      { value: "12", label: "Companies qualified" },
                      { value: "3", label: "Drafts to review" },
                      { value: "4", label: "Decisions you made" },
                    ].map(s => (
                      <div key={s.label}>
                        <div className="font-mono font-bold text-lg text-emerald-400">{s.value}</div>
                        <div className="text-[9px] text-white/30 uppercase tracking-wider">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Closing */}
      <div className="max-w-[1100px] mx-auto px-4 pt-8 pb-20">
        <div className="text-center max-w-[560px] mx-auto">
          <p className="font-display text-xl md:text-2xl text-white/80 leading-snug mb-2">
            This is not software.<br />This is your team.<br />They started work<br />the moment you signed up.
          </p>
          <p className="text-white/30 text-sm mb-8">Stop managing tools. Start handing over the work.</p>
          <button onClick={() => navigate('/auth')} className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]">
            Put Agentory to work <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default MeetTheTeamSection;
