import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import AgentAvatar from './AgentAvatar';
import StatusPill from './StatusPill';
import { AGENTS, accentClasses } from './agents';
import type { AgentState } from '@/hooks/useWorkforceState';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  state: AgentState | null;
}

export default function AgentProfileDrawer({ open, onClose, state }: Props) {
  const navigate = useNavigate();
  if (!state) return null;
  const meta = AGENTS[state.id];
  const c = accentClasses[meta.accent];

  const askAgent = () => {
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text: `${meta.name}, what are you working on?` } }));
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-black/85 backdrop-blur-2xl border-white/[0.06] p-0 overflow-y-auto">
        <SheetHeader className="p-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-start gap-4">
            <AgentAvatar id={state.id} size={64} status={state.status} active />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[18px] font-semibold text-white">{meta.name}</SheetTitle>
              <SheetDescription className="text-[12px] text-neutral-400 mt-0.5">{meta.role}</SheetDescription>
              <div className="mt-2"><StatusPill status={state.status} label={state.statusText} /></div>
            </div>
          </div>
          <p className="text-[12px] text-neutral-400 mt-3">{meta.blurb}</p>
        </SheetHeader>

        <div className="p-6 space-y-5">
          <Section title="Current mission">
            <p className="text-[13px] text-neutral-200">{state.statusText}</p>
          </Section>

          <Section title="Today's output">
            <p className={cn('text-[14px] font-medium', c.text)}>{state.todayOutput}</p>
            {state.context && <p className="text-[12px] text-neutral-400 mt-1">{state.context}</p>}
          </Section>

          {state.blockedReason && (
            <Section title="Blocked by">
              <p className="text-[13px] text-rose-300/90">{state.blockedReason}</p>
            </Section>
          )}

          <div className="pt-2 flex flex-col gap-2">
            {state.nextAction.route && (
              <button
                onClick={() => { navigate(state.nextAction.route!); onClose(); }}
                className="inline-flex items-center justify-between gap-2 h-10 px-4 rounded-lg text-[13px] font-medium text-black bg-gradient-to-b from-emerald-300 to-emerald-500 hover:from-emerald-200 hover:to-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.30)]"
              >
                <span>{state.nextAction.label}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={askAgent}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-[13px] text-neutral-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]"
            >
              <MessageCircle className="h-4 w-4" />
              Ask {meta.name}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">{title}</p>
      {children}
    </div>
  );
}
