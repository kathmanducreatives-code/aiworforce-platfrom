// Dev-only verification panel: pings each orchestration table and the
// orchestrate edge function, shows green ✓ + row count or red ✗ + error.
// Hidden in prod and dismissable for the session.

import { useEffect, useState } from 'react';
import { Check, X as XIcon, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { pingOrchestrate } from '@/lib/orchestration';
import { cn } from '@/lib/utils';

const TABLES = [
  'workspaces',
  'agents',
  'agent_capabilities',
  'task_plans',
  'tasks',
  'activity_feed',
  'handoffs',
  'approvals',
] as const;

type CheckState = 'idle' | 'ok' | 'fail';
interface CheckRow {
  name: string;
  state: CheckState;
  detail: string;
}

const SESSION_KEY = 'lov_verification_dismissed';

export default function VerificationPanel() {
  const isAuthRoute = typeof window !== 'undefined' && window.location.pathname === '/auth';
  const [open, setOpen] = useState(true);
  const [checks, setChecks] = useState<CheckRow[]>([
    ...TABLES.map<CheckRow>((t) => ({ name: t, state: 'idle', detail: '…' })),
    { name: 'orchestrate fn', state: 'idle', detail: '…' },
  ]);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === '1') {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!open || isAuthRoute) return;
    let cancelled = false;
    (async () => {
      setRunning(true);
      const results: CheckRow[] = [];
      for (const t of TABLES) {
        try {
          const { count, error } = await supabase
            .from(t as any)
            .select('*', { count: 'exact', head: true });
          if (error) {
            results.push({ name: t, state: 'fail', detail: error.message });
          } else {
            results.push({ name: t, state: 'ok', detail: `${count ?? 0} rows` });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ name: t, state: 'fail', detail: msg });
        }
        if (cancelled) return;
        setChecks([...results, { name: 'orchestrate fn', state: 'idle', detail: '…' }]);
      }
      try {
        const r = await pingOrchestrate();
        results.push({ name: 'orchestrate fn', state: r?.ok ? 'ok' : 'fail', detail: r?.ok ? 'reachable' : 'no ok' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ name: 'orchestrate fn', state: 'fail', detail: msg });
      }
      if (!cancelled) {
        setChecks(results);
        setRunning(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, isAuthRoute]);

  if (!open || isAuthRoute) return null;

  const failures = checks.filter((c) => c.state === 'fail').length;

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setOpen(false);
  };

  return (
    <div className="fixed bottom-24 right-4 z-[55] w-[280px] rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl p-3 text-xs font-mono">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          {running && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
            Backend Verify
          </span>
          <span className={cn(
            'px-1.5 py-0.5 rounded text-[9px] font-bold',
            failures === 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400',
          )}>
            {failures === 0 ? 'OK' : `${failures} FAIL`}
          </span>
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {checks.map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {c.state === 'ok' && <Check className="h-3 w-3 text-emerald-400 shrink-0" />}
              {c.state === 'fail' && <XIcon className="h-3 w-3 text-rose-400 shrink-0" />}
              {c.state === 'idle' && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
              <span className="text-foreground truncate">{c.name}</span>
            </div>
            <span className={cn(
              'text-[10px] truncate max-w-[120px] text-right',
              c.state === 'fail' ? 'text-rose-400' : 'text-muted-foreground',
            )} title={c.detail}>
              {c.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
