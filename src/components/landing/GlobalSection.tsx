import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Globe, Languages, Shield } from "lucide-react";

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
  { name: "Toronto", x: 20, y: 32 },
];

const COLUMNS = [
  { Icon: Globe, title: "Works everywhere", body: "Agentory runs in the cloud with no regional restrictions. Your AI employees work at full capacity whether you are building in Bangalore or Brooklyn." },
  { Icon: Languages, title: "Knows your market", body: "Your company context includes the markets you sell into. Your AI employees research and write differently for different audiences — because they know who you are talking to." },
  { Icon: Shield, title: "Your data stays yours", body: "Encrypted at rest and in transit. Your company context, your prompts and your employees' outputs belong to you, wherever you are building." },
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={ref} id="global" className="relative z-10 py-24 md:py-32">
      <div className="max-w-[1100px] mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">BUILT FOR THE WORLD</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            One founder in Mumbai. One in Berlin.<br />One in São Paulo. One in Toronto.<br />Same AI workforce. Same results.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            Your AI workforce works in every timezone, speaks every market's language, and never needs a local office.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-20">
          {COLUMNS.map((col, i) => (
            <motion.div key={col.title} initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.15 }} className="text-center md:text-left"
            >
              <col.Icon className="w-7 h-7 text-emerald-400 mb-4 mx-auto md:mx-0" />
              <h3 className="font-display font-bold text-lg text-white mb-2">{col.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{col.body}</p>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ duration: 0.8, delay: 0.5 }}
          className="relative w-full mx-auto" style={{ maxWidth: 800 }}>
          <svg viewBox="0 0 100 80" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            <path d={WORLD_MAP_PATH} fill="none" stroke="white" strokeWidth="0.3" opacity="0.1" />
            {HUBS.slice(0, -1).map((hub, i) => {
              const next = HUBS[(i + 2) % HUBS.length];
              return <line key={`conn-${i}`} x1={hub.x} y1={hub.y} x2={next.x} y2={next.y} stroke="white" strokeWidth="0.15" opacity="0.08" />;
            })}
            {HUBS.map((hub, i) => (
              <g key={hub.name}>
                <circle cx={hub.x} cy={hub.y} r="0.8" fill="#34d399" opacity="0.8">
                  <animate attributeName="r" values="0.6;1.2;0.6" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0.3;0.8" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
                </circle>
                <text x={hub.x} y={hub.y + 2.5} textAnchor="middle" fill="white" fontSize="1.8" opacity="0.25">{hub.name}</text>
              </g>
            ))}
          </svg>
        </motion.div>

        <div className="text-center mt-6">
          <p className="text-sm text-white/30">Built for <span className="text-white/60 font-semibold">founders anywhere</span></p>
          <p className="text-2xl mt-2 opacity-60">🇺🇸 🇬🇧 🇮🇳 🇨🇦 🇦🇺 🇩🇪 🇸🇬 🇧🇷 🇮🇱 🇦🇪</p>
        </div>
      </div>
    </section>
  );
};

export default GlobalSection;