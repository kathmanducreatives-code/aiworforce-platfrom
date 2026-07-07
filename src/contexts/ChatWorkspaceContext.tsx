import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AgentDept } from '@/data/agentProfiles';
import { setChatOpener } from '@/lib/chatCommandBus';

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
  // Extended (optional / additive) — union of main's spreadsheet metadata and
  // the branch's account/contact model. Older `lead_results` panels omit these.
  view?: 'spreadsheet' | 'cards';
  account_count?: number;
  contact_count?: number;
  locked_columns?: string[];
  available_actions?: string[];
  recommended_next_action?: LeadRecommendedAction;
  // Branch account/contact fields emitted by run-agent's ui_panel.
  can_draft?: boolean;
  contact_status?: 'needs_contact' | 'contact_found';
  recommended_persona?: { personas: string[]; primary: string; reason: string };
  next_action?: { action: string; label: string; reason: string };
  // AI Source Planner — Workbench Insights (search-strategy summary, not raw JSON).
  insights?: {
    source?: string | null;
    planner?: string | null;
    primary_query?: string | null;
    role_aliases?: string[];
    attempts?: string[];
    raw_reviewed?: number | null;
    accepted?: number | null;
    rejected?: number | null;
    duplicates?: number | null;
    main_reject_reasons?: string[];
  } | null;
  // Humanized outcome + next-action pills (complete/partial/failed).
  outcome?: { status: 'complete' | 'partial' | 'failed'; line: string; quality_lines: string[] } | null;
  next_actions?: string[];
  source_brief?: string | null;
}

export interface WorkbenchSelection {
  planId: string;
  taskId?: string | null;
  agentSlug?: string | null;
  toolCallId?: string | null;
  panel?: LeadResultsPanelMeta | null;
  conversationId?: string | null;
}

interface Ctx {
  mode: ChatMode;
  view: ChatViewKind;
  height: number;
  pending: PendingState | null;
  workbenchOpen: boolean;
  workbenchClosing: boolean;
  workbenchWidth: number;
  selectedOutput: WorkbenchSelection | null;
  historyOpen: boolean;
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
  composerFocused: boolean;
  setComposerFocused: (v: boolean) => void;
}

const ChatWorkspaceContext = createContext<Ctx | null>(null);

export const ChatWorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ChatMode>('closed');
  const [view, setView] = useState<ChatViewKind>({ kind: 'empty' });
  const [height, setHeight] = useState<number>(70);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchClosing, setWorkbenchClosing] = useState(false);
  const [workbenchWidth, setWorkbenchWidth] = useState(520);
  const [selectedOutput, setSelectedOutput] = useState<WorkbenchSelection | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerFocused, setComposerFocusedState] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // NOTE: do NOT auto-close history on focus. That coupling caused layout
  // jumps the moment the user clicked into the composer. History collapse is
  // now an explicit user action (or first-keystroke handled by the composer).
  const setComposerFocused = useCallback((v: boolean) => {
    setComposerFocusedState(v);
  }, []);

  const openWorkbench = useCallback((sel: WorkbenchSelection) => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setWorkbenchClosing(false);
    setSelectedOutput(sel);
    setWorkbenchOpen(true);
  }, []);
  const closeWorkbench = useCallback(() => {
    setWorkbenchClosing(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setWorkbenchOpen(false);
      setWorkbenchClosing(false);
      closeTimerRef.current = null;
    }, 300);
  }, []);
  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), []);

  const open = useCallback(() => setMode((m) => (m === 'closed' ? 'fullscreen' : m)), []);
  const close = useCallback(() => setMode('closed'), []);

  // Let the chat command bus open/mount the workspace when a card action fires
  // while the chat is closed (otherwise the command would be buffered forever).
  useEffect(() => {
    setChatOpener(open);
    return () => setChatOpener(null);
  }, [open]);
  const toggleFullscreen = useCallback(() => {
    setMode((m) => (m === 'closed' ? 'fullscreen' : 'closed'));
  }, []);

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

  return (
    <ChatWorkspaceContext.Provider
      value={{ mode, view, height, pending, workbenchOpen, workbenchClosing, workbenchWidth, selectedOutput, historyOpen, open, close, toggleFullscreen, setHeight, setView, setPending, openWorkbench, closeWorkbench, setWorkbenchWidth, openHistory, closeHistory, toggleHistory, composerFocused, setComposerFocused }}
    >
      {children}
    </ChatWorkspaceContext.Provider>
  );
};

export function useChatWorkspace() {
  const ctx = useContext(ChatWorkspaceContext);
  if (!ctx) throw new Error('useChatWorkspace must be used inside ChatWorkspaceProvider');
  return ctx;
}
