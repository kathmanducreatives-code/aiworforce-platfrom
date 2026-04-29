import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileHeader from "./MobileHeader";
import CommandPalette from "./shared/CommandPalette";
import CommandBar from "./dock/CommandBar";
import OperativeDock from "./dock/OperativeDock";
import GlobalChatBar from "./chat/GlobalChatBar";
import AgentBuilderModal from "./agents/AgentBuilderModal";
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
          isMobile ? 'ml-0 pt-[72px]' : isSidebarCollapsed ? 'ml-16' : 'ml-[248px]'
        }`}
      >
        {/* Top Command Bar */}
        {!isMobile && (
          <div className="sticky top-0 z-30 backdrop-blur-xl bg-card/60 border-b border-border px-6 py-2.5 flex items-center justify-end">
            <CommandBar onOpen={() => setCommandOpen(true)} />
          </div>
        )}

        <div className={isMobile ? 'px-4 py-6 pb-32' : 'pb-32'}>
          {children}
        </div>
      </main>

      {/* Global Chat Bar (persistent bottom input) */}
      <GlobalChatBar />

      {/* Operative Dock (desktop only) — sits beside the chat bar */}
      {!isMobile && <OperativeDock />}

      {/* Agent Builder full-screen takeover (mounted globally) */}
      <AgentBuilderModal />
    </div>
  );
};

export default MainLayout;
