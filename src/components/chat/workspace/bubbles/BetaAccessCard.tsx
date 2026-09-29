import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { betaAccessView, isAlreadyRequested, MAX_NOTE, type BetaRequestRow } from '@/lib/beta/betaAccess';

/**
 * Request beta access, from the reply that said this workspace has no credits.
 *
 * Spend fails closed: a paid search runs only for a workspace an operator has
 * granted credits. Pilot's refusal said "request beta access" — this is that
 * request, filed as the signed-in member for their own workspace (RLS allows
 * nothing else), and then its status. An operator decides it with
 * scripts/beta/review-requests.ts; approval adds the credits.
 */
export default function BetaAccessCard() {
  const { workspaceId } = useWorkspace();
  const { user } = useAuth();
  const [latest, setLatest] = useState<BetaRequestRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const { data, error: readError } = await supabase
      .from('beta_access_requests')
      .select('id, status, credits_granted, created_at, decided_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) setError('Could not read this workspace’s beta request.');
    setLatest((data as BetaRequestRow | null) ?? null);
    setLoaded(true);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const request = async () => {
    if (!workspaceId || !user || busy) return;
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase.from('beta_access_requests').insert({
      workspace_id: workspaceId,
      requested_by: user.id,
      note: note.trim() ? note.trim().slice(0, MAX_NOTE) : null,
    });
    // A request already open for this workspace is the answer, not a failure.
    if (insertError && !isAlreadyRequested(insertError)) setError('The request could not be sent. Try again in a moment.');
    await load();
    setBusy(false);
  };

  if (!loaded) return null;
  const view = betaAccessView(latest);
  const Icon = view.state === 'approved' ? CheckCircle2 : view.state === 'pending' ? Clock : KeyRound;
  const tone = view.state === 'approved'
    ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-400/80'
    : 'border-sky-500/20 bg-sky-500/[0.04] text-sky-400/80';

  return (
    <div className={`mt-2 rounded-xl border px-3.5 py-3 max-w-[520px] ${tone}`}>
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {view.title}
      </div>
      <div className="mt-1 text-[12.5px] text-[#C9D1D9]">{view.body}</div>
      {view.canRequest && (
        <div className="mt-2.5 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE}
            rows={2}
            placeholder="Optional: what would you like to run?"
            aria-label="Note for your beta access request"
            className="w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5
                       text-[12.5px] text-[#E6EDF3] placeholder:text-[#6E7681] resize-none"
          />
          <button
            onClick={request}
            disabled={busy || !user}
            className="self-start inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md
                       border border-sky-500/30 bg-sky-500/10 text-sky-200
                       hover:bg-sky-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</> : 'Request beta access'}
          </button>
        </div>
      )}
      {error && <div className="text-[11.5px] text-amber-300 mt-2">{error}</div>}
    </div>
  );
}
