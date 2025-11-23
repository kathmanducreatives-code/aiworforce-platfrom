import { ReactNode, useState } from "react";
import Sidebar from "./Sidebar";
import CollaborationHub from "./collaboration/CollaborationHub";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);

  return (
    <div className="min-h-screen w-full bg-background">
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onCollaborationToggle={() => setShowCollaboration(!showCollaboration)}
        showCollaboration={showCollaboration}
      />
      
      {showCollaboration && (
        <CollaborationHub onClose={() => setShowCollaboration(false)} />
      )}
      
      <main 
        className={`min-h-screen overflow-auto transition-all duration-300 ${
          isSidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
