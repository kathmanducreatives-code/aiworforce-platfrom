import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const SavingsCalculator = () => {
    const navigate = useNavigate();
    const widgetRef = useRef<HTMLDivElement>(null);
    const [hires, setHires] = useState(10);
    const [salary, setSalary] = useState(80000);
    const [displaySavings, setDisplaySavings] = useState(0);
    const savingsRef = useRef(0);

    const agencyCost = Math.round(hires * salary * 0.2);
    const spCost = 149 * 12;
    const savings = agencyCost - spCost;
    const extraHires = Math.floor(Math.max(0, savings) / salary);

    // Smooth savings number tween
    useEffect(() => {
        const target = Math.max(0, savings);
        const start = savingsRef.current;
        const diff = target - start;
        let raf: number;
        const startTime = performance.now();
        const duration = 200;

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + diff * eased);
            setDisplaySavings(current);
            savingsRef.current = current;
            if (progress < 1) raf = requestAnimationFrame(animate);
        };
        raf = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(raf);
    }, [savings]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Float-in entrance
            gsap.fromTo(widgetRef.current,
                { x: 100, y: 40, opacity: 0, scale: 0.9 },
                {
                    x: 0, y: 0, opacity: 1, scale: 1,
                    duration: 0.8,
                    ease: 'expo.out',
                    scrollTrigger: {
                        trigger: widgetRef.current,
                        start: 'top 85%',
                        toggleActions: 'play none none none',
                    },
                }
            );
        }, widgetRef);
        return () => ctx.revert();
    }, []);

    return (
        <div className="relative py-20 px-4 flex justify-center">
            <div
                ref={widgetRef}
                className="opacity-0 w-full max-w-[560px] bg-white rounded-[20px] p-8 md:p-10 border border-emerald-500/[0.12] shadow-[0_30px_80px_rgba(0,0,0,0.10),0_10px_30px_rgba(0,0,0,0.06),0_0_80px_rgba(5,150,105,0.08)]"
                style={{ animation: 'widget-float 3s ease-in-out infinite' }}
            >
                <p className="font-sans font-bold text-lg text-zinc-900 mb-6">💰 How much are you overpaying?</p>

                {/* Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                    <div>
                        <label className="text-sm font-semibold text-zinc-600 mb-2 block">Hires per year</label>
                        <input
                            type="range" min={1} max={50} value={hires}
                            onChange={(e) => setHires(Number(e.target.value))}
                            className="w-full h-2 bg-zinc-100 rounded-full appearance-none cursor-pointer"
                            style={{ accentColor: '#059669' }}
                        />
                        <p className="font-mono font-bold text-xl text-zinc-900 mt-2 tabular-nums">{hires}</p>
                    </div>
                    <div>
                        <label className="text-sm font-semibold text-zinc-600 mb-2 block">Average salary</label>
                        <input
                            type="range" min={30000} max={200000} step={5000} value={salary}
                            onChange={(e) => setSalary(Number(e.target.value))}
                            className="w-full h-2 bg-zinc-100 rounded-full appearance-none cursor-pointer"
                            style={{ accentColor: '#059669' }}
                        />
                        <p className="font-mono font-bold text-xl text-zinc-900 mt-2 tabular-nums">€{salary.toLocaleString()}</p>
                    </div>
                </div>

                {/* Cost comparison */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-zinc-50 rounded-xl p-4 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">Agency cost</p>
                        <p className="font-mono font-bold text-lg text-zinc-400 line-through tabular-nums">€{agencyCost.toLocaleString()}/yr</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                        <p className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold mb-1">ScreeningPilot</p>
                        <p className="font-mono font-bold text-lg text-emerald-600 tabular-nums">€1,788/yr</p>
                    </div>
                </div>

                {/* Savings */}
                <div className="bg-emerald-50/60 rounded-xl p-5 text-center border border-emerald-100/60 mb-6">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold mb-1">You save</p>
                    <p className="font-mono font-extrabold text-4xl md:text-5xl text-emerald-600 tabular-nums tracking-tighter transition-transform">
                        €{displaySavings.toLocaleString()}<span className="text-base text-emerald-400 font-normal">/year</span>
                    </p>
                    {extraHires > 0 && (
                        <p className="text-sm text-zinc-500 mt-2">
                            That's <strong className="text-zinc-800">{extraHires} more engineer{extraHires > 1 ? 's' : ''}</strong>.
                        </p>
                    )}
                </div>

                <button
                    onClick={() => navigate('/auth')}
                    className="group w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm py-3.5 rounded-xl transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_6px_24px_rgba(5,150,105,0.3)]"
                >
                    Start Saving Now
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>
            </div>
        </div>
    );
};

export default SavingsCalculator;
