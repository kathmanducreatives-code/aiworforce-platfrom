import { cn } from '@/lib/utils';
import ChatComposerPro from './workspace/ChatComposerPro';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';

/**
 * Persistent bottom command bar. The composer itself opens the full
 * ChatWorkspace drawer on focus / submit. When the workspace is open,
 * the workspace renders its own composer, so we hide this bar.
 */
export default function GlobalChatBar() {
  const { mode } = useChatWorkspace();
  if (mode !== 'closed') return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto px-4 pb-4 pt-3',
          'bg-gradient-to-t from-background via-background/95 to-background/0',
        )}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div className="max-w-3xl mx-auto">
          <ChatComposerPro openOnFocus />
        </div>
      </div>
    </div>
  );
}
