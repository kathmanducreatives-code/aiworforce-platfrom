import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AgentDept } from '@/data/agentProfiles';

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
  /** Extended (optional / additive). */
  view?: 'spreadsheet' | 'cards';
  account_count?: number;
  contact_count?: number;
  locked_columns?: string[];
  available_actions?: string[];
  recommended_next_action?: LeadRecommendedAction;
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
}

const ChatWorkspaceContext = createContext<Ctx | null>(null);

export const ChatWorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ChatMode>('closed');
  const [view, setView] = useState<ChatViewKind>({ kind: 'empty' });
  const [height, setHeight] = useState<number>(70);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchWidth, setWorkbenchWidth] = useState(520);
  const [selectedOutput, setSelectedOutput] = useState<WorkbenchSelection | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const openWorkbench = useCallback((sel: WorkbenchSelection) => {
    setSelectedOutput(sel);
    setWorkbenchOpen(true);
  }, []);
  const closeWorkbench = useCallback(() => setWorkbenchOpen(false), []);
  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), []);

  const open = useCallback(() => setMode((m) => (m === 'closed' ? 'fullscreen' : m)), []);
  const close = useCallback(() => setMode('closed'), []);
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
      value={{ mode, view, height, pending, workbenchOpen, workbenchWidth, selectedOutput, historyOpen, open, close, toggleFullscreen, setHeight, setView, setPending, openWorkbench, closeWorkbench, setWorkbenchWidth, openHistory, closeHistory, toggleHistory }}
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
