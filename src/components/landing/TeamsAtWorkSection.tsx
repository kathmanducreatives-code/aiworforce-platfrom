import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ToolLogoImage } from "./ToolLogos";

interface DeptCard {
  emoji: string;
  name: string;
  room: string;
  tools: { id: string; name: string }[];
  activities: { done: boolean; text: string }[];
  comingSoon?: boolean;
}

const DEPARTMENTS: DeptCard[] = [
  {
    emoji: "🎯", name: "Talent Department", room: "talent",
    tools: [
      { id: "claude", name: "Claude" }, { id: "gemini", name: "Gemini" },
      { id: "apify", name: "Apify" }, { id: "firecrawl", name: "Firecrawl" },
    ],
    activities: [
      { done: true, text: "Scout found 34 candidates matching ICP" },
      { done: true, text: "Aria completed 28 AI screening interviews" },
      { done: false, text: "Lens scoring behavioral signals for top 8" },
      { done: true, text: "Shortlist ready: 6 candidates ranked for review" },
      { done: false, text: "Monitoring open-to-work signals on LinkedIn" },
      { done: true, text: "Market salary for this role: $145k–$190k" },
    ],
  },
  {
    emoji: "📣", name: "Growth Department", room: "growth",
    tools: [
      { id: "claude", name: "Claude" }, { id: "firecrawl", name: "Firecrawl" },
      { id: "instantly", name: "Instantly" }, { id: "apify", name: "Apify" },
    ],
    activities: [
      { done: true, text: "Radar found Acme Corp — Series A trigger" },
      { done: true, text: "Penn wrote personalized outreach for James Park" },
      { done: false, text: "Relay tracking open rates on 12 sent emails" },
      { done: true, text: "Reply detected from TechFlow Inc — flagging urgent" },
      { done: false, text: "Scoring 47 leads from this week's funding news" },
      { done: true, text: "Follow-up sequence triggered for 3 warm leads" },
    ],
  },
  {
    emoji: "🎨", name: "Content Department", room: "content",
    tools: [
      { id: "claude", name: "Claude" }, { id: "replicate", name: "Replicate" },
      { id: "elevenlabs", name: "ElevenLabs" },
    ],
    activities: [
      { done: true, text: "Quill wrote LinkedIn post in your brand voice" },
      { done: false, text: "Canvas generating graphic for tomorrow's post" },
      { done: true, text: "Pulse scheduled 3 pieces of content this week" },
      { done: true, text: "Brand voice check passed: 98% consistency score" },
      { done: false, text: "Repurposing last week's top post into 3 formats" },
      { done: true, text: "Cold email sequence drafted: 5 emails, 3 subjects" },
    ],
  },
  {
    emoji: "🔍", name: "Intelligence Department", room: "intelligence",
    tools: [
      { id: "firecrawl", name: "Firecrawl" }, { id: "perplexity", name: "Perplexity" },
      { id: "claude", name: "Claude" }, { id: "notion", name: "Notion" },
    ],
    activities: [
      { done: true, text: "Hawk detected competitor pricing change" },
      { done: true, text: "Signal updated salary benchmarks for open roles" },
      { done: true, text: "Brief delivered morning report — 3 signals found" },
      { done: false, text: "Scanning 23 competitor job postings for signals" },
      { done: true, text: "3 companies in your space raised this week" },
      { done: true, text: "Weekly intelligence report saved to Notion" },
    ],
  },
  {
    emoji: "⚙️", name: "Engineering Department", room: "engineering", comingSoon: true,
    tools: [
      { id: "claude", name: "Claude" }, { id: "github", name: "GitHub" },
      { id: "linear", name: "Linear" },
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
    <section ref={sectionRef} className="relative z-10 py-16 md:py-24 bg-black overflow-hidden">
      <div className="max-w-[1100px] mx-auto px-6">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/40 bg-accent-mint/5 mb-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold">CROSS-DEPARTMENT INTELLIGENCE</span>
          </div>
          <h2 className="font-display font-bold text-4xl md:text-6xl text-white leading-[1.0] mb-8 tracking-tight">
            Five teams, one brain.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed font-medium">
            While you focus on what matters, your AI workforce handles recruiting, growth, content, research, and strategy — simultaneously.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {DEPARTMENTS.map((dept, di) => (
            <motion.div key={dept.room} initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: di * 0.1, ease: [0.23, 1, 0.32, 1] }}
              className={`glass-card-premium rounded-3xl p-8 group hover:-translate-y-2 transition-all duration-500 ${dept.comingSoon ? "opacity-40" : ""} ${di === 4 ? "md:col-span-2 md:max-w-[540px] md:mx-auto" : ""}`}>
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <span className="text-2xl grayscale group-hover:grayscale-0 transition-all">{dept.emoji}</span>
                  <span className="font-display font-black text-sm text-white uppercase tracking-widest">{dept.name}</span>
                </div>
                {dept.comingSoon ? (
                  <span className="text-[9px] px-2 py-1 rounded-md bg-white/5 text-white/20 font-black uppercase tracking-widest border border-white/5">COMING SOON</span>
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent-mint/5 border border-accent-mint/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
                    <span className="text-[9px] text-accent-mint font-black tracking-widest uppercase">ACTIVE</span>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-3 mb-8">
                <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.2em] mr-1">STACK</span>
                <div className="flex gap-2">
                  {dept.tools.slice(0, 3).map(t => (
                    <div key={t.name} className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center p-1.5 grayscale group-hover:grayscale-0 transition-all">
                      <ToolLogoImage toolId={t.id} size={16} />
                    </div>
                  ))}
                  {dept.tools.length > 3 && <span className="text-[9px] font-black text-white/20 ml-1 mt-2 tracking-tighter">+{dept.tools.length - 3}</span>}
                </div>
              </div>

              <div className="pt-8 border-t border-white/5 mt-8">
                <ActivityFeed activities={dept.activities} comingSoon={dept.comingSoon} />
              </div>

              <div className="mt-8 pt-8 border-t border-white/5">
                {dept.comingSoon ? (
                  <button onClick={() => navigate("/auth")} className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 hover:text-white transition-colors flex items-center gap-2">Join waitlist <ArrowRight className="w-3.5 h-3.5" /></button>
                ) : (
                  <button onClick={() => navigate(`/auth?room=${dept.room}`)} className="text-[10px] font-black uppercase tracking-[0.2em] text-accent-mint hover:text-white transition-colors flex items-center gap-2">Initialize Department <ArrowRight className="w-3.5 h-3.5" /></button>
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