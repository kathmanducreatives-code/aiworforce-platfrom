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

interface Ctx {
  mode: ChatMode;
  view: ChatViewKind;
  height: number;
  pending: PendingState | null;
  open: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  setHeight: (h: number) => void;
  setView: (v: ChatViewKind) => void;
  setPending: (p: PendingState | null) => void;
}

const ChatWorkspaceContext = createContext<Ctx | null>(null);

export const ChatWorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ChatMode>('closed');
  const [view, setView] = useState<ChatViewKind>({ kind: 'empty' });
  const [height, setHeight] = useState<number>(70);
  const [pending, setPending] = useState<PendingState | null>(null);

  const open = useCallback(() => setMode((m) => (m === 'closed' ? 'drawer' : m)), []);
  const close = useCallback(() => setMode('closed'), []);
  const toggleFullscreen = useCallback(() => {
    setMode((m) => (m === 'fullscreen' ? 'drawer' : 'fullscreen'));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMode((m) => (m === 'closed' ? 'drawer' : 'closed'));
      } else if (meta && e.key === 'ArrowUp') {
        e.preventDefault(); setMode('fullscreen');
      } else if (meta && e.key === 'ArrowDown') {
        e.preventDefault(); setMode((m) => (m === 'fullscreen' ? 'drawer' : m));
      } else if (e.key === 'Escape') {
        setMode((m) => (m === 'closed' ? m : m === 'fullscreen' ? 'drawer' : 'closed'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ChatWorkspaceContext.Provider
      value={{ mode, view, height, pending, open, close, toggleFullscreen, setHeight, setView, setPending }}
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
