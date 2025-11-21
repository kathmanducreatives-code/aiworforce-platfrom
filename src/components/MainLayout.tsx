import { ReactNode, useState } from "react";
import Sidebar from "./Sidebar";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
