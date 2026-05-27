import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, Minimize2, X, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useIsMobile } from '@/hooks/use-mobile';
import ConversationsSidebar from './ConversationsSidebar';
import ConversationView from './ConversationView';
import ChannelView from './ChannelView';
import DirectAgentView from './DirectAgentView';
import EmptyState from './EmptyState';
import ChatView from './ChatView';
import ChatComposerPro from './ChatComposerPro';
import ChatErrorBoundary from './ChatErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function ChatWorkspace() {
  const { mode, view, height, close, toggleFullscreen, setHeight, setView, pending } = useChatWorkspace();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag-resize state
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(70);

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHRef.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dy = startYRef.current - e.clientY;
    const vh = window.innerHeight;
    const next = Math.max(30, Math.min(95, startHRef.current + (dy / vh) * 100));
    setHeight(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  if (mode === 'closed') return null;

  const isFull = mode === 'fullscreen';
  const computedHeight = isFull ? '100vh' : `${height}vh`;

  return (
    <TooltipProvider delayDuration={300}>
      {/* Backdrop (drawer mode only) */}
      {!isFull && (
        <motion.div
          key="chat-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        />
      )}
      <AnimatePresence>
        <motion.div
          key="chat-workspace"
          ref={containerRef}
          initial={{ y: '100%', opacity: 0.6 }}
          animate={{ y: 0, opacity: 1, height: computedHeight }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          className={cn(
            'fixed left-0 right-0 bottom-0 z-40',
            'border-t border-white/[0.06]',
            'bg-background',
            'rounded-t-2xl',
            'flex flex-col',
          )}
          role="dialog"
          aria-modal="false"
          aria-label="AI Workforce Chat"
        >
          {/* Drag handle */}
          {!isMobile && (
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={toggleFullscreen}
              className="flex items-center justify-center pt-2 pb-1 cursor-ns-resize group"
              title="Drag to resize · double-click for fullscreen"
            >
              <div className="h-[3px] w-8 rounded-full bg-white/15 group-hover:bg-white/30 transition-colors" />
            </div>
          )}

          {/* Top bar (only in fullscreen) */}
          {isFull && (
            <div className="flex items-center justify-between px-5 h-12 border-b border-border/60">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                ScreeningPilot · AI Workforce
              </div>
              <div className="flex items-center gap-1">
                <button onClick={toggleFullscreen} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground" title="Exit fullscreen">
                  <Minimize2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={close} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground" title="Close">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {!isMobile && <ConversationsSidebar wide={isFull} />}

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {/* Drawer-mode top right controls */}
              {!isFull && !isMobile && (
                <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
                  <button onClick={toggleFullscreen} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground" title="Fullscreen">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={close} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground" title="Close (Esc)">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Mobile tab nav */}
              {isMobile && <MobileNav />}

              {/* Active view */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <ChatErrorBoundary>
                  {view.kind === 'empty' && <EmptyState />}
                  {view.kind === 'conversation' && <ConversationView planId={view.planId} />}
                  {view.kind === 'channel' && <ChannelView dept={view.dept} />}
                  {view.kind === 'agent' && <DirectAgentView slug={view.slug} />}
                  {view.kind === 'chat' && view.conversationId && (
                    <ChatView
                      conversationId={view.conversationId}
                      agentSlug={view.agentSlug}
                      pendingUserText={pending?.conversationId === view.conversationId ? pending.text : null}
                      awaitingReply={pending?.conversationId === view.conversationId && pending.awaiting}
                    />
                  )}
                </ChatErrorBoundary>
              </div>

              {/* Composer */}
              <div className="border-t border-border/60 px-4 py-3 bg-background/60">
                <ChatErrorBoundary>
                  <ChatComposerPro
                    restrictDepartment={view.kind === 'channel' ? view.dept : undefined}
                    autoFocus
                  />
                </ChatErrorBoundary>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </TooltipProvider>
  );
}

function MobileNav() {
  const { view, setView } = useChatWorkspace();
  const tabs: { id: string; label: string; onClick: () => void }[] = [
    { id: 'home', label: 'Home', onClick: () => setView({ kind: 'empty' }) },
    { id: 'channels', label: '#talent', onClick: () => setView({ kind: 'channel', dept: 'talent' }) },
    { id: 'team', label: '@Aria', onClick: () => setView({ kind: 'agent', slug: 'aria' }) },
  ];
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.id} onClick={t.onClick}
          className="text-xs px-3 py-1.5 rounded-md bg-foreground/5 hover:bg-foreground/10 text-foreground/85 whitespace-nowrap">
          {t.label}
        </button>
      ))}
    </div>
  );
}
