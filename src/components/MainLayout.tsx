import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileHeader from "./MobileHeader";
import CommandPalette from "./shared/CommandPalette";
import CommandBar from "./dock/CommandBar";
import CommandDock from "./dock/CommandDock";
import ChatWorkspace from "./chat/workspace/ChatWorkspace";
import AgentBuilderModal from "./agents/AgentBuilderModal";
import RouteErrorBoundary from "./RouteErrorBoundary";
import WorkspaceGate from "./WorkspaceGate";
import OnboardingGate from "./OnboardingGate";
import ChatErrorBoundary from "./chat/workspace/ChatErrorBoundary";
import ProductTour from "./tour/ProductTour";
import { ChatWorkspaceProvider } from "@/contexts/ChatWorkspaceContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { collapsedFor, readPrefs, withToggle, writePrefs } from "@/lib/sidebarPolicy";

// The session's manual sidebar choices. sessionStorage, so a new session starts
// from the route defaults again; guarded, because storage can be blocked.
const sessionStore = (() => {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
})();

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const isMobile = useIsMobile();
  const location = useLocation();
  // ONE RULE, FROM THE ROUTE (see `sidebarPolicy`): the Dashboard opens
  // expanded, every working page opens compact, and a manual toggle is kept for
  // that kind of page for the rest of the session. Seeded from the current path
  // so the first paint is already right — no expand-then-collapse jump.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => collapsedFor(location.pathname, readPrefs(sessionStore)),
  );
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    setIsSidebarCollapsed(collapsedFor(location.pathname, readPrefs(sessionStore)));
  }, [location.pathname]);

  const toggleSidebar = () => {
    const next = !isSidebarCollapsed;
    writePrefs(sessionStore, withToggle(location.pathname, readPrefs(sessionStore), next));
    setIsSidebarCollapsed(next);
  };

  return (
    <ChatWorkspaceProvider>
      <div className="min-h-screen w-full bg-transparent relative">
        {/* Command Palette (global) */}
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

        {/* Desktop Sidebar */}
        {!isMobile && (
          <Sidebar
            collapsed={isSidebarCollapsed}
            onToggle={toggleSidebar}
            onOpenCommandPalette={() => setCommandOpen(true)}
          />
        )}

        {/* Mobile Header */}
        {isMobile && (
          <MobileHeader onOpenCommandPalette={() => setCommandOpen(true)} />
        )}

        <main
          className={`min-h-screen overflow-auto transition-[margin] duration-200 ease-out relative z-10 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
            isMobile ? 'ml-0 pt-[72px]' : isSidebarCollapsed ? 'ml-[68px]' : 'ml-[260px]'
          }`}
        >
          {/* Top Command Bar */}
          {!isMobile && (
            <div className="sticky top-0 z-30 backdrop-blur-md bg-[#030303]/40 border-b border-white/[0.03] px-6 py-2.5 flex items-center justify-end">
              <CommandBar onOpen={() => setCommandOpen(true)} />
            </div>
          )}

          <div className={isMobile ? 'px-4 py-6 pb-32' : 'pb-32'}>
            <RouteErrorBoundary>
              <WorkspaceGate>
                <OnboardingGate>
                  {children}
                </OnboardingGate>
              </WorkspaceGate>
            </RouteErrorBoundary>
          </div>
        </main>

        {/* Persistent command dock — unified composer + agent surface */}
        <ChatErrorBoundary>
          <CommandDock sidebarCollapsed={isSidebarCollapsed} />
        </ChatErrorBoundary>

        {/* Full Chat Workspace drawer / fullscreen */}
        <ChatErrorBoundary>
          <ChatWorkspace />
        </ChatErrorBoundary>

        {/* Agent Builder full-screen takeover (mounted globally) */}
        <AgentBuilderModal />

        {/* Premium Pilot-led product walkthrough — mounted once, opens on cue */}
        <ProductTour />
      </div>
    </ChatWorkspaceProvider>
  );
};

export default MainLayout;
