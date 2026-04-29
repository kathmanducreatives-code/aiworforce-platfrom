import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import type { AgentDept } from '@/data/agentProfiles';
import type { DBAgent } from '@/lib/orchestration';
import { cn } from '@/lib/utils';
import { AI_MODELS } from '@/data/aiModelLogos';
import { getSwatch, DEPARTMENTS } from '@/components/agents/builder/v2/constants';

interface Props {
  department: AgentDept;
}

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export default function AgentRoster({ department }: Props) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const [open, setOpen] = useState<DBAgent | null>(null);

  const list = useMemo(
    () => agents.filter((a) => a.department === department),
    [agents, department],
  );

  if (list.length === 0) return null;
  const dept = DEPARTMENTS.find((d) => d.key === department);

  return (
    <>
      <div className="px-6 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Agent roster</span>
          <span className="text-[10px] text-muted-foreground/60">· {list.length}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {list.map((a) => {
            const color = getSwatch((a as any).avatar_color ?? 'emerald');
            const created = (a as any).created_at as string | undefined;
            const isNew = created ? (Date.now() - new Date(created).getTime()) < NEW_WINDOW_MS : false;
            const modelMeta = AI_MODELS[a.model as keyof typeof AI_MODELS];
            const initial = a.name[0]?.toUpperCase() ?? '?';
            return (
              <button
                key={a.id}
                onClick={() => setOpen(a)}
                className="group flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/40 hover:border-emerald-500/40 hover:bg-card/70 transition px-2.5 py-1.5 text-left relative"
              >
                <span className={cn('relative w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0', color.bg)}>
                  {initial}
                  <span className={cn(
                    'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card',
                    a.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-muted',
                  )} />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-foreground leading-tight flex items-center gap-1.5">
                    {a.name}
                    {isNew && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">New</span>}
                  </div>
                  {modelMeta && (
                    <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-white/90 inline-flex items-center justify-center overflow-hidden">
                        <img src={modelMeta.logo} alt="" className="w-2.5 h-2.5 object-contain" />
                      </span>
                      {modelMeta.label}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-auto">
          <SheetHeader>
            <SheetTitle>{open?.name}</SheetTitle>
          </SheetHeader>
          {open && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <span className={cn('w-14 h-14 rounded-full flex items-center justify-center text-white font-display font-black text-2xl', getSwatch((open as any).avatar_color ?? 'emerald').bg)}>
                  {open.name[0]?.toUpperCase()}
                </span>
                <div>
                  <div className={cn('inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full', dept?.accent, 'bg-white/[0.04] border', dept?.border)}>
                    {dept?.label}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Model: {open.model}</div>
                  <div className="text-xs text-muted-foreground">Status: {open.status}</div>
                </div>
              </div>
              {(open as any).role_prompt && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1.5">Brain</div>
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{(open as any).role_prompt}</p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
