import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import type { WorkbenchArtifact } from '@/lib/workbenchArtifacts';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<WorkbenchArtifact['kind'], string> = {
  lead_results: 'Leads',
  competitor_analysis: 'Competitors',
  content_draft: 'Content',
  outreach_drafts: 'Outreach',
  website_audit: 'Audit',
  qa_report: 'QA',
  coding_prompt: 'Code',
  csv_export: 'Export',
  report: 'Report',
  generic: 'Result',
};

export default function ArtifactSwitcher() {
  const { artifactsByConversation, activeArtifactId, openArtifact, view } = useChatWorkspace();
  const conversationId = view.kind === 'chat' ? view.conversationId : null;
  const list = conversationId ? (artifactsByConversation[conversationId] ?? []) : [];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  if (list.length <= 1) return null;
  const active = list.find((a) => a.id === activeArtifactId) ?? list[list.length - 1];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[#C9D1D9] hover:bg-white/[0.06] transition-colors"
        title="Switch result"
      >
        <span className="opacity-60">Viewing:</span>
        <span className="truncate max-w-[200px]">{active.title}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-50 right-0 mt-1 w-[300px] rounded-lg border border-white/[0.08] bg-[#0a0d12] shadow-xl overflow-hidden">
          <div className="max-h-[280px] overflow-auto py-1">
            {list.slice().reverse().map((a) => {
              const isActive = a.id === active.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { openArtifact(a.id); setOpen(false); }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-[12px] hover:bg-white/[0.04] transition-colors flex items-start gap-2',
                    isActive ? 'bg-emerald-500/[0.06]' : '',
                  )}
                >
                  <span className="mt-0.5 w-3 shrink-0">
                    {isActive && <Check className="h-3 w-3 text-emerald-300" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[#F0F6FC] truncate">{a.title}</div>
                    <div className="text-[10px] text-[#7D8590] mt-0.5 flex items-center gap-1.5">
                      <span>{KIND_LABEL[a.kind]}</span>
                      <span className="opacity-40">·</span>
                      <span>{new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="opacity-40">·</span>
                      <span className="capitalize">{a.status}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
