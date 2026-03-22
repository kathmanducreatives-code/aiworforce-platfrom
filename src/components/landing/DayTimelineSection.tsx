import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Clock, AlertTriangle } from 'lucide-react';
import { Users, TrendingUp, Pen, Eye, BarChart2, User } from 'lucide-react';

const timeline = [
  { time: '7:00 AM', agent: 'Brief', dept: 'Intelligence', color: 'bg-amber-500/20 border-amber-500/40', action: 'Morning brief delivered', output: '3 signals need attention today. 1 urgent. 2 informational.', status: 'done' },
  { time: '7:12 AM', agent: 'You', dept: 'Founder', color: 'bg-blue-500/20 border-blue-500/40', action: 'Reviewed brief. Approved Growth agent to pursue Acme Corp lead.', output: '', status: 'decision' },
  { time: '7:13 AM', agent: 'Radar', dept: 'Growth', color: 'bg-emerald-500/20 border-emerald-500/40', action: 'Lead research initiated for Acme Corp', output: 'Found: James Park, Co-Founder. Trigger: €8M Series A. Pain signal: posted about screening chaos.', status: 'done' },
  { time: '7:45 AM', agent: 'Penn', dept: 'Growth', color: 'bg-emerald-500/20 border-emerald-500/40', action: 'Personalized outreach drafted', output: 'Email written in your voice. References: the raise, 4 open roles, and James\'s exact post from last week.', status: 'review' },
  { time: '8:02 AM', agent: 'You', dept: 'Founder', color: 'bg-blue-500/20 border-blue-500/40', action: 'Approved. Sent.', output: '', status: 'decision' },
  { time: '8:03 AM', agent: 'Relay', dept: 'Growth', color: 'bg-emerald-500/20 border-emerald-500/40', action: 'Email delivered to james@acmecorp.com', output: 'Sent. Open tracking active. Follow-up scheduled: Thursday 9am if no reply.', status: 'done' },
  { time: '9:30 AM', agent: 'Scout', dept: 'Talent', color: 'bg-purple-500/20 border-purple-500/40', action: 'Lookalike candidate scan complete', output: '127 candidates found matching your Senior Engineer ICP. Sending to Aria for screening.', status: 'done' },
  { time: '9:31 AM', agent: 'Aria', dept: 'Talent', color: 'bg-purple-500/20 border-purple-500/40', action: 'Screening 127 candidates asynchronously', output: 'AI interviews running in background. Results ready by morning.', status: 'progress' },
  { time: '11:00 AM', agent: 'Hawk', dept: 'Intelligence', color: 'bg-amber-500/20 border-amber-500/40', action: 'Competitor alert detected', output: 'Ashby dropped their starter plan price by 20% this morning. Flagged for your awareness.', status: 'review' },
  { time: '11:05 AM', agent: 'Quill', dept: 'Content', color: 'bg-pink-500/20 border-pink-500/40', action: 'Response content drafted', output: 'LinkedIn post written: why our pricing model benefits you more. Ready for your review.', status: 'review' },
  { time: '2:30 PM', agent: 'You', dept: 'Founder', color: 'bg-blue-500/20 border-blue-500/40', action: 'Approved post. Minor edit to closing line.', output: '', status: 'decision' },
  { time: '2:32 PM', agent: 'Pulse', dept: 'Content', color: 'bg-pink-500/20 border-pink-500/40', action: 'Scheduled for tomorrow 9am', output: 'Posted at peak engagement window. Performance data by Wednesday.', status: 'done' },
  { time: '4:45 PM', agent: 'Relay', dept: 'Growth', color: 'bg-emerald-500/20 border-emerald-500/40', action: 'Reply received from James Park', output: 'He replied. Interested. Suggested a call Thursday 2pm. Calendar link sent automatically.', status: 'done' },
  { time: '5:00 PM', agent: 'Atlas', dept: 'Command', color: 'bg-emerald-500/20 border-emerald-500/40', action: 'End of day summary ready', output: 'Today: 1 meeting booked. 127 candidates in screening. 1 post scheduled. 3 competitor signals. Your time: 47 minutes.', status: 'done' },
];

const statusIcon = (s: string) => {
  if (s === 'done') return <Check className="w-3 h-3 text-emerald-400" />;
  if (s === 'review') return <AlertTriangle className="w-3 h-3 text-amber-400" />;
  if (s === 'decision') return <User className="w-3 h-3 text-blue-400" />;
  return <Clock className="w-3 h-3 text-white/40 animate-pulse" />;
};

const statusColor = (s: string) => {
  if (s === 'done') return 'bg-emerald-500';
  if (s === 'review') return 'bg-amber-500';
  if (s === 'decision') return 'bg-blue-500';
  return 'bg-white/40 animate-pulse';
};

const DayTimelineSection = () => {
  const navigate = useNavigate();

  return (
    <section id="day-timeline" className="relative z-10 py-24 md:py-32">
      <div className="max-w-[900px] mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">A MONDAY WITH YOUR WORKFORCE</span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            47 minutes of your time.<br />A full week of work done.
          </h2>
          <p className="text-white/40 text-lg max-w-[560px] mx-auto leading-relaxed">
            This is what your AI workforce does on a typical day. The founder's only job is to review and decide.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          <div className="absolute left-4 md:left-1/2 md:-translate-x-px top-0 bottom-0 w-px bg-white/[0.06]" />

          {timeline.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className={`relative flex items-start gap-4 mb-6 ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} md:gap-8`}
            >
              {/* Dot on timeline */}
              <div className="absolute left-4 md:left-1/2 -translate-x-1/2 mt-2 z-10">
                <div className={`w-3 h-3 rounded-full ${statusColor(item.status)} shadow-lg`} />
              </div>

              {/* Time */}
              <div className={`hidden md:block w-[calc(50%-24px)] ${i % 2 === 0 ? 'text-right pr-4' : 'text-left pl-4'}`}>
                <span className="font-mono text-xs text-white/30">{item.time}</span>
              </div>

              {/* Card */}
              <div className={`ml-10 md:ml-0 md:w-[calc(50%-24px)] ${i % 2 === 0 ? '' : ''}`}>
                <div className={`rounded-xl border p-4 ${item.status === 'decision' ? 'border-blue-500/20 bg-blue-500/[0.03]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="md:hidden font-mono text-[10px] text-white/30">{item.time}</span>
                    <div className={`w-6 h-6 rounded-full ${item.color} border flex items-center justify-center`}>
                      {statusIcon(item.status)}
                    </div>
                    <span className="text-xs font-bold text-white">{item.agent}</span>
                    <span className="text-[10px] text-white/30 px-1.5 py-0.5 rounded bg-white/[0.04]">{item.dept}</span>
                  </div>
                  <p className="text-sm text-white/70 font-medium">{item.action}</p>
                  {item.output && (
                    <p className="text-xs text-white/30 mt-1.5 leading-relaxed">{item.output}</p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Summary card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          className="mt-12 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-8"
        >
          <h3 className="font-display font-bold text-lg text-white text-center mb-6">Your Monday. By the numbers.</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { num: '47 min', label: 'Your time invested' },
              { num: '1', label: 'Meeting booked' },
              { num: '127', label: 'Candidates screened' },
              { num: '€0', label: 'Agency fees paid' },
            ].map(s => (
              <div key={s.label}>
                <div className="font-mono font-black text-2xl text-emerald-400 tabular-nums">{s.num}</div>
                <div className="text-xs text-white/40 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-white/30 mt-6">Your AI workforce handled the rest.</p>
          <div className="text-center mt-6">
            <button onClick={() => navigate('/auth')} className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]">
              Start your first Monday <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default DayTimelineSection;