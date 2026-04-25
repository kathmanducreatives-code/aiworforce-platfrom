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
    <section className="relative px-4 py-28 md:py-36" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-14">
          <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ FAQ</p>
          <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">Questions we get every day.</h2>
        </div>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <div key={i} className={`rounded-xl overflow-hidden transition-all duration-300 ${openIndex === i ? 'border-l-2 border-l-emerald-500/50' : ''}`}
              style={{ background: "rgba(255,255,255,0.03)", border: openIndex === i ? undefined : "1px solid rgba(255,255,255,0.05)" }}>
              <button onClick={() => setOpenIndex(openIndex === i ? null : i)} className="w-full flex items-center justify-between px-6 py-4 text-left">
                <span className="font-display font-semibold text-sm text-white/70 pr-4">{faq.q}</span>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-300 ${openIndex === i ? 'rotate-180 text-emerald-400' : 'text-white/30'}`} />
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-5 text-sm text-white/40 leading-relaxed">{faq.a}</p>
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
