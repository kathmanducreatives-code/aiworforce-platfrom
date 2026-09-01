import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const FinalCTA = () => {
    const navigate = useNavigate();

    return (
        <section className="relative px-4 py-28 md:py-36 overflow-hidden">
            {/* Subtle accent glow — not green background */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute w-[500px] h-[500px] rounded-full bg-emerald-500/[0.04] blur-[150px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>

            <div className="relative z-10 text-center max-w-3xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.15em] mb-6 text-emerald-400 font-semibold">GET STARTED</p>

                <h2 className="font-display font-black text-[clamp(2rem,4.5vw,3.8rem)] leading-[1.05] tracking-[-0.04em] text-white mb-8">
                    Your AI team is ready.<br />They just need to know<br />your company.
                </h2>
                <p className="text-lg text-white/40 mb-10 max-w-xl mx-auto leading-relaxed">
                    A few minutes and a few questions about your business. From then on your AI employees know who you are, what you sell and who you sell to — and you can start handing them work.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button onClick={() => navigate('/auth')} className="conic-border group h-[48px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-10 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]">
                        Put Agentory to work
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <button onClick={() => navigate('/auth')} className="h-[44px] inline-flex items-center gap-2 bg-transparent border border-white/15 text-white/60 hover:text-white hover:border-white/30 font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:bg-white/5">
                        Book a 20-minute setup call
                    </button>
                </div>
                <p className="text-xs text-white/20 mt-6">Start free · No credit card · Cancel anytime</p>
            </div>
        </section>
    );
};

export default FinalCTA;