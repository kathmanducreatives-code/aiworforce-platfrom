import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Search, Bot, Mail, BarChart3, Users, Calendar, MessageSquare } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
    { icon: Search, title: 'Lookalike Candidate Search', desc: 'One profile → unlimited ranked matches. Set the number: 200, 1,000, 2,000+. The AI exhausts your entire talent market.' },
    { icon: Bot, title: 'AI Resume Screening', desc: 'Every applicant scored with match percentages and reasoning. No manual CV reading. 300 resumes in 8 minutes.' },
    { icon: Mail, title: 'Email Reveal & Auto-Outreach', desc: 'One-click email discovery. Automated personalized email sequences sent to your shortlist.' },
    { icon: BarChart3, title: 'Pipeline Dashboard', desc: 'Track every candidate from discovered → contacted → interviewing → hired. Full visibility, zero spreadsheets.' },
    { icon: Users, title: 'Team Collaboration Room', desc: 'Notes, ratings, and feedback from your whole team. Everyone aligned on every candidate.' },
    { icon: Calendar, title: 'Meeting Management', desc: 'Schedule interviews directly from the platform. No back-and-forth. No calendar chaos.' },
];

const comingSoon = {
    icon: MessageSquare,
    title: 'AI Behavioral Screening',
    desc: 'Chat-based candidate interviews that assess culture fit before you ever get on a call.',
};

const FeatureSet = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            cardRefs.current.forEach((card, i) => {
                if (!card) return;
                gsap.fromTo(card, { opacity: 0, y: 30 }, {
                    opacity: 1, y: 0, duration: 0.7, delay: i * 0.12,
                    ease: 'power3.out',
                    scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none none' },
                });
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-white px-4 py-28 md:py-36">
            <div className="max-w-6xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-emerald-600 font-semibold">
                    ◆ The Full Platform
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4.5vw,3rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-14">
                    EVERY TOOL YOU NEED.<br />ONE SUBSCRIPTION.
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
                    {features.map((f, i) => (
                        <div
                            key={i}
                            ref={el => { cardRefs.current[i] = el; }}
                            className="group bg-white border border-zinc-200/60 rounded-2xl p-7 opacity-0 relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] hover:border-emerald-200/60"
                        >
                            <div className="absolute top-0 left-0 w-full h-[3px] bg-emerald-500 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110">
                                <f.icon className="w-6 h-6 text-emerald-600" />
                            </div>
                            <h3 className="font-sans font-bold text-base text-zinc-900 mb-2">{f.title}</h3>
                            <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
                        </div>
                    ))}
                </div>

                {/* Coming soon card */}
                <div
                    ref={el => { cardRefs.current[6] = el; }}
                    className="opacity-0 border border-dashed border-emerald-300/60 rounded-2xl p-7 bg-emerald-50/30 relative overflow-hidden max-w-sm"
                >
                    <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Coming Soon
                    </span>
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-5">
                        <comingSoon.icon className="w-6 h-6 text-emerald-500" />
                    </div>
                    <h3 className="font-sans font-bold text-base text-zinc-700 mb-2">{comingSoon.title}</h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">{comingSoon.desc}</p>
                </div>
            </div>
        </section>
    );
};

export default FeatureSet;
