import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HelpCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { pilotChat } from '@/lib/pilotChat';
import { getPagePrompt } from './pagePromptRegistry';

interface AskPilotAboutPageProps {
  className?: string;
  variant?: 'ghost' | 'chip';
}

/**
 * Small contextual help button on each major page. Opens a chat with Pilot
 * seeded with a page-aware prompt. Uses the existing pilotChat path so
 * Company Brain context propagates automatically.
 */
export default function AskPilotAboutPage({ className, variant = 'chip' }: AskPilotAboutPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId } = useWorkspace();
  const [busy, setBusy] = useState(false);

  const { label, prompt } = getPagePrompt(location.pathname);

  const onClick = async () => {
    if (!workspaceId || busy) return;
    setBusy(true);
    try {
      const result = await pilotChat({
        message: prompt,
        workspace_id: workspaceId,
        action_source: 'ask_pilot_help',
        metadata: { page: location.pathname },
      });
      navigate('/dashboard', { state: { conversationId: result.conversation_id } });
    } catch (e) {
      toast.error('Could not open Pilot', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const base = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors';
  const style = variant === 'chip'
    ? 'h-8 px-3 rounded-full border border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-200 hover:bg-emerald-500/10 hover:border-emerald-500/40'
    : 'text-neutral-400 hover:text-emerald-300';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !workspaceId}
      className={`${base} ${style} disabled:opacity-50 ${className ?? ''}`}
      aria-label={label}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HelpCircle className="h-3.5 w-3.5" />}
      <span>{label}</span>
    </button>
  );
}
