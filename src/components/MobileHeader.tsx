import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import NotificationCenter from "./shared/NotificationCenter";
import {
  LayoutDashboard, Activity, Calendar, Search, Brain, Target, TrendingUp,
  Mail, Share2, BarChart3, LogOut, Menu, X, Command,
} from "lucide-react";

interface MobileHeaderProps {
  onOpenCommandPalette?: () => void;
}

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/screening-jobs", icon: Activity, label: "Jobs" },
  { to: "/lead-scraper", icon: Search, label: "Leads" },
  { to: "/deep-search", icon: Brain, label: "Search" },
  { to: "/icp-intelligence", icon: Target, label: "ICP" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
];

const MobileHeader = ({ onOpenCommandPalette }: MobileHeaderProps) => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setMenuOpen(true)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <Menu className="h-5 w-5 text-foreground" />
            </button>
            <span className="text-sm font-bold text-foreground">ScreeningPilot</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onOpenCommandPalette} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
              <Command className="h-4 w-4" />
            </button>
            <NotificationCenter collapsed />
          </div>
        </div>

        {/* Quick nav tabs */}
        <div className="overflow-x-auto scrollbar-hide border-t border-border/50">
          <nav className="flex items-center gap-0.5 px-2 py-1.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`
                }
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Full-screen mobile menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[60] bg-background animate-in slide-in-from-left duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                {profile?.company_name?.[0] || 'S'}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{profile?.company_name || 'ScreeningPilot'}</p>
                <p className="text-xs text-muted-foreground">{profile?.full_name || ''}</p>
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="p-1.5 rounded-lg hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="px-3 py-4 space-y-1">
            {[
              { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
              { to: "/screening-jobs", icon: Activity, label: "Job Screening" },
              { to: "/interview-scheduler", icon: Calendar, label: "Interviews" },
              { to: "/lead-scraper", icon: Search, label: "Lead Scraper" },
              { to: "/deep-search", icon: Brain, label: "Deep Search" },
              { to: "/icp-intelligence", icon: Target, label: "ICP Intelligence" },
              { to: "/growth-signals", icon: TrendingUp, label: "Growth Signals" },
              { to: "/email-sequences", icon: Mail, label: "Email Sequences" },
              { to: "/job-distribution", icon: Share2, label: "Job Distribution" },
              { to: "/analytics", icon: BarChart3, label: "Analytics" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="absolute bottom-0 left-0 right-0 px-3 py-4 border-t border-border">
            <button onClick={async () => { await signOut(); navigate('/'); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-red-500 hover:bg-red-500/5 w-full transition-colors">
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileHeader;
