import { useMemo, useState, useRef, useEffect } from 'react';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { useUserConversations, type ChatConversationRow } from '@/hooks/useUserConversations';
import { DEPTS } from '@/lib/agentDeptIndex';
import { AGENT_PROFILES, AGENT_BY_ID } from '@/data/agentProfiles';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Filter = 'all' | 'active' | 'done';

const AGENT_HEX: Record<string, string> = {
  scout: '#3B82F6',
  aria: '#8B5CF6',
  penn: '#10B981',
  hawk: '#14B8A6',
  scribe: '#A855F7',
};

function InitialCircle({ slug, name, size = 24, active = false }: { slug: string; name: string; size?: number; active?: boolean }) {
  const hex = AGENT_HEX[slug] ?? '#7D8590';
  const alpha = active ? '40' : '26';
  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{
        width: size, height: size,
        backgroundColor: `${hex}${alpha}`, color: hex,
        fontSize: size <= 20 ? 10 : 11, fontWeight: active ? 600 : 500, lineHeight: 1,
      }}
      aria-label={name}
    >{name.charAt(0).toUpperCase()}</div>
  );
}

function ConversationItem({
  conv, onAskDelete,
}: {
  conv: ChatConversationRow;
  onAskDelete: (c: ChatConversationRow) => void;
}) {
  const { view, setView, unseenByConversation, artifactsByConversation } = useChatWorkspace();
  const { renameConversation } = useUserConversations();
  const rel = useRelativeTime(conv.updated_at);
  const active = view.kind === 'chat' && view.conversationId === conv.id;
  const profile = AGENT_BY_ID[conv.agent_slug];
  const title = (conv.title ?? '').slice(0, 30) || 'New chat';
  const unseen = unseenByConversation[conv.id] ?? 0;
  const hasResults = (artifactsByConversation[conv.id] ?? []).length > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const commitRename = async () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== title) {
      await renameConversation(conv.id, draft.trim());
    }
  };

  return (
    <div
      ref={wrapRef}
      className={cn(
        'group relative w-full py-1.5 px-2 rounded-md transition-colors flex items-start gap-2',
        active ? 'bg-white/[0.04] text-[#F0F6FC]' : 'text-[#7D8590] hover:text-[#F0F6FC] hover:bg-white/[0.02]',
      )}
    >
      <button
        onClick={() => !editing && setView({ kind: 'chat', conversationId: conv.id, agentSlug: conv.agent_slug })}
        className="flex items-start gap-2 flex-1 min-w-0 text-left"
        type="button"
      >
        <InitialCircle slug={conv.agent_slug} name={profile?.name ?? conv.agent_slug} size={24} />
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { setEditing(false); setDraft(title); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-xs bg-transparent border border-white/10 rounded px-1 py-0.5 text-[#F0F6FC] focus:outline-none focus:border-emerald-500/40"
              maxLength={120}
            />
          ) : (
            <div className="text-xs line-clamp-1 flex items-center gap-1.5">
              <span className="truncate">{title}</span>
              {unseen > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="New result" />
              )}
              {hasResults && unseen === 0 && (
                <span className="h-1 w-1 rounded-full bg-white/20 shrink-0" title="Has results" />
              )}
            </div>
          )}
          <div className="text-[10px] text-[#484F58] mt-0.5">{rel}</div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-6 w-6 inline-flex items-center justify-center rounded text-[#7D8590] hover:text-[#F0F6FC] hover:bg-white/[0.06]"
        aria-label="Conversation menu"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <div className="absolute right-1 top-9 z-50 w-[150px] rounded-md border border-white/[0.08] bg-[#0a0d12] shadow-xl overflow-hidden py-1">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setDraft(title); setEditing(true); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-[#C9D1D9] hover:bg-white/[0.05] flex items-center gap-2"
          >
            <Pencil className="h-3 w-3" /> Rename
          </button>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); onAskDelete(conv); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-rose-300 hover:bg-rose-500/10 flex items-center gap-2"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function ConversationsSidebar({ wide }: { wide?: boolean }) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { view, setView, closeWorkbench, forgetConversation } = useChatWorkspace();
  const { conversations, deleteConversation } = useUserConversations();
  const [filter, setFilter] = useState<Filter>('all');
  const [toDelete, setToDelete] = useState<ChatConversationRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'all') return conversations;
    return conversations.filter((c) => c.status === (filter === 'active' ? 'active' : 'done'));
  }, [conversations, filter]);

  const handleConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const wasActive = view.kind === 'chat' && view.conversationId === toDelete.id;
    const { error } = await deleteConversation(toDelete.id);
    setDeleting(false);
    if (error) return; // optimistic update already reverted via realtime
    forgetConversation(toDelete.id);
    if (wasActive) {
      closeWorkbench();
      setView({ kind: 'empty' });
    }
    setToDelete(null);
  };

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden bg-background/40',
        wide ? 'w-[260px]' : 'w-[220px]',
      )}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-widest text-[#484F58] mb-2">Conversations</div>
        <div className="flex items-center gap-3">
          {(['all', 'active', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'text-[12px] capitalize transition-colors duration-150',
                filter === f ? 'text-[#F0F6FC]' : 'text-[#7D8590] hover:text-[#F0F6FC]',
              )}
            >{f}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5">
        {filtered.length === 0 ? (
          <div className="text-xs text-[#484F58] px-2 py-3">No conversations.</div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}><ConversationItem conv={c} onAskDelete={setToDelete} /></li>
            ))}
          </ul>
        )}
      </div>

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
                      ? 'border-l-2 border-white pl-2 text-[#F0F6FC]'
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
                <InitialCircle slug={a.id} name={a.name} size={24} active={active} />
                {isRunning && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes "{toDelete?.title ?? 'New chat'}" and its messages. Results saved to other surfaces are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              disabled={deleting}
              className="bg-rose-500 hover:bg-rose-600 text-white"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
