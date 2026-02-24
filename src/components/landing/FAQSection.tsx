import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    {
        q: 'How does the ICP Lookalike Engine work?',
        a: 'You upload profiles of your top 5 performers. Our AI extracts 47 behavioral and skill markers — patterns invisible to humans — then scores every applicant against this ICP model to find candidates who think, work, and solve problems like your best people.',
    },
    {
        q: 'How long does it take to set up?',
        a: 'Under 10 minutes. Upload your top performer profiles, configure your scoring preferences, and the engine is ready to screen your first batch of candidates immediately.',
    },
    {
        q: 'What ATS systems do you integrate with?',
        a: 'ScreeningPilot integrates with all major ATS platforms including Greenhouse, Lever, Workday, BambooHR, and Ashby. We also offer a REST API for custom integrations.',
    },
    {
        q: 'Is candidate data kept private and secure?',
        a: 'Absolutely. All data is encrypted at rest and in transit. We are SOC 2 Type II compliant, GDPR ready, and never sell or share candidate data. Blind scoring also removes demographic identifiers during evaluation.',
    },
    {
        q: 'What happens if I\'m not satisfied?',
        a: 'We offer a 30-day money-back guarantee. If ScreeningPilot doesn\'t reduce your screening time by at least 80%, we\'ll refund your subscription — no questions asked.',
    },
    {
        q: 'How is this different from other AI screening tools?',
        a: 'Most AI screening tools just parse resumes for keywords. ScreeningPilot analyzes behavioral DNA — how candidates actually think and work — by comparing them to the proven patterns of your existing top performers. It\'s not keyword matching, it\'s people decoding.',
    },
];

const FAQSection = () => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    return (
        <section className="relative bg-white px-4 py-28 md:py-36">
            <div className="max-w-3xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-emerald-600 font-semibold text-center">
                    ◆ FAQ
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 text-center mb-16">
                    FREQUENTLY ASKED QUESTIONS
                </h2>

                <div className="space-y-3">
                    {faqs.map((faq, i) => {
                        const isOpen = openIndex === i;
                        return (
                            <div
                                key={i}
                                className={`border rounded-xl transition-all duration-300 ${isOpen ? 'border-emerald-200 bg-emerald-50/30' : 'border-zinc-200/60 bg-white'
                                    }`}
                            >
                                <button
                                    onClick={() => setOpenIndex(isOpen ? null : i)}
                                    className="w-full flex items-center justify-between p-5 text-left group"
                                >
                                    <span className="font-sans font-semibold text-base text-zinc-900 pr-4">
                                        {faq.q}
                                    </span>
                                    <ChevronDown
                                        className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-emerald-600' : ''
                                            }`}
                                    />
                                </button>
                                <div
                                    className="overflow-hidden transition-all duration-300"
                                    style={{
                                        maxHeight: isOpen ? '300px' : '0px',
                                        opacity: isOpen ? 1 : 0,
                                    }}
                                >
                                    <p className="px-5 pb-5 font-sans text-sm text-zinc-500 leading-relaxed">
                                        {faq.a}
                                    </p>
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
