import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { useUserConversations, type ChatConversationRow } from '@/hooks/useUserConversations';
import { useConversationActions } from '@/hooks/useConversationActions';
import { DEPTS } from '@/lib/agentDeptIndex';
import { AGENT_PROFILES } from '@/data/agentProfiles';
import AgentAvatar from './agents/AgentAvatar';
import ConversationRowMenu from './ConversationRowMenu';
import RenameConversationDialog from './RenameConversationDialog';
import DeleteConversationDialog from './DeleteConversationDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, Plus, CheckSquare, X, Trash2 } from 'lucide-react';

type Filter = 'all' | 'active' | 'done';

function ConversationItem({
  conv,
  onRename,
  onDelete,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  conv: ChatConversationRow;
  onRename: (c: ChatConversationRow) => void;
  onDelete: (c: ChatConversationRow) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { view, setView, closeWorkbench } = useChatWorkspace();
  const rel = useRelativeTime(conv.updated_at);
  const active = view.kind === 'chat' && view.conversationId === conv.id;
  const title = (conv.title ?? '').slice(0, 40) || 'New chat';

  return (
    <div
      className={cn(
        'group relative w-full flex items-start gap-2 pl-2.5 pr-1 py-1.5 rounded-md transition-colors cursor-pointer',
        active && !selectionMode
          ? 'bg-white/[0.05] text-[#F0F6FC]'
          : selected
            ? 'bg-emerald-500/10 text-[#F0F6FC]'
            : 'text-[#7D8590] hover:text-[#F0F6FC] hover:bg-white/[0.025]',
      )}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect(conv.id);
          return;
        }
        if (!active) closeWorkbench();
        setView({ kind: 'chat', conversationId: conv.id, agentSlug: conv.agent_slug });
      }}
    >
      {active && !selectionMode && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-emerald-400" />}
      {selectionMode ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(conv.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 h-3.5 w-3.5 accent-emerald-500 cursor-pointer"
          aria-label={`Select ${title}`}
        />
      ) : (
        <AgentAvatar slug={conv.agent_slug} size="xs" ring={false} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs line-clamp-1">{title}</div>
        <div className="text-[10px] text-[#484F58] mt-0.5">{rel}</div>
      </div>
      {!selectionMode && (
        <div className="opacity-60 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <ConversationRowMenu
            onRename={() => onRename(conv)}
            onDelete={() => onDelete(conv)}
          />
        </div>
      )}
    </div>
  );
}

export default function ConversationsSidebar({ wide }: { wide?: boolean }) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { view, setView } = useChatWorkspace();
  const { conversations, state: convState, error: convError, retry } = useUserConversations();
  const { createConversation, deleteConversations } = useConversationActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState<ChatConversationRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatConversationRow | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => filter === 'all' ? true : c.status === (filter === 'active' ? 'active' : 'done'))
      .filter((c) => !q || (c.title ?? '').toLowerCase().includes(q));
  }, [conversations, filter, query]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  };

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode]);

  const runBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    const n = await deleteConversations(ids);
    setBulkDeleting(false);
    setBulkConfirmOpen(false);
    if (n > 0) exitSelection();
  };


  return (
    <aside
      className={cn(
        'shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden bg-background/80 backdrop-blur-xl',
        wide ? 'w-[300px]' : 'w-[240px]',
      )}
    >
      <div className="px-3 pt-3 pb-2 space-y-2">
        <button
          onClick={() => void createConversation('pilot')}
          className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 text-[12px] font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#484F58]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="w-full h-7 pl-7 pr-2 rounded-md bg-white/[0.03] border border-white/[0.06] text-[12px] text-[#F0F6FC] placeholder:text-[#484F58] outline-none focus:border-white/[0.12]"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            {(['all', 'active', 'done'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'text-[11px] capitalize transition-colors duration-150',
                  filter === f ? 'text-[#F0F6FC]' : 'text-[#7D8590] hover:text-[#F0F6FC]',
                )}
              >{f}</button>
            ))}
          </div>
          <button
            onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors',
              selectionMode
                ? 'text-emerald-300 hover:text-emerald-200'
                : 'text-[#7D8590] hover:text-[#F0F6FC]',
            )}
            aria-label={selectionMode ? 'Cancel selection' : 'Select chats'}
          >
            {selectionMode ? <X className="h-3 w-3" /> : <CheckSquare className="h-3 w-3" />}
            {selectionMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      </div>

      {selectionMode && (
        <div className="px-3 py-2 border-y border-white/[0.06] bg-white/[0.02] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-[#F0F6FC]">
            <span>{selectedIds.size} selected</span>
            <button
              type="button"
              className="text-[10px] text-[#7D8590] hover:text-[#F0F6FC] underline underline-offset-2"
              onClick={selectAllFiltered}
            >Select all</button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="text-[10px] text-[#7D8590] hover:text-[#F0F6FC] underline underline-offset-2"
                onClick={() => setSelectedIds(new Set())}
              >Clear</button>
            )}
          </div>
          <button
            type="button"
            disabled={selectedIds.size === 0 || bulkDeleting}
            onClick={() => setBulkConfirmOpen(true)}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors',
              selectedIds.size === 0 || bulkDeleting
                ? 'border-white/[0.06] text-[#484F58] cursor-not-allowed'
                : 'border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20',
            )}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}


      <div className="flex-1 overflow-y-auto px-1.5">
        {convState === 'loading' ? (
          <ul className="space-y-1 px-1.5 pt-2" aria-label="Loading conversations">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-start gap-2 py-1.5">
                <div className="h-5 w-5 rounded-full bg-white/[0.05] animate-pulse" />
                <div className="flex-1 space-y-1">
                  <div className="h-2.5 w-3/4 rounded bg-white/[0.05] animate-pulse" />
                  <div className="h-2 w-1/3 rounded bg-white/[0.04] animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        ) : convState === 'error' ? (
          <div className="px-2 py-3 space-y-2">
            <div className="text-xs text-red-300/90">Couldn’t load chat history.</div>
            {convError && <div className="text-[10px] text-[#484F58] line-clamp-2">{convError}</div>}
            <button
              onClick={() => retry()}
              className="text-[11px] px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[#F0F6FC]"
            >Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-[#7D8590] px-2 py-3 leading-relaxed">
            No conversations yet. Start by asking your AI workforce to run a workflow.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <ConversationItem
                  conv={c}
                  onRename={setRenameTarget}
                  onDelete={setDeleteTarget}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(c.id)}
                  onToggleSelect={toggleSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Channels */}
      <div className="px-3 pt-3 pb-2 border-t border-white/[0.06]">
        <div className="text-[10px] uppercase tracking-widest text-[#484F58] mb-1">Channels</div>
        <ul className="space-y-0.5">
          {DEPTS.map((d) => {
            const active = view.kind === 'channel' && view.dept === d.id;
            return (
              <li key={d.id}>
                <button
                  onClick={() => setView({ kind: 'channel', dept: d.id })}
                  className={cn(
                    'w-full flex items-center gap-1.5 py-1.5 text-xs transition-colors duration-150',
                    active
                      ? 'border-l-2 border-emerald-400 pl-2 text-[#F0F6FC]'
                      : 'pl-2.5 text-[#7D8590] hover:text-[#F0F6FC]',
                  )}
                >
                  <span>#</span>
                  <span>{d.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Team */}
      <div className="px-3 py-3 border-t border-white/[0.06]">
        <div className="text-[10px] uppercase tracking-widest text-[#484F58] mb-2">Your team</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {AGENT_PROFILES.map((a) => {
            const dbA = agents.find((x) => x.slug === a.id);
            const isRunning = dbA?.status === 'running';
            const active = view.kind === 'agent' && view.slug === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setView({ kind: 'agent', slug: a.id })}
                className="relative"
                title={a.name}
              >
                <AgentAvatar slug={a.id} size="xs" ring={active} />
                {isRunning && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <RenameConversationDialog
        open={!!renameTarget}
        onOpenChange={(o) => { if (!o) setRenameTarget(null); }}
        conversationId={renameTarget?.id ?? null}
        currentTitle={renameTarget?.title ?? null}
      />
      <DeleteConversationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        conversationId={deleteTarget?.id ?? null}
        title={deleteTarget?.title ?? null}
      />
    </aside>
  );
}
