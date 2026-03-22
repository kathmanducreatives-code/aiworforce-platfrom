import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';

const templates = ['📧 Customer Success', '💰 Fundraising', '🤝 Partnerships', '📞 Cold Calling', '📱 Community Management', '🌍 Localization', '+ 200 more templates'];

const AgentBuilderSection = () => {
  const navigate = useNavigate();

  return (
    <section id="enterprise" className="relative z-10 py-24 md:py-32">
      <div className="max-w-[1100px] mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">BUILD YOUR OWN</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            Pre-built departments for the most<br />common jobs. Custom agents for<br />everything specific to you.
          </h2>
          <p className="text-white/40 text-lg max-w-[600px] mx-auto leading-relaxed">
            Every business has functions that do not fit a template. The agent builder lets you create any agent in four steps — name it, assign the AI tools, write the prompt once, and your new agent joins the workforce immediately.
          </p>
        </div>

        {/* Builder mock */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
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
                <label className="text-[10px] text-white/40 font-medium mb-1 block uppercase tracking-wider">Agent name</label>
                <div className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white bg-white/[0.02]">Customer Success Agent</div>
              </div>
              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1 block uppercase tracking-wider">Department</label>
                <div className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/60 bg-white/[0.02]">Custom ▾</div>
              </div>
              <div>
                <label className="text-[10px] text-white/40 font-medium mb-1 block uppercase tracking-wider">Assign tools</label>
                <div className="flex gap-2">
                  {['Claude ✓', 'Notion ✓', 'Slack ✓'].map(t => (
                    <span key={t} className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-1 rounded-md font-medium">{t}</span>
                  ))}
                  <span className="text-[10px] bg-white/[0.04] border border-white/[0.08] text-white/40 px-2 py-1 rounded-md font-medium border-dashed">+ Add</span>
                </div>
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
                  <span className="text-xs text-white/40">Company Brain inherited automatically</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-white/40">Agent joins workforce immediately</span>
                </div>
              </div>

              <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
                Create Agent <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Template pills */}
        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {templates.map(t => (
            <span key={t} className="text-xs text-white/30 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-full">{t}</span>
          ))}
        </div>
        <p className="text-center text-xs text-white/20 mt-4">
          Built by founders. One click to install. Prompts included. Company Brain inherited.
        </p>
      </div>
    </section>
  );
};

export default AgentBuilderSection;