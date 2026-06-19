import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { AgentDept } from '@/data/agentProfiles';
import type { WorkbenchArtifact } from '@/lib/workbenchArtifacts';

export type ChatViewKind =
  | { kind: 'empty' }
  | { kind: 'conversation'; planId: string }
  | { kind: 'channel'; dept: AgentDept }
  | { kind: 'agent'; slug: string }
  | { kind: 'chat'; conversationId: string; agentSlug: string };

export type ChatMode = 'closed' | 'drawer' | 'fullscreen';

export const CHANNEL_DEFAULT_AGENT: Record<AgentDept, string> = {
  talent: 'scout',
  growth: 'penn',
  intelligence: 'hawk',
  content: 'scribe',
  operations: 'scout',
};

interface PendingState {
  conversationId: string;
  text: string;
  awaiting: boolean;
}

export interface LeadRecommendedAction {
  action: string;
  label: string;
  reason: string;
  estimated_credits?: number;
}

export interface LeadResultsPanelMeta {
  kind: 'lead_results';
  title: string;
  subtitle: string;
  source_type: string;
  lead_count: number;
  enrichable_count: number;
  lead_candidate_ids: string[];
  plan_id: string;
  actions: string[];
  view?: 'spreadsheet' | 'cards';
  account_count?: number;
  contact_count?: number;
  locked_columns?: string[];
  available_actions?: string[];
  recommended_next_action?: LeadRecommendedAction;
  can_draft?: boolean;
  contact_status?: 'needs_contact' | 'contact_found';
  recommended_persona?: { personas: string[]; primary: string; reason: string };
  next_action?: { action: string; label: string; reason: string };
  // Optional artifact metadata (forward-compat with backend `ui_panel.artifact_id`).
  artifact_id?: string;
  status?: string;
}

export interface WorkbenchSelection {
  planId: string;
  taskId?: string | null;
  agentSlug?: string | null;
  toolCallId?: string | null;
  panel?: LeadResultsPanelMeta | null;
  conversationId?: string | null;
  /** Set when the selection was derived from a registered artifact. */
  artifactId?: string | null;
}

interface Ctx {
  mode: ChatMode;
  view: ChatViewKind;
  height: number;
  pending: PendingState | null;
  workbenchOpen: boolean;
  workbenchWidth: number;
  selectedOutput: WorkbenchSelection | null;
  historyOpen: boolean;
  // Artifacts
  artifactsByConversation: Record<string, WorkbenchArtifact[]>;
  activeArtifactId: string | null;
  unseenByConversation: Record<string, number>;
  chatOnlyMode: boolean;
  open: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  setHeight: (h: number) => void;
  setView: (v: ChatViewKind) => void;
  setPending: (p: PendingState | null) => void;
  openWorkbench: (sel: WorkbenchSelection) => void;
  closeWorkbench: () => void;
  setWorkbenchWidth: (w: number) => void;
  openHistory: () => void;
  closeHistory: () => void;
  toggleHistory: () => void;
  registerArtifact: (a: WorkbenchArtifact) => void;
  openArtifact: (id: string) => void;
  clearUnseenForConversation: (conversationId: string) => void;
  forgetConversation: (conversationId: string) => void;
  setChatOnlyMode: (v: boolean) => void;
}

const ChatWorkspaceContext = createContext<Ctx | null>(null);

function selectionFromArtifact(a: WorkbenchArtifact): WorkbenchSelection {
  const panel = a.panel as LeadResultsPanelMeta | null;
  const planId =
    (panel && (panel as any).plan_id) ||
    a.plan_id ||
    `artifact:${a.id}`;
  return {
    planId,
    panel: panel && panel.kind === 'lead_results' ? panel : null,
    conversationId: a.conversation_id,
    artifactId: a.id,
  };
}

export const ChatWorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ChatMode>('closed');
  const [view, setView] = useState<ChatViewKind>({ kind: 'empty' });
  const [height, setHeight] = useState<number>(70);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchWidth, setWorkbenchWidth] = useState(520);
  const [selectedOutput, setSelectedOutput] = useState<WorkbenchSelection | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactsByConversation, setArtifactsByConversation] = useState<Record<string, WorkbenchArtifact[]>>({});
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [unseenByConversation, setUnseenByConversation] = useState<Record<string, number>>({});
  const [chatOnlyMode, setChatOnlyMode] = useState<boolean>(false);
  const seenArtifactIdsRef = useRef<Set<string>>(new Set());

  const activeConversationId = view.kind === 'chat' ? view.conversationId : null;

  const openWorkbench = useCallback((sel: WorkbenchSelection) => {
    setSelectedOutput(sel);
    setWorkbenchOpen(true);
    if (sel.artifactId) setActiveArtifactId(sel.artifactId);
  }, []);
  const closeWorkbench = useCallback(() => setWorkbenchOpen(false), []);
  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), []);

  const registerArtifact = useCallback((a: WorkbenchArtifact) => {
    setArtifactsByConversation((prev) => {
      const list = prev[a.conversation_id] ?? [];
      const idx = list.findIndex((x) => x.id === a.id);
      let next: WorkbenchArtifact[];
      if (idx >= 0) {
        next = list.slice();
        next[idx] = { ...list[idx], ...a };
      } else {
        next = [...list, a];
      }
      return { ...prev, [a.conversation_id]: next };
    });

    const isNew = !seenArtifactIdsRef.current.has(a.id);
    if (!isNew) return;
    seenArtifactIdsRef.current.add(a.id);

    if (a.conversation_id === activeConversationId && !chatOnlyMode) {
      setActiveArtifactId(a.id);
      setSelectedOutput(selectionFromArtifact(a));
      setWorkbenchOpen(true);
    } else if (a.conversation_id !== activeConversationId) {
      setUnseenByConversation((prev) => ({
        ...prev,
        [a.conversation_id]: (prev[a.conversation_id] ?? 0) + 1,
      }));
    }
  }, [activeConversationId, chatOnlyMode]);

  const openArtifact = useCallback((id: string) => {
    setArtifactsByConversation((prev) => {
      for (const conv of Object.keys(prev)) {
        const found = prev[conv].find((a) => a.id === id);
        if (found) {
          setActiveArtifactId(found.id);
          setSelectedOutput(selectionFromArtifact(found));
          setWorkbenchOpen(true);
          break;
        }
      }
      return prev;
    });
  }, []);

  const clearUnseenForConversation = useCallback((conversationId: string) => {
    setUnseenByConversation((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const forgetConversation = useCallback((conversationId: string) => {
    setArtifactsByConversation((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setUnseenByConversation((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setActiveArtifactId((cur) => {
      if (!cur) return cur;
      const list = artifactsByConversation[conversationId] ?? [];
      return list.some((a) => a.id === cur) ? null : cur;
    });
  }, [artifactsByConversation]);

  const open = useCallback(() => setMode((m) => (m === 'closed' ? 'fullscreen' : m)), []);
  const close = useCallback(() => setMode('closed'), []);
  const toggleFullscreen = useCallback(() => {
    setMode((m) => (m === 'closed' ? 'fullscreen' : 'closed'));
  }, []);

  // Clear unseen badge when the user opens that conversation.
  useEffect(() => {
    if (activeConversationId) clearUnseenForConversation(activeConversationId);
  }, [activeConversationId, clearUnseenForConversation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMode((m) => (m === 'closed' ? 'fullscreen' : 'closed'));
      } else if (e.key === 'Escape') {
        setHistoryOpen((h) => (h ? false : h));
        setMode((m) => (m === 'closed' ? m : 'closed'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<Ctx>(() => ({
    mode, view, height, pending, workbenchOpen, workbenchWidth, selectedOutput, historyOpen,
    artifactsByConversation, activeArtifactId, unseenByConversation, chatOnlyMode,
    open, close, toggleFullscreen, setHeight, setView, setPending,
    openWorkbench, closeWorkbench, setWorkbenchWidth,
    openHistory, closeHistory, toggleHistory,
    registerArtifact, openArtifact, clearUnseenForConversation, forgetConversation, setChatOnlyMode,
  }), [mode, view, height, pending, workbenchOpen, workbenchWidth, selectedOutput, historyOpen,
       artifactsByConversation, activeArtifactId, unseenByConversation, chatOnlyMode,
       open, close, toggleFullscreen, openWorkbench, closeWorkbench,
       openHistory, closeHistory, toggleHistory,
       registerArtifact, openArtifact, clearUnseenForConversation, forgetConversation]);

  return (
    <ChatWorkspaceContext.Provider value={value}>
      {children}
    </ChatWorkspaceContext.Provider>
  );
};

export function useChatWorkspace() {
  const ctx = useContext(ChatWorkspaceContext);
  if (!ctx) throw new Error('useChatWorkspace must be used inside ChatWorkspaceProvider');
  return ctx;
}
