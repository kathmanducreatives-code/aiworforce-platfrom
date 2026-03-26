import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { ArrowRight, Search, PenLine, Target, FileText, MessageSquare } from 'lucide-react';

const AGENTS_SEQUENCE = [
  { id: 'Scout', icon: Search, color: '#34d399', text: "I've found 14 leads while you read this page." },
  { id: 'Penn', icon: PenLine, color: '#60a5fa', text: "I've drafted their emails." },
  { id: 'Hawk', icon: Target, color: '#fbbf24', text: "I've checked their competitor's pricing." },
  { id: 'Brief', icon: FileText, color: '#fbbf24', text: "Your summary is ready." },
  { id: 'Aria', icon: MessageSquare, color: '#a78bfa', text: "We're standing by." },
];

const FinalCTA = () => {
    const navigate = useNavigate();
    const sectionRef = useRef<HTMLElement>(null);
    const isInView = useInView(sectionRef, { once: true, amount: 0.5 });
    const [currentTypingIndex, setCurrentTypingIndex] = useState(-1);

    // Sequence trigger
    useEffect(() => {
        if (!isInView) return;
        
        let isActive = true;
        
        const runSequence = async () => {
             // wait before starting
             await new Promise(r => setTimeout(r, 800));
             
             for (let i = 0; i < AGENTS_SEQUENCE.length; i++) {
                 if (!isActive) break;
                 setCurrentTypingIndex(i);
                 // length of time to 'type' and wait
                 await new Promise(r => setTimeout(r, 1200));
             }
        };

        runSequence();

        return () => { isActive = false; }
    }, [isInView]);

    return (
    <section ref={sectionRef} className="relative px-6 py-16 md:py-24 overflow-hidden bg-black">
      {/* High-Contrast Radial Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[800px] pointer-events-none">
        <div className="absolute inset-0 bg-accent-mint/[0.05] blur-[160px] rounded-full scale-150" />
      </div>

      <div className="relative z-10 text-center max-w-5xl mx-auto flex flex-col items-center">
        
        {/* Avatars Sequence */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-4 mb-20 w-full min-h-[160px]">
            {AGENTS_SEQUENCE.map((agent, i) => {
                const isTyping = currentTypingIndex === i;
                const isDone = currentTypingIndex > i;
                const Icon = agent.icon;

                return (
                    <motion.div 
                        key={agent.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={isInView ? { opacity: 1, y: 0 } : {}}
                        transition={{ duration: 0.5, delay: i * 0.1 }}
                        className="relative flex flex-col items-center group"
                    >
                         {/* Bubble */}
                         <motion.div 
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: (isDone || isTyping) ? 1 : 0, scale: (isDone || isTyping) ? 1 : 0.8 }}
                            transition={{ duration: 0.3, type: "spring" }}
                            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-[140px] md:w-[160px]"
                         >
                             <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-3 text-[10px] md:text-xs text-white font-medium leading-tight shadow-xl relative">
                                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-white/10 border-b border-r border-white/20 rotate-45" />
                                {agent.text}
                             </div>
                         </motion.div>

                         {/* Avatar */}
                         <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center transition-all duration-300 relative z-10
                            ${(isTyping || isDone) ? 'scale-110 shadow-lg' : 'scale-100 opacity-50 grayscale'}
                         `} style={{ backgroundColor: `${agent.color}20`, borderColor: `${agent.color}50` }}>
                             <Icon className="w-8 h-8" style={{ color: agent.color }} />
                         </div>
                         
                         <div className="mt-3 text-[10px] font-black uppercase tracking-widest text-white/50">{agent.id}</div>
                    </motion.div>
                )
            })}
        </div>


        <h2 className="font-display font-black text-[clamp(3rem,8vw,9rem)] text-white leading-[0.9] tracking-tighter mb-16">
          The future of work<br /><span className="green-glow-text text-accent-mint">is autonomous.</span>
        </h2>

        <motion.div
           initial={{ opacity: 0, scale: 0.9 }}
           animate={currentTypingIndex === AGENTS_SEQUENCE.length - 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
           transition={{ duration: 0.8, type: "spring", bounce: 0.5 }}
           className="flex flex-col sm:flex-row items-center justify-center gap-6 w-full"
        >
          <button 
            onClick={() => navigate('/auth')} 
            className="shimmer-btn w-full sm:w-auto h-[80px] px-16 bg-accent-mint text-black font-black text-lg md:text-xl uppercase tracking-[0.2em] rounded-2xl shadow-[0_0_80px_rgba(0,255,148,0.6)] hover:shadow-[0_0_120px_rgba(0,255,148,0.8)] hover:scale-105 transition-all flex items-center justify-center gap-4 group"
          >
            Wake Your Team Up <ArrowRight className="w-8 h-8 group-hover:translate-x-2 transition-transform" />
          </button>
        </motion.div>

        <div className="mt-20 flex flex-wrap justify-center gap-8 md:gap-12 opacity-40">
           <div className="text-[10px] font-black uppercase tracking-widest text-white">14-Day Free Trial</div>
           <div className="text-[10px] font-black uppercase tracking-widest text-white">No Credit Card</div>
           <div className="text-[10px] font-black uppercase tracking-widest text-white">Cancel Anytime</div>
        </div>
      </div>
    </section>
    );
};

export default FinalCTA;