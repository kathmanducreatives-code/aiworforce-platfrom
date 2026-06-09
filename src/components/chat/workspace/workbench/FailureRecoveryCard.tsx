import { AlertTriangle, RefreshCw, Plug, ArrowLeftRight, Sparkles } from 'lucide-react';
import { friendlyError } from './errorCopy';
import type { DBToolCall, DBTask } from '@/lib/orchestration';

function prefill(text: string) {
  window.dispatchEvent(new CustomEvent('chat:prefill', { detail: text }));
}

interface Props {
  toolCall: DBToolCall | null;
  task: DBTask | null;
}

export default function FailureRecoveryCard({ toolCall, task }: Props) {
  const rawCode =
    toolCall?.error ??
    (toolCall?.output_json && (toolCall.output_json.error || toolCall.output_json.code)) ??
    null;
  const provider = toolCall?.provider ?? null;
  const tool = toolCall?.tool_name ?? '—';
  const step = task?.description ?? '—';

  const info = friendlyError(typeof rawCode === 'string' ? rawCode : null, provider ?? undefined);

  const actions: Array<{ key: string; label: string; icon: any; onClick: () => void }> = [];
  for (const r of info.recovery) {
    if (r === 'retry')
      actions.push({ key: 'retry', label: 'Retry run', icon: RefreshCw, onClick: () => prefill('@Pilot retry the last step') });
    if (r === 'reconnect')
      actions.push({
        key: 'reconnect',
        label: `Reconnect ${info.reconnectProvider ?? provider ?? 'tool'}`,
        icon: Plug,
        onClick: () => prefill(`@Pilot help me reconnect ${info.reconnectProvider ?? provider ?? 'the tool'}`),
      });
    if (r === 'switch_source')
      actions.push({
        key: 'switch',
        label: 'Switch sourcing method',
        icon: ArrowLeftRight,
        onClick: () => prefill('@Pilot use an alternative sourcing method for this task'),
      });
    if (r === 'ask_alternative')
      actions.push({
        key: 'alt',
        label: 'Ask Pilot for alternative',
        icon: Sparkles,
        onClick: () => prefill('@Pilot suggest an alternative approach for this task'),
      });
  }

  return (
    <div className="rounded-xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.06] to-transparent p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#F0F6FC]">{info.title}</div>
          <div className="mt-1 text-[12px] text-[#C9D1D9] leading-relaxed">{info.body}</div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#7D8590]">Tool</div>
              <div className="text-[#F0F6FC] mt-0.5 truncate">{provider ?? tool}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#7D8590]">Step</div>
              <div className="text-[#F0F6FC] mt-0.5 truncate">{step}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#7D8590]">Error type</div>
              <div className="text-[#F0F6FC] mt-0.5 truncate">{info.errorType}</div>
            </div>
          </div>

          {rawCode && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded border border-white/[0.08] bg-white/[0.03] text-[#7D8590]">
              <span className="text-amber-300/80">code</span>
              <span>{String(rawCode)}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.key}
                  onClick={a.onClick}
                  className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/40 transition-colors"
                >
                  <Icon className="h-3 w-3" /> {a.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
