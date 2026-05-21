import { motion } from 'framer-motion';
import { AGENT_PROFILES, deptText, deptRing } from '@/data/agentProfiles';
import { cn } from '@/lib/utils';
import PoweredByStrip from '@/components/agents/PoweredByStrip';

const departmentLabel: Record<string, string> = {
  talent: 'Talent',
  growth: 'Growth',
  intelligence: 'Intelligence',
  content: 'Content',
};

export default function MeetYourAITeamSection() {
  return (
    <section className="relative z-10 py-24 md:py-32 border-t border-white/[0.04]">
      <div className="max-w-[1200px] mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400 mb-4">YOUR AI TEAM</p>
          <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.04em] text-white mb-5">
            The faces behind your<br />autonomous workforce.
          </h2>
          <p className="text-white/40 text-base md:text-lg max-w-[640px] mx-auto leading-relaxed">
            Five specialized AI agents, always on, always in sync. Each one trained on your Company Brain
            and pre-wired with the best AI model for the job.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6 md:gap-8 max-w-[1100px] mx-auto">
          {AGENT_PROFILES.map((agent, i) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="flex flex-col items-center text-center group"
            >
              <div className="relative">
                <div
                  className={cn(
                    'w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden ring-2 ring-offset-4 ring-offset-transparent transition-transform duration-500 group-hover:scale-[1.04]',
                    deptRing[agent.department],
                  )}
                  style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
                >
                  <img
                    src={agent.image}
                    alt={`${agent.name} — ${agent.role}`}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="absolute bottom-2 right-2 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-deep-space animate-pulse" />
              </div>
              <h3 className="mt-5 font-display font-bold text-xl text-white">{agent.name}</h3>
              <p className="text-sm text-white/50 mt-0.5">{agent.role}</p>
              <span className={cn('mt-2 text-[10px] uppercase tracking-[0.15em] font-mono font-semibold', deptText[agent.department])}>
                {departmentLabel[agent.department]}
              </span>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 0.6, y: 0 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.5, delay: AGENT_PROFILES.length * 0.08 }}
            className="flex flex-col items-center text-center"
          >
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-2 border-dashed border-white/15 flex items-center justify-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/40">v2</span>
            </div>
            <h3 className="mt-5 font-display font-bold text-xl text-white/60">More agents</h3>
            <p className="text-sm text-white/40 mt-0.5">Joining the team in v2</p>
            <span className="mt-2 text-[10px] uppercase tracking-[0.15em] font-mono font-semibold text-white/30">
              Coming soon
            </span>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-20 md:mt-24"
        >
          <PoweredByStrip />
        </motion.div>
      </div>
    </section>
  );
}
