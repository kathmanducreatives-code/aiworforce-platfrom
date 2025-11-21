import { LayoutDashboard, BarChart3, Search, Mail, LogOut, Menu, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

const Sidebar = ({ isCollapsed, onToggle }: SidebarProps) => {
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
    { to: "/deep-search", icon: Search, label: "Deep Search" },
  ];

  return (
    <aside className={`bg-card border-r border-border flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
      {/* Header with hamburger */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex-1">
            {profile?.logo_url ? (
              <img 
                src={profile.logo_url} 
                alt="Client logo" 
                className="h-12 w-auto" 
              />
            ) : (
              <h2 className="text-xl font-bold text-foreground">ScreeningPilot</h2>
            )}
          </div>
        )}
        <Button
          onClick={onToggle}
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-muted"
        >
          {isCollapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2 py-4">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                } ${isCollapsed ? 'justify-center' : ''}`
              }
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </ScrollArea>

      <div className="p-4 border-t border-border">
        <Button
          onClick={handleSignOut}
          variant="ghost"
          className={`w-full gap-3 text-muted-foreground hover:text-foreground ${isCollapsed ? 'justify-center px-0' : 'justify-start'}`}
          title={isCollapsed ? "Sign Out" : undefined}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
