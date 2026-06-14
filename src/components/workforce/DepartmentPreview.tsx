import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Radar, Crown, BarChart3, PenLine, Eye, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENTS, type AgentId } from './agents';
import { DEPT_CONFIG, type DeptTotals } from './departmentConfig';

const ICONS = {
  command: Crown,
  radar: Radar,
  rank: BarChart3,
  pen: PenLine,
  eye: Eye,
  doc: FileText,
} as const;

interface Props {
  agentId: AgentId;
  totals: DeptTotals;
  brainComplete: boolean;
}

const toneClass: Record<string, string> = {
  default: 'text-neutral-200',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
};

export default function DepartmentPreview({ agentId, totals, brainComplete }: Props) {
  const navigate = useNavigate();
  const meta = AGENTS[agentId];
  const cfg = DEPT_CONFIG[agentId];
  const Icon = ICONS[cfg.iconKey as keyof typeof ICONS] ?? Crown;
  const stats = cfg.stats(totals, brainComplete);
  const actions = cfg.actions(totals, brainComplete);

  return (
    <div
      className={cn(
        'rounded-2xl p-5 lg:p-6',
        'bg-black/45 border border-white/[0.08] backdrop-blur-2xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_20px_60px_-30px_rgba(0,0,0,0.8)]',
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-[auto,1fr,auto] gap-5 md:gap-6 items-start">
        {/* Identity */}
        <div className="flex items-center gap-4 md:flex-col md:items-start">
          <div
            className="relative h-16 w-16 rounded-2xl flex items-center justify-center border"
            style={{
              borderColor: `${cfg.ringHex}55`,
              background: `linear-gradient(135deg, ${cfg.ringHex}20, transparent)`,
              boxShadow: `0 0 28px ${cfg.glowRgba}`,
            }}
          >
            <Icon className="h-7 w-7" style={{ color: cfg.ringHex }} strokeWidth={1.75} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 mb-1">
              {meta.name} · {meta.role}
            </div>
            <h3 className="text-[18px] font-semibold text-white leading-tight">{cfg.title}</h3>
            <p className="text-[13px] text-neutral-400 mt-1 max-w-md">{cfg.subtitle}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2.5 self-stretch">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-3 py-2.5 bg-white/[0.025] border border-white/[0.06]"
            >
              <div className="text-[10.5px] uppercase tracking-wider text-neutral-500">{s.label}</div>
              <div className={cn('text-[15px] font-semibold mt-0.5 tabular-nums', toneClass[s.tone ?? 'default'])}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex md:flex-col gap-2 md:min-w-[180px]">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.route)}
              className={cn(
                'group inline-flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-medium transition-all',
                a.primary
                  ? 'text-black border'
                  : 'text-neutral-200 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06]',
              )}
              style={
                a.primary
                  ? {
                      background: cfg.ringHex,
                      borderColor: cfg.ringHex,
                      boxShadow: `0 0 24px ${cfg.glowRgba}`,
                    }
                  : undefined
              }
            >
              <span>{a.label}</span>
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
