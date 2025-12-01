import { ReactNode, useState } from "react";
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);

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
          showCollaboration={showCollaboration}
        />
      )}

      {/* Mobile Header */}
      {isMobile && <MobileHeader />}
      
      {showCollaboration && (
        <CollaborationHub onClose={() => setShowCollaboration(false)} />
      )}
      
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
