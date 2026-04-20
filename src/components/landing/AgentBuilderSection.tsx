import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Terminal, Play, Settings, ShieldAlert, Cpu } from 'lucide-react';
import { ToolLogoImage } from './ToolLogos';

const FULL_PROMPT = "You are our primary Customer Success Agent.\n1. When a user asks a technical question, query Notion.\n2. Summarize the answer in under 50 words.\n3. Identify the missing information and ping the engineers in Slack.\n4. If the user sounds angry, escalate directly to the Founder.";

const AgentBuilderSection = () => {
  const [step, setStep] = useState(0);
  const [typedPrompt, setTypedPrompt] = useState("");

  useEffect(() => {
    let isActive = true;
    
    const runSequence = async () => {
      while (isActive) {
        // Reset
        setStep(0);
        setTypedPrompt("Drafting routine...");
        await new Promise(r => setTimeout(r, 2000));
        if (!isActive) break;

        // Step 1: Swap Tools
        setStep(1);
        await new Promise(r => setTimeout(r, 1500));
        if (!isActive) break;

        // Step 2: Rewrite Prompt
        setStep(2);
        setTypedPrompt("");
        const chars = FULL_PROMPT.split('');
        let currentString = "";
        for (let i = 0; i < chars.length; i++) {
          if (!isActive) break;
          currentString += chars[i];
          setTypedPrompt(currentString);
          await new Promise(r => setTimeout(r, 15 + Math.random() * 20));
        }
        await new Promise(r => setTimeout(r, 1000));
        if (!isActive) break;

        // Step 3: Deploy
        setStep(3);
        await new Promise(r => setTimeout(r, 5000));
      }
    };

    runSequence();

    return () => { isActive = false; };
  }, []);

  return (
    <section id="customization" className="relative z-10 py-16 md:py-24 bg-transparent overflow-hidden border-t border-white/5">
      {/* Blueprint Grid Background */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
        backgroundImage: `linear-gradient(#00FF94 1px, transparent 1px), linear-gradient(90deg, #00FF94 1px, transparent 1px)`,
        backgroundSize: '40px 40px'
      }} />

      <div className="max-w-[1200px] mx-auto px-6 relative">
        <div className="text-center mb-24">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/40 bg-accent-mint/5 mb-8">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold mt-px">THE LABORATORY</span>
          </div>
          <h2 className="font-display font-bold text-4xl md:text-6xl text-white leading-[1.0] mb-8 tracking-tight">
            Train once.<br/>Every agent remembers.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            Drop your voice, ICP, and operating rules into Pilot. Scout, Aria, Radar, and Penn stop acting generic and start working like they already know your company.
          </p>
        </div>

        {/* Builder Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-stretch max-w-5xl mx-auto">
          
          {/* Left: Constructor UI */}
          <div className="glass-card-premium rounded-3xl shadow-[0_40px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col">
            <div className="bg-white/[0.02] px-6 py-4 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mt-1">Constructor v2.4</span>
                <div className="flex gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[9px] font-bold text-amber-500 uppercase">Configuration Mode</span>
                </div>
            </div>

            <div className="p-8 space-y-8 flex-1">
                <div>
                    <label className="text-[10px] text-white/50 font-black uppercase tracking-widest mb-3 block">Agent Designation</label>
                    <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white font-bold text-sm tracking-tight flex items-center justify-between">
                        Customer Success Agent
                        <Terminal className="w-4 h-4 text-white/40" />
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-white/50 font-black uppercase tracking-widest mb-3 block">Primary Toolset</label>
                    <div className="flex gap-3">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <ToolLogoImage toolId="claude" size={24} />
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <ToolLogoImage toolId="notion" size={24} />
                        </div>
                        {/* Swapping Tool Animation */}
                        <div className="relative w-12 h-12 shrink-0">
                            <AnimatePresence mode="popLayout">
                                {step < 1 ? (
                                    <motion.div 
                                        key="nanobanana"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8, y: -20 }}
                                        className="absolute inset-0 rounded-xl border border-red-500/20 bg-red-500/10 flex items-center justify-center"
                                    >
                                        <ToolLogoImage toolId="nanobanana" size={20} />
                                    </motion.div>
                                ) : (
                                    <motion.div 
                                        key="midjourney"
                                        initial={{ opacity: 0, scale: 0.8, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        className="absolute inset-0 rounded-xl border border-accent-mint/30 bg-accent-mint/10 flex items-center justify-center"
                                    >
                                        <ToolLogoImage toolId="midjourney" size={20} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-white/[0.02] border border-white/5 border-dashed flex items-center justify-center">
                            <span className="text-white/40 text-xs font-bold">+</span>
                        </div>
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-3">
                        <label className="text-[10px] text-white/50 font-black uppercase tracking-widest block">Directives</label>
                        <span className="text-[9px] font-mono text-accent-mint bg-accent-mint/10 px-2 py-0.5 rounded uppercase">Auto-Save</span>
                    </div>
                    <div className="bg-black/50 border border-white/10 rounded-xl overflow-hidden min-h-[160px] relative flex">
                        {/* Line number gutter */}
                        <div className="w-10 shrink-0 bg-white/[0.02] border-r border-white/5 pt-4 pb-4 flex flex-col items-center select-none">
                            {(typedPrompt || " ").split('\n').map((_, i) => (
                                <div key={i} className="text-[10px] font-mono text-white/15 leading-[1.8] tabular-nums h-[1.8em] flex items-center justify-center">
                                    {String(i + 1).padStart(2, '0')}
                                </div>
                            ))}
                        </div>
                        {/* Code area */}
                        <div className="flex-1 p-4">
                            <div className="text-white/80 font-mono text-xs leading-[1.8] whitespace-pre-wrap">
                                {typedPrompt}
                                {step === 2 && <span className="inline-block w-2 h-3 ml-1 bg-accent-mint animate-pulse" />}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-2 mt-auto">
                    <button className={`w-full py-4 rounded-xl font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all duration-500
                        ${step === 3 
                            ? 'bg-accent-mint/10 text-accent-mint border border-accent-mint/20 cursor-default' 
                            : 'bg-white text-black hover:bg-accent-mint hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                        }
                    `}>
                        {step === 3 ? (
                            <><Check className="w-4 h-4" /> Agent Live</>
                        ) : (
                            <><Play className="w-4 h-4" /> Compile & Deploy</>
                        )}
                    </button>
                </div>
            </div>
          </div>

          {/* Right: Live Preview */}
           <div className="glass-card-premium rounded-3xl border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col bg-[#050505]">
               <div className="bg-white/[0.02] px-6 py-4 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mt-1">Live Agent Preview</span>
                <div className="flex gap-2">
                    <div className={`w-2 h-2 rounded-full ${step === 3 ? 'bg-accent-mint' : 'bg-red-500'} animate-pulse`} />
                    <span className={`text-[9px] font-bold uppercase ${step === 3 ? 'text-accent-mint' : 'text-red-500'}`}>
                        {step === 3 ? 'Online' : 'Offline'}
                    </span>
                </div>
            </div>

            <div className="p-8 flex-1 flex flex-col items-center justify-center relative">
                
                {/* Visualizer rings */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full border border-white/5 flex items-center justify-center opacity-50 pointer-events-none">
                    <div className={`w-56 h-56 rounded-full border border-white/5 flex items-center justify-center transition-all duration-1000 ${step === 3 ? 'border-accent-mint/30 shadow-[0_0_50px_rgba(0,255,148,0.1)] rotate-180' : ''}`}>
                        <div className={`w-32 h-32 rounded-full border flex items-center justify-center transition-all duration-1000 ${step === 3 ? 'border-accent-mint/50 bg-accent-mint/5 -rotate-90' : 'border-white/10 bg-white/[0.02]'}`}>
                            
                        </div>
                    </div>
                </div>

                <div className={`relative z-10 w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-1000 mb-8 border backdrop-blur-md shadow-2xl
                    ${step === 3 ? 'bg-[#00FF94] border-[#00FF94] shadow-[0_0_40px_rgba(0,255,148,0.4)] scale-110' : 'bg-white/5 border-white/10 scale-100'}
                `}>
                    <Cpu className={`w-10 h-10 ${step === 3 ? 'text-black' : 'text-white/50'}`} />
                </div>

                <div className="relative z-10 text-center w-full">
                    <AnimatePresence mode="wait">
                        {step < 3 ? (
                            <motion.div 
                                key="offline"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="flex flex-col items-center gap-4"
                            >
                                <div className="text-white/50 font-mono text-sm uppercase tracking-widest font-bold">
                                    Awaiting Compilation...
                                </div>
                                {/* Terminal scanline */}
                                <div className="w-full max-w-[200px] h-16 rounded-lg bg-white/[0.02] border border-white/5 relative overflow-hidden">
                                    <div 
                                        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-accent-mint/40 to-transparent"
                                        style={{ animation: 'scanline 2s linear infinite' }}
                                    />
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div 
                                key="online"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="w-full"
                            >
                                <div className="p-4 rounded-xl bg-accent-mint/[0.05] border border-accent-mint/20 text-left relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2 opacity-20">
                                        <ToolLogoImage toolId="notion" size={40} className="grayscale" />
                                    </div>
                                    <h4 className="text-accent-mint font-bold text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
                                        System Message
                                    </h4>
                                    <p className="text-white/70 text-sm leading-relaxed font-medium">
                                        Successfully established neural link to <span className="font-bold text-white">Notion Workspace</span> and <span className="font-bold text-white">Slack</span>. I have indexed 142 knowledge base articles. Ready to handle customer inquiries according to custom directives.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

           </div>
        </div>

        {/* Template Pills */}
        <div className="mt-20 flex flex-wrap justify-center gap-3">
          {['📧 Customer Success', '💰 Fundraising', '🤝 Partnerships', '📞 Outreach', '📱 Community Management', '🌍 Localization'].map((t, i) => (
            <div key={i} className="px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-white/50 font-bold uppercase tracking-widest hover:border-accent-mint/30 hover:text-accent-mint transition-colors cursor-pointer hover:bg-white/10">
              {t}
            </div>
          ))}
          <div className="px-5 py-2.5 rounded-full bg-transparent border border-white/5 text-[10px] text-white/40 font-bold uppercase tracking-widest">+ 150 More Presets</div>
        </div>
      </div>
    </section>
  );
};

export default AgentBuilderSection;