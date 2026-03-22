import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, MessageSquare, Eye, Radio, PenLine, Send,
  Target, TrendingUp, FileText, Brain, GitBranch, Crown, ArrowRight,
} from 'lucide-react';
import { TOOL_BRANDS, TOOL_LOGO_MAP } from './ToolLogos';
import { useIsMobile } from '@/hooks/use-mobile';

// Department colors
const DEPT = {
  talent:       { color: "#34d399", label: "Talent",       bg: "rgba(52,211,153,0.12)" },
  growth:       { color: "#60a5fa", label: "Growth",       bg: "rgba(96,165,250,0.12)" },
  content:      { color: "#a78bfa", label: "Content",      bg: "rgba(167,139,250,0.12)" },
  intelligence: { color: "#fbbf24", label: "Intelligence", bg: "rgba(251,191,36,0.12)" },
} as const;

type DeptKey = keyof typeof DEPT;

interface Agent {
  id: string;
  name: string;
  title: string;
  department: DeptKey;
  icon: React.ElementType;
  job: string;
  tools: string[];
  talksTo: string[];
}

const AGENTS: Agent[] = [
  { id: "scout", name: "Scout", title: "Talent Scout Agent", department: "talent", icon: Search, job: "Finds candidates matching your ICP across LinkedIn while you sleep.", tools: ["apify", "firecrawl"], talksTo: ["Aria"] },
  { id: "aria", name: "Aria", title: "AI Screening Agent", department: "talent", icon: MessageSquare, job: "Runs async AI interviews with every applicant. Scores answers across 12 criteria.", tools: ["gemini", "claude"], talksTo: ["Lens"] },
  { id: "lens", name: "Lens", title: "People Analyst Agent", department: "talent", icon: Eye, job: "Reads behavioral signals CVs never show. Flags ownership, clarity, culture fit.", tools: ["gemini", "claude"], talksTo: ["Founder"] },
  { id: "radar", name: "Radar", title: "Lead Intelligence Agent", department: "growth", icon: Radio, job: "Monitors funding news, job postings, and LinkedIn for warm leads daily.", tools: ["firecrawl", "apify", "perplexity"], talksTo: ["Penn"] },
  { id: "penn", name: "Penn", title: "Outreach Copywriter Agent", department: "growth", icon: PenLine, job: "Writes personalized cold emails referencing the exact trigger that made this lead hot.", tools: ["claude"], talksTo: ["Relay"] },
  { id: "relay", name: "Relay", title: "Outreach Coordinator Agent", department: "growth", icon: Send, job: "Sends at optimal time, tracks replies, triggers follow-ups automatically.", tools: ["instantly", "hunter"], talksTo: ["Signal"] },
  { id: "hawk", name: "Hawk", title: "Competitor Monitor Agent", department: "intelligence", icon: Target, job: "Watches competitor pricing, hiring, product, and reviews around the clock.", tools: ["firecrawl", "perplexity"], talksTo: ["Quill", "Brief"] },
  { id: "signal", name: "Signal", title: "Market Intelligence Agent", department: "intelligence", icon: TrendingUp, job: "Tracks talent markets, salary benchmarks, and industry funding movements.", tools: ["firecrawl", "perplexity", "gpt4"], talksTo: ["Radar", "Brief"] },
  { id: "brief", name: "Brief", title: "Morning Brief Agent", department: "intelligence", icon: FileText, job: "Synthesizes everything into a 3-minute daily report. Delivered at 7am. Every day.", tools: ["claude"], talksTo: ["Founder"] },
];

interface FeedMessage {
  agentId: string;
  agentName: string;
  department: DeptKey;
  tools: string[];
  time: string;
  text: string;
  passedTo?: string;
  passedToDept?: DeptKey;
}

const MESSAGES: FeedMessage[] = [
  { agentId: "signal", agentName: "Signal", department: "intelligence", tools: ["firecrawl", "perplexity"], time: "07:04 AM", text: "Market scan complete. Series A funding up 34% this week in SaaS. Identified 12 companies that raised in last 48 hours with 3+ open engineering roles. Passing high-priority leads to Radar.", passedTo: "Radar", passedToDept: "growth" },
  { agentId: "radar", agentName: "Radar", department: "growth", tools: ["firecrawl", "apify"], time: "07:06 AM", text: "Received 12 leads from Signal. Running deep enrichment on each. Found decision makers for 9 of 12. Top lead: Acme Corp — €8M Series A, James Park Co-Founder. Trigger score: 28/30.", passedTo: "Penn", passedToDept: "growth" },
  { agentId: "penn", agentName: "Penn", department: "growth", tools: ["claude"], time: "07:09 AM", text: "Outreach drafted for James Park using Acme's Series A trigger + his LinkedIn post as the hook. References his exact words: 'hiring is about to become my full time job'. Brand voice check: passed.", passedTo: "Relay", passedToDept: "growth" },
  { agentId: "scout", agentName: "Scout", department: "talent", tools: ["apify", "firecrawl"], time: "07:11 AM", text: "ICP lookalike scan complete for Senior Engineer role. 127 candidates found across LinkedIn matching your profile. Similarity scores: 6 above 90%, 18 above 80%.", passedTo: "Aria", passedToDept: "talent" },
  { agentId: "hawk", agentName: "Hawk", department: "intelligence", tools: ["firecrawl", "perplexity"], time: "07:15 AM", text: "Competitor alert: Ashby dropped Starter plan pricing by 22% — detected 40 minutes ago on their /pricing page. Previous: €49/month. Current: €38/month. This is their 3rd price change in 90 days.", passedTo: "Brief", passedToDept: "intelligence" },
  { agentId: "relay", agentName: "Relay", department: "growth", tools: ["instantly"], time: "07:19 AM", text: "Email to james@acmecorp.com delivered. Open tracking active. Subject: 'saw the Series A this morning' — 31% above average open rate for this subject line format. Follow-up scheduled Thursday 9am." },
  { agentId: "brief", agentName: "Brief", department: "intelligence", tools: ["claude"], time: "07:21 AM", text: "Morning brief compiled. Today's priorities: 1. James Park reply likely within 4hrs. 2. Competitor pricing change — response drafted. 3. 24 candidates in screening. Your attention needed: 2 items. Estimated review time: 8 minutes." },
  { agentId: "aria", agentName: "Aria", department: "talent", tools: ["gemini", "claude"], time: "09:31 AM", text: "Screening 127 candidates asynchronously. AI interviews running in background. Candidates complete at their own pace. 14 completed so far — 3 scoring above 85%. Results ready by morning.", passedTo: "Lens", passedToDept: "talent" },
];

const DEPARTMENTS = [
  { key: "talent" as DeptKey, label: "Talent", count: 3 },
  { key: "growth" as DeptKey, label: "Growth", count: 3 },
  { key: "content" as DeptKey, label: "Content", count: 2 },
  { key: "intelligence" as DeptKey, label: "Intelligence", count: 3 },
];

const truths = [
  { icon: Brain, title: "One brain. Every agent knows everything.", body: "Tell ScreeningPilot about your company once. Your brand voice, your ICP, your competitors, your goals. From that moment every agent operates with full context — permanently. What you tell one, all of them remember." },
  { icon: GitBranch, title: "They pass work to each other. You just decide.", body: "Scout finds candidates and passes them to Aria. Hawk spots a competitor move and tells Quill to draft a response. Radar finds a lead and Penn writes the email. The handoffs happen automatically — no configuration, no prompting, no tab switching." },
  { icon: Crown, title: "You are the only human in the room.", body: "Your agents brief each other, execute the work, and surface only what needs a human decision. Eight minutes of reviewing their outputs replaces eight hours of doing the work yourself. You are the founder making calls — not the intern running between desks." },
];

const MeetTheTeamSection = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.1, rootMargin: "-50px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative w-full px-4 py-24 md:py-36 overflow-hidden">
      <div className="max-w-[1100px] mx-auto">
        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          viewport={{ once: true, margin: "-50px" }}
          className="text-center mb-16"
        >
          <p className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4">YOUR AI WORKFORCE</p>
          <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.04em] text-white mb-6">
            Meet the team running<br />your company right now.
          </h2>
          <p className="text-white/40 text-base md:text-lg max-w-[600px] mx-auto leading-relaxed">
            Every agent has a role, a set of tools, and colleagues they work with. They pass information between departments automatically. You hired them all for €149/month.
          </p>
        </motion.div>

        {/* War Room */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="rounded-2xl border border-white/[0.08] overflow-hidden mb-20"
          style={{ background: "linear-gradient(180deg, #0a0e14 0%, #060a10 100%)" }}
        >
          {/* Chrome bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
            </div>
            <span className="font-mono text-[11px] text-white/30">ScreeningPilot Internal · 5 agents online</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[10px] text-emerald-400/60">All systems active</span>
            </div>
          </div>

          <div className="flex">
            {/* Sidebar — desktop only */}
            {!isMobile && (
              <div className="w-[200px] border-r border-white/[0.06] p-4 hidden lg:block shrink-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/20 mb-3">DEPARTMENTS</p>
                {DEPARTMENTS.map(d => (
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
                    <span className="text-xs text-white/30">Engineering</span>
                  </div>
                  <span className="text-[9px] text-white/15">Soon</span>
                </div>

                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/20 mt-6 mb-3">AGENTS ONLINE</p>
                <div className="flex flex-wrap gap-1">
                  {AGENTS.map(a => (
                    <span key={a.id} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/30">
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 min-w-0">
              <MessageFeed inView={inView} isMobile={isMobile} />
            </div>
          </div>
        </motion.div>

        {/* Agent Profile Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-20">
          {AGENTS.map((agent, i) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: DEPT[agent.department].bg }}>
                    <agent.icon className="w-5 h-5" style={{ color: DEPT[agent.department].color }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{agent.name}</p>
                    <p className="text-[10px] text-white/30">{agent.title}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] text-emerald-400/60 font-mono">ACTIVE</span>
                </div>
              </div>

              <p className="text-xs text-white/40 leading-relaxed mb-4">{agent.job}</p>

              <div className="flex items-center gap-2 mb-3">
                <span className="text-[9px] text-white/20 uppercase tracking-wider">Tools</span>
                <div className="flex gap-1">
                  {agent.tools.map(t => {
                    const Logo = TOOL_LOGO_MAP[t];
                    return (
                      <div key={t} className="w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: TOOL_BRANDS[t]?.bg || "#333", border: "1px solid rgba(255,255,255,0.06)" }}>
                        {Logo && <Logo width={14} height={14} />}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-white/20 uppercase tracking-wider">Talks to</span>
                {agent.talksTo.map(name => {
                  const target = AGENTS.find(a => a.name === name);
                  const color = target ? DEPT[target.department].color : "#6b7280";
                  return (
                    <span key={name} className="text-[10px] font-medium" style={{ color }}>
                      {name}
                    </span>
                  );
                })}
                {agent.talksTo.includes("Founder") && (
                  <span className="text-[10px] font-medium text-white/50">Founder</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Three Truth Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12 mb-20">
          {truths.map((t, i) => {
            const Icon = t.icon;
            return (
              <motion.div key={t.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="text-center md:text-left"
              >
                <Icon className="w-7 h-7 text-emerald-400 mb-4 mx-auto md:mx-0" />
                <h3 className="font-display font-bold text-white text-lg mb-2">{t.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{t.body}</p>
              </motion.div>
            );
          })}
        </div>

        {/* Closing */}
        <div className="text-center max-w-[560px] mx-auto">
          <p className="font-display text-xl md:text-2xl text-white/80 leading-snug mb-2">
            This is not software.<br />This is your team.<br />They started work<br />the moment you signed up.
          </p>
          <p className="text-white/30 text-sm mb-8">Stop managing tools. Start leading a workforce.</p>
          <button onClick={() => navigate('/auth')} className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]">
            Meet your workforce <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
};

// Auto-cycling message feed
const MessageFeed = ({ inView, isMobile }: { inView: boolean; isMobile: boolean }) => {
  const maxVisible = isMobile ? 3 : 4;
  const [visibleRange, setVisibleRange] = useState<number[]>([]);

  useEffect(() => {
    if (!inView) return;
    // Start with first message
    setVisibleRange([0]);

    const interval = setInterval(() => {
      setVisibleRange(prev => {
        const nextIdx = prev.length > 0 ? (prev[prev.length - 1] + 1) % MESSAGES.length : 0;
        const next = [...prev, nextIdx];
        if (next.length > maxVisible) next.shift();
        return next;
      });
    }, 2200);

    return () => clearInterval(interval);
  }, [inView, maxVisible]);

  return (
    <div className="relative overflow-hidden" style={{ height: isMobile ? 320 : 400 }}>
      {/* Top fade */}
      <div className="absolute top-0 left-0 right-0 h-12 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, #0a0e14, transparent)" }} />

      <div className="p-4 flex flex-col justify-end h-full gap-3">
        <AnimatePresence mode="popLayout">
          {visibleRange.map(idx => {
            const msg = MESSAGES[idx];
            const dept = DEPT[msg.department];
            return (
              <motion.div
                key={`${msg.agentId}-${idx}-${visibleRange.indexOf(idx)}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                layout
                className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: dept.bg }}>
                      {(() => {
                        const agent = AGENTS.find(a => a.id === msg.agentId);
                        if (!agent) return null;
                        const Icon = agent.icon;
                        return <Icon className="w-3.5 h-3.5" style={{ color: dept.color }} />;
                      })()}
                    </div>
                    <span className="text-xs font-bold" style={{ color: dept.color }}>{msg.agentName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: dept.bg, color: dept.color }}>{dept.label}</span>
                  </div>
                  <span className="font-mono text-[10px] text-white/20">{msg.time}</span>
                </div>

                {/* Tool pills */}
                <div className="flex gap-1 mb-2">
                  {msg.tools.map(t => {
                    const Logo = TOOL_LOGO_MAP[t];
                    return (
                      <div key={t} className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: TOOL_BRANDS[t]?.bg || "#333" }}>
                        {Logo && <Logo width={11} height={11} />}
                      </div>
                    );
                  })}
                </div>

                {/* Text */}
                <p className="text-xs text-white/50 leading-relaxed">{msg.text}</p>

                {/* Passed to */}
                {msg.passedTo && msg.passedToDept && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3, duration: 0.3 }}
                    className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04]"
                  >
                    <ArrowRight className="w-3 h-3 text-white/20" />
                    <span className="text-[10px] text-white/20">Passed to:</span>
                    <span className="text-[10px] font-semibold" style={{ color: DEPT[msg.passedToDept].color }}>
                      {msg.passedTo} · {DEPT[msg.passedToDept].label}
                    </span>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MeetTheTeamSection;
