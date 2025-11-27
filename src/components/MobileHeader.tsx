import { LayoutDashboard, BarChart3, Search, Brain, LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const MobileHeader = () => {
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
    <header className="fixed top-0 left-0 right-0 z-50 bg-card border-b border-border">
      {/* Logo/Brand Section */}
      <div className="px-4 py-3 border-b border-border">
        {profile?.logo_url ? (
          <img 
            src={profile.logo_url} 
            alt="Client logo" 
            className="h-8 w-auto" 
          />
        ) : (
          <h2 className="text-lg font-semibold text-foreground">ScreeningPilot</h2>
        )}
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
                `flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all duration-200 whitespace-nowrap min-w-fit ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
            className="flex items-center gap-2 px-4 py-2.5 text-muted-foreground hover:text-foreground whitespace-nowrap min-w-fit ml-auto"
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
