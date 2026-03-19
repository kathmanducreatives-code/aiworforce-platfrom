import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const rows = [
    { task: 'Candidate sourcing', manual: '40 hrs/month — agency sends 5 profiles', sp: 'AI scores 500+ candidates in seconds' },
    { task: 'Resume screening', manual: '€24,000/hire — agency fee for manual review', sp: 'AI auto-rejects 95% of bad fits instantly' },
    { task: 'Interview prep', manual: 'Zero prep — agency sends you blind', sp: 'Full interview blueprint generated per candidate' },
    { task: 'Candidate pipeline', manual: 'Black box — you have no visibility', sp: 'Real-time dashboard with every score and reason' },
    { task: 'Cost per hire', manual: '€8,200 average per placement', sp: '€149/month flat — unlimited screenings', highlight: true },
];

const TimeMath = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const rowEls = tableRef.current?.querySelectorAll('.time-row');
            if (rowEls) {
                rowEls.forEach((row, i) => {
                    gsap.fromTo(row, { opacity: 0, x: -20 }, {
                        opacity: 1, x: 0, duration: 0.5, delay: i * 0.15, ease: 'power3.out',
                        scrollTrigger: { trigger: tableRef.current, start: 'top 70%', toggleActions: 'play none none none' },
                    });
                    const spCell = row.querySelector('.sp-cell');
                    if (spCell) {
                        gsap.fromTo(spCell, { opacity: 0, x: 30 }, {
                            opacity: 1, x: 0, duration: 0.4, delay: 0.3 + i * 0.15, ease: 'power3.out',
                            scrollTrigger: { trigger: tableRef.current, start: 'top 70%', toggleActions: 'play none none none' },
                        });
                    }
                });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative px-4 py-28 md:py-36">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-14">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ The Math Doesn't Lie</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
                        YOUR AGENCY VS. SCREENINGPILOT
                    </h2>
                </div>
                <div ref={tableRef} className="glass-strong rounded-2xl overflow-hidden">
                    <div className="grid grid-cols-3 gap-0 text-xs font-semibold text-white/30 uppercase tracking-wider px-6 py-4 border-b border-white/[0.06]">
                        <span>Task</span><span>Recruiting Agency</span><span className="text-emerald-400">ScreeningPilot</span>
                    </div>
                    {rows.map((row, i) => (
                        <div key={i} className={`time-row grid grid-cols-3 gap-0 px-6 py-4 opacity-0 border-b border-white/[0.03] last:border-0 ${row.highlight ? 'bg-emerald-500/[0.06]' : ''}`}>
                            <span className={`text-sm ${row.highlight ? 'font-bold text-white' : 'text-white/60'}`}>{row.task}</span>
                            <span className="text-sm text-white/40">{row.manual}</span>
                            <span className={`sp-cell text-sm font-semibold opacity-0 ${row.highlight ? 'text-emerald-400 text-base' : 'text-emerald-400/80'}`}>{row.sp}</span>
                        </div>
                    ))}
                </div>
                <p className="text-center text-white/70 text-sm mt-6">
                    Companies using ScreeningPilot save an average of <span className="text-emerald-400 font-semibold">€80,000/year</span> in agency fees.
                </p>
            </div>
        </section>
    );
};

export default TimeMath;
