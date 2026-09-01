import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

const faqs = [
  { q: 'How is this different from just using ChatGPT or Claude?', a: 'A chat assistant starts from nothing every session. Agentory\'s AI employees already know your company — what you sell, who you sell to, your voice, your competitors — before the conversation starts. It is the difference between briefing a new freelancer every morning and having a team that has worked with you for six months.' },
  { q: 'Do the AI employees actually work together?', a: 'Yes. When one finds something another should act on, it hands it over — a signal becomes research, research becomes a draft, a draft comes to you. You do not set the handoffs up.' },
  { q: 'What kinds of work can I give it?', a: 'Research, finding and qualifying leads, watching competitors and markets, writing content, drafting outreach, screening candidates, and company research. You can also build AI employees for jobs unique to your business.' },
  { q: 'Which AI model does it use?', a: 'Whichever one is right for the job. Your employees choose the model, the research source and the tool each piece of work needs, and switch between them as the work requires. You never pick one, and you never manage a subscription to one.' },
  { q: 'How long does setup take?', a: 'A few minutes: a short set of questions about your company, your voice, your customers and your goals. From that moment every AI employee is briefed and ready.' },
  { q: 'Do they act on their own, or do I review everything?', a: 'You control that. By default your employees surface their work for your review before anything is sent or published. As trust builds you can approve specific employees to act on their own. We never send emails or publish content without your explicit approval — until you tell us to.' },
  { q: 'What about my data?', a: 'Your company context is encrypted at rest and in transit. Everything — your prompts, your employees\' outputs, your company context — belongs to you.' },
];

const FAQSection = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="relative px-4 py-28 md:py-36" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
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
