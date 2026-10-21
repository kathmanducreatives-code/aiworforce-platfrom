import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { invokeFunction } from '@/lib/agentoryApi';
import { StaleClientSelection, WorkspaceSelection, type PilotResource } from '@/lib/workspaceSelection';
import ExistingLeadImport from '@/components/leads/pilot/ExistingLeadImport';
import ClientWorkspaceSelector from '@/components/workspace/ClientWorkspaceSelector';

function SessionWorkspace({ userId, token }: { userId: string; token: string }) {
  const qc = useQueryClient();
  const controller = useMemo(() => new WorkspaceSelection(userId, async (body) => {
    const r = await invokeFunction('pilot-context', body);
    if (r.error) throw r.error;
    return r.data;
  }, () => { void qc.cancelQueries().catch(() => {}); qc.clear(); }, (() => { try { return window.sessionStorage; } catch { return null; } })()), [userId, qc, token]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    void controller.loadChoices();
    const refresh = () => { if (document.visibilityState === 'visible') void controller.loadChoices(); };
    document.addEventListener('visibilitychange', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); controller.stop(); };
  }, [controller, token]);
  const selected = state.selected;
  const revision = state.revision;
  const csvCurrent = useCallback(() => { const s = controller.snapshot(); return !!selected && s.selected === selected && s.revision === revision && !!s.context && !s.loading; }, [controller, selected, revision]);
  return <main className="relative mx-auto grid max-w-3xl gap-6 p-8">
    <header className="grid gap-3"><h1 className="text-2xl font-semibold">Outbound Outpost · client preparation</h1>
      <p className="text-sm text-muted-foreground">Select one client for Company Brain, explicitly chosen memory and existing pilot tasks. This preparation workspace does not execute tasks.</p>
      <ClientWorkspaceSelector state={state} select={(id) => { void controller.select(id).catch(() => {}); }} />
      <button className="justify-self-start underline" onClick={() => { void controller.loadChoices(); }}>Refresh authorization</button>
    </header>
    {state.loading && <p role="status">Validating client context…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.selected && <PreparationForm key={`${state.selected.workspace_id}:${state.selected.client_binding_id}:${state.revision}`} controller={controller} loading={state.loading} />}
    {import.meta.env.VITE_OUTPOST_PILOT_CSV_PREVIEW_ENABLED === 'true' && state.selected && state.context && !state.loading && <ExistingLeadImport key={`${state.selected.workspace_id}:${state.selected.client_binding_id}:${state.revision}`} scope={state.selected} current={csvCurrent} />}
    {state.context && <section><h2 className="font-semibold">Validated client context</h2><pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded border p-4 text-xs">{JSON.stringify(state.context, null, 2)}</pre></section>}
    <a className="underline" href="/dashboard">Leave client preparation</a>
  </main>;
}

function PreparationForm({ controller, loading }: { controller: WorkspaceSelection; loading: boolean }) {
  const [taskId, setTaskId] = useState('');
  const [refs, setRefs] = useState('[]');
  const run = async (action: 'read' | 'prepare' | 'resume') => {
    try {
      const resources = JSON.parse(refs) as PilotResource[];
      if (action === 'read') await controller.read(resources);
      else if (action === 'prepare') await controller.prepare(taskId, resources);
      else await controller.resume(taskId, resources);
    } catch (e) { if (!(e instanceof StaleClientSelection)) console.warn('Client preparation refused'); }
  };
  return <section className="grid gap-3">
      <label>Existing pilot task ID<input className="block w-full rounded border bg-background p-2" value={taskId} onChange={(e) => setTaskId(e.target.value)} /></label>
      <label>Explicit resource references<textarea className="block w-full rounded border bg-background p-2 font-mono" aria-label="Resource references" value={refs} onChange={(e) => setRefs(e.target.value)} /></label>
      <div className="flex flex-wrap gap-4">
        <button disabled={loading} onClick={() => void run('read')}>Read selected context</button>
        <button disabled={loading || !taskId} onClick={() => void run('prepare')}>Bind and prepare</button>
        <button disabled={loading || !taskId} onClick={() => void run('resume')}>Validate task resume</button>
      </div>
  </section>;
}

export default function OutpostWorkspace() {
  const { user, session, loading } = useAuth();
  if (import.meta.env.VITE_OUTPOST_PILOT_CONTEXT_ENABLED !== 'true') return <main className="relative p-8">Client preparation is not enabled.</main>;
  if (loading) return <main className="relative p-8">Checking session…</main>;
  if (!user || !session) return <main className="relative p-8"><a href="/auth">Sign in to select a client</a></main>;
  return <SessionWorkspace key={user.id} userId={user.id} token={session.access_token} />;
}
