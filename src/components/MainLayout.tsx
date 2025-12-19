import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileHeader from "./MobileHeader";
import CollaborationHub from "./collaboration/CollaborationHub";
import AuthenticatedBackground from "./AuthenticatedBackground";
import { useIsMobile } from "@/hooks/use-mobile";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const isMobile = useIsMobile();
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);

  // Auto-close collaboration panel when navigating to a different page
  useEffect(() => {
    setShowCollaboration(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen w-full bg-background relative">
      {/* Premium Background Effects */}
      <AuthenticatedBackground />
      
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar 
          isCollapsed={isSidebarCollapsed} 
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onCollaborationToggle={() => setShowCollaboration(!showCollaboration)}
          onCloseCollaboration={() => setShowCollaboration(false)}
          showCollaboration={showCollaboration}
        />
      )}

      {/* Mobile Header */}
      {isMobile && (
        <MobileHeader 
          onCollaborationToggle={() => setShowCollaboration(!showCollaboration)}
          showCollaboration={showCollaboration}
        />
      )}
      
      <CollaborationHub 
        isOpen={showCollaboration}
        onClose={() => setShowCollaboration(false)} 
        isSidebarCollapsed={isSidebarCollapsed}
      />
      
      <main 
        className={`min-h-screen overflow-auto transition-all duration-300 relative z-10 ${
          isMobile ? 'ml-0 pt-[120px]' : isSidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        <div className={isMobile ? 'px-4 py-6' : ''}>
          {children}
        </div>
      </main>
    </div>
  );
};

export default MainLayout;
