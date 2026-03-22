import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, Users, Pen, BarChart2, User,
  Brain, ArrowLeftRight, UserCheck, ArrowRight,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const agents = [
  { id: 'talent', name: 'Talent Dept', icon: Users, bubble: 'I screen 100 candidates while you sleep.', desk: { top: '8%', left: '18%' }, entryFrom: { x: -120, y: -80 } },
  { id: 'growth', name: 'Growth Dept', icon: TrendingUp, bubble: 'I find leads before your competitors do.', desk: { top: '8%', left: '68%' }, entryFrom: { x: 120, y: -80 } },
  { id: 'content', name: 'Content Dept', icon: Pen, bubble: 'I write in your voice. Always.', desk: { top: '62%', left: '10%' }, entryFrom: { x: -120, y: 80 } },
  { id: 'intelligence', name: 'Intel Dept', icon: BarChart2, bubble: 'I know what your competitors did last night.', desk: { top: '62%', left: '76%' }, entryFrom: { x: 120, y: 80 } },
];

const founder = { id: 'you', name: 'You', icon: User, desk: { top: '38%', left: '43%' } };

const connections = [
  { from: 'you', to: 'talent' }, { from: 'you', to: 'growth' },
  { from: 'you', to: 'content' }, { from: 'you', to: 'intelligence' },
  { from: 'talent', to: 'intelligence' }, { from: 'growth', to: 'content' },
  { from: 'talent', to: 'growth' }, { from: 'content', to: 'intelligence' },
];

const feedItems = [
  { from: 'Talent', to: 'Intelligence', text: 'Competitor hired 6 engineers — adding to report' },
  { from: 'Intelligence', to: 'Content', text: 'Competitor dropped pricing — drafting response post' },
  { from: 'Growth', to: 'Talent', text: 'Lead also has open roles — flagging for recruiting' },
  { from: 'Content', to: 'Growth', text: 'Top post angle: screening automation — converting well' },
  { from: 'Intelligence', to: 'All', text: 'Weekly brief distributed — 4 action items assigned' },
  { from: 'Growth', to: 'Intelligence', text: 'New funding round — 12 warm leads identified' },
  { from: 'Content', to: 'Intelligence', text: 'Brand voice score 98% — consistency maintained' },
  { from: 'Talent', to: 'Growth', text: 'Strong candidate also matches outreach ICP — flagged' },
];

const truths = [
  { icon: Brain, title: 'One brain. Shared by all.', body: 'Tell ScreeningPilot about your company once. Every agent in every department knows everything from that moment forward. What you tell one, all of them remember.' },
  { icon: ArrowLeftRight, title: 'What one finds, all act on.', body: 'When your Talent agent finds a candidate signal your Growth agent checks if they are also a potential lead. When Intelligence spots a competitor move your Content agent writes about your advantage. Automatically.' },
  { icon: UserCheck, title: 'You decide. They execute.', body: 'Your agents brief each other, hand off work, and surface only what needs a human decision. You are the founder making calls — not the messenger between fifteen tabs.' },
];

const getDeskCenter = (id: string) => {
  const all = [founder, ...agents];
  const a = all.find((x) => x.id === id);
  if (!a) return { x: 50, y: 50 };
  return { x: parseFloat(a.desk.left) + 7, y: parseFloat(a.desk.top) + 10 };
};

const MeetTheTeamSection = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0);
  const hasPlayed = useRef(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !hasPlayed.current) { hasPlayed.current = true; runSequence(); } },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const runSequence = useCallback(() => {
    setPhase(1);
    setTimeout(() => setPhase(2), 1000);
    setTimeout(() => setPhase(3), 5000);
    setTimeout(() => setPhase(4), 7000);
    setTimeout(() => setPhase(5), 10000);
  }, []);

  return (
    <section ref={sectionRef} className="relative w-full px-4 py-24 md:py-36 overflow-hidden">
      <div className="max-w-[1100px] mx-auto">
        <div className="text-center mb-16">
          <p className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4">MEET THE TEAM</p>
          <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.04em] text-white mb-6">
            Five departments.<br />Fifteen agents.<br />One company that never sleeps.
          </h2>
          <p className="text-white/40 text-base md:text-lg max-w-[600px] mx-auto leading-relaxed">
            Your AI workforce arrives on day one fully briefed on your company. They know each other. They work together. They surface only what needs your attention.
          </p>
        </div>

        {isMobile ? <MobileAgentCards phase={phase} /> : <DesktopOffice phase={phase} />}

        <div className="mt-16 overflow-hidden">
          <div className="overflow-hidden whitespace-nowrap">
            <div className="ticker-track">
              {[...feedItems, ...feedItems].map((item, i) => (
                <FeedPill key={i} item={item} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12 mt-20">
          {truths.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.title} className="text-center md:text-left">
                <Icon className="w-7 h-7 text-emerald-400 mb-4 mx-auto md:mx-0" />
                <h3 className="font-display font-bold text-white text-lg mb-2">{t.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{t.body}</p>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-20 max-w-[560px] mx-auto">
          <p className="font-display text-xl md:text-2xl text-white/80 italic leading-snug mb-4">
            "This is what a real team feels like."
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

const DesktopOffice = ({ phase }: { phase: number }) => {
  const [visibleAgents, setVisibleAgents] = useState<string[]>([]);
  const [activeBubble, setActiveBubble] = useState<string | null>(null);
  const [drawnLines, setDrawnLines] = useState<number>(0);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (phase < 2) return;
    if (phase === 2) {
      agents.forEach((a, i) => {
        setTimeout(() => {
          setVisibleAgents((prev) => [...prev, a.id]);
          setActiveBubble(a.id);
          setTimeout(() => setActiveBubble((cur) => (cur === a.id ? null : cur)), 1200);
        }, i * 800);
      });
    }
    if (phase === 3) {
      setShowWelcome(true);
      setTimeout(() => setShowWelcome(false), 2000);
    }
    if (phase >= 4) {
      connections.forEach((_, i) => {
        setTimeout(() => setDrawnLines(i + 1), i * 300);
      });
    }
  }, [phase]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: phase >= 1 ? 1 : 0 }}
      transition={{ duration: 0.8 }}
      className="relative w-full max-w-[700px] mx-auto aspect-[700/450] rounded-2xl border border-white/[0.06] overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #04060d 0%, #02050a 100%)' }}
    >
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs><pattern id="office-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#office-grid)" />
      </svg>
      <div className="absolute top-4 left-4 w-3 h-3 rounded-full bg-emerald-500/20" />
      <div className="absolute bottom-4 right-4 w-3 h-3 rounded bg-white/[0.06]" />

      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {connections.slice(0, drawnLines).map((c, i) => {
          const from = getDeskCenter(c.from);
          const to = getDeskCenter(c.to);
          return <line key={i} x1={`${from.x}%`} y1={`${from.y}%`} x2={`${to.x}%`} y2={`${to.y}%`} stroke="rgba(52,211,153,0.25)" strokeWidth="1.5" className="animate-line-draw" style={{ '--line-delay': `${i * 0.1}s` } as React.CSSProperties} />;
        })}
        {phase >= 5 && connections.slice(0, drawnLines).map((c, i) => {
          const from = getDeskCenter(c.from);
          const to = getDeskCenter(c.to);
          return (
            <circle key={`dot-${i}`} r="2" fill="#34d399" opacity="0.6">
              <animateMotion dur={`${3 + i * 0.3}s`} repeatCount="indefinite" path={`M${from.x * 7},${from.y * 4.5} L${to.x * 7},${to.y * 4.5}`} />
            </circle>
          );
        })}
      </svg>

      <DeskNode agent={founder} isVisible={phase >= 1} isFounder showBubble={false} isAlive={phase >= 5} />
      {agents.map((a) => (
        <DeskNode key={a.id} agent={a} isVisible={visibleAgents.includes(a.id)} isFounder={false} showBubble={activeBubble === a.id} entryFrom={a.entryFrom} bubble={a.bubble} isAlive={phase >= 5} />
      ))}

      <AnimatePresence>
        {showWelcome && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-white/[0.08] backdrop-blur-md border border-white/[0.1] rounded-xl px-6 py-3 text-center">
            <p className="text-sm font-semibold text-white">🎉 Welcome to ScreeningPilot HQ</p>
            <p className="text-xs text-white/40">Your workforce is ready.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase >= 5 && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }} className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs text-white/30 text-center max-w-[280px]">
            You are the only one who needs to be here. Your workforce handles the rest.
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

interface DeskNodeProps {
  agent: { id: string; name: string; icon: React.ElementType; desk: { top: string; left: string } };
  isVisible: boolean; isFounder: boolean; showBubble: boolean;
  entryFrom?: { x: number; y: number }; bubble?: string; isAlive: boolean;
}

const DeskNode = ({ agent, isVisible, isFounder, showBubble, entryFrom, bubble, isAlive }: DeskNodeProps) => {
  const Icon = agent.icon;
  const size = isFounder ? 'w-12 h-12' : 'w-10 h-10';
  const ringColor = isFounder ? 'ring-emerald-400/60' : 'ring-emerald-500/40';

  return (
    <motion.div className="absolute z-10 flex flex-col items-center" style={{ top: agent.desk.top, left: agent.desk.left }}
      initial={entryFrom ? { opacity: 0, x: entryFrom.x, y: entryFrom.y } : { opacity: 0 }}
      animate={isVisible ? { opacity: 1, x: 0, y: 0, scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <AnimatePresence>
        {showBubble && bubble && (
          <motion.div initial={{ opacity: 0, scale: 0.8, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }} className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white/[0.1] backdrop-blur-sm border border-white/[0.08] rounded-lg px-3 py-1.5 whitespace-nowrap z-20">
            <p className="text-[10px] text-white/70">{bubble}</p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={`${size} rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.1] relative ${isFounder ? 'border-emerald-500/40' : ''}`}>
        <Icon className="w-4 h-4 text-emerald-400" />
        {(isVisible || isFounder) && <span className={`absolute inset-0 rounded-full ring-2 ${ringColor} ${isAlive ? 'animate-[ping_2s_ease-in-out_infinite]' : ''} opacity-40`} />}
      </div>
      <div className={`mt-1 px-3 py-1 rounded bg-white/[0.04] border border-white/[0.06] transition-all duration-500 ${isVisible ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : ''}`}>
        <p className="text-[9px] font-mono text-white/50 text-center whitespace-nowrap">{agent.name}</p>
      </div>
    </motion.div>
  );
};

const MobileAgentCards = ({ phase }: { phase: number }) => {
  const allAgents = [{ ...founder, bubble: 'The founder. The decision maker.' }, ...agents];
  return (
    <div className="relative flex flex-col items-center gap-1">
      <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px border-l border-dashed border-emerald-500/20 z-0" />
      {allAgents.map((a, i) => {
        const Icon = a.icon;
        return (
          <motion.div key={a.id} initial={{ opacity: 0, y: 20 }} animate={phase >= 2 || (a.id === 'you' && phase >= 1) ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: i * 0.15, duration: 0.4 }} className="relative z-10 flex items-center gap-4 w-full max-w-xs bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{a.name}</p>
              <p className="text-[10px] text-white/40">{a.bubble}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

const FeedPill = ({ item }: { item: { from: string; to: string; text: string } }) => (
  <span className="inline-flex items-center gap-2 mx-3 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] whitespace-nowrap">
    <span className="text-[10px] text-emerald-400 font-semibold">{item.from}</span>
    <span className="text-[10px] text-white/20">→</span>
    <span className="text-[10px] text-white/40 font-medium">{item.to}</span>
    <span className="text-[10px] text-white/30">{item.text}</span>
  </span>
);

export default MeetTheTeamSection;
