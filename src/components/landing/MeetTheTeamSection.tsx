import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, Users, Pen, BarChart2, User,
  Brain, ArrowLeftRight, UserCheck, ArrowRight,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

/* ── Agent data ── */
const agents = [
  {
    id: 'growth',
    name: 'Growth Agent',
    icon: TrendingUp,
    bubble: 'I find leads before your competitors do.',
    // pentagon top-left
    desk: { top: '8%', left: '18%' },
    entryFrom: { x: -120, y: -80 },
  },
  {
    id: 'recruiting',
    name: 'Recruiting Agent',
    icon: Users,
    bubble: 'I screen 100 candidates while you sleep.',
    desk: { top: '8%', left: '68%' },
    entryFrom: { x: 120, y: -80 },
  },
  {
    id: 'content',
    name: 'Content Agent',
    icon: Pen,
    bubble: 'I write in your voice. Always.',
    desk: { top: '62%', left: '10%' },
    entryFrom: { x: -120, y: 80 },
  },
  {
    id: 'strategy',
    name: 'Strategy Agent',
    icon: BarChart2,
    bubble: 'I know what your competitors did last night.',
    desk: { top: '62%', left: '76%' },
    entryFrom: { x: 120, y: 80 },
  },
];

const founder = {
  id: 'you',
  name: 'You',
  icon: User,
  desk: { top: '38%', left: '43%' },
};

/* ── Connection lines (index pairs into [founder, ...agents]) ── */
const connections = [
  // from founder(center) to each agent
  { from: 'you', to: 'growth' },
  { from: 'you', to: 'recruiting' },
  { from: 'you', to: 'content' },
  { from: 'you', to: 'strategy' },
  // cross connections
  { from: 'growth', to: 'strategy' },
  { from: 'recruiting', to: 'content' },
  { from: 'growth', to: 'recruiting' },
  { from: 'content', to: 'strategy' },
];

/* ── Collaboration feed items ── */
const feedItems = [
  { from: 'Growth', to: 'Strategy', text: 'Sent 3 hot leads for this morning\'s brief' },
  { from: 'Strategy', to: 'Content', text: 'Competitor dropped pricing — brief sent for post' },
  { from: 'Recruiting', to: 'Growth', text: '2 candidates also match outreach ICP — flagged' },
  { from: 'Content', to: 'Growth', text: 'Post about Series A chaos ready — publishing at 9am' },
  { from: 'Strategy', to: 'All', text: 'Weekly brief distributed — 4 action items assigned' },
  { from: 'Growth', to: 'Recruiting', text: 'Lead converted — forwarding company profile' },
  { from: 'Content', to: 'Strategy', text: 'Top post this week: screening automation angle' },
  { from: 'Recruiting', to: 'Strategy', text: 'Competitor hired 6 engineers — adding to report' },
  { from: 'Strategy', to: 'Growth', text: 'New funding round — 12 warm leads identified' },
  { from: 'Growth', to: 'Content', text: 'Reply pattern found: time-saving angle converts' },
];

/* ── Three truths ── */
const truths = [
  {
    icon: Brain,
    title: 'One brain. Shared by all.',
    body: 'Every agent knows your company because they all draw from the same Company Brain. What you tell one, all of them know. What one learns, all of them remember.',
  },
  {
    icon: ArrowLeftRight,
    title: 'What one finds, all act on.',
    body: 'When your Growth agent finds a signal your Content agent writes about it. When your Recruiting agent spots a pattern your Strategy agent notes it. Intelligence flows automatically.',
  },
  {
    icon: UserCheck,
    title: 'You decide. They execute.',
    body: 'Your agents brief each other, hand off work, and surface only what needs your attention. You are not the messenger between tools anymore. You are the founder making decisions.',
  },
];

/* ── Helpers ── */
const getDeskCenter = (id: string) => {
  const all = [founder, ...agents];
  const a = all.find((x) => x.id === id);
  if (!a) return { x: 50, y: 50 };
  return {
    x: parseFloat(a.desk.left) + 7,
    y: parseFloat(a.desk.top) + 10,
  };
};

/* ═══════════════════════════════════════════ */
/*               MAIN COMPONENT               */
/* ═══════════════════════════════════════════ */
const MeetTheTeamSection = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0); // 0=not started, 1-5
  const hasPlayed = useRef(false);

  /* Intersection Observer — trigger once */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasPlayed.current) {
          hasPlayed.current = true;
          runSequence();
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const runSequence = useCallback(() => {
    setPhase(1);                          // Phase 1: office appears
    setTimeout(() => setPhase(2), 1000);  // Phase 2: agents arrive
    setTimeout(() => setPhase(3), 5000);  // Phase 3: welcome notification
    setTimeout(() => setPhase(4), 7000);  // Phase 4: connections draw
    setTimeout(() => setPhase(5), 10000); // Phase 5: alive
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative w-full px-4 py-24 md:py-36 overflow-hidden"
    >
      <div className="max-w-[1100px] mx-auto">
        {/* ── PART 1: Headline ── */}
        <div className="text-center mb-16">
          <p className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4">
            Meet the team
          </p>
          <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.04em] text-white mb-6">
            Five agents. One office.<br />
            They already know your company.<br />
            Now they know each other.
          </h2>
          <p className="text-white/40 text-base md:text-lg max-w-[600px] mx-auto leading-relaxed">
            Most AI tools are strangers to each other. In Pilot your agents are colleagues. They share what they find. They build on each other's work. They brief each other so you never have to.
          </p>
        </div>

        {/* ── PART 2: Office / Mobile cards ── */}
        {isMobile ? (
          <MobileAgentCards phase={phase} />
        ) : (
          <DesktopOffice phase={phase} />
        )}

        {/* ── PART 3: Collaboration Feed ── */}
        <div className="mt-16 overflow-hidden">
          <div className="overflow-hidden whitespace-nowrap">
            <div className="ticker-track">
              {[...feedItems, ...feedItems].map((item, i) => (
                <FeedPill key={i} item={item} />
              ))}
            </div>
          </div>
        </div>

        {/* ── PART 4: Three Truths ── */}
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

        {/* ── PART 5: Closing CTA ── */}
        <div className="text-center mt-20 max-w-[560px] mx-auto">
          <p className="font-display text-xl md:text-2xl text-white/80 italic leading-snug mb-4">
            "This is what it feels like when your tools finally become a team."
          </p>
          <p className="text-white/30 text-sm mb-8">
            Stop managing tools. Start leading a team.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]"
          >
            Meet your AI team
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════════ */
/*            DESKTOP OFFICE VISUAL           */
/* ═══════════════════════════════════════════ */
const DesktopOffice = ({ phase }: { phase: number }) => {
  const [visibleAgents, setVisibleAgents] = useState<string[]>([]);
  const [activeBubble, setActiveBubble] = useState<string | null>(null);
  const [drawnLines, setDrawnLines] = useState<number>(0);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (phase < 2) return;
    if (phase === 2) {
      // stagger agent arrivals
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
      // draw lines one by one
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
      {/* Grid overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="office-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#office-grid)" />
      </svg>

      {/* Decorative elements */}
      <div className="absolute top-4 left-4 w-3 h-3 rounded-full bg-emerald-500/20" title="plant" />
      <div className="absolute bottom-4 right-4 w-3 h-3 rounded bg-white/[0.06]" title="coffee machine" />

      {/* SVG connection lines */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {connections.slice(0, drawnLines).map((c, i) => {
          const from = getDeskCenter(c.from);
          const to = getDeskCenter(c.to);
          return (
            <line
              key={i}
              x1={`${from.x}%`}
              y1={`${from.y}%`}
              x2={`${to.x}%`}
              y2={`${to.y}%`}
              stroke="rgba(52,211,153,0.25)"
              strokeWidth="1.5"
              className="animate-line-draw"
              style={{ '--line-delay': `${i * 0.1}s` } as React.CSSProperties}
            />
          );
        })}
        {/* Pulsing dots on drawn lines */}
        {phase >= 5 && connections.slice(0, drawnLines).map((c, i) => {
          const from = getDeskCenter(c.from);
          const to = getDeskCenter(c.to);
          return (
            <circle
              key={`dot-${i}`}
              r="2"
              fill="#34d399"
              opacity="0.6"
              className="animate-pulse-dot"
              style={{
                '--dot-x1': `${from.x}%`,
                '--dot-y1': `${from.y}%`,
                '--dot-x2': `${to.x}%`,
                '--dot-y2': `${to.y}%`,
                animationDelay: `${i * 0.4}s`,
              } as React.CSSProperties}
            >
              <animateMotion
                dur={`${3 + i * 0.3}s`}
                repeatCount="indefinite"
                path={`M${from.x * 7},${from.y * 4.5} L${to.x * 7},${to.y * 4.5}`}
              />
            </circle>
          );
        })}
      </svg>

      {/* Founder desk — always visible */}
      <DeskNode
        agent={founder}
        isVisible={phase >= 1}
        isFounder
        showBubble={false}
        isAlive={phase >= 5}
      />

      {/* Agent desks */}
      {agents.map((a) => (
        <DeskNode
          key={a.id}
          agent={a}
          isVisible={visibleAgents.includes(a.id)}
          isFounder={false}
          showBubble={activeBubble === a.id}
          entryFrom={a.entryFrom}
          bubble={a.bubble}
          isAlive={phase >= 5}
        />
      ))}

      {/* Welcome notification */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-white/[0.08] backdrop-blur-md border border-white/[0.1] rounded-xl px-6 py-3 text-center"
          >
            <p className="text-sm font-semibold text-white">🎉 Welcome to Pilot HQ</p>
            <p className="text-xs text-white/40">Your team is ready.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 5 closing label */}
      <AnimatePresence>
        {phase >= 5 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs text-white/30 text-center max-w-[280px]"
          >
            You are the only one who needs to be here. Your team handles the rest.
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* ── Desk node ── */
interface DeskNodeProps {
  agent: { id: string; name: string; icon: React.ElementType; desk: { top: string; left: string } };
  isVisible: boolean;
  isFounder: boolean;
  showBubble: boolean;
  entryFrom?: { x: number; y: number };
  bubble?: string;
  isAlive: boolean;
}

const DeskNode = ({ agent, isVisible, isFounder, showBubble, entryFrom, bubble, isAlive }: DeskNodeProps) => {
  const Icon = agent.icon;
  const size = isFounder ? 'w-12 h-12' : 'w-10 h-10';
  const ringColor = isFounder ? 'ring-emerald-400/60' : 'ring-emerald-500/40';

  return (
    <motion.div
      className="absolute z-10 flex flex-col items-center"
      style={{ top: agent.desk.top, left: agent.desk.left }}
      initial={entryFrom ? { opacity: 0, x: entryFrom.x, y: entryFrom.y } : { opacity: 0 }}
      animate={isVisible ? { opacity: 1, x: 0, y: 0, scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Speech bubble */}
      <AnimatePresence>
        {showBubble && bubble && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white/[0.1] backdrop-blur-sm border border-white/[0.08] rounded-lg px-3 py-1.5 whitespace-nowrap z-20"
          >
            <p className="text-[10px] text-white/70">{bubble}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Avatar */}
      <div
        className={`${size} rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.1] relative ${isFounder ? 'border-emerald-500/40' : ''}`}
      >
        <Icon className="w-4 h-4 text-emerald-400" />
        {/* Online ring */}
        {(isVisible || isFounder) && (
          <span className={`absolute inset-0 rounded-full ring-2 ${ringColor} ${isAlive ? 'animate-[ping_2s_ease-in-out_infinite]' : ''} opacity-40`} />
        )}
      </div>

      {/* Desk */}
      <div
        className={`mt-1 px-3 py-1 rounded bg-white/[0.04] border border-white/[0.06] transition-all duration-500 ${isVisible ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : ''}`}
      >
        <p className="text-[9px] font-mono text-white/50 text-center whitespace-nowrap">{agent.name}</p>
      </div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════ */
/*            MOBILE AGENT CARDS              */
/* ═══════════════════════════════════════════ */
const MobileAgentCards = ({ phase }: { phase: number }) => {
  const allAgents = [
    { ...founder, bubble: 'The founder. The decision maker.' },
    ...agents,
  ];

  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* Dotted connecting line */}
      <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px border-l border-dashed border-emerald-500/20 z-0" />

      {allAgents.map((a, i) => {
        const Icon = a.icon;
        return (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 2 || (a.id === 'you' && phase >= 1)
              ? { opacity: 1, y: 0 }
              : {}}
            transition={{ delay: i * 0.2, duration: 0.4 }}
            className="relative z-10 flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-3 w-full max-w-[320px]"
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-emerald-500/10 shrink-0">
              <Icon className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{a.name}</p>
              <p className="text-[11px] text-white/40">{a.bubble}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/*              FEED PILL                     */
/* ═══════════════════════════════════════════ */
const FeedPill = ({ item }: { item: typeof feedItems[number] }) => (
  <span className="inline-flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] rounded-full px-4 py-2 mx-2 whitespace-nowrap hover:-translate-y-0.5 transition-transform">
    <span className="text-[11px] font-semibold text-emerald-400">{item.from}</span>
    <ArrowRight className="w-3 h-3 text-white/20" />
    <span className="text-[11px] font-semibold text-emerald-400">{item.to}</span>
    <span className="text-[11px] text-white/30 ml-1">{item.text}</span>
  </span>
);

export default MeetTheTeamSection;
