import React, { useState, useEffect } from 'react';
import { Terminal, CheckCircle2, Loader2, Sparkles, Filter, Database, Cpu } from 'lucide-react';

interface InterceptionLoaderProps {
    onComplete: () => void;
    post: any;
}

const stepDefs = [
    { id: 1, label: 'Connecting to LinkedIn scraper…', icon: Database },
    { id: 2, label: 'Scraping comments & profile data…', icon: Filter },
    { id: 3, label: 'Filtering for qualified buyers…', icon: Cpu },
    { id: 4, label: 'Claude analyzing buying signals…', icon: Sparkles },
    { id: 5, label: 'Generating connection notes…', icon: CheckCircle2 },
];

const InterceptionLoader: React.FC<InterceptionLoaderProps> = ({ onComplete, post }) => {
    const [steps, setSteps] = useState(stepDefs.map(s => ({ ...s, status: s.id === 1 ? 'loading' : 'waiting' as 'loading' | 'waiting' | 'complete' })));
    const [currentStep, setCurrentStep] = useState(0);

    useEffect(() => {
        if (currentStep < steps.length) {
            const timer = setTimeout(() => {
                setSteps(prev => prev.map((step, idx) => {
                    if (idx === currentStep) return { ...step, status: 'complete' as const };
                    if (idx === currentStep + 1) return { ...step, status: 'loading' as const };
                    return step;
                }));
                setCurrentStep(prev => prev + 1);
            }, 2500);
            return () => clearTimeout(timer);
        } else {
            const finalTimer = setTimeout(onComplete, 1000);
            return () => clearTimeout(finalTimer);
        }
    }, [currentStep]);

    const progress = Math.round((currentStep / steps.length) * 100);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] w-full max-w-2xl mx-auto px-6 py-10 animate-fade-in">
            {/* Terminal card */}
            <div className="w-full bg-[#0c0c0e] border border-white/[0.10] rounded-2xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_30px_rgba(59,130,246,0.08)] relative overflow-hidden">
                {/* Glow border effect */}
                <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.08), transparent 50%, rgba(139,92,246,0.06))',
                }} />

                {/* Terminal header — macOS-style dots */}
                <div className="flex items-center gap-2 mb-8 pb-4 border-b border-white/[0.06] relative">
                    <div className="flex gap-[7px]">
                        <div className="w-[11px] h-[11px] rounded-full bg-[#ff5f57]" />
                        <div className="w-[11px] h-[11px] rounded-full bg-[#febc2e]" />
                        <div className="w-[11px] h-[11px] rounded-full bg-[#28c840]" />
                    </div>
                    <div className="ml-3 text-slate-500 text-xs font-mono flex items-center gap-2">
                        <Terminal size={13} />
                        interceptor --post="{post?.author?.toLowerCase().replace(' ', '_') ?? 'target'}"
                    </div>
                </div>

                {/* Steps */}
                <div className="flex flex-col gap-5 relative">
                    {steps.map((step) => {
                        const isComplete = step.status === 'complete';
                        const isLoading = step.status === 'loading';
                        const isWaiting = step.status === 'waiting';

                        return (
                            <div
                                key={step.id}
                                className={[
                                    'flex items-center gap-4 transition-all duration-500',
                                    isWaiting ? 'opacity-25' : 'opacity-100',
                                    isLoading ? 'animate-fade-in' : '',
                                ].join(' ')}
                            >
                                {/* Icon */}
                                <div className={[
                                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300',
                                    isComplete ? 'bg-emerald-500/15 text-emerald-400' : '',
                                    isLoading ? 'bg-blue-500/15 text-blue-400' : '',
                                    isWaiting ? 'bg-white/[0.03] text-slate-600' : '',
                                ].join(' ')}>
                                    {isLoading
                                        ? <Loader2 size={16} className="animate-spin" />
                                        : isComplete
                                            ? <CheckCircle2 size={16} />
                                            : <step.icon size={16} />
                                    }
                                </div>

                                {/* Label */}
                                <span className={[
                                    'text-sm font-mono transition-colors duration-300',
                                    isComplete ? 'text-slate-300 font-medium' : '',
                                    isLoading ? 'text-blue-400 font-semibold' : '',
                                    isWaiting ? 'text-slate-600' : '',
                                ].join(' ')}>
                                    {step.label}
                                </span>

                                {/* Success badge */}
                                {isComplete && (
                                    <span className="ml-auto text-[11px] font-bold font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md animate-scale-in">
                                        ✓ SUCCESS
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Progress bar */}
                <div className="mt-10 relative">
                    <div className="flex justify-between text-[11px] text-slate-500 mb-2 font-mono">
                        <span>Progress</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 shadow-[0_0_12px_rgba(59,130,246,0.5)] transition-all duration-700 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Subtitle */}
            <p className="mt-6 text-slate-500 text-xs text-center leading-relaxed max-w-sm">
                Claude is identifying targets based on intent signals in comments.
                <br />This usually takes about 10-15 seconds.
            </p>
        </div>
    );
};

export default InterceptionLoader;
