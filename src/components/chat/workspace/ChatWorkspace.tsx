import { motion, AnimatePresence } from 'framer-motion';
import { X, PanelLeft } from 'lucide-react';
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
import WorkbenchPanel from './workbench/WorkbenchPanel';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export default function ChatWorkspace() {
  const { mode, view, close, setView, pending, workbenchOpen, historyOpen, openHistory, closeHistory } = useChatWorkspace();
  const isMobile = useIsMobile();
  const showSplit = workbenchOpen && !isMobile;

  return (
    <TooltipProvider delayDuration={300}>
      <AnimatePresence>
        {mode !== 'closed' && (
          <motion.div
            key="chat-workspace"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              'fixed inset-0 z-40',
              'bg-background',
              'flex flex-col',
            )}
            style={{ height: '100dvh' }}
            role="dialog"
            aria-modal="true"
            aria-label="AI Workforce Chat"
          >
            {/* Top bar */}
            <div className="flex items-center justify-between px-3 h-12 border-b border-border/60 shrink-0">
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={openHistory}
                      className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                      aria-label="Conversation history"
                    >
                      <PanelLeft className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Conversation history</TooltipContent>
                </Tooltip>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground pl-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  ScreeningPilot · AI Workforce
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={close}
                  className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                  title="Close (Esc)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Body: 50/50 split when workbench open, otherwise chat fills */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div
                className={cn(
                  'flex flex-col min-w-0 min-h-0 overflow-hidden relative',
                  showSplit ? 'basis-1/2 flex-1' : 'flex-1',
                )}
              >
                {isMobile && <MobileNav />}

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

                <div
                  className="border-t border-border/60 px-4 py-3 bg-background/80 backdrop-blur shrink-0"
                  style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
                >
                  <ChatErrorBoundary>
                    <ChatComposerPro
                      restrictDepartment={view.kind === 'channel' ? view.dept : undefined}
                      autoFocus
                    />
                  </ChatErrorBoundary>
                </div>
              </div>

              {showSplit && (
                <div className="basis-[60%] flex-1 min-w-0 border-l border-white/[0.06] bg-[#0a0d12] overflow-hidden">
                  <ChatErrorBoundary>
                    <WorkbenchPanel />
                  </ChatErrorBoundary>
                </div>
              )}
            </div>

            {/* Workbench (mobile fullscreen overlay) */}
            {workbenchOpen && isMobile && (
              <div className="absolute inset-0 z-50 bg-[#0a0d12]">
                <ChatErrorBoundary>
                  <WorkbenchPanel />
                </ChatErrorBoundary>
              </div>
            )}

            {/* Conversation history drawer */}
            <Sheet open={historyOpen} onOpenChange={(o) => (o ? openHistory() : closeHistory())}>
              <SheetContent side="left" className="p-0 w-[300px] sm:max-w-[320px] bg-background border-r border-white/[0.06]">
                <div className="h-full flex flex-col">
                  <ConversationsSidebar wide />
                </div>
              </SheetContent>
            </Sheet>
          </motion.div>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
}

function MobileNav() {
  const { setView } = useChatWorkspace();
  const tabs: { id: string; label: string; onClick: () => void }[] = [
    { id: 'home', label: 'Home', onClick: () => setView({ kind: 'empty' }) },
    { id: 'channels', label: '#talent', onClick: () => setView({ kind: 'channel', dept: 'talent' }) },
    { id: 'team', label: '@Aria', onClick: () => setView({ kind: 'agent', slug: 'aria' }) },
  ];
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 overflow-x-auto shrink-0">
      {tabs.map((t) => (
        <button key={t.id} onClick={t.onClick}
          className="text-xs px-3 py-1.5 rounded-md bg-foreground/5 hover:bg-foreground/10 text-foreground/85 whitespace-nowrap">
          {t.label}
        </button>
      ))}
    </div>
  );
}
