import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Languages, Shield, Target, MessageSquare, PenLine, Search, FileText } from "lucide-react";

const HUBS = [
  { name: "San Francisco", x: 15, y: 38 },
  { name: "New York", x: 22, y: 36 },
  { name: "São Paulo", x: 30, y: 68 },
  { name: "London", x: 47, y: 28 },
  { name: "Berlin", x: 52, y: 28 },
  { name: "Tel Aviv", x: 57, y: 40 },
  { name: "Dubai", x: 60, y: 42 },
  { name: "Bangalore", x: 70, y: 52 },
  { name: "Singapore", x: 77, y: 56 },
  { name: "Tokyo", x: 88, y: 38 },
];

const AGENT_MESSAGES = [
    { text: "Hawk detecting pricing change in", city: "London", icon: Target, color: "#fbbf24" },
    { text: "Penn sending outreach to", city: "Berlin", icon: PenLine, color: "#60a5fa" },
    { text: "Aria analyzing candidate in", city: "Tokyo", icon: MessageSquare, color: "#a78bfa" },
    { text: "Radar identifying leads in", city: "San Francisco", icon: Search, color: "#60a5fa" },
    { text: "Scout scraping profiles in", city: "New York", icon: Search, color: "#34d399" },
    { text: "Brief analyzing markets in", city: "Tel Aviv", icon: FileText, color: "#fbbf24" },
];

const COLUMNS = [
  { Icon: Globe, title: "Works everywhere", body: "ScreeningPilot runs in the cloud with zero regional restrictions. Your workforce operates at full capacity whether you are building in Bangalore or Brooklyn." },
  { Icon: Languages, title: "Speaks your market", body: "The Company Brain stores your market context. Your agents write outreach for US investors and Indian founders differently — because they know exactly who you are talking to in each market." },
  { Icon: Shield, title: "Trusted globally", body: "GDPR compliant. SOC2 ready. Encrypted at rest and in transit. Your data never leaves your control regardless of where you are building." },
];

const WORLD_MAP_PATH = `
M 8,35 Q 12,28 18,30 L 22,28 Q 25,25 28,27 L 28,32 Q 26,36 22,38 L 18,42 Q 14,50 16,55 L 20,60 Q 24,65 28,70 L 32,75 Q 30,78 26,76 L 22,72 Q 18,68 15,62 L 12,55 Q 8,48 7,42 Z
M 42,20 L 48,18 Q 55,17 60,20 L 65,22 Q 70,24 75,22 L 80,20 Q 85,22 88,28 L 90,35 Q 88,40 85,42 L 80,44 Q 75,48 72,52 L 70,55 Q 68,58 65,56 L 62,52 Q 58,48 55,45 L 52,42 Q 48,38 45,35 L 42,30 Q 40,25 42,20 Z
M 72,55 Q 76,52 80,54 L 82,58 Q 84,62 82,66 L 78,68 Q 74,66 72,62 Z
M 48,42 Q 52,40 55,42 L 58,48 Q 56,55 52,58 L 48,56 Q 45,50 48,42 Z
`;

const GlobalSection = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Cycle messages
  useEffect(() => {
     if (!inView) return;
     const interval = setInterval(() => {
         setActiveMessageIndex(prev => (prev + 1) % AGENT_MESSAGES.length);
     }, 3000);
     return () => clearInterval(interval);
  }, [inView]);

  return (
    <section ref={ref} id="global" className="relative z-10 py-16 md:py-24 bg-[#000502]">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/40 bg-accent-mint/5 mb-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold">BUILT FOR THE WORLD</span>
          </div>
          <h2 className="font-display font-bold text-4xl md:text-6xl text-white leading-[1.0] mb-8 tracking-tight">
            One workforce. Every timezone.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed font-medium">
             Your AI workforce works in every timezone, speaks every market's language, and never needs a local office.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-24 max-w-5xl mx-auto">
          {COLUMNS.map((col, i) => (
            <motion.div key={col.title} initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.15, ease: [0.23, 1, 0.32, 1] }} className="text-center md:text-left group"
            >
              <div className="w-12 h-12 rounded-2xl bg-accent-mint/5 border border-accent-mint/20 flex items-center justify-center mb-6 mx-auto md:mx-0 group-hover:bg-accent-mint/10 group-hover:border-accent-mint/40 transition-all">
                 <col.Icon className="w-6 h-6 text-accent-mint" />
              </div>
              <h3 className="font-display font-bold text-xl text-white mb-4 tracking-tight">{col.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed font-medium">{col.body}</p>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ duration: 1.2, delay: 0.5 }}
          className="relative w-full mx-auto p-4 md:p-12 rounded-[2rem] border border-accent-mint/20 bg-[#060606] shadow-[inset_0_0_60px_rgba(0,255,148,0.04),_0_50px_100px_rgba(0,0,0,0.8)]" style={{ maxWidth: 1000 }}>
          
          {/* Map Container */}
          <div className="relative w-full aspect-[5/3] md:aspect-[2/1]">
              <svg viewBox="0 0 100 80" className="w-full h-full absolute inset-0" preserveAspectRatio="xMidYMid meet">
                  <path d={WORLD_MAP_PATH} fill="none" stroke="white" strokeWidth="0.2" opacity="0.05" />
                  {HUBS.slice(0, -1).map((hub, i) => {
                  const next = HUBS[(i + 2) % HUBS.length];
                  return <line key={`conn-${i}`} x1={hub.x} y1={hub.y} x2={next.x} y2={next.y} stroke="white" strokeWidth="0.1" opacity="0.04" />;
                  })}
                  {HUBS.map((hub, i) => (
                  <g key={hub.name}>
                      <circle cx={hub.x} cy={hub.y} r="0.6" fill="#00FF94" opacity="0.5">
                      <animate attributeName="r" values="0.4;1.2;0.4" dur={`${3 + i * 0.4}s`} repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur={`${3 + i * 0.4}s`} repeatCount="indefinite" />
                      </circle>
                  </g>
                  ))}
              </svg>

              {/* Floating Messages Over Map */}
              <AnimatePresence mode="wait">
                  {AGENT_MESSAGES.map((msg, i) => {
                      if (i !== activeMessageIndex) return null;
                      const hub = HUBS.find(h => h.name === msg.city);
                      if (!hub) return null;
                      const Icon = msg.icon;

                      return (
                          <motion.div 
                              key={i}
                              initial={{ opacity: 0, y: 10, scale: 0.9 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                              transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
                              className="absolute z-20"
                              style={{ 
                                  left: `${hub.x}%`, 
                                  top: `${hub.y}%`,
                                  transform: 'translate(-50%, -100%)',
                                  marginTop: '-15px' 
                              }}
                          >
                              {/* Pulse origin */}
                              <div className="absolute left-1/2 bottom-0 w-1 h-1 bg-white rounded-full translate-x-1/2 translate-y-2 blur-[1px]">
                                  <div className="absolute inset-0 bg-white rounded-full animate-ping" />
                              </div>

                              <div className="flex items-center gap-3 py-2 px-3 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl min-w-[200px] md:min-w-[280px]">
                                  <div className="w-8 h-8 rounded-lg border border-white/5 flex items-center justify-center shrink-0" style={{ backgroundColor: `${msg.color}15` }}>
                                      <Icon className="w-4 h-4" style={{ color: msg.color }} />
                                  </div>
                                  <div>
                                      <p className="text-[10px] md:text-xs text-white/90 font-medium leading-tight whitespace-nowrap">
                                          {msg.text} <span className="font-bold text-white">{msg.city}</span>...
                                      </p>
                                  </div>
                              </div>
                          </motion.div>
                      )
                  })}
              </AnimatePresence>
          </div>
        </motion.div>

        <div className="text-center mt-12 bg-white/[0.02] py-4 rounded-full border border-white/5 max-w-lg mx-auto">
          <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Agents actively observing 40+ markets</p>
        </div>
      </div>
    </section>
  );
};

export default GlobalSection;