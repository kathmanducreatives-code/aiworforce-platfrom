import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    { q: 'How does ScreeningPilot replace my recruiting agency?', a: 'You paste a job description, AI builds screening criteria, generates a candidate application link, scores every applicant on 12+ criteria, and auto-rejects 95% of bad fits. Your agency charges €24,000 per hire for the same work.' },
    { q: 'What exactly does the AI screen for?', a: 'Resume quality, experience relevance, skill matching, education fit, salary expectations, and answers to custom screening questions. Every candidate gets a transparent score — no agency black box.' },
    { q: 'How fast is it compared to an agency?', a: 'Agencies take 6–8 weeks to send you 5 profiles. ScreeningPilot scores hundreds of candidates in under 60 seconds and surfaces only the top fits.' },
    { q: 'What is the interview blueprint?', a: 'For each qualified candidate, AI generates a structured interview guide with claims to verify, suggested questions, and key evaluation areas. Your agency never gave you this.' },
    { q: 'What about the expert interviewer marketplace?', a: 'Instead of hiring full-time recruiters or paying agencies, you can tap into fractional expert interviewers on demand — directly from ScreeningPilot.' },
    { q: 'Is it really €149/month with no per-hire fees?', a: 'Yes. Flat rate. Unlimited screenings. No placement fees. No surprise invoices. Your agency was charging 20% of first-year salary per hire.' },
    { q: 'What if I still want to use an agency for some roles?', a: 'That\'s fine. Most customers start by replacing their agency on 2–3 roles, see the results, and then cancel the agency entirely within a month.' },
];

const FAQSection = () => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    return (
        <section className="relative px-4 py-28 md:py-36">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-14">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ FAQ</p>
                    <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">STILL HAVE QUESTIONS?</h2>
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
