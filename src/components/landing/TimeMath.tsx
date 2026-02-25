import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const rows = [
    { task: 'Finding candidates for a role', manual: '3-4 weeks, 45 hours', sp: '12-15 minutes' },
    { task: 'Screening 100 resumes', manual: '8-10 hours', sp: 'Instant (AI scores all)' },
    { task: 'Finding candidate emails', manual: '2-3 hours researching', sp: 'One click per candidate' },
    { task: 'Writing personalized outreach', manual: '30 min per candidate', sp: 'Automated for all' },
    { task: 'Full sourcing-to-outreach cycle', manual: '50-60 hours', sp: 'Under 1 hour', highlight: true },
];

const TimeMath = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            rowRefs.current.forEach((row, i) => {
                if (!row) return;
                const manualEl = row.querySelector('.manual-col');
                const spEl = row.querySelector('.sp-col');

                gsap.fromTo(row, { opacity: 0, y: 15 }, {
                    opacity: 1, y: 0, duration: 0.5, delay: i * 0.15,
                    ease: 'power3.out',
                    scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                });
                if (spEl) {
                    gsap.fromTo(spEl, { opacity: 0, x: 30 }, {
                        opacity: 1, x: 0, duration: 0.4, delay: 0.3 + i * 0.15,
                        ease: 'power3.out',
                        scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                    });
                }
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-zinc-50/50 px-4 py-28 md:py-36">
            <div className="max-w-4xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-emerald-600 font-semibold">
                    ◆ The Time Math
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.6rem,4vw,2.8rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-14">
                    WHAT TAKES YOUR AGENCY 4 WEEKS<br />TAKES US 15 MINUTES
                </h2>

                {/* Table header */}
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-4 mb-3 px-4">
                    <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">Task</span>
                    <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">Manual / Agency</span>
                    <span className="text-xs text-emerald-600 font-semibold uppercase tracking-wider">ScreeningPilot</span>
                </div>

                {/* Rows */}
                <div className="space-y-2">
                    {rows.map((row, i) => (
                        <div
                            key={i}
                            ref={el => { rowRefs.current[i] = el; }}
                            className={`grid grid-cols-[1fr_1fr_1fr] gap-4 items-center rounded-xl px-4 py-4 opacity-0 ${row.highlight ? 'bg-emerald-50 border border-emerald-200/50' : 'bg-white border border-zinc-100'
                                }`}
                        >
                            <span className={`text-sm font-medium ${row.highlight ? 'text-zinc-900 font-semibold' : 'text-zinc-700'}`}>
                                {row.task}
                            </span>
                            <span className="manual-col text-sm text-zinc-400">{row.manual}</span>
                            <span className={`sp-col text-sm font-semibold opacity-0 ${row.highlight ? 'text-emerald-700 text-base' : 'text-emerald-600'}`}>
                                {row.sp}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Summary */}
                <p className="text-sm text-zinc-400 mt-8 text-center">
                    That's a <strong className="text-zinc-700">70%+ reduction</strong> in sourcing time and <strong className="text-zinc-700">10-40x more candidates</strong>.
                </p>
            </div>
        </section>
    );
};

export default TimeMath;
