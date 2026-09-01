import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Quote } from 'lucide-react';
import { EMPLOYEE_BY_ID, type EmployeeId } from './employees';
import { EmployeeAvatar } from './EmployeePortrait';

gsap.registerPlugin(ScrollTrigger);

// NOT TESTIMONIALS. These cards previously carried anonymous quotes with
// specific financial claims that nothing sourced. The section, cards, chips and
// animation are unchanged; the content is now a description of the work
// Agentory actually does, which needs no attribution to be true.
const useCases = [
    { body: "Research markets, find companies, check the signals you asked for, and return qualified opportunities with the evidence attached.", name: "Research & Leads", who: ["lyra", "atlas"] as EmployeeId[] },
    { body: "Turn your company context and research into posts, messages and outreach written in your voice — every draft ready for your review.", name: "Content & Outreach", who: ["mira"] as EmployeeId[] },
    { body: "Monitor what is changing in your market, research candidates for a role, and bring the decisions that need you back in one place.", name: "Intelligence & Recruiting", who: ["lyra", "atlas", "orion"] as EmployeeId[] },
];

const stages = ['Research', 'Leads', 'Signals', 'Content', 'Outreach', 'Recruiting', 'Monitoring', 'Company Intelligence'];

const SocialProof = () => {
    const sectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const cards = sectionRef.current?.querySelectorAll('.test-card');
            if (cards) {
                cards.forEach((card, i) => {
                    gsap.fromTo(card, { opacity: 0, y: 30 }, {
                        opacity: 1, y: 0, duration: 0.6, delay: i * 0.15, ease: 'power3.out',
                        scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
                    });
                });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative px-4 py-28 md:py-36">
            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-14">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ HOW BUSINESSES USE AGENTORY</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
                        Work you can hand over.
                    </h2>
                </div>
                <div className="flex flex-wrap justify-center gap-4 mb-14">
                    {stages.map((s) => (
                        <span key={s} className="text-xs font-medium text-white/30 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-full">{s}</span>
                    ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {useCases.map((t, i) => (
                        <div key={i} className="test-card glass rounded-2xl p-6 opacity-0 border-l-2 border-l-emerald-500/30 hover:border-l-emerald-500/60 transition-all duration-300">
                            <Quote className="w-5 h-5 text-emerald-500/30 mb-4" />
                            <p className="text-sm text-white/50 leading-relaxed mb-5 italic">{t.body}</p>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-white/60">{t.name}</p>
                                </div>
                                {/* Who handles this, rather than an invented metric. */}
                                <span className="flex items-center -space-x-2">
                                    {t.who.map((id) => {
                                        const employee = EMPLOYEE_BY_ID[id];
                                        return employee ? <EmployeeAvatar key={id} employee={employee} size={24} /> : null;
                                    })}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <p className="text-center text-xs text-white/20 mt-8">
                    Examples of the work Agentory handles today.
                </p>
            </div>
        </section>
    );
};

export default SocialProof;