import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ClaudeLogo, FirecrawlLogo, InstantlyLogo, ApifyLogo, GeminiLogo, ReplicateLogo, ElevenLabsLogo, PerplexityLogo, NotionLogo, LinearLogo, GitHubLogo } from "./ToolLogos";
import { EMPLOYEE_BY_ID, type EmployeeId } from './employees';
import { EmployeeAvatar } from './EmployeePortrait';

interface DeptCard {
  emoji: string;
  /** Which AI employees do this kind of work. More than one where it needs a handoff. */
  owners?: EmployeeId[];
  name: string;
  room: string;
  tools: { Logo: React.FC<{ width?: number; height?: number }>; name: string }[];
  activities: { done: boolean; text: string }[];
  comingSoon?: boolean;
}

const DEPARTMENTS: DeptCard[] = [
  {
    emoji: "🎯", name: "Research & Recruiting", room: "talent", owners: ["atlas"],
    tools: [
      { Logo: ClaudeLogo, name: "Claude" }, { Logo: GeminiLogo, name: "Gemini" },
      { Logo: ApifyLogo, name: "Apify" }, { Logo: FirecrawlLogo, name: "Firecrawl" },
    ],
    activities: [
      { done: true, text: "Atlas researched 34 companies matching your ICP" },
      { done: true, text: "Atlas qualified 28 of them against your criteria" },
      { done: false, text: "Atlas ranking the strongest 8 by fit" },
      { done: true, text: "Shortlist ready: 6 candidates ranked for review" },
      { done: false, text: "Atlas reviewing this week's applicants for the open role" },
      { done: true, text: "Market salary for this role: $145k–$190k" },
    ],
  },
  {
    emoji: "📣", name: "Leads & Outreach", room: "growth", owners: ["lyra", "atlas", "mira"],
    tools: [
      { Logo: ClaudeLogo, name: "Claude" }, { Logo: FirecrawlLogo, name: "Firecrawl" },
      { Logo: InstantlyLogo, name: "Instantly" }, { Logo: ApifyLogo, name: "Apify" },
    ],
    activities: [
      { done: true, text: "Lyra flagged Acme Corp — funding signal" },
      { done: true, text: "Mira drafted outreach referencing that signal" },
      { done: false, text: "Mira drafting follow-ups for 12 leads in queue" },
      { done: true, text: "Reply detected from TechFlow Inc — flagging urgent" },
      { done: false, text: "Orion queueing 47 leads for your review" },
      { done: true, text: "Outreach drafts ready for 3 warm leads" },
    ],
  },
  {
    emoji: "🎨", name: "Content", room: "content", owners: ["mira"],
    tools: [
      { Logo: ClaudeLogo, name: "Claude" }, { Logo: ReplicateLogo, name: "Replicate" },
      { Logo: ElevenLabsLogo, name: "ElevenLabs" },
    ],
    activities: [
      { done: true, text: "Mira wrote a LinkedIn post in your brand voice" },
      { done: false, text: "Mira drafting a newsletter for tomorrow" },
      { done: true, text: "Mira queued 3 pieces of content this week" },
      { done: true, text: "Brand voice check passed: 98% consistency score" },
      { done: false, text: "Repurposing last week's top post into 3 formats" },
      { done: true, text: "Cold email sequence drafted: 5 emails, 3 subjects" },
    ],
  },
  {
    emoji: "🔍", name: "Signals & Monitoring", room: "intelligence", owners: ["lyra"],
    tools: [
      { Logo: FirecrawlLogo, name: "Firecrawl" }, { Logo: PerplexityLogo, name: "Perplexity" },
      { Logo: ClaudeLogo, name: "Claude" }, { Logo: NotionLogo, name: "Notion" },
    ],
    activities: [
      { done: true, text: "Lyra detected a competitor pricing change" },
      { done: true, text: "Lyra refreshed hiring and market data" },
      { done: true, text: "Lyra delivered the morning brief — 3 signals found" },
      { done: false, text: "Lyra scanning 23 competitor job postings" },
      { done: true, text: "3 companies in your space raised this week" },
      { done: true, text: "Weekly intelligence report saved to Notion" },
    ],
  },
  {
    emoji: "⚙️", name: "Engineering", room: "engineering", comingSoon: true,
    tools: [
      { Logo: ClaudeLogo, name: "Claude" }, { Logo: GitHubLogo, name: "GitHub" },
      { Logo: LinearLogo, name: "Linear" },
    ],
    activities: [
      { done: false, text: "Code generation from plain English" },
      { done: false, text: "Linear tickets from feature descriptions" },
      { done: false, text: "PR review and documentation" },
      { done: false, text: "Technical spec writing from requirements" },
    ],
  },
];

const ActivityFeed = ({ activities, comingSoon }: { activities: DeptCard["activities"]; comingSoon?: boolean }) => {
  const [idx, setIdx] = useState(0);
  const count = comingSoon ? activities.length : 3;

  useEffect(() => {
    if (comingSoon) return;
    const interval = setInterval(() => {
      setIdx(prev => (prev + 1) % (activities.length - count + 1));
    }, 3000);
    return () => clearInterval(interval);
  }, [activities.length, count, comingSoon]);

  const visible = activities.slice(idx, idx + count);

  return (
    <div className="space-y-2 min-h-[72px]">
      <AnimatePresence mode="popLayout">
        {visible.map((a, i) => (
          <motion.div key={`${idx}-${i}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}
            className={`flex items-start gap-2 text-xs ${comingSoon ? "opacity-40" : ""}`}>
            {a.done ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> : <Loader className="w-3.5 h-3.5 text-white/30 shrink-0 mt-0.5 animate-spin" />}
            <span className="text-white/50">{a.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const TeamsAtWorkSection = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="the-work" ref={sectionRef} className="relative z-10 py-24 md:py-32">
      <div className="max-w-[1100px] mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">WHAT AGENTORY HANDLES</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            The work you can hand over.<br />All of it sharing one company context.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            Research, leads, signals, content, outreach, recruiting and company intelligence — handled by AI employees who all know your business. More kinds of work as Agentory grows.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {DEPARTMENTS.map((dept, di) => (
            <motion.div key={dept.room} initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: di * 0.1 }}
              className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 ${dept.comingSoon ? "opacity-60" : ""} ${di === 4 ? "md:col-span-2 md:max-w-[540px] md:mx-auto" : ""}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{dept.emoji}</span>
                  <span className="font-display font-bold text-sm text-white">{dept.name}</span>
                </div>
                {dept.comingSoon ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/30 font-medium">COMING SOON</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />ACTIVE
                  </span>
                )}
              </div>
              {/* WHO DOES THIS. Faces sit above the tools, because the employee is
                  the thing being sold and the tooling is what they reach for. */}
              {dept.owners && dept.owners.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] text-white/20 uppercase tracking-wider mr-1">Who:</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {dept.owners.map((id, oi) => {
                      const employee = EMPLOYEE_BY_ID[id];
                      if (!employee) return null;
                      return (
                        <span key={id} className="inline-flex items-center gap-1">
                          {oi > 0 && <span className="text-white/15 text-[10px] mr-0.5">→</span>}
                          <EmployeeAvatar employee={employee} size={20} />
                          <span className="text-[11px] font-medium" style={{ color: employee.accent }}>{employee.name}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] text-white/20 uppercase tracking-wider mr-1">Tools:</span>
                {dept.tools.slice(0, 3).map(t => (
                  <div key={t.name} className="w-6 h-6 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center" title={t.name}>
                    <t.Logo width={16} height={16} />
                  </div>
                ))}
                {dept.tools.length > 3 && <span className="text-[10px] text-white/30 ml-1">+{dept.tools.length - 3} more</span>}
              </div>
              <div className="h-px bg-white/[0.04] mb-3" />
              <ActivityFeed activities={dept.activities} comingSoon={dept.comingSoon} />
              <div className="mt-4">
                {dept.comingSoon ? (
                  <button onClick={() => navigate("/auth")} className="text-xs text-white/30 font-medium hover:text-white/50 transition-colors flex items-center gap-1">Join waitlist <ArrowRight className="w-3 h-3" /></button>
                ) : (
                  <button onClick={() => navigate(`/auth?room=${dept.room}`)} className="text-xs text-emerald-400/80 font-medium hover:text-emerald-400 transition-colors flex items-center gap-1">View the work <ArrowRight className="w-3 h-3" /></button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TeamsAtWorkSection;