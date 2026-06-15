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
    <div
      className={cn(
        'rounded-xl p-5 lg:p-6',
        'bg-white/[0.015] border border-white/[0.06] backdrop-blur-xl',
        'shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]',
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_200px] gap-6 lg:gap-8 items-start">
        {/* Identity */}
        <div className="flex items-start gap-3.5">
          <div
            className="h-11 w-11 rounded-lg flex items-center justify-center border shrink-0"
            style={{
              borderColor: `${cfg.ringHex}40`,
              background: `${cfg.ringHex}10`,
            }}
          >
            <Icon className="h-[20px] w-[20px]" style={{ color: cfg.ringHex }} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow mb-1">{meta.name} · {meta.role}</div>
            <h3 className="text-[15px] font-semibold text-white tracking-tight leading-tight">{cfg.title}</h3>
            <p className="text-[12.5px] text-neutral-400 mt-1 leading-snug">{cfg.subtitle}</p>
          </div>
        </div>

        {/* Stats — inline KPI row, no individual card chrome */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.04] rounded-lg overflow-hidden border border-white/[0.04]">
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-3 bg-[#0a0a0a]">
              <div className="eyebrow">{s.label}</div>
              <div className={cn('text-[20px] font-semibold num mt-1 leading-none', toneClass[s.tone ?? 'default'])}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.route)}
              className={cn(
                'group inline-flex items-center justify-between gap-2 px-3 h-9 rounded-md text-[12.5px] font-medium transition-colors',
                a.primary
                  ? 'text-black'
                  : 'text-neutral-300 bg-white/[0.025] border border-white/[0.06] hover:bg-white/[0.05] hover:text-white',
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
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
