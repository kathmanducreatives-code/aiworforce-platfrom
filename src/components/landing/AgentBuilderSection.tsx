import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { AI_MODELS } from '@/data/aiModelLogos';
import { AI_TOOLS } from '@/data/aiToolLogos';
import { cn } from '@/lib/utils';
import { EMPLOYEES } from './employees';
import { EmployeeAvatar } from './EmployeePortrait';

const templates = ['📧 Customer Success', '💰 Fundraising', '🤝 Partnerships', '📞 Cold Calling', '📱 Community Management', '🌍 Localization', '+ build your own'];

const MODEL_OPTIONS = [
  { ...AI_MODELS['gpt-4o'],        selected: false },
  { ...AI_MODELS['claude-sonnet'], selected: true  },
  { ...AI_MODELS['gemini-pro'],    selected: false },
];

const TOOL_OPTIONS = [
  { ...AI_TOOLS.firecrawl,  selected: true,  badge: 'Web Scraping' },
  { ...AI_TOOLS.elevenlabs, selected: false, badge: 'Voice'        },
];

const AgentBuilderSection = () => {
  const navigate = useNavigate();

  return (
    <section id="build-your-own" className="relative z-10 py-24 md:py-32">
      <div className="max-w-[1100px] mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">BUILD YOUR OWN AI EMPLOYEE</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            Need an employee for<br />something else?<br />Build one.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            Start with Agentory's ready-to-work AI employees, then create new ones for the jobs unique to your business. They inherit your company context and work alongside the rest of your Agentory team.
          </p>
        </div>

        {/* Builder mock */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6 }}
          className="max-w-xl mx-auto"
        >
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <div className="bg-white/[0.03] px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
              <span className="text-sm font-bold text-white">Build a new agent</span>
              <span className="text-[10px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-1 rounded">Save</span>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1 block uppercase tracking-wider">What should this employee do?</label>
                <div className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white bg-white/[0.02]">Customer Success Agent</div>
              </div>
              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1 block uppercase tracking-wider">Kind of work</label>
                <div className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/60 bg-white/[0.02]">Custom ▾</div>
              </div>

              {/* Model selector — real logos */}
              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1.5 block uppercase tracking-wider">Handled for you</label>
                <div className="grid grid-cols-3 gap-2">
                  {MODEL_OPTIONS.map((m) => (
                    <div
                      key={m.key}
                      className={cn(
                        'flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all',
                        m.selected
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-white/[0.08] bg-white/[0.02] text-white/50',
                      )}
                    >
                      <span className={cn('w-5 h-5 rounded-sm flex items-center justify-center overflow-hidden', m.chipBg)}>
                        <img src={m.logo} alt={m.label} className="w-4 h-4 object-contain" />
                      </span>
                      <span className="truncate">{m.label}</span>
                      {m.selected && <Check className="w-3 h-3 ml-auto shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>

              {/* Tools selector — real logos */}
              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1.5 block uppercase tracking-wider">Chosen for the job</label>
                <div className="grid grid-cols-2 gap-2">
                  {TOOL_OPTIONS.map((t) => (
                    <div
                      key={t.key}
                      className={cn(
                        'flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all',
                        t.selected
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : 'border-white/[0.08] bg-white/[0.02]',
                      )}
                    >
                      <span className="w-6 h-6 rounded-md bg-white flex items-center justify-center overflow-hidden shrink-0">
                        <img src={t.logo} alt={t.label} className="w-4 h-4 object-contain" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs font-semibold truncate', t.selected ? 'text-emerald-300' : 'text-white/70')}>{t.label}</p>
                        <p className="text-[10px] text-white/40 truncate">{t.badge}</p>
                      </div>
                      {t.selected && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </div>
                  ))}
                </div>
                <button className="mt-2 text-[10px] text-white/40 hover:text-white/60 font-medium">+ Add another tool</button>
              </div>

              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1 block uppercase tracking-wider">Agent prompt</label>
                <div className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white/60 bg-white/[0.02] min-h-[60px]">
                  "You are our Customer Success agent. Our customers are Series A founders. They churn when they don't see ROI in 30 days. Your job is to..."
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-white/40">Knows your company automatically</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-white/40">Joins your team immediately</span>
                </div>
              </div>

              <button
                onClick={() => navigate('/auth')}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
              >
                Create Agent <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* The team the new employee joins. Without this the builder reads as a
            standalone tool; with it, it reads as hiring into an existing team. */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-white/25">Joins</span>
          <div className="flex items-center -space-x-2">
            {EMPLOYEES.map((employee) => (
              <EmployeeAvatar key={employee.id} employee={employee} size={30} />
            ))}
            <span className="w-[30px] h-[30px] rounded-full border border-dashed border-emerald-500/40 bg-emerald-500/[0.06] flex items-center justify-center text-emerald-400 text-[13px] font-bold relative z-10">
              +
            </span>
          </div>
          <span className="text-[11px] text-white/30">your existing AI team</span>
        </div>

        {/* Template pills */}
        <div className="mt-10 flex flex-wrap justify-center gap-2">
        {templates.map(t => (
            <span key={t} className="text-xs text-white/30 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-full">{t}</span>
          ))}
        </div>
        <p className="text-center text-xs text-white/20 mt-4">
          Start with Agentory's ready-to-work AI employees, then create new ones for the jobs unique to your business. They inherit your company context and work alongside the rest of your Agentory team.
        </p>
      </div>
    </section>
  );
};

export default AgentBuilderSection;
