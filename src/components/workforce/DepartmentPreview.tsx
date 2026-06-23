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
  default: 'text-neutral-100',
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
    <div className={cn('card-premium p-6 lg:p-7')}>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_220px] gap-7 lg:gap-9 items-start">
        {/* Identity */}
        <div className="flex items-start gap-4">
          <div
            className="h-12 w-12 rounded-lg flex items-center justify-center border shrink-0"
            style={{
              borderColor: `${cfg.ringHex}40`,
              background: `${cfg.ringHex}10`,
            }}
          >
            <Icon className="h-[22px] w-[22px]" style={{ color: cfg.ringHex }} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">{meta.name} · {meta.role}</div>
            <h3 className="text-[20px] font-semibold text-white tracking-tight leading-tight">{cfg.title}</h3>
            <p className="text-[14.5px] text-neutral-400 mt-1.5 leading-snug">{cfg.subtitle}</p>
          </div>
        </div>

        {/* Stats — inline KPI row, no individual card chrome */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.05] rounded-lg overflow-hidden border border-white/[0.06]">
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-4 bg-[#0a0a0a]">
              <div className="eyebrow">{s.label}</div>
              <div className={cn('text-[26px] font-semibold num mt-2 leading-none tracking-tight', toneClass[s.tone ?? 'default'])}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.route)}
              className={cn(
                'group inline-flex items-center justify-between gap-2 px-4 h-10 rounded-md text-[14px] font-semibold transition-colors',
                a.primary
                  ? 'text-black'
                  : 'text-neutral-200 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:text-white',
              )}
              style={
                a.primary
                  ? {
                      background: cfg.ringHex,
                      border: `1px solid ${cfg.ringHex}`,
                    }
                  : undefined
              }
            >
              <span>{a.label}</span>
              <ArrowUpRight className="h-4 w-4 opacity-70 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
