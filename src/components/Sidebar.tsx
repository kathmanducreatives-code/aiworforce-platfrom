import { LayoutDashboard, BarChart3, Search, Brain, LogOut, Menu, X, MessageSquare, Calendar, Mail } from "lucide-react";
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
  onCloseCollaboration?: () => void;
  showCollaboration?: boolean;
  isMobile?: boolean;
}

const Sidebar = ({ isCollapsed, onToggle, onCollaborationToggle, onCloseCollaboration, showCollaboration, isMobile = false }: SidebarProps) => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const navItems = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/analytics", icon: BarChart3, label: "Analytics" },
    { to: "/lead-scraper", icon: Search, label: "Lead Scraper" },
    { to: "/deep-search", icon: Brain, label: "Deep Search" },
    { to: "/interview-scheduler", icon: Calendar, label: "Interviews" },
    { to: "/email-sequences", icon: Mail, label: "Email Sequences" },
  ];

  const handleCollaborationClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onCollaborationToggle?.();
  };

  return (
    <aside 
      className={`${isMobile ? 'relative' : 'fixed left-0 top-0'} h-screen bg-card/95 backdrop-blur-xl ${!isMobile && 'border-r border-border/50 shadow-[0_0_30px_rgba(0,0,0,0.5)]'} flex flex-col transition-all duration-300 ${!isMobile && 'z-40'} ${
        isCollapsed && !isMobile ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header with hamburger */}
      <div className="p-5 border-b border-border/50 flex items-center justify-between min-h-[72px]">
        {!isCollapsed && (
          <div className="flex-1">
            {profile?.logo_url ? (
              <img 
                src={profile.logo_url} 
                alt="Client logo" 
                className="h-12 w-auto hover:scale-105 transition-transform duration-300" 
              />
            ) : (
              <h2 className="text-xl font-bold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent tracking-tight">
                ScreeningPilot
              </h2>
            )}
          </div>
        )}
        <Button
          onClick={onToggle}
          variant="ghost"
          size="icon"
          className="h-9 w-9 hover:bg-primary/10 hover:text-primary transition-all"
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
            end={item.to === "/dashboard"}
            onClick={() => onCloseCollaboration?.()}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 relative ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(62,207,142,0.2)]"
                  : "text-muted-foreground hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_15px_rgba(62,207,142,0.15)]"
              } ${isCollapsed ? 'justify-center' : ''}`
            }
            title={isCollapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                {isActive && !isCollapsed && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-foreground rounded-r shadow-glow animate-pulse-glow" />
                )}
                <item.icon className="h-5 w-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
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
          className={`group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 relative w-full ${
            showCollaboration
              ? "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(62,207,142,0.2)]"
              : "text-muted-foreground hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_15px_rgba(62,207,142,0.15)]"
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? "Collaboration" : undefined}
        >
          {showCollaboration && !isCollapsed && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-foreground rounded-r shadow-glow animate-pulse-glow" />
          )}
          <MessageSquare className="h-5 w-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
          {!isCollapsed && (
            <span className="font-medium">Collaboration</span>
          )}
        </button>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border/50">
        <Button
          onClick={handleSignOut}
          variant="ghost"
          className={`w-full gap-3 text-muted-foreground hover:text-primary hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(62,207,142,0.15)] transition-all duration-300 ${
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
