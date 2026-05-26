import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import NotificationCenter from "./shared/NotificationCenter";
import {
  LayoutDashboard, Activity, Calendar, Search, Brain, Target, TrendingUp,
  Mail, Share2, BarChart3, LogOut, Menu, X, Command, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#050505]/65 backdrop-blur-lg border-b border-white/[0.03]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setMenuOpen(true)} className="p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors border border-transparent hover:border-white/[0.04]">
              <Menu className="h-5 w-5 text-neutral-300" />
            </button>
            <span className="text-sm font-bold text-foreground">ScreeningPilot</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onOpenCommandPalette} className="p-2 rounded-lg hover:bg-white/[0.04] transition-colors text-neutral-400 hover:text-foreground">
              <Command className="h-4 w-4" />
            </button>
            <NotificationCenter collapsed />
          </div>
        </div>

        {/* Quick nav tabs */}
        <div className="overflow-x-auto scrollbar-hide border-t border-white/[0.03]">
          <nav className="flex items-center gap-1 px-2 py-1.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-all duration-200",
                    isActive 
                      ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' 
                      : 'text-neutral-400 border-transparent hover:text-foreground hover:bg-white/[0.02]'
                  )
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
        <div className="fixed inset-0 z-[60] bg-[#050505]/95 backdrop-blur-xl animate-in slide-in-from-left duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-center text-sm font-bold text-emerald-400">
                {profile?.full_name?.[0] || 'S'}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-none">{profile?.full_name || 'ScreeningPilot'}</p>
                <p className="text-[11px] text-neutral-500 mt-1">{profile?.full_name ? 'Premium Account' : ''}</p>
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="p-1.5 rounded-lg hover:bg-white/[0.04] border border-transparent hover:border-white/[0.04]">
              <X className="h-5 w-5 text-neutral-400" />
            </button>
          </div>
          <nav className="px-3 py-4 space-y-1 overflow-y-auto max-h-[calc(100vh-140px)]">
            {[
              { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
              { to: "/screening-jobs", icon: Activity, label: "Job Screening" },
              { to: "/interview-scheduler", icon: Calendar, label: "Interviews" },
              { to: "/expert-marketplace", icon: Users, label: "Expert Interviews" },
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
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all duration-200",
                    isActive 
                      ? 'bg-white/[0.03] text-foreground border-white/[0.06] shadow-sm' 
                      : 'text-neutral-400 border-transparent hover:text-foreground hover:bg-white/[0.02]'
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0 text-neutral-400" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="absolute bottom-0 left-0 right-0 px-3 py-4 border-t border-white/[0.04] bg-[#050505]/40 backdrop-blur-md">
            <button onClick={async () => { await signOut(); navigate('/'); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:text-rose-400 hover:bg-rose-500/5 w-full transition-colors border border-transparent hover:border-rose-500/10">
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
