import { ReactNode, useState } from "react";
import Sidebar from "./Sidebar";
import CollaborationHub from "./collaboration/CollaborationHub";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const isMobile = useIsMobile();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);

  return (
    <div className="min-h-screen w-full bg-background">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar 
          isCollapsed={isSidebarCollapsed} 
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onCollaborationToggle={() => setShowCollaboration(!showCollaboration)}
          showCollaboration={showCollaboration}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      {isMobile && (
        <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-64">
            <Sidebar 
              isCollapsed={false} 
              onToggle={() => setIsMobileSidebarOpen(false)}
              onCollaborationToggle={() => {
                setShowCollaboration(!showCollaboration);
                setIsMobileSidebarOpen(false);
              }}
              showCollaboration={showCollaboration}
              isMobile={true}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile Hamburger Menu */}
      {isMobile && (
        <div className="fixed top-4 left-4 z-50">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsMobileSidebarOpen(true)}
            className="bg-card shadow-lg"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      )}
      
      {showCollaboration && (
        <CollaborationHub onClose={() => setShowCollaboration(false)} />
      )}
      
      <main 
        className={`min-h-screen overflow-auto transition-all duration-300 ${
          isMobile ? 'ml-0' : isSidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
