import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Activity, Calendar, Search, Brain, Target, TrendingUp,
  Mail, Share2, BarChart3, LogOut, Settings, HelpCircle, ChevronLeft, ChevronRight,
  PanelLeftClose, PanelLeft, Command, Users, CheckSquare, ShieldCheck, Video,
  ClipboardList, Wallet, UserCircle, Briefcase, Crosshair, Zap
} from 'lucide-react';

interface NavGroup {
  label: string;
  items: { path: string; icon: any; label: string }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Recruit',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/screening-jobs', icon: Activity, label: 'Job Screening' },
      { path: '/interview-scheduler', icon: Calendar, label: 'Interviews' },
      { path: '/expert-marketplace', icon: Users, label: 'Expert Interviews' },
    ],
  },
  {
    label: 'Source',
    items: [
      { path: '/lead-scraper', icon: Search, label: 'Lead Scraper' },
      { path: '/deep-search', icon: Brain, label: 'Deep Search' },
      { path: '/icp-intelligence', icon: Target, label: 'ICP Intelligence' },
      { path: '/growth-signals', icon: TrendingUp, label: 'Growth Signals' },
    ],
  },
  {
    label: 'Engage',
    items: [
      { path: '/email-sequences', icon: Mail, label: 'Email Sequences' },
      { path: '/job-distribution', icon: Share2, label: 'Job Distribution' },
    ],
  },
  {
    label: 'Growth & Outbound',
    items: [
      { path: '/post-interceptor', icon: Crosshair, label: 'Post Interceptor' },
      { path: '/lead-crm', icon: Zap, label: 'Lead CRM' },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

const Sidebar = ({ collapsed, onToggle, onOpenCommandPalette }: SidebarProps) => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col border-r border-border bg-card/95 backdrop-blur-xl transition-all duration-300',
        collapsed ? 'w-[64px]' : 'w-[248px]'
      )}
    >
      {/* User Profile */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-border', collapsed && 'justify-center px-0')}>
        {!collapsed && (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
              {profile?.full_name?.[0] || 'S'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{profile?.full_name || 'ScreeningPilot'}</p>
              <p className="text-xs text-muted-foreground truncate">{profile?.full_name || 'Professional'}</p>
            </div>
            <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">Pro</span>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
            {profile?.full_name?.[0] || 'S'}
          </div>
        )}
      </div>

      {/* Command Palette Shortcut */}
      {!collapsed && onOpenCommandPalette && (
        <button
          onClick={onOpenCommandPalette}
          className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-card/70 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-card transition-all"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] bg-muted/70 border border-border rounded px-1 py-0.5 font-mono">⌘K</kbd>
        </button>
      )}
      {collapsed && onOpenCommandPalette && (
        <button onClick={onOpenCommandPalette} className="mx-auto mt-3 p-2 rounded-lg hover:bg-muted transition-colors">
          <Search className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-3 mb-1.5">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 relative group',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                      collapsed && 'justify-center px-2'
                    )}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                    )}
                    <item.icon className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-border px-3 py-3 space-y-0.5">
        {/* Settings button hidden until Settings page is implemented */}
        <button
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <HelpCircle className="h-4 w-4" />
          {!collapsed && <span>Help & Support</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-red-500 hover:bg-red-500/5 transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <div className="pt-1.5 border-t border-border mt-1.5">
          <button
            onClick={onToggle}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all w-full',
              collapsed && 'justify-center px-2'
            )}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
