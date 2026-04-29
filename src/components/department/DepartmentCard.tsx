import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeptTheme } from '@/lib/departmentTheme';
import type { DBAgent, DBActivity, DBPlan, DBApproval } from '@/lib/orchestration';
import { AGENT_BY_NAME } from '@/data/agentProfiles';

interface Props {
  theme: DeptTheme;
  agents: DBAgent[];
  events: DBActivity[];
  plans: DBPlan[];
  approvals: DBApproval[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DepartmentCard({ theme, agents, events, plans, approvals }: Props) {
  const navigate = useNavigate();
  const Icon = theme.icon;

  const runningAgents = agents.filter((a) => a.status === 'running').length;
  const activePlans = plans.filter((p) => p.status === 'planning' || p.status === 'executing').length;
  const awaitingCount = approvals.length;

  // Status line: latest activity event for this dept
  const latestEvent = events[0];
  const statusLine =
    latestEvent?.title ||
    (runningAgents > 0
      ? `${runningAgents} agent${runningAgents > 1 ? 's' : ''} working`
      : 'Quiet for now — give the team a task.');

  // Recent output: latest non-handoff event body
  const lastOutput = events.find((e) => e.body && e.event_type !== 'handoff')?.body;

  // Today progress
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayPlans = plans.filter((p) => new Date(p.created_at) >= startOfDay);
  const todayDone = todayPlans.filter((p) => p.status === 'complete').length;
  const progressPct = todayPlans.length === 0 ? 0 : Math.round((todayDone / todayPlans.length) * 100);

  return (
    <button
      onClick={() => navigate(`/rooms/${theme.key}`)}
      className={cn(
        'group relative text-left w-full rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md p-6',
        'transition-all duration-300 hover:-translate-y-0.5 hover:border-border',
        'overflow-hidden',
      )}
      style={{
        boxShadow: `inset 3px 0 0 ${theme.hex}`,
      }}
    >
      {/* Soft accent glow on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background: `radial-gradient(circle at 0% 0%, ${theme.hex}10, transparent 60%)`,
        }}
      />

      <div className="relative z-10 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${theme.hex}1a`, color: theme.hex }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground leading-tight">{theme.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
                {runningAgents > 0 && ` · ${runningAgents} running`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {awaitingCount > 0 && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {awaitingCount} awaiting
              </span>
            )}
            <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Agent avatars */}
        {agents.length > 0 && (
          <div className="flex items-center gap-1.5">
            {agents.slice(0, 6).map((a) => {
              const profile = AGENT_BY_NAME[a.name?.toLowerCase()];
              const running = a.status === 'running';
              return (
                <div key={a.id} className="relative">
                  {profile?.image ? (
                    <img
                      src={profile.image}
                      alt={a.name}
                      title={`${a.name} · ${a.status}`}
                      className={cn(
                        'h-7 w-7 rounded-full object-cover ring-2 transition',
                        running ? 'ring-offset-1 ring-offset-card' : 'ring-border/40',
                      )}
                      style={running ? { boxShadow: `0 0 0 2px ${theme.hex}` } as any : undefined}
                    />
                  ) : (
                    <div
                      className="h-7 w-7 rounded-full bg-muted text-[10px] font-bold text-foreground flex items-center justify-center ring-2 ring-border/40"
                      title={a.name}
                    >
                      {a.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  {running && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card animate-pulse"
                      style={{ backgroundColor: theme.hex }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Status line */}
        <div className="space-y-1.5">
          <p className="text-[13px] text-foreground/90 leading-snug line-clamp-1">{statusLine}</p>
          {latestEvent && (
            <p className="text-[11px] text-muted-foreground">{relativeTime(latestEvent.created_at)}</p>
          )}
        </div>

        {/* Counts */}
        <div className="flex items-center gap-4 text-[12px]">
          <span className="text-muted-foreground">
            <span className="text-foreground font-semibold tabular-nums">{activePlans}</span> active
          </span>
          <span className="h-3 w-px bg-border/60" />
          <span className="text-muted-foreground">
            <span className="text-foreground font-semibold tabular-nums">{todayDone}</span> done today
          </span>
        </div>

        {/* Recent output preview */}
        {lastOutput && (
          <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Latest output</p>
            <p className="text-xs text-foreground/80 line-clamp-1">{lastOutput}</p>
          </div>
        )}

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Today</span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-border/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, backgroundColor: theme.hex }}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
