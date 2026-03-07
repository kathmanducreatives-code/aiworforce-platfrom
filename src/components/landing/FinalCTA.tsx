import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const FinalCTA = () => {
    const navigate = useNavigate();

    return (
        <section className="relative px-4 py-28 md:py-36 overflow-hidden">
            {/* Gradient glow */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.06] via-transparent to-teal-500/[0.04]" />
                <div className="absolute w-[500px] h-[500px] rounded-full bg-emerald-500/[0.08] blur-[150px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>

            <div className="relative z-10 text-center max-w-6xl mx-auto">
                <h2 className="font-display font-black text-[clamp(2.2rem,5vw,4.5rem)] leading-[1.0] tracking-[-0.05em] text-white mb-8">
                    READY TO FIRE YOUR<br /><span className="text-shimmer">RECRUITING AGENCY?</span>
                </h2>
                <p className="text-lg text-white/40 mb-10 max-w-xl mx-auto">
                    Stop paying €15,000+ per hire. Start hiring unlimited for €149/month.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button onClick={() => navigate('/auth')} className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]">
                        Start Free Trial
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <button onClick={() => navigate('/get-demo')} className="h-[44px] inline-flex items-center gap-2 bg-transparent border border-white/15 text-white/60 hover:text-white hover:border-white/30 font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:bg-white/5">
                        Book a Demo
                    </button>
                </div>
                <p className="text-xs text-white/20 mt-6">Cancel anytime · No per-hire fees · Setup in 5 minutes</p>
            </div>
        </section>
    );
};

export default FinalCTA;
