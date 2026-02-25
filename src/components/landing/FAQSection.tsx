import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    { q: 'How does the lookalike engine work?', a: 'You paste the LinkedIn URL of your ideal candidate. Our AI analyzes their profile — skills, experience, seniority, industry — and then scans LinkedIn to find every matching professional. You get up to 2,000+ ranked results with match scores, emails revealed, and one-click outreach. All in about 15 minutes.' },
    { q: 'How long does it actually take?', a: 'The lookalike search runs in 12–15 minutes for most queries. AI screening of 100+ resumes takes under 8 minutes. From "I need to hire someone" to "I have 2,000 ranked candidates with emails" — about 15 minutes total.' },
    { q: 'How is this different from LinkedIn Recruiter?', a: 'LinkedIn Recruiter charges €8,000+/year and limits you to boolean keyword searches. ScreeningPilot uses behavioral AI matching — it understands role fit, not just keyword overlap. And we reveal emails and automate outreach. LinkedIn doesn\'t.' },
    { q: 'How is this different from a recruitment agency?', a: 'Agencies charge €15,000–€30,000 per hire and take 4–8 weeks. ScreeningPilot costs €149/month for unlimited hires and delivers results in 15 minutes. You control the entire process. No middlemen.' },
    { q: 'Can I really replace my agency with this?', a: 'Yes. That\'s exactly what it\'s built for. You get the same (usually better) candidate pipeline, for less than 1% of the cost, in a fraction of the time. Over 200 companies have already switched.' },
    { q: 'What about candidate quality?', a: 'Our AI scores candidates on 12+ behavioral and technical dimensions. The match scores are transparent — you see exactly why each candidate was ranked. Most users report higher quality candidates than agency shortlists.' },
    { q: 'Is there a free trial?', a: 'Yes. Start with a free trial — no credit card required. You\'ll have full access to lookalike search, AI screening, email reveal, and the pipeline dashboard. See the results before you commit.' },
];

const FAQSection = () => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    return (
        <section className="relative px-4 py-28 md:py-36">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-14">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ FAQ</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">EVERYTHING YOU NEED TO KNOW</h2>
                </div>
                <div className="space-y-2">
                    {faqs.map((faq, i) => (
                        <div key={i} className={`glass rounded-xl overflow-hidden transition-all duration-300 ${openIndex === i ? 'border-l-2 border-l-emerald-500/50' : ''}`}>
                            <button onClick={() => setOpenIndex(openIndex === i ? null : i)} className="w-full flex items-center justify-between px-6 py-4 text-left">
                                <span className="font-display font-semibold text-sm text-white/70 pr-4">{faq.q}</span>
                                <ChevronDown className={`w-4 h-4 text-white/30 shrink-0 transition-transform duration-300 ${openIndex === i ? 'rotate-180 text-emerald-400' : ''}`} />
                            </button>
                            <div className={`overflow-hidden transition-all duration-300 ${openIndex === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                                <p className="px-6 pb-5 text-sm text-white/35 leading-relaxed">{faq.a}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FAQSection;
