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
import { ChatWorkspaceProvider } from "@/contexts/ChatWorkspaceContext";
import { useIsMobile } from "@/hooks/use-mobile";

interface MainLayoutProps {
  children: ReactNode;
}

const DATA_HEAVY_ROUTES = ['/lead-scraper', '/deep-search', '/candidates'];

const MainLayout = ({ children }: MainLayoutProps) => {
  const isMobile = useIsMobile();
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    if (DATA_HEAVY_ROUTES.includes(location.pathname)) {
      setIsSidebarCollapsed(true);
    }
  }, [location.pathname]);

  return (
    <ChatWorkspaceProvider>
      <div className="min-h-screen w-full bg-transparent relative">
        {/* Command Palette (global) */}
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

        {/* Desktop Sidebar */}
        {!isMobile && (
          <Sidebar
            collapsed={isSidebarCollapsed}
            onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            onOpenCommandPalette={() => setCommandOpen(true)}
          />
        )}

        {/* Mobile Header */}
        {isMobile && (
          <MobileHeader onOpenCommandPalette={() => setCommandOpen(true)} />
        )}

        <main
          className={`min-h-screen overflow-auto transition-all duration-300 relative z-10 ${
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
                {children}
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
      </div>
    </ChatWorkspaceProvider>
  );
};

export default MainLayout;
