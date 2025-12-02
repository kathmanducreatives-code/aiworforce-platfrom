import { LayoutDashboard, BarChart3, Search, Brain, LogOut, MessageSquare } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MobileHeaderProps {
  onCollaborationToggle?: () => void;
  showCollaboration?: boolean;
}

const MobileHeader = ({ onCollaborationToggle, showCollaboration }: MobileHeaderProps) => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/landing");
  };

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/analytics", icon: BarChart3, label: "Analytics" },
    { to: "/lead-scraper", icon: Search, label: "Leads" },
    { to: "/deep-search", icon: Brain, label: "Deep Search" },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-b border-border/50 shadow-lg">
      {/* Logo/Brand Section */}
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        {profile?.logo_url ? (
          <img 
            src={profile.logo_url} 
            alt="Client logo" 
            className="h-8 w-auto hover:scale-105 transition-transform" 
          />
        ) : (
          <h2 className="text-lg font-semibold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent">
            ScreeningPilot
          </h2>
        )}
        
        {/* Collaboration Toggle */}
        <Button
          onClick={onCollaborationToggle}
          variant="ghost"
          size="icon"
          className={`h-9 w-9 transition-all duration-300 ${
            showCollaboration 
              ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(62,207,142,0.3)]" 
              : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
          }`}
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      </div>

      {/* Navigation Section */}
      <ScrollArea className="w-full">
        <nav className="flex items-center gap-1 px-2 py-2 overflow-x-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all duration-300 whitespace-nowrap min-w-fit ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(62,207,142,0.2)]"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm font-medium">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          
          <Button
            onClick={handleSignOut}
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 px-4 py-2.5 text-muted-foreground hover:text-primary hover:bg-primary/10 whitespace-nowrap min-w-fit ml-auto transition-all duration-300"
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">Sign Out</span>
          </Button>
        </nav>
      </ScrollArea>
    </header>
  );
};

export default MobileHeader;
