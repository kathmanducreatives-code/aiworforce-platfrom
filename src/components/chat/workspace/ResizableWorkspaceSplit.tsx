import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatPaneWidthProvider } from './ChatPaneWidthContext';

const STORAGE_KEY = 'agentory:workspace-split-ratio';
const DEFAULT_RATIO = 0.4; // chat fraction
const MIN_CHAT_PX = 380;
const MIN_WB_PX = 620;
const MIN_CHAT_FRACTION = 0.25; // workbench ≤ 75%
const MAX_CHAT_FRACTION = 0.6;
const DIVIDER_PX = 6;

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
  const available = containerW - DIVIDER_PX;
  if (available <= 0) return desiredPx;
  const minByPct = Math.max(MIN_CHAT_PX, available * MIN_CHAT_FRACTION);
  const maxByPct = Math.min(available - MIN_WB_PX, available * MAX_CHAT_FRACTION);
  if (maxByPct < minByPct) {
    // not enough space — keep within bounds
    return Math.max(MIN_CHAT_PX, Math.min(available - MIN_WB_PX, desiredPx));
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
  const dragRef = useRef<{ startX: number; startChatPx: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chatPx = containerW > 0
    ? Math.round(clampChatPx(ratio * containerW, containerW))
    : 0;

  // Global drag affordances
  useEffect(() => {
    if (!dragging) return;
    const cls = 'workspace-split-resizing';
    document.body.classList.add(cls);
    const style = document.createElement('style');
    style.textContent = `body.${cls}{cursor:col-resize!important;user-select:none!important;}body.${cls} *{user-select:none!important;cursor:col-resize!important;}`;
    document.head.appendChild(style);
    return () => {
      document.body.classList.remove(cls);
      style.remove();
    };
  }, [dragging]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startChatPx: chatPx };
    setDragging(true);
  }, [chatPx]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !containerRef.current) return;
    const { startX, startChatPx } = dragRef.current;
    const clientX = e.clientX;
    const w = containerRef.current.clientWidth;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const next = clampChatPx(startChatPx + (clientX - startX), w);
      setRatio(next / w);
    });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDragging(false);
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch { /* noop */ }
  }, [ratio]);

  const onDoubleClick = useCallback(() => {
    setRatio(DEFAULT_RATIO);
    try { localStorage.setItem(STORAGE_KEY, String(DEFAULT_RATIO)); } catch { /* noop */ }
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 grid overflow-hidden relative"
      style={{
        gridTemplateColumns: containerW > 0
          ? `${chatPx}px ${DIVIDER_PX}px 1fr`
          : `minmax(0, 2fr) ${DIVIDER_PX}px minmax(0, 3fr)`,
      }}
      data-resizing={dragging || undefined}
    >
      <div className="min-w-0 min-h-0 overflow-hidden flex flex-col">
        <ChatPaneWidthProvider width={chatPx || 0}>
          {chat}
        </ChatPaneWidthProvider>
      </div>

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
          'group relative cursor-col-resize select-none touch-none',
          'before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-px before:bg-white/[0.06]',
          'hover:before:bg-emerald-400/30 transition-colors',
          dragging && 'before:bg-emerald-400/60',
        )}
      >
        <div
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'h-7 w-3 rounded-full flex items-center justify-center',
            'bg-white/[0.04] border border-white/[0.06]',
            'group-hover:bg-emerald-500/15 group-hover:border-emerald-500/30 transition-colors',
            dragging && 'bg-emerald-500/25 border-emerald-500/40',
          )}
        >
          <GripVertical className="h-3 w-3 text-white/40 group-hover:text-emerald-300" />
        </div>
      </div>

      <div className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-[#0a0d12]">
        {workbench}
      </div>
    </div>
  );
}
