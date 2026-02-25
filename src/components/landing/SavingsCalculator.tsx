import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const SavingsCalculator = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [hires, setHires] = useState(10);
    const [salary, setSalary] = useState(80000);

    const agencyCost = Math.round(hires * salary * 0.2);
    const spCost = 149 * 12;
    const savings = agencyCost - spCost;
    const extraHires = Math.floor(savings / salary);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(cardRef.current, { opacity: 0, scale: 0.95, y: 30 }, {
                opacity: 1, scale: 1, y: 0, duration: 0.8, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-zinc-50/50 px-4 py-28 md:py-36">
            <div className="max-w-3xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-emerald-600 font-semibold text-center">
                    ◆ The Money Math
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.6rem,4vw,2.8rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 text-center mb-3">
                    YOUR AGENCY IS CHARGING YOU €82,000/YEAR.<br />WE CHARGE €1,788.
                </h2>
                <p className="text-zinc-400 text-center mb-12 text-sm font-medium">Do the math. Then fire your agency.</p>

                <div ref={cardRef} className="bg-white rounded-2xl p-8 md:p-10 border border-zinc-200/60 shadow-[0_12px_40px_rgba(0,0,0,0.06)] opacity-0">
                    {/* Hires slider */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-semibold text-zinc-700">How many hires per year?</label>
                            <span className="font-mono font-bold text-lg text-zinc-900 tabular-nums">{hires}</span>
                        </div>
                        <input
                            type="range" min={1} max={50} value={hires}
                            onChange={(e) => setHires(Number(e.target.value))}
                            className="w-full h-2 bg-zinc-100 rounded-full appearance-none cursor-pointer accent-emerald-600"
                            style={{ accentColor: '#059669' }}
                        />
                        <div className="flex justify-between text-[10px] text-zinc-300 mt-1">
                            <span>1</span><span>25</span><span>50</span>
                        </div>
                    </div>

                    {/* Salary slider */}
                    <div className="mb-10">
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-semibold text-zinc-700">Average salary per hire?</label>
                            <span className="font-mono font-bold text-lg text-zinc-900 tabular-nums">€{salary.toLocaleString()}</span>
                        </div>
                        <input
                            type="range" min={30000} max={200000} step={5000} value={salary}
                            onChange={(e) => setSalary(Number(e.target.value))}
                            className="w-full h-2 bg-zinc-100 rounded-full appearance-none cursor-pointer"
                            style={{ accentColor: '#059669' }}
                        />
                        <div className="flex justify-between text-[10px] text-zinc-300 mt-1">
                            <span>€30K</span><span>€100K</span><span>€200K</span>
                        </div>
                    </div>

                    {/* Results */}
                    <div className="space-y-4 border-t border-zinc-100 pt-8">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-500">Agency cost (20% fee):</span>
                            <span className="font-mono font-bold text-lg text-zinc-400 line-through tabular-nums">
                                €{agencyCost.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-500">ScreeningPilot cost:</span>
                            <span className="font-mono font-bold text-lg text-emerald-600 tabular-nums">€{spCost.toLocaleString()}/year</span>
                        </div>
                        <div className="border-t border-zinc-100 pt-4">
                            <div className="flex items-center justify-between">
                                <span className="text-base font-semibold text-zinc-900">You save:</span>
                                <span className="font-mono font-extrabold text-3xl md:text-5xl text-emerald-600 tabular-nums tracking-tighter">
                                    €{Math.max(0, savings).toLocaleString()}<span className="text-lg text-zinc-400 font-normal">/year</span>
                                </span>
                            </div>
                        </div>
                        {extraHires > 0 && (
                            <p className="text-sm text-zinc-400 text-right mt-2">
                                That's enough to hire <strong className="text-zinc-700">{extraHires} more employees</strong>
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default SavingsCalculator;
