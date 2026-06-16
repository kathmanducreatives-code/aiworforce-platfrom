import { AlertTriangle, RotateCw, ListFilter, Bookmark, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LeadSourcingErrorPayload {
  kind: 'lead_sourcing_error';
  title: string;
  message: string;
  source_type?: string;
  criteria?: string;
  count?: number;
  error?: string;
  retry_command?: string;   // reruns the same brief
  lead_request?: Record<string, unknown>;
}

function send(text: string, conversationId?: string) {
  window.dispatchEvent(new CustomEvent('chat:send', { detail: { text, conversation_id: conversationId } }));
}

export default function LeadSourcingErrorCard({ payload, conversationId }: { payload: LeadSourcingErrorPayload; conversationId?: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-gradient-to-b from-red-500/[0.06] to-transparent p-4 max-w-[560px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-6 w-6 rounded-md bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
        </span>
        <div className="text-[13px] font-semibold text-[#F0F6FC]">{payload.title || 'Scout could not source leads'}</div>
      </div>
      <p className="text-[12px] text-[#C9D1D9] leading-relaxed mb-2">{payload.message}</p>
      <div className="text-[11px] text-[#7D8590] space-y-0.5 mb-3">
        {payload.source_type && <div>Source: {payload.source_type}</div>}
        {payload.criteria && <div>Criteria: {payload.criteria}</div>}
        {typeof payload.count === 'number' && <div>Count: {payload.count}</div>}
        {payload.error && <div className="text-red-300/80">Error: {payload.error}</div>}
        <div className="text-emerald-400/70">No leads saved · no credits charged · nothing sent.</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {payload.retry_command && (
          <Button size="sm" onClick={() => send(payload.retry_command!, conversationId)} className="h-7 gap-1.5 bg-emerald-500/90 hover:bg-emerald-500 text-[#03100a] font-semibold text-[12px]">
            <RotateCw className="h-3 w-3" /> Retry
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => send('Find me leads.', conversationId)} className="h-7 gap-1.5 text-[12px]">
          <ListFilter className="h-3 w-3" /> Change lead source
        </Button>
        <Button size="sm" variant="outline" onClick={() => send('Save this lead brief for later.', conversationId)} className="h-7 gap-1.5 text-[12px]">
          <Bookmark className="h-3 w-3" /> Save brief for later
        </Button>
        <a href="/settings/integrations" className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-white/[0.1] text-[12px] text-[#C9D1D9] hover:bg-white/[0.04]">
          <Settings className="h-3 w-3" /> Open setup
        </a>
      </div>
    </div>
  );
}
