import { useState } from 'react';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkbenchData } from './useWorkbenchData';
import WorkbenchHeader from './WorkbenchHeader';
import AgentOutputViewer from './AgentOutputViewer';
import OutputActionBar from './OutputActionBar';
import ChatErrorBoundary from '../ChatErrorBoundary';
import { Loader2, FlaskConical } from 'lucide-react';

type Tab = 'results' | 'reasoning' | 'activity';

export default function WorkbenchPanel() {
  const { selectedOutput, closeWorkbench, workbenchWidth, setWorkbenchWidth } = useChatWorkspace();
  const isMobile = useIsMobile();
  const data = useWorkbenchData(selectedOutput);
  const [tab, setTab] = useState<Tab>('results');

  if (!selectedOutput) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 text-[#7D8590]">
        <FlaskConical className="h-6 w-6 mb-2 text-[#484F58]" />
        <div className="text-[13px] text-[#C9D1D9]">Workbench</div>
        <div className="text-[12px] mt-1 max-w-xs">
          Pick a step or tool from any plan to view its output here.
        </div>
      </div>
    );
  }

  if (data.loading && !data.task && !data.toolCall) {
    return (
      <div className="h-full flex items-center justify-center text-[#7D8590] text-[12px]">
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading output…
      </div>
    );
  }

  const reasoning =
    (data.task?.output as any)?.reasoning ??
    (data.task?.output as any)?.notes ??
    (data.task?.output as any)?.thoughts ??
    null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'results', label: 'Results' },
  ];
  if (reasoning) tabs.push({ id: 'reasoning', label: 'Reasoning' });
  if (data.activity.length > 0) tabs.push({ id: 'activity', label: 'Activity' });

  // Drag-resize (desktop only)
  const onResizePointerDown = (e: React.PointerEvent) => {
    if (isMobile) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = workbenchWidth;
    const move = (ev: PointerEvent) => {
      const dx = startX - ev.clientX;
      const next = Math.max(360, Math.min(900, startW + dx));
      setWorkbenchWidth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="h-full flex flex-row">
      {!isMobile && (
        <div
          onPointerDown={onResizePointerDown}
          className="w-1 hover:w-1.5 bg-transparent hover:bg-emerald-500/30 cursor-col-resize transition-all shrink-0"
          aria-hidden
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0a0d12]">
        <WorkbenchHeader data={data} onClose={closeWorkbench} onRefresh={data.refresh} />

        {tabs.length > 1 && (
          <div className="flex items-center gap-1 px-3 border-b border-white/[0.06]">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-[12px] px-3 py-2 -mb-px border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-emerald-400 text-[#F0F6FC]'
                    : 'border-transparent text-[#7D8590] hover:text-[#C9D1D9]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 space-y-3">
          <ChatErrorBoundary>
            {tab === 'results' && (
              <>
                <AgentOutputViewer
                  task={data.task}
                  toolCall={data.toolCall}
                  agentSlug={data.agentSlug}
                  approval={data.approval}
                />
                <OutputActionBar agentSlug={data.agentSlug} />
              </>
            )}
            {tab === 'reasoning' && reasoning && (
              <div className="text-[13px] text-[#C9D1D9] whitespace-pre-wrap leading-relaxed">
                {typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning, null, 2)}
              </div>
            )}
            {tab === 'activity' && (
              <ul className="space-y-2">
                {data.activity.map((a) => (
                  <li key={a.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <div className="text-[11px] text-[#7D8590]">
                      {new Date(a.created_at).toLocaleTimeString()} · {a.event_type}
                    </div>
                    <div className="text-[12px] text-[#C9D1D9] mt-0.5">{a.title}</div>
                    {a.body && <div className="text-[11px] text-[#7D8590] mt-0.5">{a.body}</div>}
                  </li>
                ))}
              </ul>
            )}
          </ChatErrorBoundary>
        </div>
      </div>
    </div>
  );
}
