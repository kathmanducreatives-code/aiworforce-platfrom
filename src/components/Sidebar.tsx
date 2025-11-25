import { LayoutDashboard, BarChart3, Search, Brain, LogOut, Menu, X, MessageSquare } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onCollaborationToggle?: () => void;
  showCollaboration?: boolean;
}

const Sidebar = ({ isCollapsed, onToggle, onCollaborationToggle, showCollaboration }: SidebarProps) => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/landing");
  };

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/analytics", icon: BarChart3, label: "Analytics" },
    { to: "/lead-scraper", icon: Search, label: "Lead Scraper" },
    { to: "/deep-search", icon: Brain, label: "Deep Search" },
  ];

  const handleCollaborationClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onCollaborationToggle?.();
  };

  return (
    <aside 
      className={`fixed left-0 top-0 h-screen bg-card border-r border-border flex flex-col transition-all duration-300 z-40 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header with hamburger */}
      <div className="p-5 border-b border-border flex items-center justify-between min-h-[72px]">
        {!isCollapsed && (
          <div className="flex-1">
            {profile?.logo_url ? (
              <img 
                src={profile.logo_url} 
                alt="Client logo" 
                className="h-12 w-auto" 
              />
            ) : (
              <h2 className="text-xl font-bold text-foreground tracking-tight">ScreeningPilot</h2>
            )}
          </div>
        )}
        <Button
          onClick={onToggle}
          variant="ghost"
          size="icon"
          className="h-9 w-9 hover:bg-muted transition-colors"
        >
          {isCollapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
        </Button>
      </div>

      {/* Navigation - No ScrollArea, fixed height */}
      <nav className="flex-1 px-3 py-6 space-y-1 overflow-hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 relative ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } ${isCollapsed ? 'justify-center' : ''}`
            }
            title={isCollapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                {isActive && !isCollapsed && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-primary-foreground rounded-r" />
                )}
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!isCollapsed && (
                  <span className="font-medium">{item.label}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
        
        {/* Collaboration Button */}
        <button
          onClick={handleCollaborationClick}
          className={`group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 relative w-full ${
            showCollaboration
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? "Collaboration" : undefined}
        >
          {showCollaboration && !isCollapsed && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-primary-foreground rounded-r" />
          )}
          <MessageSquare className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && (
            <span className="font-medium">Collaboration</span>
          )}
        </button>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <Button
          onClick={handleSignOut}
          variant="ghost"
          className={`w-full gap-3 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${
            isCollapsed ? 'justify-center px-0' : 'justify-start'
          }`}
          title={isCollapsed ? "Sign Out" : undefined}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && <span className="font-medium">Sign Out</span>}
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
