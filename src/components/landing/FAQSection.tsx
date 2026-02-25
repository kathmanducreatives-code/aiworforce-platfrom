import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    {
        q: 'How does the lookalike engine work?',
        a: "You paste one LinkedIn profile of your ideal candidate. The AI analyzes their career trajectory, skills, industry, seniority, and experience patterns. Then it searches LinkedIn for every similar professional — and ranks them all by match score. You choose how many: 200, 1,000, even 2,000+.",
    },
    {
        q: 'How long does it actually take?',
        a: "15 minutes or less for a full candidate search. Finding candidates, ranking them, revealing emails, and setting up outreach — the entire workflow that takes agencies 3-4 weeks.",
    },
    {
        q: 'How is this different from LinkedIn Recruiter?',
        a: "LinkedIn Recruiter gives you filters. ScreeningPilot gives you an AI that understands what makes your ideal candidate tick — then exhausts the entire talent market for that profile. Plus email reveal, automated outreach, screening, pipeline management, and team collaboration. It's a full recruiting OS, not a search filter.",
    },
    {
        q: 'How is this different from a recruitment agency?',
        a: "Agencies charge 20% of salary per hire (€15,000-€30,000) and send you 3-5 candidates. ScreeningPilot costs €149/month for unlimited hires and finds 2,000+ candidates per search. You control the process, see every candidate, and pay a flat fee.",
    },
    {
        q: 'Can I really replace my agency with this?',
        a: "Yes. That's exactly what it's built for. Companies making 3-20 hires per year are saving €40,000-€80,000+ annually by switching from agencies to ScreeningPilot. The math is simple: €149/month vs €15,000+ per hire.",
    },
    {
        q: 'What about candidate quality?',
        a: "Every candidate is ranked by AI match score with detailed reasoning. The lookalike engine doesn't just keyword-match — it analyzes career patterns, skill trajectories, and industry context. Most users report higher quality shortlists than their agencies delivered.",
    },
    {
        q: 'Is there a free trial?',
        a: "We offer a full demo so you can see the platform in action with your actual hiring needs. Book a demo and we'll run a live search for any role you're currently hiring for.",
    },
];

const FAQSection = () => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    return (
        <section className="relative bg-white px-4 py-28 md:py-36">
            <div className="max-w-3xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-emerald-600 font-semibold text-center">
                    ◆ Questions
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 text-center mb-16">
                    EVERYTHING YOU NEED TO KNOW
                </h2>
                <div className="space-y-3">
                    {faqs.map((faq, i) => {
                        const isOpen = openIndex === i;
                        return (
                            <div key={i} className={`border rounded-xl transition-all duration-300 ${isOpen ? 'border-emerald-200 bg-emerald-50/30 border-l-[3px] border-l-emerald-500' : 'border-zinc-200/60 bg-white'}`}>
                                <button onClick={() => setOpenIndex(isOpen ? null : i)} className="w-full flex items-center justify-between p-5 text-left">
                                    <span className="font-sans font-semibold text-base text-zinc-900 pr-4">{faq.q}</span>
                                    <ChevronDown className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-emerald-600' : ''}`} />
                                </button>
                                <div className="overflow-hidden transition-all duration-300" style={{ maxHeight: isOpen ? '300px' : '0px', opacity: isOpen ? 1 : 0 }}>
                                    <p className="px-5 pb-5 font-sans text-sm text-zinc-500 leading-relaxed">{faq.a}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

export default FAQSection;
