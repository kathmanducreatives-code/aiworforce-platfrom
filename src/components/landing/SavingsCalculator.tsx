import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, X, Calculator } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const SavingsCalculator = () => {
    const navigate = useNavigate();
    const triggerRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [hasTriggered, setHasTriggered] = useState(false);
    const [hires, setHires] = useState(10);
    const [salary, setSalary] = useState(80000);
    const [displaySavings, setDisplaySavings] = useState(0);
    const savingsRef = useRef(0);

    const agencyCost = Math.round(hires * salary * 0.2);
    const spCost = 149 * 12;
    const savings = agencyCost - spCost;
    const extraHires = Math.floor(Math.max(0, savings) / salary);

    // Smooth number tween
    useEffect(() => {
        const target = Math.max(0, savings);
        const start = savingsRef.current;
        const diff = target - start;
        let raf: number;
        const startTime = performance.now();
        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / 200, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + diff * eased);
            setDisplaySavings(current);
            savingsRef.current = current;
            if (progress < 1) raf = requestAnimationFrame(animate);
        };
        raf = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(raf);
    }, [savings]);

    // Trigger popup when scrolling past Dashboard section
    useEffect(() => {
        const st = ScrollTrigger.create({
            trigger: triggerRef.current,
            start: 'top center',
            onEnter: () => {
                if (!hasTriggered) {
                    setHasTriggered(true);
                    setTimeout(() => setIsOpen(true), 400);
                }
            },
        });
        return () => st.kill();
    }, [hasTriggered]);

    return (
        <>
            {/* Invisible scroll trigger between Dashboard & Screening */}
            <div ref={triggerRef} className="h-0 w-0" />

            {/* Notification popup — fixed bottom-right */}
            <div className={`fixed bottom-6 right-6 z-50 transition-all duration-500 ${isOpen
                    ? 'translate-y-0 opacity-100 scale-100'
                    : 'translate-y-[120%] opacity-0 scale-95'
                }`} style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                <div className="w-[340px] sm:w-[380px] bg-white rounded-2xl border border-emerald-500/[0.15] shadow-[0_20px_60px_rgba(0,0,0,0.15),0_8px_24px_rgba(0,0,0,0.08),0_0_60px_rgba(5,150,105,0.08)] overflow-hidden">
                    {/* Header bar */}
                    <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Calculator className="w-4 h-4 text-white/80" />
                            <span className="text-white font-semibold text-sm">How much are you overpaying?</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white transition-colors p-0.5">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="p-5">
                        {/* Sliders */}
                        <div className="space-y-4 mb-5">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="text-xs font-medium text-zinc-500">Hires per year</label>
                                    <span className="font-mono font-bold text-sm text-zinc-900 tabular-nums">{hires}</span>
                                </div>
                                <input type="range" min={1} max={50} value={hires} onChange={(e) => setHires(Number(e.target.value))}
                                    className="w-full h-1.5 bg-zinc-100 rounded-full appearance-none cursor-pointer" style={{ accentColor: '#059669' }} />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="text-xs font-medium text-zinc-500">Average salary</label>
                                    <span className="font-mono font-bold text-sm text-zinc-900 tabular-nums">€{salary.toLocaleString()}</span>
                                </div>
                                <input type="range" min={30000} max={200000} step={5000} value={salary} onChange={(e) => setSalary(Number(e.target.value))}
                                    className="w-full h-1.5 bg-zinc-100 rounded-full appearance-none cursor-pointer" style={{ accentColor: '#059669' }} />
                            </div>
                        </div>

                        {/* Cost comparison row */}
                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-zinc-50 rounded-lg p-3 text-center">
                                <p className="text-[9px] uppercase tracking-wider text-zinc-400 font-semibold mb-0.5">Agency</p>
                                <p className="font-mono font-bold text-sm text-zinc-400 line-through tabular-nums">€{agencyCost.toLocaleString()}</p>
                            </div>
                            <div className="bg-emerald-50 rounded-lg p-3 text-center border border-emerald-100">
                                <p className="text-[9px] uppercase tracking-wider text-emerald-600 font-semibold mb-0.5">ScreeningPilot</p>
                                <p className="font-mono font-bold text-sm text-emerald-600 tabular-nums">€1,788/yr</p>
                            </div>
                        </div>

                        {/* Savings */}
                        <div className="bg-emerald-50/70 rounded-xl p-4 text-center border border-emerald-100/60 mb-4">
                            <p className="text-[9px] uppercase tracking-wider text-emerald-500 font-bold mb-0.5">You save</p>
                            <p className="font-mono font-extrabold text-2xl text-emerald-600 tabular-nums tracking-tighter">
                                €{displaySavings.toLocaleString()}<span className="text-xs text-emerald-400 font-normal">/yr</span>
                            </p>
                            {extraHires > 0 && (
                                <p className="text-[11px] text-zinc-500 mt-1">That's <strong className="text-zinc-800">{extraHires}</strong> more engineer{extraHires > 1 ? 's' : ''}.</p>
                            )}
                        </div>

                        <button onClick={() => navigate('/auth')}
                            className="group w-full inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs py-2.5 rounded-lg transition-all duration-300 hover:shadow-[0_4px_16px_rgba(5,150,105,0.3)]">
                            Start Saving Now <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Reopen button when closed */}
            {hasTriggered && !isOpen && (
                <button onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 rounded-full shadow-[0_8px_24px_rgba(5,150,105,0.35)] flex items-center justify-center text-white transition-all duration-300 hover:scale-110 animate-bounce"
                    style={{ animationDuration: '2s' }}>
                    <Calculator className="w-6 h-6" />
                </button>
            )}
        </>
    );
};

export default SavingsCalculator;
