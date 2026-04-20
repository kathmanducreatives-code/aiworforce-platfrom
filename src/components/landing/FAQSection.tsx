import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

const faqs = [
  { q: 'How is this different from just using Claude?', a: 'Claude is a blank slate every session. ScreeningPilot\'s Company Brain means every agent already knows your company before the conversation begins. It is the difference between briefing a new freelancer every morning and having a team that has worked with you for six months.' },
  { q: 'Do the agents actually work together automatically?', a: 'Yes. When your Intelligence agent detects a competitor move your Content agent is notified and can draft a response. When your Talent agent finds a strong candidate your Growth agent checks if they are also a potential customer. The coordination happens without you setting it up.' },
  { q: 'How long does setup take?', a: 'The Company Brain setup takes 10 minutes — 12 questions about your company, your voice, your customers, and your goals. From that moment every agent is briefed and ready. Your first department is operational the same day.' },
  { q: 'What if I need a tool you have not integrated?', a: 'The custom agent builder lets you connect any tool with an API. You assign the tools, write the prompt once, and the agent joins your workforce immediately — already knowing your company from the Company Brain.' },
  { q: 'Do agents act autonomously or do I review everything?', a: 'You control the autonomy level. By default agents surface their work for your review before anything is sent or published. As trust builds you can approve specific agents to act autonomously. We never send emails or publish content without your explicit approval — until you tell us to.' },
  { q: 'What about data security?', a: 'Your Company Brain is encrypted at rest and in transit. We do not train any model on your data. Everything — your prompts, your agent outputs, your company context — belongs entirely to you. Export or delete everything at any time.' },
];

const FAQSection = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="relative px-6 py-16 md:py-24 bg-black">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/40 bg-accent-mint/5 mb-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold">QUESTIONS & ANSWERS</span>
          </div>
          <h2 className="font-display font-bold text-[clamp(2rem,4.5vw,3.25rem)] text-white leading-tight tracking-tight">
            Commonly asked.
          </h2>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="glass-card-premium rounded-2xl border-white/5 overflow-hidden transition-all duration-300">
              <button 
                onClick={() => setOpenIndex(openIndex === i ? null : i)} 
                className="w-full flex items-center justify-between px-8 py-6 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="font-display font-bold text-base text-white/90 pr-4">{faq.q}</span>
                <ChevronDown className={`w-5 h-5 shrink-0 transition-transform duration-500 ${openIndex === i ? 'rotate-180 text-accent-mint' : 'text-white/50'}`} />
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-8 pb-8 pt-2">
                       <p className="text-white/40 leading-relaxed font-medium">{faq.a}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQSection;
