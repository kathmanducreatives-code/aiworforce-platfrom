import { motion } from 'framer-motion';
import PoweredByStrip from '@/components/agents/PoweredByStrip';
import { EMPLOYEES } from './employees';
import { EmployeePortrait3D } from './EmployeePortrait';

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
            Different employees.<br />Different jobs.
          </h2>
          <p className="text-white/40 text-base md:text-lg max-w-[640px] mx-auto leading-relaxed">
            Each AI employee is good at a different part of your online work. They all work from the same
            company context, and they hand work to each other when a job needs more than one of them.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6 md:gap-8 max-w-[1100px] mx-auto">
          {EMPLOYEES.map((employee, i) => (
            <motion.div
              key={employee.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="flex flex-col items-center text-center group"
            >
              <EmployeePortrait3D employee={employee} priority={i < 2} />
              <h3 className="mt-5 font-display font-bold text-xl text-white">{employee.name}</h3>
              <p className="text-sm text-white/50 mt-0.5">{employee.function}</p>
              <span
                className="mt-2 text-[10px] uppercase tracking-[0.15em] font-mono font-semibold"
                style={{ color: employee.accent }}
              >
                {employee.tag}
              </span>
              {/* The specialty is what turns a portrait into a colleague. */}
              <p className="mt-3 text-[12.5px] leading-relaxed text-white/35 max-w-[210px]">
                {employee.specialty}
              </p>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 0.6, y: 0 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.5, delay: EMPLOYEES.length * 0.08 }}
            className="flex flex-col items-center text-center"
          >
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-2 border-dashed border-white/15 flex items-center justify-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/40">v2</span>
            </div>
            <h3 className="mt-5 font-display font-bold text-xl text-white/60">More employees</h3>
            <p className="text-sm text-white/40 mt-0.5">New employees join as Agentory takes on more kinds of work</p>
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
