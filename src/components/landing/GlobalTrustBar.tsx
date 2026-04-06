import { useEffect, useState } from "react";
import { Globe } from "lucide-react";

const FLAGS = "🇺🇸 🇬🇧 🇮🇳 🇨🇦 🇦🇺 🇩🇪 🇸🇬 🇧🇷 🇳🇱 🇫🇷 🇦🇪 🇸🇪 🇮🇱 🇯🇵 🇰🇷 🇵🇱 🇿🇦 🇲🇽 🇳🇬 🇵🇹";
const flagItems = FLAGS.split(" ");

const MESSAGES = [
  "Scout found 34 candidates in Mumbai...",
  "Penn sent outreach to a founder in Berlin...",
  "Aria screened 89 applicants in Toronto...",
  "Brief delivered to a solo founder in Lagos..."
];

const GlobalTrustBar = () => {
  const [text, setText] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const [msgIndex, setMsgIndex] = useState(0);

  // Typewriter effect
  useEffect(() => {
    const currentMsg = MESSAGES[msgIndex];
    let timeout: NodeJS.Timeout;

    if (isTyping) {
      if (text.length < currentMsg.length) {
        timeout = setTimeout(() => setText(currentMsg.slice(0, text.length + 1)), 50);
      } else {
        timeout = setTimeout(() => setIsTyping(false), 3000); // Pause on complete text
      }
    } else {
      if (text.length > 0) {
        timeout = setTimeout(() => setText(text.slice(0, -1)), 30);
      } else {
        setMsgIndex((prev) => (prev + 1) % MESSAGES.length);
        setIsTyping(true);
      }
    }
    return () => clearTimeout(timeout);
  }, [text, isTyping, msgIndex]);

  return (
    <section className="relative z-10 w-full border-y border-white/5 bg-galaxy-void/80 backdrop-blur-sm py-5 overflow-hidden">
      
      {/* Live Activity Feed */}
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-center mb-4">
        <Globe className="w-3.5 h-3.5 text-accent-mint mr-3 opacity-80" />
        <span className="font-mono text-[11px] font-bold text-accent-mint tracking-[0.1em] uppercase h-4 flex items-center min-w-[320px] justify-start opacity-90">
          {text}
          <span className="w-1.5 h-3 bg-accent-mint inline-block ml-1 animate-pulse" />
        </span>
      </div>

      {/* Flag ticker */}
      <div className="w-full overflow-hidden relative h-6 flex items-center">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-galaxy-void to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-galaxy-void to-transparent z-10 pointer-events-none" />
        
        <div className="flex whitespace-nowrap animate-[ticker-scroll_40s_linear_infinite] items-center">
          {[...flagItems, ...flagItems, ...flagItems, ...flagItems].map((flag, i) => (
            <div key={i} className="flex items-center gap-2 mx-6 opacity-40 grayscale transition-all hover:opacity-100 hover:grayscale-0">
              <span className="text-sm">{flag}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-accent-mint shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default GlobalTrustBar;