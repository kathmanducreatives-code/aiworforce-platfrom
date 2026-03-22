import { useEffect, useState, useRef } from "react";
import { Globe, Lock, ShieldCheck } from "lucide-react";

const FLAGS = "🇺🇸 🇬🇧 🇮🇳 🇨🇦 🇦🇺 🇩🇪 🇸🇬 🇧🇷 🇳🇱 🇫🇷 🇦🇪 🇸🇪 🇮🇱 🇯🇵 🇰🇷 🇵🇱 🇿🇦 🇲🇽 🇳🇬 🇵🇹";
const flagItems = FLAGS.split(" ");

const GlobalTrustBar = () => {
  const [count, setCount] = useState(47);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCount(prev => {
        if (prev >= 52) return 47;
        return prev + 1;
      });
    }, 3000);
    return () => clearInterval(intervalRef.current);
  }, []);

  return (
    <section className="relative z-10 w-full border-y border-white/[0.04] bg-white/[0.02]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
        {/* Left — Counter */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <Globe className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-white/50 font-medium">
            Founders from <span className="text-white font-bold tabular-nums">{count}</span> countries building with ScreeningPilot
          </span>
        </div>

        {/* Center — Flag ticker */}
        <div className="flex-1 overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#02060a] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#02060a] to-transparent z-10 pointer-events-none" />
          <div className="flex whitespace-nowrap animate-[ticker-scroll_30s_linear_infinite]">
            {[...flagItems, ...flagItems, ...flagItems].map((flag, i) => (
              <span key={i} className="text-2xl mx-3 opacity-70">{flag}</span>
            ))}
          </div>
        </div>

        {/* Right — Badges */}
        <div className="hidden sm:flex items-center gap-3 shrink-0">
          {[
            { icon: Lock, label: "SOC2 Ready" },
            { icon: ShieldCheck, label: "GDPR" },
            { icon: Lock, label: "Encrypted" },
          ].map(b => (
            <div key={b.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.06] bg-white/[0.03] text-xs text-white/40 font-medium">
              <b.icon className="w-3 h-3" />
              {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile badges */}
      <div className="sm:hidden flex items-center justify-center gap-3 pb-3">
        {[
          { icon: Lock, label: "SOC2 Ready" },
          { icon: ShieldCheck, label: "GDPR" },
          { icon: Lock, label: "Encrypted" },
        ].map(b => (
          <div key={b.label} className="flex items-center gap-1 px-2 py-1 rounded-full border border-white/[0.06] bg-white/[0.03] text-[10px] text-white/40 font-medium">
            <b.icon className="w-2.5 h-2.5" />
            {b.label}
          </div>
        ))}
      </div>
    </section>
  );
};

export default GlobalTrustBar;