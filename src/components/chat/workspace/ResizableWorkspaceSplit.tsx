import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatPaneWidthProvider } from './ChatPaneWidthContext';

const STORAGE_KEY = 'agentory:workspace-split-ratio';
const DEFAULT_RATIO = 0.4; // chat fraction
const MIN_CHAT_PX = 360;
const MIN_WB_PX = 560;
const MIN_CHAT_FRACTION = 0.25; // workbench ≤ 75%
const MAX_CHAT_FRACTION = 0.6;

function readSavedRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RATIO;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0 || n >= 1) return DEFAULT_RATIO;
    return n;
  } catch {
    return DEFAULT_RATIO;
  }
}

function clampChatPx(desiredPx: number, containerW: number): number {
  if (containerW <= 0) return desiredPx;
  const minByPct = Math.max(MIN_CHAT_PX, containerW * MIN_CHAT_FRACTION);
  const maxByPct = Math.min(containerW - MIN_WB_PX, containerW * MAX_CHAT_FRACTION);
  // If pane too small for both mins, just keep within container bounds.
  if (maxByPct < minByPct) {
    return Math.max(MIN_CHAT_PX, Math.min(containerW - MIN_WB_PX, desiredPx));
  }
  return Math.max(minByPct, Math.min(maxByPct, desiredPx));
}

interface Props {
  chat: ReactNode;
  workbench: ReactNode;
}

export default function ResizableWorkspaceSplit({ chat, workbench }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [ratio, setRatio] = useState<number>(() => readSavedRatio());
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startChatPx: number } | null>(null);

  // Track container width
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chatPx = (() => {
    if (containerW <= 0) return 0;
    const desired = ratio * containerW;
    return Math.round(clampChatPx(desired, containerW));
  })();

  // Body class during drag — disables selection + sets resize cursor globally.
  useEffect(() => {
    if (!dragging) return;
    const cls = 'workspace-split-resizing';
    document.body.classList.add(cls);
    const style = document.createElement('style');
    style.setAttribute('data-split-drag', '');
    style.textContent = `body.${cls}{cursor:col-resize!important;user-select:none!important;}body.${cls} *{user-select:none!important;}`;
    document.head.appendChild(style);
    return () => {
      document.body.classList.remove(cls);
      style.remove();
    };
  }, [dragging]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragStateRef.current = { startX: e.clientX, startChatPx: chatPx };
    setDragging(true);
  }, [chatPx]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current || !containerRef.current) return;
    const { startX, startChatPx } = dragStateRef.current;
    const dx = e.clientX - startX;
    const next = clampChatPx(startChatPx + dx, containerRef.current.clientWidth);
    const nextRatio = next / containerRef.current.clientWidth;
    setRatio(nextRatio);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDragging(false);
    try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch { /* noop */ }
  }, [ratio]);

  const onDoubleClick = useCallback(() => {
    setRatio(DEFAULT_RATIO);
    try { localStorage.setItem(STORAGE_KEY, String(DEFAULT_RATIO)); } catch { /* noop */ }
  }, []);

  const wbPx = Math.max(0, containerW - chatPx);

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden relative" data-resizing={dragging || undefined}>
      <div
        className="flex flex-col min-w-0 min-h-0 overflow-hidden shrink-0"
        style={{ width: containerW > 0 ? chatPx : undefined, flexBasis: containerW > 0 ? chatPx : '40%' }}
      >
        <ChatPaneWidthProvider width={chatPx || 0}>
          {chat}
        </ChatPaneWidthProvider>
      </div>

      {/* Divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat and workbench"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        className={cn(
          'group relative shrink-0 w-1.5 cursor-col-resize select-none',
          'before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-px before:bg-white/[0.06]',
          'hover:before:bg-emerald-400/30 transition-colors',
          dragging && 'before:bg-emerald-400/50',
        )}
      >
        <div
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'h-8 w-3 rounded-full flex items-center justify-center',
            'bg-white/[0.04] border border-white/[0.06]',
            'group-hover:bg-emerald-500/15 group-hover:border-emerald-500/30',
            'transition-colors',
            dragging && 'bg-emerald-500/25 border-emerald-500/40',
          )}
        >
          <GripVertical className="h-3 w-3 text-white/40 group-hover:text-emerald-300" />
        </div>
      </div>

      <div
        className="flex flex-col min-w-0 min-h-0 overflow-hidden bg-[#0a0d12]"
        style={{ width: containerW > 0 ? wbPx : undefined, flex: '1 1 0%' }}
      >
        {workbench}
      </div>
    </div>
  );
}
