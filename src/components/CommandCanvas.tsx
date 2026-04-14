import { ReactNode, useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import NavigationRail from './NavigationRail';
import ContextHeader from './ContextHeader';
import ActivityTerminal from './ActivityTerminal';
import CommandPalette from './shared/CommandPalette';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

/* ─── Types ─── */

interface CommandCanvasProps {
  children: ReactNode;
}

/* ─── Page Transition Wrapper ─── */

const PageTransition = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    // Reset animation on route change
    if (prevPath.current !== location.pathname) {
      setIsVisible(false);
      prevPath.current = location.pathname;
      const frame = requestAnimationFrame(() => {
        setIsVisible(true);
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setIsVisible(true);
    }
  }, [location.pathname]);

  return (
    <div
      className="page-transition-wrapper"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 320ms cubic-bezier(0.16, 1, 0.3, 1), transform 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'opacity, transform',
        minHeight: '100%',
      }}
    >
      {children}
    </div>
  );
};

/* ─── Component ─── */

const CommandCanvas = ({ children }: CommandCanvasProps) => {
  const [commandOpen, setCommandOpen] = useState(false);
  const isMobile = useIsMobile();

  // Global keyboard shortcut: Cmd+K / Ctrl+K for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Mobile fallback — keep existing mobile layout
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-transparent relative" role="application" aria-label="ScreeningPilot Mobile">
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        <MobileHeader onOpenCommandPalette={() => setCommandOpen(true)} />
        <main className="min-h-screen overflow-auto ml-0 pt-[72px] relative z-10" aria-label="Main content">
          <div className="px-4 py-6">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    );
  }

  // Desktop — the 3-zone Command Canvas
  return (
    <div className="h-screen w-full bg-transparent relative flex overflow-hidden" role="application" aria-label="ScreeningPilot Command Center">
      {/* Command Palette (global) */}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

      {/* Zone 1: Navigation Rail (left) */}
      <nav aria-label="Primary navigation">
        <NavigationRail onOpenCommandPalette={() => setCommandOpen(true)} />
      </nav>

      {/* Main content area (right of rail) */}
      <div className="flex-1 flex flex-col ml-[64px] h-screen overflow-hidden">
        {/* Zone 2: Context Header (top) */}
        <header aria-label="System status">
          <ContextHeader />
        </header>

        {/* Scrollable content area */}
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden relative z-10 command-canvas-scrollarea"
          aria-label="Main content"
        >
          <PageTransition>{children}</PageTransition>
        </main>

        {/* Zone 3: Activity Terminal (bottom, anchored) */}
        <aside aria-label="Workforce activity feed">
          <ActivityTerminal />
        </aside>
      </div>
    </div>
  );
};

export default CommandCanvas;
