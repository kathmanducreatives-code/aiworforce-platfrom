import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    { q: 'How does ScreeningPilot automate hiring?', a: 'You define your ideal candidate once, share an AI application link, and let ScreeningPilot handle screening, scoring, and interview prep. Your team focuses only on top candidates.' },
    { q: 'What exactly gets automated?', a: 'Resume screening, candidate evaluation, pre-interview testing, interview blueprint generation, and interviewer coordination are automated in one workflow.' },
    { q: 'How does the AI score candidates?', a: 'The system evaluates resume quality, experience relevance, and answers to personalized screening questions. Each candidate receives an AI screening score.' },
    { q: 'What is the interview blueprint?', a: 'For qualified candidates, ScreeningPilot prepares claims to verify, suggested questions, and key evaluation areas so interviewers can validate candidate fit quickly.' },
    { q: 'How does the expert interviewer marketplace work?', a: 'You can select fractional expert interviewers, send invitations, and schedule interviews from ScreeningPilot instead of building a large recruiting team.' },
    { q: 'Can ScreeningPilot reduce agency dependency?', a: 'Yes. ScreeningPilot replaces most manual first-pass recruiting work so companies can reduce or eliminate agency usage.' },
    { q: 'How much hiring work can be automated?', a: 'Teams can automate up to 90% of repetitive hiring workflow and spend interview time only on qualified candidates.' },
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
